// KOREKSI CCO & PERUBAHAN WAKTU LEWAT TANGGAL SELESAI (DECISIONS 771) – DB asli.
//
// Permintaan user 2026-11-23: *"bagaimana jika aku mencatat cco, tapi kemudian
// aku salah info, bagaimana mengeditnya? lalu ada inputan perubahan waktu /
// hari, sedangkan bisa jadi aku hanya tahu … tanggal akhir dari
// perpanjangannya"*, lalu *"catatan tidak diisi lalu disimpan juga tembus"*.
//
// Yang dijaga:
// 1. basis data: isian dokumen CCO boleh berubah, versi lamanya SELALU masuk
//    riwayat (trigger), identitas/turunan tidak boleh berubah, CCO tetap tidak
//    bisa dihapus, riwayat sendiri append-only;
// 2. koreksi lewat aksi: tanggal selesai → hari terhadap jadwal sebelum CCO itu,
//    audit menyimpan sebelum/sesudah + alasan, penolakan yang perlu;
// 3. Catat CCO baru dengan tanggal selesai; alasan kosong ditolak server.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) }));

let aktor: { id: string; orgId: string; role: string; mustChangePassword: boolean } | null = null;
vi.mock("@/lib/auth/session", async (asli) => ({
  ...(await asli<typeof import("@/lib/auth/session")>()),
  getCurrentUser: async () => aktor,
  hasLocationAccess: async () => true,
  requireLocationAccess: async () => undefined,
  requireCapability: async () => aktor,
}));

const { db } = await import("@/lib/db");
const { koreksiCcoAction, addAmendment } = await import("@/lib/package/actions");

const t = (k: string) => new Date(`${k}T00:00:00.000Z`);
const suffix = `kc${Date.now().toString(36)}`;
const ids = { org: "", orgLain: "", paket: "", kontrak: "", cco1: "", cco2: "", ccoLain: "", kontrakLain: "", paketTanpaSpmk: "" };

function form(isi: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}

async function kontrak(orgId: string, nama: string, endDate: Date | null) {
  const vendor = await db.vendor.create({ data: { orgId, name: `PT ${nama}` } });
  const pkg = await db.package.create({ data: { orgId, name: `Paket ${nama}`, stage: "pelaksanaan" } });
  const k = await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `KTR/${nama}`,
      contractValue: 1_000_000_000n,
      signedDate: t("2026-07-01"),
      startDate: endDate ? t("2026-07-10") : null,
      endDate,
    },
  });
  return { paketId: pkg.id, kontrakId: k.id };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org KC ${suffix}`, slug: `org-kc-${suffix}` } });
  const lain = await db.organization.create({ data: { name: `Org KC2 ${suffix}`, slug: `org-kc2-${suffix}` } });
  ids.org = org.id;
  ids.orgLain = lain.id;
  const u = await db.user.create({
    data: { orgId: org.id, username: `kc-${suffix}`, fullName: "Uji Koreksi", passwordHash: "x", role: "super_admin" },
  });
  aktor = { id: u.id, orgId: org.id, role: "super_admin", mustChangePassword: false };

  const a = await kontrak(org.id, `A-${suffix}`, t("2026-12-31"));
  ids.paket = a.paketId;
  ids.kontrak = a.kontrakId;
  const c1 = await db.contractAmendment.create({
    data: {
      contractId: a.kontrakId,
      ccoNumber: "CCO-01",
      valueDelta: 0n,
      endDateDelta: 30,
      effectiveDate: t("2026-11-01"),
      reason: "Perpanjangan waktu cuaca",
      createdAt: new Date("2026-11-01T03:00:00Z"),
    },
  });
  const c2 = await db.contractAmendment.create({
    data: {
      contractId: a.kontrakId,
      ccoNumber: "CCO-02",
      valueDelta: 15_000_000n,
      endDateDelta: 15,
      effectiveDate: t("2026-11-10"),
      reason: "Tambah pekerjaan talud",
      createdAt: new Date("2026-11-10T03:00:00Z"),
    },
  });
  ids.cco1 = c1.id;
  ids.cco2 = c2.id;

  const b = await kontrak(lain.id, `B-${suffix}`, t("2026-12-31"));
  ids.kontrakLain = b.kontrakId;
  ids.ccoLain = (
    await db.contractAmendment.create({
      data: { contractId: b.kontrakId, ccoNumber: "CCO-01", valueDelta: 0n, endDateDelta: 10, effectiveDate: t("2026-11-01"), reason: "Org lain" },
    })
  ).id;

  ids.paketTanpaSpmk = (await kontrak(org.id, `C-${suffix}`, null)).paketId;
});

afterAll(async () => {
  // contract_amendments, riwayatnya, & audit_logs append-only: ikut TRUNCATE berkas lain.
  await db.$disconnect();
});

describe("basis data: koreksi selalu meninggalkan jejak", () => {
  it("mengubah isian dokumen → versi lama masuk riwayat oleh trigger, bukan oleh aplikasi", async () => {
    const tmp = await db.contractAmendment.create({
      // Kontrak lain: jadwal selesai kontrak A dipakai uji berikutnya.
      data: { contractId: ids.kontrakLain, ccoNumber: "TMP-1", valueDelta: 1n, endDateDelta: 1, effectiveDate: t("2026-11-20"), reason: "Sementara" },
    });
    await db.$executeRawUnsafe(`UPDATE contract_amendments SET end_date_delta = 7, reason = 'Dikoreksi' WHERE id = '${tmp.id}'`);
    const riwayat = await db.contractAmendmentHistory.findMany({ where: { amendmentId: tmp.id } });
    expect(riwayat).toHaveLength(1);
    expect(riwayat[0]).toMatchObject({ ccoNumber: "TMP-1", endDateDelta: 1, reason: "Sementara", valueDelta: 1n });
    // Ubah tanpa beda isian → tidak menambah riwayat.
    await db.$executeRawUnsafe(`UPDATE contract_amendments SET reason = reason WHERE id = '${tmp.id}'`);
    expect(await db.contractAmendmentHistory.count({ where: { amendmentId: tmp.id } })).toBe(1);
  });

  it("CCO tetap tidak bisa dihapus", async () => {
    await expect(db.contractAmendment.delete({ where: { id: ids.cco1 } })).rejects.toThrow(/tidak boleh dihapus/);
  });

  it("identitas & turunan RAB tidak boleh diubah", async () => {
    await expect(
      db.$executeRawUnsafe(`UPDATE contract_amendments SET value_delta_rab = 5 WHERE id = '${ids.cco1}'`),
    ).rejects.toThrow(/hanya boleh dikoreksi isian dokumennya/);
  });

  it("riwayat koreksi append-only", async () => {
    const r = await db.contractAmendmentHistory.findFirst({ select: { id: true } });
    await expect(db.$executeRawUnsafe(`UPDATE contract_amendment_history SET reason = 'x' WHERE id = '${r!.id}'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(db.$executeRawUnsafe(`DELETE FROM contract_amendment_history WHERE id = '${r!.id}'`)).rejects.toThrow(/append-only/);
  });
});

describe("koreksi lewat layar", () => {
  const dasar = (id: string, lebih: Record<string, string> = {}) => ({
    amendmentId: id,
    ccoNumber: id === ids.cco1 ? "CCO-01" : "CCO-02",
    effectiveDate: id === ids.cco1 ? "2026-11-01" : "2026-11-10",
    valueDelta: id === ids.cco1 ? "0" : "15.000.000",
    waktuMode: "hari",
    endDateDelta: id === ids.cco1 ? "30" : "15",
    reason: id === ids.cco1 ? "Perpanjangan waktu cuaca" : "Tambah pekerjaan talud",
    alasanKoreksi: "Salah ketik dari dokumen",
    ...lebih,
  });

  it("tanggal selesai diketik → hari dihitung dari jadwal tepat sebelum CCO itu", async () => {
    // Kontrak selesai 31 Des; CCO-01 +30 → 30 Jan. Dokumen CCO-02: selesai 20 Feb 2027.
    const r = await koreksiCcoAction(undefined, form(dasar(ids.cco2, { waktuMode: "tanggal", akhirBaru: "2027-02-20", endDateDelta: "" })));
    expect(r?.error).toBeUndefined();
    expect(r?.success).toContain("waktu +15 hari → +21 hari");
    expect(r?.success).toContain("20 Feb 2027");
    const a = await db.contractAmendment.findUniqueOrThrow({ where: { id: ids.cco2 } });
    expect(a.endDateDelta).toBe(21);
    const riwayat = await db.contractAmendmentHistory.findMany({ where: { amendmentId: ids.cco2 } });
    expect(riwayat.map((h) => h.endDateDelta)).toEqual([15]);
    const log = await db.auditLog.findFirst({
      where: { action: "amendment.koreksi", userId: aktor!.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.payload).toMatchObject({
      amendmentId: ids.cco2,
      alasan: "Salah ketik dari dokumen",
      sebelum: { endDateDelta: 15 },
      sesudah: { endDateDelta: 21 },
    });
  });

  it("mengoreksi hari CCO yang lebih awal menyebut CCO sesudahnya ikut bergeser", async () => {
    const r = await koreksiCcoAction(undefined, form(dasar(ids.cco1, { endDateDelta: "35" })));
    expect(r?.success).toContain("ikut bergeser");
  });

  it("nilai resmi minus dengan awalan Rp terbaca", async () => {
    const r = await koreksiCcoAction(undefined, form(dasar(ids.cco2, { valueDelta: "Rp -2.500.000", waktuMode: "hari", endDateDelta: "21" })));
    expect(r?.error).toBeUndefined();
    expect((await db.contractAmendment.findUniqueOrThrow({ where: { id: ids.cco2 } })).valueDelta).toBe(-2_500_000n);
  });

  it("menolak: nomor kembar, tanpa perubahan, tanpa alasan koreksi, CCO organisasi lain", async () => {
    const kembar = await koreksiCcoAction(undefined, form(dasar(ids.cco2, { ccoNumber: "CCO-01", valueDelta: "-2.500.000", endDateDelta: "21" })));
    expect(kembar?.error).toMatch(/sudah dipakai CCO lain/);
    const sama = await koreksiCcoAction(undefined, form(dasar(ids.cco2, { valueDelta: "-2.500.000", endDateDelta: "21" })));
    expect(sama?.error).toBe("Tidak ada yang berubah.");
    const tanpa = await koreksiCcoAction(undefined, form(dasar(ids.cco2, { endDateDelta: "22", alasanKoreksi: "" })));
    expect(tanpa?.error).toMatch(/kenapa CCO ini dikoreksi/);
    const lain = await koreksiCcoAction(undefined, form(dasar(ids.ccoLain, { endDateDelta: "11" })));
    expect(lain?.error).toBe("CCO tidak ditemukan.");
  });

  it("tanggal berlaku dikunci bila ada lokasi yang masuk/dicabut lewat CCO itu", async () => {
    const loc = await db.location.create({
      data: { packageId: ids.paket, name: "Lokasi KC", slug: `lok-${suffix}`, village: "D", regency: "K", province: "P" },
    });
    await db.locationScopeChange.create({
      data: { locationId: loc.id, packageId: ids.paket, amendmentId: ids.cco1, kind: "tambah", status: "aktif", effectiveDate: t("2026-11-01"), reason: "Masuk lewat CCO-01" },
    });
    const r = await koreksiCcoAction(undefined, form(dasar(ids.cco1, { effectiveDate: "2026-11-05", endDateDelta: "35" })));
    expect(r?.error).toMatch(/Tanggal berlaku CCO ini tidak bisa diubah/);
  });
});

describe("Catat CCO baru dengan tanggal selesai", () => {
  const catat = (lebih: Record<string, string>) =>
    addAmendment(
      undefined,
      form({ packageId: ids.paket, ccoNumber: "CCO-03", effectiveDate: "2026-11-23", reason: "Perpanjangan lagi", waktuMode: "hari", endDateDelta: "0", ...lebih }),
    );

  it("alasan kosong ditolak server – tidak ada CCO tercatat", async () => {
    const r = await catat({ reason: "" });
    expect(r?.error).toMatch(/Alasan adendum wajib diisi/);
    expect(await db.contractAmendment.count({ where: { contractId: ids.kontrak, ccoNumber: "CCO-03" } })).toBe(0);
  });

  it("tanggal selesai → hari terhadap jadwal selesai berjalan", async () => {
    // 31 Des + 35 (CCO-01) + 21 (CCO-02) = 25 Feb 2027. Dokumen: selesai 7 Mar 2027 → +10.
    const r = await catat({ waktuMode: "tanggal", akhirBaru: "2027-03-07", endDateDelta: "" });
    expect(r?.error).toBeUndefined();
    const a = await db.contractAmendment.findFirstOrThrow({ where: { contractId: ids.kontrak, ccoNumber: "CCO-03" } });
    expect(a.endDateDelta).toBe(10);
  });

  it("tanpa SPMK, tanggal selesai ditolak dengan sebabnya", async () => {
    const r = await addAmendment(
      undefined,
      form({ packageId: ids.paketTanpaSpmk, ccoNumber: "CCO-01", effectiveDate: "2026-11-23", reason: "Perpanjangan", waktuMode: "tanggal", akhirBaru: "2027-01-10" }),
    );
    expect(r?.error).toMatch(/SPMK belum terbit/);
  });
});
