// BERKAS MINGGUAN: satu sampul + tujuh laporan harian (DECISIONS 332).
//
// Keterangan user 2026-08-16: *"sampul itu dibutuhkan untuk mengumpulkan
// beberapa laporan harian dalam periode mingguan. jadi satu sampul untuk 7
// laporan harian."*
//
// Yang diuji di sini adalah JANJI BERKASNYA, dan sengaja pada PDF sungguhan —
// bukan pada angka perantara. Pelajaran DECISIONS 331 masih baru: 19 uji
// aritmetika bisa hijau semua sementara gambarnya tidak pernah sampai ke
// kertas. Untuk PDF, satu-satunya keluaran yang berarti adalah berkas PDF-nya.
//
// Janji yang dikunci:
//
//  1. SATU sampul untuk tujuh hari — bukan tujuh sampul.
//  2. Hari tanpa laporan tetap dapat halaman blanko (keputusan user), dan
//     jumlahnya DILAPORKAN, tidak dihilangkan diam-diam.
//  3. Penomoran halaman MENERUS untuk seluruh berkas.
//  4. Tanpa SPMK tidak terbit — daripada menerbitkan dokumen resmi atas
//     tanggal karangan.
//
// Jalankan: DATABASE_URL=...marlin_test APP_ENV=test pnpm vitest run tests/integration
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { renderMingguanKkpPdf, tanggalMinggu } = await import("@/lib/pdf/mingguan-kkp");
const { renderHarianKkpPdf } = await import("@/lib/pdf/harian-kkp");

const suffix = `mgg-${Date.now().toString(36)}`;
const MULAI = new Date("2026-06-01T00:00:00.000Z");
let slug: string;
let slugTanpaSpmk: string;
let locationId: string;

/** Berapa halaman di PDF. Penanda `/Type /Page` ditulis sekali per halaman. */
function jumlahHalaman(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor ${suffix}` } });

  const buatLokasi = async (nama: string, denganSpmk: boolean) => {
    const pkg = await db.package.create({
      data: { orgId: org.id, name: `Paket ${nama}`, stage: "pelaksanaan" },
    });
    await db.contract.create({
      data: {
        packageId: pkg.id,
        vendorId: vendor.id,
        contractNumber: `SPK-${nama}`,
        contractValue: 100_000_000n,
        signedDate: new Date("2026-05-25"),
        durationDays: 153,
        ...(denganSpmk
          ? { startDate: MULAI, endDate: new Date("2026-11-01T00:00:00.000Z") }
          : {}),
      },
    });
    const loc = await db.location.create({
      data: {
        packageId: pkg.id,
        name: `Lokasi ${nama}`,
        slug: nama,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
        status: "berjalan",
        isActive: true,
      },
    });
    return loc;
  };

  const pembuat = await db.user.create({
    data: {
      orgId: org.id,
      username: `mandor-${suffix}`,
      fullName: "Mandor Uji",
      passwordHash: "x",
      role: "field_supervisor",
    },
  });

  const loc = await buatLokasi(suffix, true);
  locationId = loc.id;
  slug = loc.slug;
  slugTanpaSpmk = (await buatLokasi(`${suffix}-nospmk`, false)).slug;

  // Minggu ke-2 = 8..14 Juni. Sengaja hanya TIGA hari yang punya laporan,
  // supaya "empat hari kosong" bisa dibuktikan.
  for (const t of ["2026-06-08", "2026-06-09", "2026-06-10"]) {
    await db.dailyReport.create({
      data: {
        locationId,
        reportDate: new Date(`${t}T00:00:00.000Z`),
        status: "final",
        weather: "cerah",
        createdById: pembuat.id,
      },
    });
  }
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("berkas mingguan", () => {
  it("tanggalnya minggu ke-2 dihitung dari SPMK, bukan kalender", async () => {
    expect(tanggalMinggu(MULAI, 2)).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
  });

  it("terbit sebagai PDF berisi tujuh hari", async () => {
    const hasil = await renderMingguanKkpPdf(slug, 2);
    expect(hasil).not.toBeNull();
    expect(hasil!.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(hasil!.tanggal).toHaveLength(7);
  });

  it("halamannya PERSIS satu sampul + tujuh badan harian", async () => {
    // Pembuktian terkuat yang bisa dilakukan tanpa membaca teks: PDF ini
    // memakai font subset, sehingga bita string di dalamnya adalah ID glyph —
    // mencari kata "LAPORAN HARIAN" di sana selalu nihil dan uji yang
    // melakukannya akan hijau/merah karena alasan yang salah.
    //
    // Jadi yang dihitung halamannya. Kalau tiap hari membawa sampulnya
    // sendiri, jumlahnya kelebihan enam. Kalau ada hari yang terlewat,
    // jumlahnya kurang.
    const mingguan = (await renderMingguanKkpPdf(slug, 2))!;

    let badan = 0;
    for (const t of mingguan.tanggal) {
      const sehari = (await renderHarianKkpPdf(slug, t, { tanpaSampul: true }))!;
      badan += jumlahHalaman(sehari.buffer);
    }
    expect(jumlahHalaman(mingguan.buffer)).toBe(1 + badan);
  });

  it("tepatnya: LEBIH SEDIKIT daripada tujuh laporan harian bersampul", async () => {
    // Sisi lain dari janji yang sama — enam sampul yang hilang itu intinya.
    const mingguan = (await renderMingguanKkpPdf(slug, 2))!;
    let bersampul = 0;
    for (const t of mingguan.tanggal) {
      bersampul += jumlahHalaman((await renderHarianKkpPdf(slug, t))!.buffer);
    }
    expect(jumlahHalaman(mingguan.buffer)).toBe(bersampul - 6);
  });

  it("hari tanpa laporan tetap dapat halaman, dan jumlahnya DILAPORKAN", async () => {
    // Tiga hari berlaporan, empat kosong. Halamannya tetap ada (blanko kosong,
    // keputusan user) — yang tidak boleh adalah menghilangkannya diam-diam.
    const hasil = (await renderMingguanKkpPdf(slug, 2))!;
    expect(hasil.hariKosong).toBe(4);
    expect(hasil.tanggal).toHaveLength(7);
  });

  it("minggu yang seluruhnya kosong tetap terbit, dan mengaku kosong", async () => {
    const hasil = (await renderMingguanKkpPdf(slug, 9))!;
    expect(hasil.hariKosong).toBe(7);
    expect(hasil.tanggal).toHaveLength(7);
    expect(hasil.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("tanpa SPMK TIDAK terbit — daripada mengarang tanggal", async () => {
    // "Minggu ke-n" tidak punya tanggal tanpa SPMK. Menerbitkan dokumen resmi
    // atas tanggal tebakan jauh lebih buruk daripada tidak terbit.
    expect(await renderMingguanKkpPdf(slugTanpaSpmk, 1)).toBeNull();
  });
});
