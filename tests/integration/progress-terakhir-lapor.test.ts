// TERAKHIR LAPOR di papan /progress: tanggal kerja laporan terakhir yang DIKIRIM.
//
// Kolom ini memisahkan dua keadaan yang di papan lama terlihat persis sama:
// deviasi buruk dengan pelaporan yang jalan, dan deviasi buruk yang laporannya
// juga mandek. Yang kedua bukan soal kecepatan pekerjaan lagi — angkanya
// sendiri sudah tidak bisa dipercaya, karena realisasi dihitung dari laporan.
//
// Dua keputusan user 2026-08-30 yang dijaga di sini:
//
//  1. Yang dihitung adalah DIKIRIM, bukan disetujui. Laporan yang dikembalikan
//     jadi `perlu_koreksi` TETAP pernah dikirim; membuangnya dari hitungan akan
//     menuduh lapangan tidak melapor justru pada hari mereka melapor lalu
//     diminta membetulkan.
//  2. Yang dikembalikan tanggal KERJA, bukan jam pengirimannya. Pertanyaannya
//     "lapangan sudah melapor sampai tanggal berapa".
//
// Jalankan: DATABASE_URL=...marlin_test APP_ENV=test pnpm vitest run tests/integration
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getLastSubmittedReportDates } = await import("@/lib/daily-report/queries");

const suffix = `tlp-${Date.now().toString(36)}`;
let orgId: string;
let userId: string;
/** Lokasi A: punya laporan terkirim (dan satu draft yang lebih baru). */
let locA: string;
/** Lokasi B: SATU-SATUNYA laporannya berstatus perlu_koreksi. */
let locB: string;
/** Lokasi C: hanya punya draft — belum pernah mengirim apa pun. */
let locC: string;

const tanggal = (s: string) => new Date(`${s}T00:00:00.000Z`);

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  orgId = org.id;
  const pkg = await db.package.create({
    data: { orgId, name: `Paket ${suffix}`, stage: "pelaksanaan" },
  });
  const user = await db.user.create({
    data: {
      orgId,
      username: `u-${suffix}`,
      fullName: "Pengirim Uji",
      passwordHash: "x",
      role: "field_supervisor",
    },
  });
  userId = user.id;

  const buatLokasi = async (nama: string) => {
    const l = await db.location.create({
      data: {
        packageId: pkg.id,
        name: `Lokasi ${nama} ${suffix}`,
        slug: `${suffix}-${nama}`,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
        status: "berjalan",
        isActive: true,
      },
    });
    return l.id;
  };
  locA = await buatLokasi("a");
  locB = await buatLokasi("b");
  locC = await buatLokasi("c");

  const laporan = (
    locationId: string,
    tgl: string,
    status: "draft" | "dikirim" | "perlu_koreksi" | "disetujui" | "final",
    submittedAt: Date | null,
  ) =>
    db.dailyReport.create({
      data: {
        locationId,
        reportDate: tanggal(tgl),
        status,
        createdById: userId,
        submittedById: submittedAt ? userId : null,
        submittedAt,
      },
    });

  // A: dikirim 20 Agu, final 22 Agu, lalu DRAFT 25 Agu yang belum dikirim.
  await laporan(locA, "2026-08-20", "dikirim", new Date("2026-08-20T10:00:00Z"));
  await laporan(locA, "2026-08-22", "final", new Date("2026-08-22T10:00:00Z"));
  await laporan(locA, "2026-08-25", "draft", null);

  // B: satu-satunya laporannya dikembalikan untuk dikoreksi.
  await laporan(locB, "2026-08-21", "perlu_koreksi", new Date("2026-08-21T09:00:00Z"));

  // C: hanya draft.
  await laporan(locC, "2026-08-24", "draft", null);
});

afterAll(async () => {
  await db.dailyReport.deleteMany({ where: { locationId: { in: [locA, locB, locC] } } });
  await db.location.deleteMany({ where: { id: { in: [locA, locB, locC] } } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.package.deleteMany({ where: { orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.$disconnect();
});

describe("getLastSubmittedReportDates", () => {
  it("mengambil tanggal kerja TERBARU di antara yang sudah dikirim", async () => {
    const peta = await getLastSubmittedReportDates([locA]);
    expect(peta.get(locA)).toEqual(tanggal("2026-08-22"));
  });

  it("draft yang lebih baru TIDAK menggeser tanggalnya", async () => {
    // Draft 25 Agu ada dan lebih baru dari 22 Agu. Kalau ia ikut terhitung,
    // papan akan menyatakan lapangan sudah melapor sampai 25 – padahal yang
    // ada baru rancangan yang belum dikirim siapa pun.
    const peta = await getLastSubmittedReportDates([locA]);
    expect(peta.get(locA)).not.toEqual(tanggal("2026-08-25"));
  });

  it("laporan yang dikembalikan untuk dikoreksi TETAP terhitung pernah dikirim", async () => {
    const peta = await getLastSubmittedReportDates([locB]);
    expect(peta.get(locB)).toEqual(tanggal("2026-08-21"));
  });

  it("lokasi yang belum pernah mengirim tidak ada di petanya", async () => {
    // Bukan tanggal karangan, bukan epoch: ketiadaannya dinyatakan sebagai
    // ketiadaan, dan layar yang memutuskan cara menyebutnya.
    const peta = await getLastSubmittedReportDates([locC]);
    expect(peta.has(locC)).toBe(false);
  });

  it("satu panggilan melayani banyak lokasi sekaligus", async () => {
    // Papan /progress memuat 83 lokasi; kueri per lokasi berarti 83 perjalanan
    // ke basis data untuk satu tabel.
    const peta = await getLastSubmittedReportDates([locA, locB, locC]);
    expect([...peta.keys()].sort()).toEqual([locA, locB].sort());
  });

  it("daftar kosong tidak menyentuh basis data", async () => {
    const peta = await getLastSubmittedReportDates([]);
    expect(peta.size).toBe(0);
  });
});
