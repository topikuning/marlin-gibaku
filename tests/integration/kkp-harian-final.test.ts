// LAPORAN YANG SUDAH FINAL TIDAK BOLEH KEHILANGAN SAMPUL & FOTONYA.
//
// Laporan user 2026-08-07: *"cetak harian final juga, halaman fotonya tidak
// ada"*. Penyebabnya cacat SENYAP di `getKkpDailyData`: sampul + dokumentasi
// (nomor kontrak, periode, alamat pelaksana, dan seluruh daftar foto) hanya
// dirakit di cabang PRATINJAU. Begitu laporan difinalisasi, cabangnya berpindah
// ke `finalSnapshot` — dan snapshot itu memang tidak pernah memuat foto.
//
// Yang membuatnya berbahaya: pratinjau terlihat SEMPURNA. Dokumen yang cacat
// justru versi final — satu-satunya yang benar-benar dikirim ke KKP, dan yang
// baru diperiksa orang setelah terkirim.
//
// Uji ini membandingkan dokumen SEBELUM dan SESUDAH finalisasi atas laporan
// yang SAMA. Tidak ada yang boleh hilang hanya karena statusnya berubah.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Audit log memanggil `requestIp()` (→ next/headers); di luar request scope Next
// melempar. Header disediakan di sini, bukan dengan menelan galatnya di produksi.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "marlin.uji", "x-forwarded-proto": "https" }),
}));
// Kop pemilik memuat logo dari R2; di uji R2 mati. Halaman tetap harus terbentuk.
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => false,
  r2PresignGet: async () => {
    throw new Error("R2 mati di uji");
  },
  r2GetBuffer: async () => {
    throw new Error("R2 mati di uji");
  },
}));

const { db } = await import("@/lib/db");
const { getKkpDailyData } = await import("@/lib/daily-report/queries");
const { getOrCreateDraft, upsertItem, submitReport, approveReport, finalizeReport } = await import(
  "@/lib/daily-report/service"
);

const suffix = `kf${Date.now().toString(36)}`;
const HARI = "2026-06-10"; // minggu ke-2 dari SPMK 1 Juni

let orgId = "";
let mandorId = "";
let pmId = "";
let adminId = "";
let locationId = "";
let slug = "";
let reportId = "";
let batuId = "";

async function buatUser(nama: string, role: "site_manager" | "project_manager" | "super_admin") {
  return (
    await db.user.create({
      data: { orgId, username: `${nama}-${suffix}`, fullName: nama, passwordHash: "x", role },
      select: { id: true },
    })
  ).id;
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org KF ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  mandorId = await buatUser("Mandor", "site_manager");
  pmId = await buatUser("PM", "project_manager");
  adminId = await buatUser("Admin", "super_admin");

  const vendor = await db.vendor.create({
    data: {
      orgId,
      name: `PT Vendor KF ${suffix}`,
      address: "Jl. Uji No. 1, Jakarta",
      logoKey: "logo/vendor-kf.webp",
    },
  });
  const pkg = await db.package.create({
    data: { orgId, name: `Paket KF ${suffix}`, stage: "pelaksanaan" },
  });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-KF-${suffix}`,
      contractValue: 125_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 21,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-21"),
      workTitle: "Pembangunan Uji Final",
    },
  });

  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi Final",
      slug: `final-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true, slug: true },
  });
  locationId = loc.id;
  slug = loc.slug;

  // RAB aktif dimundurkan ke sebelum SPMK: `getLocationProgress({asOf})` memilih
  // revisi yang EFEKTIF pada tanggal itu, dan tanpa ini grandTotal jadi 0
  // sehingga kolom bobot di kartu foto kehilangan artinya.
  const rev = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo: 1,
      source: "hps_awal",
      status: "aktif",
      totalValue: 125_000_000n,
      createdAt: new Date("2026-05-26"),
    },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "kategori",
      code: "I",
      name: "PEKERJAAN UJI",
      amount: 125_000_000n,
      lineageKey: "I",
      sortOrder: 1,
    },
  });
  batuId = (
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        code: "1",
        name: "Pasangan batu",
        volume: 100,
        unit: "m3",
        unitPrice: 1_000_000,
        amount: 100_000_000n,
        lineageKey: "I#1",
        sortOrder: 2,
      },
      select: { id: true },
    })
  ).id;

  const lap = await getOrCreateDraft(locationId, HARI, mandorId);
  reportId = lap.id;
  const item = await upsertItem(lap.id, { rabNodeId: batuId, volumeDone: 20 }, mandorId);

  // Foto bukti yang TERTAUT ke baris pekerjaannya — inilah yang hilang.
  await db.photo.create({
    data: {
      locationId,
      reportId: lap.id,
      reportItemId: item.id,
      r2Key: `photos/${suffix}/1.webp`,
      sha256: `sha-${suffix}-1`,
      bytes: 1234,
      uploadedById: mandorId,
    },
  });
  // Foto kedua tanpa item — bukti tetap bukti; tidak boleh ikut hilang.
  await db.photo.create({
    data: {
      locationId,
      reportId: lap.id,
      r2Key: `photos/${suffix}/2.webp`,
      sha256: `sha-${suffix}-2`,
      bytes: 2345,
      uploadedById: mandorId,
    },
  });

  await submitReport(lap.id, mandorId);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("KASUS INTI: sampul & dokumentasi bertahan melewati finalisasi", () => {
  it("pratinjau memuat foto, nomor kontrak, dan periode", async () => {
    const d = await getKkpDailyData(slug, HARI);
    expect(d).not.toBeNull();
    expect(d!.isFinal).toBe(false);
    expect(d!.photos).toHaveLength(2);
    expect(d!.contractNumber).toContain("SPK-KF-");
    expect(d!.periodStart).toBeTruthy();
    expect(d!.contractorAddress).toBe("Jl. Uji No. 1, Jakarta");
    expect(d!.vendorLogoKey).toBe("logo/vendor-kf.webp");
    // Bobot kartu foto: 20 m3 × Rp 1 juta = Rp 20 juta dari Rp 125 juta = 16%.
    const berlabel = d!.photos!.find((p) => p.pekerjaan === "Pasangan batu");
    expect(berlabel?.bobot).toBeCloseTo(16, 2);
    expect(berlabel?.kategori).toBe("PEKERJAAN UJI");
  });

  it("SESUDAH final, dokumen yang sama masih memuat semuanya", async () => {
    await approveReport(reportId, pmId);
    await finalizeReport(reportId, adminId);

    const d = await getKkpDailyData(slug, HARI);
    expect(d!.isFinal).toBe(true);

    // Inti bug: cabang finalSnapshot dulu tidak merakit blok ini sama sekali,
    // sehingga halaman DOKUMENTASI PEKERJAAN raib dari PDF final.
    expect(d!.photos).toHaveLength(2);
    expect(d!.photos!.some((p) => p.pekerjaan === "Pasangan batu")).toBe(true);
    expect(d!.photos!.some((p) => p.pekerjaan === null)).toBe(true);

    // Sampul: identitas kontrak & pelaksana ikut hilang bersama fotonya.
    expect(d!.contractNumber).toContain("SPK-KF-");
    expect(d!.contractDate).toBeTruthy();
    expect(d!.periodStart).toBeTruthy();
    expect(d!.periodEnd).toBeTruthy();
    expect(d!.contractorAddress).toBe("Jl. Uji No. 1, Jakarta");
    expect(d!.vendorLogoKey).toBe("logo/vendor-kf.webp");
  });

  it("angka blanko TETAP dari snapshot beku – perbaikan ini tidak boleh mencairkannya", async () => {
    // Batas yang penting: sampul & foto boleh diambil dari data hidup, TAPI
    // volume/prestasi wajib tetap dari snapshot. Kalau tidak, "final" kehilangan
    // artinya. Diuji dengan MENGUBAH RAB sesudah final: nama & volume di blanko
    // harus tetap seperti saat dibekukan.
    await db.rabNode.update({ where: { id: batuId }, data: { volume: 999 } });
    const d = await getKkpDailyData(slug, HARI);
    expect(d!.items[0].name).toBe("Pasangan batu");
    expect(d!.items[0].volumeContract).toBe(100);
    expect(d!.items[0].volumeToday).toBe(20);
    await db.rabNode.update({ where: { id: batuId }, data: { volume: 100 } });
  });
});

// SUSUNAN KARTU DIPAKAI BERSAMA PDF & LAYAR.
//
// Kalau halaman cetak HTML mengelompokkan fotonya sendiri, cepat atau lambat
// urutannya berbeda dari PDF yang dikirim — persis cara blanko harian pernah
// menyimpang antara PDF dan Excel (DECISIONS 241).
describe("kartu dokumentasi", () => {
  it("dikelompokkan per pekerjaan, maksimal 3 foto per kartu", async () => {
    const { susunKartu } = await import("@/lib/daily-report/kkp-lampiran-susun");
    const kartu = susunKartu([
      { pekerjaan: "Galian" },
      { pekerjaan: "Batu" },
      { pekerjaan: "Galian" },
      { pekerjaan: "Galian" },
      { pekerjaan: "Galian" },
      { pekerjaan: null },
    ]);
    expect(kartu).toHaveLength(4); // Galian(3) + Galian(1) + Batu(1) + tanpa-item(1)
    expect(kartu[0]).toHaveLength(3);
    expect(kartu[0].every((f) => f.pekerjaan === "Galian")).toBe(true);
    expect(kartu.some((k) => k[0].pekerjaan === null)).toBe(true);
  });

  it("modul PDF memakai fungsi yang SAMA, bukan salinannya", async () => {
    const murni = await import("@/lib/daily-report/kkp-lampiran-susun");
    const pdf = await import("@/lib/pdf/harian-kkp-lampiran");
    expect(pdf.susunKartu).toBe(murni.susunKartu);
    expect(pdf.terbilang).toBe(murni.terbilang);
  });
});
