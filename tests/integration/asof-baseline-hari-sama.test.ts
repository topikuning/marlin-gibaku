// BATAS `asOf` DI HARI YANG SAMA — kenapa layar & PDF menampilkan rencana beda.
//
// Laporan user 2026-08-06: workspace lokasi menulis Rencana 1,7% / Deviasi
// +2,7%, sedangkan PDF "Ringkasan Pelaksanaan Harian" tanggal SAMA menulis
// Rencana kurva-S 23,30% / Deviasi −18,91%. Realisasinya cocok (4,4% vs 4,39%),
// minggunya cocok (2 dari 20). Yang berbeda HANYA rencananya — dan hari itu
// jadwal kurva-S memang baru diubah.
//
// Sebabnya bukan dua rumus. Keduanya memanggil `getLocationProgress` yang sama.
// Yang berbeda adalah BASELINE MANA yang dianggap berlaku:
//
//   - layar workspace  → tanpa `asOf` → baseline berstatus `aktif` (yang BARU);
//   - PDF harian       → `asOf = reportDate`.
//
// `reportDate` berasal dari kolom tanggal kerja `@db.Date`, jadi nilainya
// TENGAH MALAM UTC = 07:00 WIB. Baseline yang diaktifkan siang hari punya
// `createdAt` LEBIH BESAR dari batas itu, sehingga gugur oleh syarat
// `createdAt <= asOf` — dan baseline lama yang `supersededAt`-nya juga siang itu
// justru lolos syarat `supersededAt > asOf`. Hasilnya: dokumen resmi hari ini
// memakai jadwal yang tadi pagi baru saja diganti, tanpa satu kata pun di
// dokumen yang mengatakannya.
//
// Maksud `asOf` (CALC-01) adalah "revisi & baseline yang EFEKTIF pada tanggal
// itu". Baseline yang diaktifkan pukul 14:00 pada 6 Agustus JELAS efektif pada
// 6 Agustus. Jadi batas yang benar adalah AKHIR hari kerja itu, bukan awalnya.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getLocationProgress } = await import("@/lib/progress");
const { parseDateKey } = await import("@/lib/format");

const suffix = `aof${Date.now().toString(36)}`;
let orgId: string;
let locId: string;

/** Tanggal laporan = hari saat jadwal diubah. */
const HARI_INI = "2026-08-06";
/** Batas `asOf` yang dipakai kode: tengah malam UTC = 07:00 WIB. */
const ASOF = parseDateKey(HARI_INI)!;
/** Jadwal diganti SIANG hari itu — sesudah batas di atas. */
const SAAT_GANTI = new Date("2026-08-06T07:30:00.000Z"); // 14:30 WIB

/** Rencana kumulatif minggu 1..20 — dua kurva yang sangat berbeda di minggu 2. */
const KURVA_LAMA = [11.5, 23.3, 34, 44, 52, 59, 65, 70, 75, 79, 83, 86, 89, 92, 94, 96, 97, 98, 99, 100];
const KURVA_BARU = [0.8, 1.7, 3.2, 5.4, 8.5, 12.5, 17.5, 23.5, 30.5, 38, 46, 54, 62, 70, 77, 84, 89, 94, 97, 100];

async function buatBaseline(no: number, kurva: number[], createdAt: Date, supersededAt: Date | null) {
  const b = await db.baseline.create({
    data: {
      locationId: locId,
      baselineNo: no,
      source: "auto",
      status: supersededAt ? "digantikan" : "aktif",
      contractDays: 140,
      createdAt,
      supersededAt,
    },
    select: { id: true },
  });
  await db.baselinePoint.createMany({
    data: kurva.map((p, i) => ({ baselineId: b.id, weekNumber: i + 1, plannedPct: p })),
  });
  return b.id;
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org ASOF ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket ASOF ${suffix}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Pasir ${suffix}`,
      slug: `pasir-${suffix}`,
      village: "Pasir",
      regency: "Kebumen",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true },
  });
  locId = loc.id;

  const vendor = await db.vendor.create({
    data: { orgId, name: `CV Uji ${suffix}` },
    select: { id: true },
  });
  // Kontrak mulai 27 Jul 2026 → 6 Agu 2026 = hari ke-11 = minggu ke-2.
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 12_228_475_000n,
      ppnPercent: 11,
      signedDate: new Date("2026-07-20T00:00:00.000Z"),
      durationDays: 140,
      startDate: new Date("2026-07-27T00:00:00.000Z"),
      endDate: new Date("2026-12-09T00:00:00.000Z"),
    },
  });

  // Baseline LAMA dibuat sebelum hari ini, digantikan SIANG ini.
  await buatBaseline(1, KURVA_LAMA, new Date("2026-07-27T02:00:00.000Z"), SAAT_GANTI);
  // Baseline BARU dibuat SIANG ini — sesudah tengah malam UTC hari ini.
  await buatBaseline(2, KURVA_BARU, SAAT_GANTI, null);
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("asOf pada hari yang sama dengan pergantian baseline", () => {
  it("minggunya sama-sama 2 — jadi selisihnya memang bukan soal minggu", async () => {
    const layar = await getLocationProgress(locId);
    const dokumen = await getLocationProgress(locId, { asOf: ASOF });
    expect(layar.weekNumber).toBe(2);
    expect(dokumen.weekNumber).toBe(2);
  });

  it("layar workspace memakai baseline AKTIF (yang baru)", async () => {
    const layar = await getLocationProgress(locId);
    expect(layar.planPct).toBeCloseTo(1.7, 5);
  });

  it("dokumen hari INI harus memakai baseline yang berlaku hari ini juga", async () => {
    // Inilah cacatnya. Batas `asOf` = tengah malam UTC (07:00 WIB), sedangkan
    // jadwalnya diganti pukul 14:30 WIB — jadi baseline baru gugur dan dokumen
    // resmi mencetak rencana yang sudah dibatalkan pagi tadi.
    const dokumen = await getLocationProgress(locId, { asOf: ASOF });
    expect(dokumen.planPct).toBeCloseTo(1.7, 5);
  });

  it("laporan BACKDATED tetap memakai baseline yang berlaku saat itu", async () => {
    // Pagar arah sebaliknya: perbaikan batas hari ini TIDAK boleh membuat
    // dokumen lama ikut memakai jadwal yang baru (CALC-01). 30 Juli = minggu 1.
    const lampau = await getLocationProgress(locId, { asOf: parseDateKey("2026-07-30")! });
    expect(lampau.weekNumber).toBe(1);
    expect(lampau.planPct).toBeCloseTo(11.5, 5);
  });
});
