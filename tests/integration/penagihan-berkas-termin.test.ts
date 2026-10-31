/*
 * "SIAPKAN BERKAS TERMIN n" (DECISIONS 721) di atas database sungguhan:
 * periode laporan dari progres konsultan, pekerjaan yang diantre, folder
 * termin yang sudah ada dipakai ulang, tekan ulang tanpa kembaran, dan putaran
 * termin yang tidak bergantung sakelar unggah otomatis. Drive dan pembuat PDF
 * ditiru: yang diuji aturannya, bukan Google.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const tertunda: (() => Promise<void>)[] = [];
vi.mock("next/server", async (importAsli) => ({
  ...(await importAsli<typeof import("next/server")>()),
  after: (f: () => Promise<void>) => {
    tertunda.push(f);
  },
}));
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async () => {},
  r2Delete: async () => {},
  r2GetBuffer: async () => Buffer.from("isi"),
  classifyR2Error: (e: unknown) => String(e),
}));
vi.mock("@/lib/penyimpanan/berkas", async (importAsli) => ({
  ...(await importAsli<typeof import("@/lib/penyimpanan/berkas")>()),
  ambilBerkas: async () => Buffer.from("isi dokumen"),
}));

/* Drive tiruan yang ingat folder buatannya. */
const anak = new Map<string, { id: string; name: string }[]>();
let dibuat: string[] = [];
let naik: string[] = [];
vi.mock("@/lib/gdrive/client", () => {
  class GDriveError extends Error {
    readonly status: number | null = null;
    readonly retryAfter: string | null = null;
  }
  return {
    GDriveError,
    ensureFolderPath: async (root: string, seg: string[]) => [root, ...seg].join("/"),
    daftarSubfolder: async (parent: string) => anak.get(parent) ?? [],
    buatFolder: async (parent: string, name: string) => {
      const id = `${parent}/${name}`;
      anak.set(parent, [...(anak.get(parent) ?? []), { id, name }]);
      dibuat.push(id);
      return id;
    },
    uploadToDrive: async (input: { folderId: string; fileName: string }) => {
      naik.push(`${input.folderId} :: ${input.fileName}`);
      return { id: `f-${naik.length}`, name: input.fileName, webViewLink: null, created: true };
    },
  };
});
vi.mock("@/lib/gdrive/config", () => ({
  getGDriveConfigDisplay: async () => ({ clientId: "x", hasClientSecret: true, connected: true, accountEmail: null }),
}));

/* Pembuat PDF tiruan. */
const pdf = (isi: string) => ({ buffer: Buffer.from(`%PDF ${isi}`) });
let dokumentasiKosong = false;
vi.mock("@/lib/pdf/periodik-kkp", () => ({
  renderPeriodikKkpPdf: async (_l: string, kind: string, n: number) => pdf(`${kind} ${n}`),
  renderKurvaPaketPdf: async () => pdf("kurva"),
}));
vi.mock("@/lib/laporan/kurva-paket", () => ({ susunKurvaPaket: async () => ({}) }));
vi.mock("@/lib/pdf/mingguan-kkp", () => ({ renderMingguanKkpPdf: async (_s: string, n: number) => pdf(`harian ${n}`) }));
vi.mock("@/lib/pdf/dokumentasi-sarpras", () => ({
  renderDokumentasiSarprasPdf: async () => (dokumentasiKosong ? null : { ...pdf("dok"), lokasi: "x" }),
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
const { antrekanBerkasTermin, ringkasBerkasTermin } = await import("@/lib/penagihan/berkas-termin");
const { jalankanAntreanTermin, jalankanAntreanDrive, ringkasAntrean } = await import("@/lib/gdrive/antrean");
const { setGDriveOtomatisAktif } = await import("@/lib/gdrive/setelan");
const { siapkanBerkasTerminAction } = await import("@/lib/penagihan/actions");
const { uploadDocument } = await import("@/lib/documents");

const suffix = `bt${Date.now().toString(36)}`;
let packageId = "";
let paketTanpaDrive = "";
let contractId = "";
const VENDOR = `CV. Termin ${suffix}`;
const INDUK = "akar/7. BERKAS TERMIN";
const sesi = () => ({ ...pengguna!, role: "super_admin" as const });

async function progres(terminKe: number, mingguKe: number) {
  await db.terminProgresKonsultan.upsert({
    where: { contractId_terminKe: { contractId, terminKe } },
    create: { contractId, terminKe, progresPct: 26.6, mingguKe, lokasi: [], diubahOlehId: pengguna!.id },
    update: { mingguKe },
  });
}
const pekerjaan = () =>
  db.gDriveJob.findMany({ where: { packageId, kind: "berkas_termin" }, select: { refKey: true, periode: true, status: true, lastError: true } });

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org BT ${suffix}`, slug: `org-${suffix}` } });
  const u = await db.user.create({
    data: { orgId: org.id, username: `sa-${suffix}`, fullName: "Admin", passwordHash: "x", role: "super_admin", mustChangePassword: false },
  });
  pengguna = u as unknown as SessionUser;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: VENDOR } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket BT ${suffix}`, stage: "pelaksanaan", driveFolderId: "akar" } });
  packageId = pkg.id;
  const k = await db.contract.create({
    data: {
      packageId,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 1_000_000_000n,
      signedDate: new Date("2026-06-25T00:00:00Z"),
      startDate: new Date("2026-07-01T00:00:00Z"),
      endDate: new Date("2026-12-27T00:00:00Z"),
      durationDays: 180,
    },
  });
  contractId = k.id;
  for (const [n, aktif] of [["satu", true], ["dua", true], ["mati", false]] as const) {
    await db.location.create({
      data: { packageId, name: `Desa ${n}`, slug: `desa-${n}-${suffix}`, village: "D", regency: "K", province: "P", isActive: aktif },
    });
  }
  await uploadDocument({ file: new File(["spmk"], "spmk.pdf", { type: "application/pdf" }), packageId, phase: "mulai_kerja", type: "spmk", title: "SPMK" }, u.id);

  const p2 = await db.package.create({ data: { orgId: org.id, name: `Paket tanpa Drive ${suffix}`, stage: "pelaksanaan" } });
  paketTanpaDrive = p2.id;
  await db.contract.create({
    data: { packageId: p2.id, vendorId: vendor.id, contractNumber: `K2-${suffix}`, contractValue: 1n, signedDate: new Date("2026-06-25T00:00:00Z") },
  });
});

beforeEach(() => {
  anak.clear();
  dibuat = [];
  naik = [];
  tertunda.length = 0;
  peran = "super_admin";
  dokumentasiKosong = false;
});

afterAll(async () => {
  await setGDriveOtomatisAktif(true).catch(() => {});
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("antrekanBerkasTermin", () => {
  it("progres konsultan termin belum diisi: ditolak dan menunjuk termin yang harus diisi", async () => {
    expect(await antrekanBerkasTermin(packageId, 1, sesi())).toMatchObject({ ok: false, terminKe: 1 });
    expect(await pekerjaan()).toHaveLength(0);
  });

  it("termin 1 minggu 1–3: berkas yang ada + Kurva S + laporan per lokasi AKTIF", async () => {
    await progres(1, 3);
    const r = await antrekanBerkasTermin(packageId, 1, sesi());
    expect(r).toEqual({ ok: true, jumlah: 18, rentang: { awal: 1, akhir: 3 }, dariDrive: 0 });
    // SPMK 1 + Kurva 1 + (mingguan 3 + harian 3 + bulanan 1 + dokumentasi 1) × 2 lokasi aktif.
    const j = await pekerjaan();
    expect(j).toHaveLength(18);
    expect(j.every((x) => x.status === "menunggu")).toBe(true);
    expect(j.filter((x) => x.periode.includes("|bulanan|"))).toHaveLength(2);
  });

  it("berkas yang ditarik DARI Drive KKP tidak diunggah balik (DECISIONS 197)", async () => {
    const doc = await uploadDocument(
      {
        file: new File(["ba"], "ba-pemeriksaan.pdf", { type: "application/pdf" }),
        packageId,
        phase: "pelaksanaan",
        type: "mc_berkala",
        title: "BA Pemeriksaan",
        termin: { ke: 1, butir: "9c" },
      },
      pengguna!.id,
    );
    await db.document.update({ where: { id: doc.id }, data: { source: "drive_kkp" } });
    const r = await antrekanBerkasTermin(packageId, 1, sesi());
    expect(r).toMatchObject({ ok: true, jumlah: 18, dariDrive: 1 });
    expect((await pekerjaan()).some((x) => x.periode.includes("|9c|"))).toBe(false);
    await db.document.delete({ where: { id: doc.id } });
  });

  it("tekan ulang: baris yang sama dipakai, tidak berlipat", async () => {
    await db.gDriveJob.updateMany({ where: { packageId }, data: { status: "sukses" } });
    await antrekanBerkasTermin(packageId, 1, sesi());
    const j = await pekerjaan();
    expect(j).toHaveLength(18);
    expect(j.every((x) => x.status === "menunggu")).toBe(true);
  });

  it("termin 2: mulai sesudah minggu prestasi termin 1; minggu yang tidak maju ditolak", async () => {
    expect(await antrekanBerkasTermin(packageId, 2, sesi())).toMatchObject({ ok: false, terminKe: 2 });
    await progres(2, 3);
    expect(await antrekanBerkasTermin(packageId, 2, sesi())).toMatchObject({ ok: false, terminKe: 2 });
    await progres(2, 5);
    expect(await antrekanBerkasTermin(packageId, 2, sesi())).toMatchObject({ ok: true, rentang: { awal: 4, akhir: 5 } });
    // Termin 2 tidak menyentuh baris termin 1.
    expect((await pekerjaan()).filter((x) => x.periode.startsWith("1|"))).toHaveLength(18);
    await db.gDriveJob.deleteMany({ where: { packageId, periode: { startsWith: "2|" } } });
  });

  it("Kurva S yang diunggah sendiri disalin; laporan MARLIN hanya mengisi folder yang masih kosong", async () => {
    const doc = await uploadDocument(
      {
        file: new File(["kurva"], "kurva-sendiri.pdf", { type: "application/pdf" }),
        packageId,
        phase: "pelaksanaan",
        type: "laporan",
        title: "Kurva S",
        termin: { ke: 1, butir: "5" },
      },
      pengguna!.id,
    );
    await antrekanBerkasTermin(packageId, 1, sesi());
    const j = await pekerjaan();
    expect(j).toHaveLength(19);
    expect(j.find((x) => x.periode.startsWith("1|kurva_s|"))!.periode).toBe("1|kurva_s||T9|");
    expect(j.find((x) => x.periode === `1|berkas||5|d${doc.id}`)).toBeTruthy();
  });
});

describe("jalankanAntreanTermin", () => {
  it("semua berkas naik ke folder termin dengan susunan KKP; satu laporan mingguan ke dua folder", async () => {
    const h = await jalankanAntreanTermin({ packageId, terminKe: 1 });
    expect(h.sisa).toBe(0);
    expect(h.gagal).toBe(0);
    const termin = `${INDUK}/TERMIN 1 (25%) ${VENDOR}`;
    expect(dibuat.filter((d) => d === termin)).toHaveLength(1);
    expect(naik).toContain(`${termin}/3. SPMK :: spmk.pdf`);
    expect(naik).toContain(`${termin}/7. Laporan Mingguan :: Laporan Mingguan Minggu ke-2 - Desa satu.pdf`);
    expect(naik).toContain(`${termin}/BERKAS DOKUMEN TEKNIS/6. Laporan Mingguan :: Laporan Mingguan Minggu ke-2 - Desa satu.pdf`);
    expect(naik).toContain(`${termin}/BERKAS DOKUMEN TEKNIS/5. Laporan Harian :: Laporan Harian Minggu ke-3 - Desa dua.pdf`);
    expect(naik.some((x) => x.includes("Desa mati"))).toBe(false);
    expect((await pekerjaan()).every((x) => x.status === "sukses")).toBe(true);
    expect(await ringkasBerkasTermin(packageId, 1)).toMatchObject({ total: 19, sukses: 19, menunggu: 0 });
  });

  it("folder termin yang sudah ada dipakai walau namanya lain (persen/penyedia) – tidak dibuat kembaran", async () => {
    anak.set(INDUK, [{ id: "folder-lama", name: "Termin 1  cv lama" }]);
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
    expect(dibuat).toEqual([]);
    expect(naik.length).toBeGreaterThan(0);
    expect(naik.every((x) => x.startsWith("folder-lama/"))).toBe(true);
  });

  it("tidak bergantung sakelar unggah otomatis – orang menekan tombolnya sendiri", async () => {
    await setGDriveOtomatisAktif(false);
    await antrekanBerkasTermin(packageId, 1, sesi());
    expect((await jalankanAntreanDrive({ pindai: false })).aktif).toBe(false);
    expect(naik).toHaveLength(0);
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
    expect(naik.length).toBeGreaterThan(0);
    await setGDriveOtomatisAktif(true);
  });

  it("berkas yang tidak bisa disusun tercatat dengan sebabnya, tidak diulang", async () => {
    dokumentasiKosong = true;
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
    const r = await ringkasBerkasTermin(packageId, 1);
    expect(r.batal).toBe(2);
    expect(r.masalah.filter((m) => m.label === "Dokumentasi sarana prasarana").map((m) => m.lokasi).sort()).toEqual([
      "Desa dua",
      "Desa satu",
    ]);
    expect(r.masalah[0].pesan).toMatch(/Belum ada foto/);
  });
});

describe("layar Sistem", () => {
  it("berkas termin yang menyerah terbaca sebagai nama berkasnya, bukan kode antrean", async () => {
    const j = await db.gDriveJob.findFirstOrThrow({ where: { packageId, periode: { startsWith: "1|mingguan|2|" }, location: { name: "Desa satu" } } });
    await db.gDriveJob.update({ where: { id: j.id }, data: { status: "menyerah", lastError: "uji" } });
    const m = (await ringkasAntrean()).macet.find((x) => x.kind === "berkas_termin");
    expect(m).toMatchObject({ periode: "Termin 1 · Laporan mingguan minggu ke-2", lokasi: "Desa satu" });
  });
});

describe("siapkanBerkasTerminAction", () => {
  const form = (pkg: string, terminKe = 1) => {
    const f = new FormData();
    f.set("packageId", pkg);
    f.set("terminKe", String(terminKe));
    return f;
  };

  it("berhasil: mengantre, mencatat audit, dan menjadwalkan putaran di latar", async () => {
    const r = await siapkanBerkasTerminAction(undefined, form(packageId));
    expect(r?.success).toMatch(/minggu ke-1 s\.d\. ke-3/);
    expect(tertunda).toHaveLength(1);
    const a = await db.auditLog.findFirst({ where: { action: "penagihan.siapkan_berkas", resourceId: packageId } });
    expect(a).toBeTruthy();
  });

  it("peran tanpa izin unggah dokumen ditolak", async () => {
    // exec_viewer boleh MELIHAT paket, tapi tidak boleh mengunggah dokumen.
    peran = "exec_viewer";
    const r = await siapkanBerkasTerminAction(undefined, form(packageId));
    expect(r?.error).toBe("Tidak berhak.");
    expect(tertunda).toHaveLength(0);
  });

  it("paket tanpa folder Drive: ditolak dengan tautan ke pengaturannya", async () => {
    const r = await siapkanBerkasTerminAction(undefined, form(paketTanpaDrive));
    expect(r).toMatchObject({ error: expect.stringMatching(/belum punya folder Google Drive/), tautan: { href: `/paket/${paketTanpaDrive}` } });
  });

  it("progres termin belum diisi: tautannya ke isian progres termin itu", async () => {
    const r = await siapkanBerkasTerminAction(undefined, form(packageId, 3));
    expect(r?.tautan?.href).toBe(`/paket/${packageId}/termin?termin=3#progres-konsultan`);
  });
});
