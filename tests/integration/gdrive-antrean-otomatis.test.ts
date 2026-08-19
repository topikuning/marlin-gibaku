// Antrean unggah OTOMATIS laporan ke Drive KKP (DECISIONS 313).
//
// Panggilan nyata ke googleapis.com tidak bisa dijalankan dari kontainer kerja,
// jadi klien Drive di-mock: yang diuji di sini adalah ATURAN antreannya di atas
// database sungguhan — apa yang terjaring, apa yang tidak, apa yang terjadi
// saat Google menahan laju, dan apa yang terjadi saat laporan dibuka kembali
// setelah terlanjur diantre.
//
// Bagian paling berbahaya dari fitur ini bukan unggahannya, melainkan
// KEGAGALAN YANG DIAM: semua orang mengira laporan sudah ada di folder pemberi
// kerja, padahal tidak. Karena itu yang paling banyak diuji adalah jalur gagal.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2GetBuffer: async () => Buffer.from("foto-palsu"),
  r2Put: async () => {},
  r2Delete: async () => {},
}));

vi.mock("@/lib/pdf/harian-kkp", () => ({
  renderHarianKkpPdf: async () => ({ buffer: Buffer.from("%PDF-palsu") }),
}));

/** Kegagalan yang disuntikkan ke unggahan berikutnya. */
let lemparBerikut: { status: number | null; pesan: string; retryAfter?: string } | null = null;
/** Nama berkas yang berhasil naik, berurutan. */
let naik: string[] = [];

vi.mock("@/lib/gdrive/client", () => {
  class GDriveError extends Error {
    readonly status: number | null;
    readonly retryAfter: string | null;
    constructor(message: string, opts?: { status?: number | null; retryAfter?: string | null }) {
      super(message);
      this.status = opts?.status ?? null;
      this.retryAfter = opts?.retryAfter ?? null;
    }
  }
  return {
    GDriveError,
    ensureFolderPath: async () => "folder-tujuan",
    uploadToDrive: async (input: { fileName: string }) => {
      if (lemparBerikut) {
        const l = lemparBerikut;
        lemparBerikut = null;
        throw new GDriveError(l.pesan, { status: l.status, retryAfter: l.retryAfter ?? null });
      }
      naik.push(input.fileName);
      return {
        id: `id-${input.fileName}`,
        name: input.fileName,
        webViewLink: `https://drive.google.com/file/d/${input.fileName}/view`,
        created: true,
      };
    },
  };
});

let terhubung = true;
vi.mock("@/lib/gdrive/config", () => ({
  getGDriveConfigDisplay: async () => ({
    clientId: "x",
    hasClientSecret: true,
    connected: terhubung,
    accountEmail: "marlin@example.com",
  }),
}));

const { db } = await import("@/lib/db");
const {
  antrekanLaporanHarian,
  jalankanAntreanDrive,
  pindaiHarian,
  pindaiMingguan,
  ulangiYangMenyerah,
} = await import("@/lib/gdrive/antrean");
const { setGDriveOtomatisAktif } = await import("@/lib/gdrive/setelan");
const { MAKS_PERCOBAAN } = await import("@/lib/gdrive/laju");

const suffix = `ga${Date.now().toString(36)}`;
let orgId = "";
let userId = "";
let packageId = "";
let lokasiId = "";
let lokasiSlug = "";
/** Lokasi di paket yang BELUM punya folder Drive — tidak boleh terjaring. */
let lokasiTanpaDriveId = "";
let laporanFinalId = "";

const TANGGAL_FINAL = new Date("2026-07-20T00:00:00.000Z");
const TANGGAL_DRAF = new Date("2026-07-21T00:00:00.000Z");

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org GA ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const user = await db.user.create({
    data: {
      orgId,
      username: `ga-${suffix}`,
      fullName: "Tester",
      passwordHash: "x",
      role: "super_admin",
    },
  });
  userId = user.id;
  const vendor = await db.vendor.create({ data: { orgId, name: `Vendor ${suffix}` } });

  const pkg = await db.package.create({
    data: { orgId, name: `Paket GA ${suffix}`, driveFolderId: "folder-kkp", stage: "pelaksanaan" },
  });
  packageId = pkg.id;
  await db.contract.create({
    data: {
      packageId,
      vendorId: vendor.id,
      contractNumber: `KTR-${suffix}`,
      contractValue: 1_000_000_000n,
      signedDate: new Date("2026-01-01T00:00:00.000Z"),
      durationDays: 150,
      startDate: new Date("2026-06-01T00:00:00.000Z"),
      endDate: new Date("2026-10-28T00:00:00.000Z"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId,
      name: "Pasar Banggi",
      slug: `pasar-banggi-${suffix}`,
      village: "Pasar Banggi",
      regency: "Rembang",
      province: "Jawa Tengah",
      // `isActive` default-nya FALSE dan baru dinyalakan saat SPMK aktif —
      // lokasi yang belum berjalan tidak punya laporan mingguan untuk disetor.
      isActive: true,
      status: "berjalan",
    },
  });
  lokasiId = loc.id;
  lokasiSlug = loc.slug;

  // Lokasi KEDUA di paket yang sama — memastikan pindai mingguan tidak berhenti
  // di lokasi pertama saat jatah satu putaran kecil.
  await db.location.create({
    data: {
      packageId,
      name: "Zona Ujung",
      slug: `zona-ujung-${suffix}`,
      village: "Zona Ujung",
      regency: "Rembang",
      province: "Jawa Tengah",
      isActive: true,
      status: "berjalan",
    },
  });

  const pkgTanpa = await db.package.create({
    data: { orgId, name: `Paket tanpa Drive ${suffix}`, stage: "pelaksanaan" },
  });
  const locTanpa = await db.location.create({
    data: {
      packageId: pkgTanpa.id,
      name: "Tanpa Drive",
      slug: `tanpa-drive-${suffix}`,
      village: "Tanpa Drive",
      regency: "Rembang",
      province: "Jawa Tengah",
    },
  });
  lokasiTanpaDriveId = locTanpa.id;

  const final = await db.dailyReport.create({
    data: { locationId: lokasiId, reportDate: TANGGAL_FINAL, status: "final", createdById: userId },
  });
  laporanFinalId = final.id;
  // Draf di lokasi yang sama — laporan yang belum final TIDAK boleh naik.
  await db.dailyReport.create({
    data: { locationId: lokasiId, reportDate: TANGGAL_DRAF, status: "draft", createdById: userId },
  });
  // Final, tapi paketnya belum punya folder Drive — tidak ada tujuan unggah.
  await db.dailyReport.create({
    data: {
      locationId: lokasiTanpaDriveId,
      reportDate: TANGGAL_FINAL,
      status: "final",
      createdById: userId,
    },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$executeRawUnsafe('TRUNCATE TABLE "app_settings" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(async () => {
  terhubung = true;
  lemparBerikut = null;
  naik = [];
  await db.gDriveJob.deleteMany({});
  await db.gDriveUpload.deleteMany({});
  await db.photo.deleteMany({ where: { locationId: lokasiId } });
  await db.dailyReport.update({ where: { id: laporanFinalId }, data: { status: "final" } });
  await setGDriveOtomatisAktif(true);
});

/** Baris antrean laporan harian yang final (satu-satunya yang layak). */
function jobHarian() {
  return db.gDriveJob.findUnique({
    where: { kind_refKey: { kind: "laporan_harian", refKey: `${lokasiSlug}:2026-07-20` } },
  });
}

describe("sakelar", () => {
  it("MATI = antrean tidak disentuh sama sekali", async () => {
    await setGDriveOtomatisAktif(false);
    const h = await jalankanAntreanDrive();
    expect(h.aktif).toBe(false);
    expect(await db.gDriveJob.count()).toBe(0);
    expect(naik).toEqual([]);
  });

  it("akun Google belum terhubung: pekerjaan MENUNGGU, bukan dihanguskan", async () => {
    // Kalau ini dihitung gagal, seluruh antrean bisa menyerah permanen hanya
    // karena token belum dipasang — dan tidak ada yang tahu.
    await pindaiHarian();
    terhubung = false;
    const h = await jalankanAntreanDrive();
    expect(h.terhubung).toBe(false);
    const job = await jobHarian();
    expect(job).toMatchObject({ status: "menunggu", attempts: 0 });
  });
});

describe("pindai", () => {
  it("menjaring laporan FINAL yang paketnya punya folder Drive – dan hanya itu", async () => {
    const n = await pindaiHarian();
    expect(n).toBe(1);
    const semua = await db.gDriveJob.findMany({ where: { kind: "laporan_harian" } });
    expect(semua).toHaveLength(1);
    expect(semua[0]).toMatchObject({ periode: "2026-07-20", locationId: lokasiId });
  });

  it("dijalankan dua kali tidak menggandakan pekerjaan", async () => {
    await pindaiHarian();
    const kedua = await pindaiHarian();
    expect(kedua).toBe(0);
    expect(await db.gDriveJob.count({ where: { kind: "laporan_harian" } })).toBe(1);
  });

  it("laporan mingguan: hanya minggu yang SUDAH TUNTAS yang diantre", async () => {
    // SPMK 1 Juni; pada 20 Juni berjalan minggu ke-3, jadi yang tuntas 1 & 2 —
    // untuk KEDUA lokasi aktif di paket ini.
    const n = await pindaiMingguan(new Date("2026-06-20T09:00:00.000Z"));
    expect(n).toBe(4);
    const minggu = await db.gDriveJob.findMany({
      where: { kind: "laporan_mingguan" },
      orderBy: { periode: "asc" },
    });
    expect(minggu.map((m) => m.periode).sort()).toEqual(["1", "1", "2", "2"]);
  });

  it("BACKLOG konvergen: yang sudah diantre tidak memakan jatah putaran", async () => {
    // Cacat yang diuji di sini pernah nyata: mengambil "N final terbaru" lalu
    // mengandalkan skipDuplicates berarti begitu N itu terantre, tiap putaran
    // berikutnya mengambil N yang sama dan menyisipkan nol — laporan yang lebih
    // tua tidak akan PERNAH naik, tanpa satu pun tanda bahwa ada yang
    // tertinggal.
    const lama = await db.dailyReport.create({
      data: {
        locationId: lokasiId,
        reportDate: new Date("2026-07-10T00:00:00.000Z"),
        status: "final",
        createdById: userId,
      },
    });

    // Jatah satu — hanya yang terbaru (20 Juli) yang muat.
    expect(await pindaiHarian(1)).toBe(1);
    expect(await db.gDriveJob.count({ where: { kind: "laporan_harian" } })).toBe(1);

    // Putaran berikutnya dengan jatah yang sama harus MAJU ke yang lebih tua,
    // bukan mengambil ulang yang sudah diantre.
    expect(await pindaiHarian(1)).toBe(1);
    const semua = await db.gDriveJob.findMany({ where: { kind: "laporan_harian" } });
    expect(semua.map((j) => j.periode).sort()).toEqual(["2026-07-10", "2026-07-20"]);

    // Sudah habis — tidak ada lagi yang tertinggal.
    expect(await pindaiHarian(1)).toBe(0);
    await db.dailyReport.delete({ where: { id: lama.id } });
  });

  it("BACKLOG mingguan konvergen – jatah kecil tetap menjangkau lokasi berikutnya", async () => {
    // Dua cacat sekaligus diuji di sini: minggu yang sudah diantre memakan
    // jatah, DAN pindai berhenti di lokasi pertama. Dengan jatah 1 per putaran,
    // empat putaran harus menjangkau 2 lokasi × 2 minggu — bukan berputar di
    // lokasi yang sama.
    const now = new Date("2026-06-20T09:00:00.000Z");
    for (let i = 0; i < 4; i++) expect(await pindaiMingguan(now, 1)).toBe(1);
    expect(await pindaiMingguan(now, 1)).toBe(0);

    const perLokasi = await db.gDriveJob.groupBy({
      by: ["locationId"],
      where: { kind: "laporan_mingguan" },
      _count: { _all: true },
    });
    expect(perLokasi).toHaveLength(2);
    expect(perLokasi.every((p) => p._count._all === 2)).toBe(true);
  });

  it("tidak menghidupkan kembali pekerjaan yang sudah MENYERAH", async () => {
    // Yang menyerah butuh tangan manusia; memutarnya diam-diam menyembunyikan
    // masalah yang justru harus terlihat.
    await pindaiHarian();
    await db.gDriveJob.updateMany({ data: { status: "menyerah", lastError: "folder hilang" } });
    await pindaiHarian();
    expect(await jobHarian()).toMatchObject({ status: "menyerah" });
  });
});

describe("mengerjakan antrean", () => {
  it("menaikkan PDF laporan lalu menandai selesai; putaran kedua tidak mengulang", async () => {
    await pindaiHarian();
    const h = await jalankanAntreanDrive({ pindai: false });
    expect(h.sukses).toBe(1);
    expect(naik).toEqual([`Laporan Harian - Pasar Banggi - 2026-07-20.pdf`]);
    expect(await jobHarian()).toMatchObject({ status: "sukses", lastError: null });

    naik = [];
    const kedua = await jalankanAntreanDrive({ pindai: false });
    expect(kedua.dikerjakan).toBe(0);
    expect(naik).toEqual([]);
  });

  it("prasyarat teknis hilang (folder paket dicabut) TIDAK menghentikan sisa putaran", async () => {
    // Galat ini sampai tanpa status HTTP. Kalau digolongkan "ditahan laju", ia
    // menghentikan putaran DAN mengulang selamanya tanpa pernah muncul sebagai
    // macet — laporan lain ikut tertahan oleh satu paket yang salah setelan.
    await pindaiHarian();
    await db.package.update({ where: { id: packageId }, data: { driveFolderId: null } });
    try {
      const h = await jalankanAntreanDrive({ pindai: false });
      expect(h.gagal).toBe(1);
      expect(h.ditahan).toBe(0);
      expect(h.berhenti).toBeNull();
      expect(await jobHarian()).toMatchObject({ status: "menunggu", attempts: 1 });
    } finally {
      await db.package.update({
        where: { id: packageId },
        data: { driveFolderId: "folder-kkp" },
      });
    }
  });

  it("FOTO ikut naik – hasil otomatis sama isinya dengan tombol manual", async () => {
    await db.photo.create({
      data: {
        locationId: lokasiId,
        reportId: laporanFinalId,
        r2Key: `foto/${suffix}-1.jpg`,
        sha256: `sha-${suffix}-1`,
        bytes: 1024,
      },
    });
    await pindaiHarian();
    await jalankanAntreanDrive({ pindai: false });
    expect(naik).toEqual([
      "Laporan Harian - Pasar Banggi - 2026-07-20.pdf",
      "2026-07-20 Pasar Banggi 01.jpg",
    ]);
  });

  it("laporan dibuka kembali setelah diantre: DIBATALKAN, tidak naik", async () => {
    // Angka yang sudah dicabut tidak boleh mendarat di folder pemberi kerja
    // hanya karena antreannya terlanjur dibuat beberapa jam sebelumnya.
    await pindaiHarian();
    await db.dailyReport.update({ where: { id: laporanFinalId }, data: { status: "disetujui" } });
    const h = await jalankanAntreanDrive({ pindai: false });
    expect(h.batal).toBe(1);
    expect(naik).toEqual([]);
    expect(await jobHarian()).toMatchObject({ status: "batal" });
  });

  it("finalisasi ulang mengantre lagi – isinya sudah berbeda dari yang di Drive", async () => {
    await pindaiHarian();
    await jalankanAntreanDrive({ pindai: false });
    expect(await jobHarian()).toMatchObject({ status: "sukses" });

    await antrekanLaporanHarian(laporanFinalId);
    expect(await jobHarian()).toMatchObject({ status: "menunggu", attempts: 0 });
  });
});

describe("saat Google menolak", () => {
  it("ditahan laju (429): tetap menunggu, percobaan TIDAK bertambah, putaran berhenti", async () => {
    await pindaiHarian();
    lemparBerikut = { status: 429, pesan: "Rate Limit Exceeded", retryAfter: "60" };
    const h = await jalankanAntreanDrive({ pindai: false });

    expect(h.ditahan).toBe(1);
    expect(h.gagal).toBe(0);
    expect(h.berhenti).toMatch(/menahan laju/i);
    const job = await jobHarian();
    expect(job).toMatchObject({ status: "menunggu", attempts: 0 });
    expect(job!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("gagal beneran (404 folder): percobaan bertambah dan mundur dijadwalkan", async () => {
    await pindaiHarian();
    lemparBerikut = { status: 404, pesan: "Folder Drive tidak ditemukan" };
    const h = await jalankanAntreanDrive({ pindai: false });

    expect(h.gagal).toBe(1);
    expect(h.ditahan).toBe(0);
    const job = await jobHarian();
    expect(job).toMatchObject({ status: "menunggu", attempts: 1 });
    expect(job!.lastError).toMatch(/tidak ditemukan/i);
  });

  it("menyerah setelah batas percobaan, lalu bisa dikembalikan lewat “coba lagi”", async () => {
    await pindaiHarian();
    await db.gDriveJob.updateMany({ data: { attempts: MAKS_PERCOBAAN - 1 } });
    lemparBerikut = { status: 400, pesan: "Permintaan ditolak" };
    const h = await jalankanAntreanDrive({ pindai: false });

    expect(h.menyerah).toBe(1);
    expect(await jobHarian()).toMatchObject({ status: "menyerah" });

    const dikembalikan = await ulangiYangMenyerah();
    expect(dikembalikan).toBe(1);
    expect(await jobHarian()).toMatchObject({ status: "menunggu", attempts: 0, lastError: null });
  });

  it("pekerjaan yang menggantung karena proses mati dibebaskan lagi", async () => {
    await pindaiHarian();
    await db.gDriveJob.updateMany({
      data: { status: "jalan", claimedAt: new Date(Date.now() - 60 * 60_000) },
    });
    await jalankanAntreanDrive({ pindai: false });
    expect(await jobHarian()).toMatchObject({ status: "sukses" });
  });
});
