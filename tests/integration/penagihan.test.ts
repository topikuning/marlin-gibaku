/*
 * HALAMAN PENAGIHAN (DECISIONS 720) – status 42 berkas termin diturunkan dari
 * dokumen, surat, dan jadwal; unggah per baris memberi penanda butir & termin;
 * dokumen tetap berlaku lintas termin, NIB/NPWP lintas paket perusahaan yang
 * sama; gerbang kapabilitas dan isolasi organisasi.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async () => {},
  r2Delete: async () => {},
  classifyR2Error: (e: unknown) => String(e),
}));

let peran: SessionUser["role"] = "super_admin";
let pengguna: SessionUser | null = null;
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  return {
    ...asli,
    getCurrentUser: async () => (pengguna ? { ...pengguna, role: peran } : null),
    requireCapability: async (cap: Parameters<typeof can>[1]) => {
      if (!can(peran, cap)) throw new asli.ForbiddenError("Tidak berhak.");
      return { ...pengguna!, role: peran };
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { can } = await import("@/lib/authz");
const { UserRole } = await import("@/generated/prisma/enums");
const { muatPenagihan } = await import("@/lib/penagihan/data");
const { unggahBerkasTerminAction } = await import("@/lib/penagihan/actions");

const suffix = `pg${Date.now().toString(36)}`;
let orgId = "";
let paketA = "";
let paketB = "";
let paketVendorLain = "";
let urut = 0;

function berkas(nama = "berkas.pdf") {
  return new File([`isi ${nama} ${++urut} ${suffix}`], nama, { type: "application/pdf" });
}
function unggah(packageId: string, terminKe: number, kode: string, locationId?: string) {
  const f = new FormData();
  f.set("packageId", packageId);
  f.set("terminKe", String(terminKe));
  f.set("kode", kode);
  if (locationId) f.set("locationId", locationId);
  f.set("file", berkas(`${kode}.pdf`));
  return unggahBerkasTerminAction(undefined, f);
}
const sesi = () => ({ ...pengguna!, role: "super_admin" as const });
async function status(packageId: string, terminKe: number) {
  const d = await muatPenagihan(packageId, sesi(), terminKe);
  return new Map(d!.langkah.flatMap((l) => l.baris).map((b) => [b.butir.kode, b]));
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org PG ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const u = await db.user.create({
    data: { orgId, username: `sa-${suffix}`, fullName: "Admin Tagih", passwordHash: "x", role: "super_admin", mustChangePassword: false },
  });
  pengguna = u as unknown as SessionUser;
  const vendor = await db.vendor.create({ data: { orgId, name: `CV. Tagih ${suffix}` } });
  const vendorLain = await db.vendor.create({ data: { orgId, name: `CV. Lain ${suffix}` } });
  const paket = async (n: string, vendorId: string) => {
    const p = await db.package.create({ data: { orgId, name: `Paket ${n} ${suffix}`, stage: "pelaksanaan" } });
    await db.contract.create({
      data: { packageId: p.id, vendorId, contractNumber: `K-${n}-${suffix}`, contractValue: 1_000_000_000n, signedDate: new Date("2026-07-15T00:00:00Z") },
    });
    await db.location.create({
      data: { packageId: p.id, name: `Desa ${n}`, slug: `desa-${n}-${suffix}`, village: "D", regency: "K", province: "P" },
    });
    return p.id;
  };
  paketA = await paket("a", vendor.id);
  paketB = await paket("b", vendor.id);
  paketVendorLain = await paket("c", vendorLain.id);
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("muatPenagihan", () => {
  it("kontrak baru: jadwal bawaan 4 termin, termin 1 dipilih, 42 berkas dengan status menurut asalnya", async () => {
    const d = await muatPenagihan(paketA, sesi());
    expect(d!.daftarTermin.map((t) => t.ambangPct)).toEqual([25, 50, 80, 100]);
    expect(d!.terminKe).toBe(1);
    // 46 butir; 9 duplikat BERKAS DOKUMEN TEKNIS tidak dihitung (DECISIONS 725).
    expect(d!.ringkas.total).toBe(37);
    expect(d!.langkah).toHaveLength(9);
    const s = await status(paketA, 1);
    expect(s.get("9a")!.status).toBe("belum_dibuat");
    expect(s.get("5")!.status).toBe("disiapkan_marlin");
    expect(s.get("3")!.status).toBe("belum_diunggah");
    expect(s.get("9c")!.status).toBe("menunggu");
    // Termin 4 membawa retensi 5%: dibayar 20% dari 1 miliar.
    const t4 = await muatPenagihan(paketA, sesi(), 4);
    expect(t4!.termin.dibayar).toBe(200_000_000n);
    expect(t4!.termin.retensi).toBe(50_000_000n);
  });

  it("dokumen paket biasa (SPMK di menu Dokumen) memenuhi butirnya, lengkap dengan tautan melihatnya", async () => {
    const { uploadDocument } = await import("@/lib/documents");
    const doc = await uploadDocument(
      { file: berkas("spmk.pdf"), packageId: paketA, phase: "mulai_kerja", type: "spmk", title: "SPMK" },
      pengguna!.id,
    );
    const b = (await status(paketA, 1)).get("3")!;
    expect(b.status).toBe("ada");
    expect(b.rujukan?.href).toBe(`/api/documents/${doc.id}`);
  });

  it("surat yang dibuat memenuhi butirnya untuk termin itu saja", async () => {
    const k = await db.contract.findFirstOrThrow({ where: { packageId: paketA }, select: { id: true } });
    const s = await db.suratPenyedia.create({
      data: { contractId: k.id, jenis: "permohonan_pemeriksaan", terminKe: 1, nomor: "PP/1", tanggal: new Date("2026-09-15T00:00:00Z"), kota: "Bogor", dibuatOlehId: pengguna!.id },
    });
    const b = (await status(paketA, 1)).get("9a")!;
    expect(b.status).toBe("ada");
    expect(b.rujukan?.href).toBe(`/api/surat-penyedia/${s.id}/pdf`);
    expect((await status(paketA, 2)).get("9a")!.status).toBe("belum_dibuat");
  });
});

describe("unggah dari baris daftar periksa", () => {
  it("berkas per termin: tercatat untuk termin itu saja", async () => {
    expect((await unggah(paketA, 1, "9c"))?.success).toMatch(/termin 1/);
    const doc = await db.document.findFirstOrThrow({ where: { packageId: paketA, butirTermin: "9c" } });
    expect(doc).toMatchObject({ terminKe: 1, title: "9c. BA Pemeriksaan Hasil Pekerjaan – Termin 1" });
    expect((await status(paketA, 1)).get("9c")!.status).toBe("ada");
    expect((await status(paketA, 2)).get("9c")!.status).toBe("menunggu");
    // Sesudah termin 2 punya BA-nya sendiri, tautan "Lihat" tiap termin
    // menunjuk berkas termin itu, bukan berkas termin lain.
    await unggah(paketA, 2, "9c");
    const doc2 = await db.document.findFirstOrThrow({ where: { packageId: paketA, butirTermin: "9c", terminKe: 2 } });
    expect((await status(paketA, 1)).get("9c")!.rujukan?.href).toBe(`/api/documents/${doc.id}`);
    expect((await status(paketA, 2)).get("9c")!.rujukan?.href).toBe(`/api/documents/${doc2.id}`);
  });

  it("dokumen tetap (SSUK & SKK) tanpa termin: berlaku di semua termin; folder duplikat T12 cukup di no. 2", async () => {
    // Folder duplikat menolak unggahan dan menunjuk butir utamanya.
    expect((await unggah(paketA, 1, "T12"))?.error).toMatch(/cukup diisi di 2\. SSUK & SKK/);
    expect((await unggah(paketA, 1, "2"))?.success).toMatch(/semua termin/);
    const doc = await db.document.findFirstOrThrow({ where: { packageId: paketA, butirTermin: "2" } });
    expect(doc.terminKe).toBeNull();
    const s3 = await status(paketA, 3);
    expect(s3.get("2")!.status).toBe("ada");
    expect(s3.get("T12")!.status).toBe("ada");
  });

  it("NIB milik perusahaan: diunggah di paket A, terpenuhi juga di paket B perusahaan yang sama, tidak di perusahaan lain", async () => {
    expect((await unggah(paketA, 1, "10h"))?.success).toBeTruthy();
    expect((await status(paketB, 2)).get("10h")!.status).toBe("ada");
    expect((await status(paketVendorLain, 1)).get("10h")!.status).toBe("belum_diunggah");
  });

  it("peran tanpa izin unggah dokumen ditolak; butir asing dan paket organisasi lain ditolak", async () => {
    const tanpaIzin = Object.values(UserRole).find((r) => !can(r, "document.upload"))!;
    peran = tanpaIzin;
    try {
      expect((await unggah(paketA, 1, "9d"))?.error).toBeTruthy();
    } finally {
      peran = "super_admin";
    }
    expect((await unggah(paketA, 1, "99"))?.error).toMatch(/tidak dikenal/);

    const lain = await db.organization.create({ data: { name: `Org Lain ${suffix}`, slug: `lain-${suffix}` } });
    const pLain = await db.package.create({ data: { orgId: lain.id, name: "Paket Lain" } });
    expect((await unggah(pLain.id, 1, "9d"))?.error).toMatch(/tidak ditemukan/);
    expect(await db.document.count({ where: { butirTermin: "9d" } })).toBe(0);
  });
});

describe("paket multi-lokasi (DECISIONS 725)", () => {
  let paketM = "";
  const lok: Record<string, string> = {};

  beforeAll(async () => {
    const vendor = await db.vendor.create({ data: { orgId, name: `CV. Multi ${suffix}` } });
    const p = await db.package.create({ data: { orgId, name: `Paket multi ${suffix}`, stage: "pelaksanaan" } });
    paketM = p.id;
    await db.contract.create({
      data: { packageId: p.id, vendorId: vendor.id, contractNumber: `K-M-${suffix}`, contractValue: 1_000_000_000n, signedDate: new Date("2026-07-15T00:00:00Z") },
    });
    for (const [nama, aktif] of [["Asemdoyong", true], ["Muarareja", true], ["Lama", false]] as const) {
      const l = await db.location.create({
        data: { packageId: p.id, name: nama, slug: `${nama.toLowerCase()}-${suffix}`, village: nama, regency: "K", province: "P", isActive: aktif },
      });
      lok[nama] = l.id;
    }
  });

  it("RAB tiap lokasi diambil dari berkas Excel revisi RAB aktif; satu lokasi saja = 'sebagian', bukan 'ada'", async () => {
    const { uploadDocument } = await import("@/lib/documents");
    const excel = await uploadDocument(
      { file: berkas("Lampiran NEGO Asemdoyong.xlsx"), packageId: paketM, locationId: lok.Asemdoyong, phase: "kontrak", type: "hps", title: "RAB Asemdoyong" },
      pengguna!.id,
    );
    await db.rabRevision.create({
      data: { locationId: lok.Asemdoyong, revisionNo: 0, source: "hps_awal", status: "aktif", totalValue: 1n, sourceDocumentId: excel.id },
    });
    const rab = (await status(paketM, 1)).get("12")!;
    expect(rab.status).toBe("sebagian");
    expect(rab.lokasi!.map((l) => [l.nama, l.status])).toEqual([
      ["Asemdoyong", "ada"],
      ["Muarareja", "belum_diunggah"],
    ]);
    expect(rab.lokasi![0].berkas[0].href).toBe(`/api/documents/${excel.id}`);
  });

  it("Excel revisi RAB draft/digantikan dan dokumen lokasi nonaktif tidak ikut sebagai RAB berkas termin", async () => {
    const { uploadDocument } = await import("@/lib/documents");
    const ex = (nama: string, locationId: string) =>
      uploadDocument({ file: berkas(nama), packageId: paketM, locationId, phase: "kontrak", type: "hps", title: nama }, pengguna!.id);
    const lama = await ex("RAB Muarareja revisi lama.xlsx", lok.Muarareja);
    const draf = await ex("RAB Muarareja draf.xlsx", lok.Muarareja);
    const mati = await ex("RAB Lama.xlsx", lok.Lama);
    await db.rabRevision.createMany({
      data: [
        { locationId: lok.Muarareja, revisionNo: 0, source: "hps_awal", status: "digantikan", totalValue: 1n, sourceDocumentId: lama.id },
        { locationId: lok.Muarareja, revisionNo: 1, source: "hps_awal", status: "draft", totalValue: 1n, sourceDocumentId: draf.id },
        { locationId: lok.Lama, revisionNo: 0, source: "hps_awal", status: "aktif", totalValue: 1n, sourceDocumentId: mati.id },
      ],
    });
    const rab = (await status(paketM, 1)).get("12")!;
    expect(rab.berkas.map((b) => b.judul)).toEqual(["RAB Asemdoyong"]);
    expect(rab.lokasi!.map((l) => [l.nama, l.status])).toEqual([
      ["Asemdoyong", "ada"],
      ["Muarareja", "belum_diunggah"],
    ]);
    expect(rab.sumber).toHaveLength(1);
    // Begitu revisi drafnya diaktifkan, Excel-nya yang dipakai.
    await db.rabRevision.updateMany({ where: { sourceDocumentId: draf.id }, data: { status: "aktif" } });
    expect((await status(paketM, 1)).get("12")!.lokasi!.map((l) => l.status)).toEqual(["ada", "ada"]);
  });

  it("unggah per lokasi: berkas tercatat untuk lokasi itu; lokasi lengkap = 'ada'", async () => {
    expect((await unggah(paketM, 1, "4", lok.Muarareja))?.success).toMatch(/Muarareja/);
    const doc = await db.document.findFirstOrThrow({ where: { packageId: paketM, butirTermin: "4" } });
    expect(doc).toMatchObject({ locationId: lok.Muarareja, terminKe: 1 });
    expect(doc.title).toContain("Muarareja");
    const shop = (await status(paketM, 1)).get("4")!;
    expect(shop.lokasi!.map((l) => l.status)).toEqual(["belum_diunggah", "ada"]);
    expect((await unggah(paketM, 1, "4", lok.Asemdoyong))?.success).toBeTruthy();
    expect((await status(paketM, 1)).get("4")!.status).toBe("ada");
  });

  it("dokumen tanpa lokasi berlaku untuk seluruh paket; semua berkas tampil, bukan hanya yang pertama", async () => {
    await unggah(paketM, 1, "T16");
    expect((await status(paketM, 1)).get("T16")!.status).toBe("ada");
    await unggah(paketM, 1, "3");
    await unggah(paketM, 1, "3");
    expect((await status(paketM, 1)).get("3")!.berkas).toHaveLength(2);
  });

  it("lokasi ditolak bila butirnya satu per paket, lokasinya nonaktif, atau milik paket lain", async () => {
    expect((await unggah(paketM, 1, "3", lok.Asemdoyong))?.error).toMatch(/satu untuk seluruh paket/);
    expect((await unggah(paketM, 1, "4", lok.Lama))?.error).toMatch(/tidak ditemukan di paket ini/);
    const lain = await db.location.findFirstOrThrow({ where: { packageId: paketA }, select: { id: true } });
    expect((await unggah(paketM, 1, "4", lain.id))?.error).toMatch(/tidak ditemukan di paket ini/);
  });

  it("lokasi nonaktif tidak ikut dihitung", async () => {
    const rab = (await status(paketM, 1)).get("12")!;
    expect(rab.lokasi!.map((l) => l.nama)).not.toContain("Lama");
  });
});
