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
/** Berkas Drive yang dibuang ke Sampah. */
let sampah: string[] = [];
/**
 * Isi Drive tiruan, setia pada Drive & `uploadToDrive` sungguhan: berkas
 * bernama sama bisa lebih dari satu; MARLIN hanya menimpa yang dipilih
 * `pilihTimpa` (milik MARLIN – DECISIONS 723), selain itu membuat berkas baru.
 * Berkas yang dibuang ke Sampah hilang.
 */
type Meta = { createdTime: Date; terbitanMarlin: boolean; diubahOrangLain: boolean };
const isiDrive = new Map<string, string[]>();
const metaDrive = new Map<string, Meta>();
let urutId = 0;
/** Id berkas terbaru bernama `kunci` ("folder :: nama"). */
const idDi = (kunci: string) => isiDrive.get(kunci)?.at(-1);
/** Taruh berkas buatan ORANG di Drive tiruan. */
function taruhBerkasOrang(kunci: string, meta: Partial<Meta> = {}): string {
  const id = `orang-${++urutId}`;
  isiDrive.set(kunci, [...(isiDrive.get(kunci) ?? []), id]);
  metaDrive.set(id, { createdTime: new Date(Date.now() - 86_400_000), terbitanMarlin: false, diubahOrangLain: true, ...meta });
  return id;
}
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
    uploadToDrive: async (input: {
      folderId: string;
      fileName: string;
      pilihTimpa: (c: (Meta & { id: string })[]) => Promise<string | null>;
    }) => {
      const kunci = `${input.folderId} :: ${input.fileName}`;
      naik.push(kunci);
      const calon = (isiDrive.get(kunci) ?? []).map((id) => ({ id, ...metaDrive.get(id)! }));
      const timpa = calon.length ? await input.pilihTimpa(calon) : null;
      if (timpa) return { id: timpa, name: input.fileName, webViewLink: null, created: false };
      const id = `f-${++urutId}`;
      isiDrive.set(kunci, [...(isiDrive.get(kunci) ?? []), id]);
      metaDrive.set(id, { createdTime: new Date(), terbitanMarlin: true, diubahOrangLain: false });
      return { id, name: input.fileName, webViewLink: null, created: true };
    },
    metaBerkas: async (id: string) => {
      const ada = [...isiDrive.values()].some((ids) => ids.includes(id));
      return ada ? { id, ...metaDrive.get(id)! } : null;
    },
    buangKeSampah: async (id: string) => {
      sampah.push(id);
      for (const [k, ids] of isiDrive) isiDrive.set(k, ids.filter((x) => x !== id));
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
/** Batas minggu yang diminta tiap Kurva S paket. */
let kurvaSampai: (number | undefined)[] = [];
vi.mock("@/lib/laporan/kurva-paket", () => ({
  susunKurvaPaket: async (_id: string, _u: unknown, opsi?: { sampaiMinggu?: number }) => {
    kurvaSampai.push(opsi?.sampaiMinggu);
    return {};
  },
}));
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
const { siapkanBerkasTerminAction, unggahBerkasTerminAction } = await import("@/lib/penagihan/actions");
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
  sampah = [];
  kurvaSampai = [];
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
    expect(r).toEqual({ ok: true, jumlah: 18, rentang: { awal: 1, akhir: 3 }, dariDrive: 0, dibuang: 0 });
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
    // Kurva MARLIN keluar; scan yang sama disalin ke 5 DAN T9 (folder berpasangan).
    expect(j).toHaveLength(19);
    expect(j.some((x) => x.periode.startsWith("1|kurva_s|"))).toBe(false);
    expect(j.find((x) => x.periode === `1|berkas||5|d${doc.id}`)).toBeTruthy();
    expect(j.find((x) => x.periode === `1|berkas||T9|d${doc.id}`)).toBeTruthy();
    // Unggahan dicabut: Kurva S kembali disiapkan MARLIN.
    await db.document.delete({ where: { id: doc.id } });
    await antrekanBerkasTermin(packageId, 1, sesi());
    expect((await pekerjaan()).find((x) => x.periode.startsWith("1|kurva_s|"))!.periode).toBe("1|kurva_s|3|5+T9|");
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
    expect(await ringkasBerkasTermin(packageId, 1)).toMatchObject({ total: 18, sukses: 18, menunggu: 0 });
    // Kurva S termin 1 berhenti di minggu prestasinya (3), bukan minggu berjalan.
    expect(kurvaSampai).toEqual([3]);
  });

  it("minggu prestasi dibetulkan: isi berkas mengikuti, baris minggu yang keluar rentang dibuang", async () => {
    await progres(1, 2);
    await antrekanBerkasTermin(packageId, 1, sesi());
    const j = await pekerjaan();
    // SPMK + Kurva S + (mingguan 2 + harian 2 + bulanan 1 + dokumentasi 1) × 2 lokasi.
    expect(j.filter((x) => !x.refKey.startsWith("buang>"))).toHaveLength(14);
    expect(j.some((x) => /^1\|(mingguan|harian)\|3\|/.test(x.periode))).toBe(false);
    expect(j.find((x) => x.periode.startsWith("1|kurva_s|"))!.periode).toBe("1|kurva_s|2|5+T9|");
    // Laporan minggu 3 versi MARLIN yang sudah naik dibuang dari folder termin 1.
    expect(j.filter((x) => x.refKey.startsWith("buang>"))).toHaveLength(4);
    await progres(1, 3);
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
  });

  it("scan bertanda tangan menggantikan versi MARLIN: semua scan disalin ke kedua folder, versi MARLIN dibuang ke Sampah", async () => {
    // Pastikan semua sudah naik dulu, lalu catat berkas Drive tiap pekerjaan.
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
    const unggahan = await db.gDriveUpload.findMany({
      where: { packageId, kind: "berkas_termin", status: "sukses" },
      select: { refKey: true, fileId: true },
    });
    const idMingguan = [...new Set(unggahan.filter((u) => u.refKey.includes(":mingguan:")).map((u) => u.fileId))];
    const idLain = unggahan.filter((u) => !u.refKey.includes(":mingguan:")).map((u) => u.fileId);
    expect(idMingguan).toHaveLength(12); // 3 minggu × 2 lokasi × 2 folder (7 & T6)

    // Dua scan sekaligus, nama berkasnya sama-sama "scan.pdf" (dari HP).
    const f = new FormData();
    f.set("packageId", packageId);
    f.set("terminKe", "1");
    f.set("kode", "7");
    f.append("file", new File(["scan minggu 1"], "scan.pdf", { type: "application/pdf" }));
    f.append("file", new File(["scan minggu 2"], "scan.pdf", { type: "application/pdf" }));
    expect((await unggahBerkasTerminAction(undefined, f))?.success).toMatch(/^2 berkas 7\. Laporan Mingguan/);

    naik = [];
    const r = await antrekanBerkasTermin(packageId, 1, sesi());
    expect(r).toMatchObject({ ok: true, dibuang: 6 });
    await jalankanAntreanTermin({ packageId, terminKe: 1 });

    // Versi MARLIN laporan mingguan dibuang; berkas lain tidak tersentuh.
    expect([...sampah].sort()).toEqual([...idMingguan].sort());
    expect(sampah.some((id) => idLain.includes(id))).toBe(false);
    // Kedua scan masuk ke 7 dan T6, dengan nama yang tidak saling menimpa.
    const termin = `${INDUK}/TERMIN 1 (25%) ${VENDOR}`;
    const scanNaik = naik.filter((x) => x.includes(":: scan"));
    expect(scanNaik).toHaveLength(4);
    expect(new Set(scanNaik).size).toBe(4);
    expect(scanNaik.filter((x) => x.startsWith(`${termin}/7. Laporan Mingguan ::`))).toHaveLength(2);
    expect(scanNaik.filter((x) => x.startsWith(`${termin}/BERKAS DOKUMEN TEKNIS/6. Laporan Mingguan ::`))).toHaveLength(2);
    const ringkas = await ringkasBerkasTermin(packageId, 1);
    expect(ringkas.berkasDibuang).toBe(12);
    expect(ringkas.menunggu).toBe(0);

    // Menekan lagi tidak membuang apa-apa lagi.
    sampah = [];
    expect(await antrekanBerkasTermin(packageId, 1, sesi())).toMatchObject({ dibuang: 0 });
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
    expect(sampah).toEqual([]);

    // Bersihkan: scan dicabut, laporan mingguan kembali disiapkan MARLIN.
    await db.document.deleteMany({ where: { packageId, butirTermin: "7" } });
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
  });

  it("scan yang namanya persis sama dengan berkas MARLIN menimpa berkas Drive yang sama – scan itu tidak ikut dibuang", async () => {
    const nama = "Laporan Mingguan Minggu ke-1 - Desa satu.pdf";
    const termin = `${INDUK}/TERMIN 1 (25%) ${VENDOR}`;
    const kunci7 = `${termin}/7. Laporan Mingguan :: ${nama}`;
    const kunciT6 = `${termin}/BERKAS DOKUMEN TEKNIS/6. Laporan Mingguan :: ${nama}`;
    const idLama = [idDi(kunci7), idDi(kunciT6)];
    expect(idLama.every(Boolean)).toBe(true);

    const f = new FormData();
    f.set("packageId", packageId);
    f.set("terminKe", "1");
    f.set("kode", "7");
    f.append("file", new File(["scan diteken"], nama, { type: "application/pdf" }));
    await unggahBerkasTerminAction(undefined, f);
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });

    // Salinan scan menimpa berkas Drive yang sama (id sama) – id itu dilindungi.
    expect([idDi(kunci7), idDi(kunciT6)]).toEqual(idLama);
    expect(sampah.some((id) => idLama.includes(id))).toBe(false);
    expect(sampah).toHaveLength(10);

    await db.document.deleteMany({ where: { packageId, butirTermin: "7" } });
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
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

describe("buatan orang tidak pernah diubah atau dibuang (DECISIONS 723)", () => {
  const termin = () => `${INDUK}/TERMIN 1 (25%) ${VENDOR}`;

  it("berkas orang bernama sama tidak ditimpa – MARLIN membuat berkas baru di sebelahnya, dan hanya membuang miliknya", async () => {
    const kunci = `${termin()}/BERKAS DOKUMEN TEKNIS/5. Laporan Harian :: Laporan Harian Minggu ke-4 - Desa satu.pdf`;
    const punyaOrang = taruhBerkasOrang(kunci);
    await progres(1, 4);
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
    const ids = isiDrive.get(kunci)!;
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(punyaOrang);
    const punyaMarlin = ids[1];

    // Minggu prestasi kembali ke 3: versi MARLIN minggu 4 dibuang, berkas orang tetap.
    await progres(1, 3);
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
    expect(sampah).toContain(punyaMarlin);
    expect(sampah).not.toContain(punyaOrang);
    expect(isiDrive.get(kunci)).toEqual([punyaOrang]);
  });

  it("berkas yang dulu ditimpa kode lama (bertanda MARLIN, tapi sudah ada sebelum MARLIN mengunggah) tidak dibuang dan tidak ditimpa lagi", async () => {
    const kunci = `${termin()}/7. Laporan Mingguan :: Laporan Mingguan Minggu ke-1 - Desa satu.pdf`;
    const id = idDi(kunci)!;
    // Seolah berkas orang yang sempat diberi revisi & penanda oleh kode lama.
    metaDrive.set(id, { createdTime: new Date(Date.now() - 86_400_000), terbitanMarlin: true, diubahOrangLain: false });

    const f = new FormData();
    f.set("packageId", packageId);
    f.set("terminKe", "1");
    f.set("kode", "7");
    f.append("file", new File(["scan"], "scan-minggu.pdf", { type: "application/pdf" }));
    await unggahBerkasTerminAction(undefined, f);
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
    expect(sampah).not.toContain(id);
    // Di folder termin, laporan mingguan versi MARLIN yang tersisa hanya berkas itu.
    const tersisa = [...isiDrive.entries()]
      .filter(([k, ids]) => k.startsWith(`${termin()}/`) && k.split(" :: ")[1].startsWith("Laporan Mingguan Minggu") && ids.length)
      .map(([k]) => k);
    expect(tersisa).toEqual([kunci]);

    // Scan dicabut, laporan MARLIN dibuat lagi: berkas itu tidak ditimpa, MARLIN membuat yang baru.
    await db.document.deleteMany({ where: { packageId, butirTermin: "7" } });
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
    expect(isiDrive.get(kunci)![0]).toBe(id);
    expect(isiDrive.get(kunci)).toHaveLength(2);
  });

  it("berkas MARLIN yang sudah diubah orang lain tidak ditimpa", async () => {
    const kunci = `${termin()}/BERKAS DOKUMEN TEKNIS/9. Kurva S :: Kurva S - Paket BT ${suffix}.pdf`;
    const id = idDi(kunci)!;
    metaDrive.set(id, { ...metaDrive.get(id)!, diubahOrangLain: true });
    await antrekanBerkasTermin(packageId, 1, sesi());
    await jalankanAntreanTermin({ packageId, terminKe: 1 });
    expect(isiDrive.get(kunci)).toHaveLength(2);
    expect(isiDrive.get(kunci)![0]).toBe(id);
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

describe("lima surat otomatis dari tombol Siapkan berkas (DECISIONS 724)", () => {
  const form = (terminKe: number, tanggal: Record<string, string>) => {
    const f = new FormData();
    f.set("packageId", packageId);
    f.set("terminKe", String(terminKe));
    for (const [j, t] of Object.entries(tanggal)) f.set(`tanggal_${j}`, t);
    return f;
  };
  const LIMA = {
    permohonan_pemeriksaan: "2026-09-21",
    ba_pembahasan_kemajuan: "2026-09-22",
    permohonan_pembayaran: "2026-09-23",
    invoice: "2026-09-23",
    kwitansi: "2026-09-23",
  };
  const suratTermin = (terminKe: number) =>
    db.suratPenyedia.findMany({
      where: { contractId, terminKe },
      orderBy: { nomorUrut: "asc" },
      select: { id: true, jenis: true, nomor: true, nomorUrut: true, tanggal: true },
    });
  /** Progres konsultan lengkap per lokasi aktif – syarat surat progres. */
  async function progresLengkap(terminKe: number, mingguKe: number, pct: number) {
    const lokasi = await db.location.findMany({ where: { packageId, isActive: true }, select: { id: true } });
    await db.terminProgresKonsultan.upsert({
      where: { contractId_terminKe: { contractId, terminKe } },
      create: {
        contractId,
        terminKe,
        progresPct: pct,
        mingguKe,
        diubahOlehId: pengguna!.id,
        lokasi: lokasi.map((l) => ({ locationId: l.id, nomor: "", tanggal: "2026-09-20", mingguKe, persen: pct })),
      },
      update: {
        progresPct: pct,
        mingguKe,
        lokasi: lokasi.map((l) => ({ locationId: l.id, nomor: "", tanggal: "2026-09-20", mingguKe, persen: pct })),
      },
    });
  }

  it("data belum lengkap: berhenti di surat pertama dengan tautan 'isi di …', tidak ada surat, berkas tidak diantre", async () => {
    await progresLengkap(1, 3, 26.6);
    const sebelum = await db.gDriveJob.count({ where: { packageId } });
    const r = await siapkanBerkasTerminAction(undefined, form(1, LIMA));
    expect(r?.error).toMatch(/Kota penulisan surat/);
    expect(r?.kurang?.[0].href).toBe(`/paket/${packageId}/termin#data-surat`);
    await db.vendor.updateMany({ where: { name: VENDOR }, data: { kotaSurat: "Bogor", polaNomorSurat: "77.{urut}/SP/{bulan}/{tahun}" } });
    const r2 = await siapkanBerkasTerminAction(undefined, form(1, LIMA));
    expect(r2?.judul).toMatch(/Surat Permohonan Pemeriksaan Pekerjaan belum bisa disusun/);
    expect(r2?.kurang?.length).toBeGreaterThan(0);
    expect(await suratTermin(1)).toEqual([]);
    expect(await db.gDriveJob.count({ where: { packageId } })).toBe(sebelum);
  });

  it("data lengkap: kelima surat dibuat berurutan dengan tanggal formulir dan nomor otomatis, lalu ikut disalin ke Drive", async () => {
    await db.vendor.updateMany({ where: { name: VENDOR }, data: { npwp: "0000 1111 2222 3333", address: "Jl. Sintetis 1" } });
    await db.contract.update({
      where: { id: contractId },
      data: {
        workTitle: "Pekerjaan Konstruksi Uji",
        contractorSignerName: "Penanda Tangan Uji",
        contractorSignerTitle: "Direktur",
        supervisorFirm: "PT. Konsultan Sintetis",
        coTeamLeaderName: "Ir. Co Uji",
        bankNama: "Bank Uji",
        bankRekening: "0011223344",
        bankAtasNama: "CV TERMIN UJI",
      },
    });
    const r = await siapkanBerkasTerminAction(undefined, form(1, LIMA));
    expect(r?.error).toBeUndefined();
    expect(r?.success).toMatch(/Surat dibuat: Surat Permohonan Pemeriksaan Pekerjaan nomor 77\.1\/SP\/IX\/2026/);
    const s = await suratTermin(1);
    expect(s.map((x) => x.jenis)).toEqual(["permohonan_pemeriksaan", "ba_pembahasan_kemajuan", "permohonan_pembayaran", "invoice", "kwitansi"]);
    expect(s.map((x) => x.nomorUrut)).toEqual([1, 2, 3, 4, 5]);
    expect(s.map((x) => x.tanggal.toISOString().slice(0, 10))).toEqual(Object.values(LIMA));
    const salinan = (await pekerjaan()).filter((x) => /^1\|berkas\|\|(9a|9b|10a|10b|10c)\|s/.test(x.periode));
    expect(salinan).toHaveLength(5);
  });

  it("ditekan lagi: surat yang sudah ada tidak dibuat ulang dan tidak diubah", async () => {
    const lama = await suratTermin(1);
    await siapkanBerkasTerminAction(undefined, form(1, LIMA));
    expect(await suratTermin(1)).toEqual(lama);
  });

  it("surat yang sudah diganti scan versi sendiri tidak dibuat MARLIN", async () => {
    await progresLengkap(2, 5, 55);
    const f = new FormData();
    f.set("packageId", packageId);
    f.set("terminKe", "2");
    f.set("kode", "9b");
    f.append("file", new File(["ba diteken"], "ba-termin-2.pdf", { type: "application/pdf" }));
    await unggahBerkasTerminAction(undefined, f);
    const r = await siapkanBerkasTerminAction(undefined, form(2, LIMA));
    expect(r?.error).toBeUndefined();
    expect((await suratTermin(2)).map((x) => x.jenis)).toEqual(["permohonan_pemeriksaan", "permohonan_pembayaran", "invoice", "kwitansi"]);
  });

  it("progres di bawah ambang: tidak ada surat yang dibuat sama sekali", async () => {
    await progresLengkap(3, 7, 60); // ambang termin 3 = 80%
    const r = await siapkanBerkasTerminAction(undefined, form(3, LIMA));
    expect(r?.kurang?.some((k) => k.href === `/paket/${packageId}/termin?termin=3#progres-konsultan`)).toBe(true);
    expect(await suratTermin(3)).toEqual([]);
  });

  it("tanpa izin kelola kontrak: surat tidak dibuat, berkas lain tetap disiapkan", async () => {
    const lokasi = await db.location.findMany({ where: { packageId, isActive: true }, select: { id: true } });
    await db.locationAssignment.createMany({ data: lokasi.map((l) => ({ userId: pengguna!.id, locationId: l.id })), skipDuplicates: true });
    await progresLengkap(4, 9, 100);
    peran = "site_manager";
    const r = await siapkanBerkasTerminAction(undefined, form(4, LIMA));
    expect(r?.success).toMatch(/perlu izin kelola kontrak/);
    expect(await suratTermin(4)).toEqual([]);
  });
});
