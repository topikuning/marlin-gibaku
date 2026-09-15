// SATU SEMANTIK TANGGAL AKHIR KONTRAK: endDate = SPMK + durationDays.
//
// Keputusan user 2026-09-15: SPMK adalah titik nol, jadi kontrak 116 hari yang
// SPMK-nya Kamis 5/3/2026 berakhir 29/6/2026 — bukan 28/6. Itu memang yang
// ditulis aksi SPMK & koreksi kontrak (DECISIONS 054), dan yang tersimpan di
// seluruh kontrak yang sudah ada.
//
// Yang TIDAK ikut sepakat: (a) cabang `assume` getPeriodBounds — dipakai Cetak
// Jadwal sebelum SPMK — memakai durasi − 1; (b) `totalWeeksFor` menghitung
// kolom minggu dari ceil(durasi/7) alih-alih dari pasangan (SPMK, akhir) yang
// tersimpan. Pada durasi kelipatan 7 keduanya berselisih satu kolom: baseline
// dibuat 17 kolom sementara laporan periodik memakai 18, sehingga kolom minggu
// TERAKHIR blanko KKP tidak punya titik rencana sama sekali.
// Audit 2026-09-15 (G-2).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { totalWeeksFor } = await import("@/lib/rab/import");
const { getPeriodBounds } = await import("@/lib/periodic-report");

const suffix = `ak${Date.now().toString(36)}`;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
const kunci = (t: Date) => t.toISOString().slice(0, 10);

/** Durasi KELIPATAN 7 — di situlah kedua penghitung berselisih. */
const DURASI = 119;
const START = "2026-03-05";
/** SPMK + durasi, sesuai keputusan user. */
const END = "2026-07-02";

let lokasiBerSpmk = "";
let lokasiTanpaSpmk = "";
let baselineId = "";

/** Migrasi backfill dibaca dari berkasnya supaya uji & migrasi tak bisa menyimpang. */
const MIGRASI = readFileSync(
  "prisma/migrations/20260915140000_kolom_minggu_baseline_dari_tanggal/migration.sql",
  "utf8",
);

async function buatPaket(nama: string, opts: { spmk: boolean }) {
  const org = await db.organization.create({ data: { name: `Org ${nama}`, slug: `${suffix}-${nama}` } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${nama}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${nama}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `KTR-${nama}`,
      contractValue: 100_000_000n, signedDate: d("2026-03-01"), durationDays: DURASI,
      startDate: opts.spmk ? d(START) : null,
      endDate: opts.spmk ? d(END) : null,
      weekMode: "tujuh_hari",
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: `Lokasi ${nama}`, slug: `lok-${suffix}-${nama}`,
      village: "Desa", regency: "Kab", province: "Prov",
    },
    select: { id: true },
  });
  return loc.id;
}

beforeAll(async () => {
  lokasiBerSpmk = await buatPaket(`spmk${suffix}`, { spmk: true });
  lokasiTanpaSpmk = await buatPaket(`pra${suffix}`, { spmk: false });

  // Baseline LAMA: 17 kolom, dibuat penghitung ceil(durasi/7) yang keliru.
  const rev = await db.rabRevision.create({
    data: {
      locationId: lokasiBerSpmk, revisionNo: 1, source: "hps_awal",
      status: "aktif", totalValue: 100_000_000n,
    },
  });
  const baseline = await db.baseline.create({
    data: {
      locationId: lokasiBerSpmk, baselineNo: 1, source: "manual", status: "aktif",
      rabRevisionId: rev.id, contractDays: DURASI,
    },
  });
  baselineId = baseline.id;
  await db.baselinePoint.createMany({
    data: Array.from({ length: 17 }, (_, i) => ({
      baselineId, weekNumber: i + 1, plannedPct: ((i + 1) / 17) * 100,
    })),
  });
  await db.baselineScheduleItem.createMany({
    data: [
      {
        baselineId, lineageKey: "I", name: "PERSIAPAN", weightPct: 40,
        weekly: Array.from({ length: 17 }, (_, i) => (i < 4 ? 10 : 0)),
      },
      {
        baselineId, lineageKey: "II", name: "STRUKTUR", weightPct: 60,
        weekly: Array.from({ length: 17 }, (_, i) => (i >= 4 ? 60 / 13 : 0)),
      },
    ],
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("kolom minggu baseline dan laporan periodik memakai penghitung yang sama", () => {
  it("totalWeeksFor sepakat dengan getPeriodBounds", async () => {
    const baseline = await totalWeeksFor(lokasiBerSpmk);
    const bounds = await getPeriodBounds(lokasiBerSpmk);
    if (!bounds) throw new Error("bounds tidak terbentuk");
    // 2026-03-05 s/d 2026-07-02 = 120 hari inklusif = 18 kolom tujuh-hari.
    expect(bounds.totalWeeks).toBe(18);
    expect(baseline.totalWeeks).toBe(bounds.totalWeeks);
  });
});

describe("Cetak Jadwal sebelum SPMK memakai semantik yang sama", () => {
  it("akhir yang diasumsikan = mulai + durasi, bukan durasi − 1", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${START}T09:00:00+07:00`));
    try {
      const bounds = await getPeriodBounds(lokasiTanpaSpmk, { assume: true });
      if (!bounds) throw new Error("bounds asumsi tidak terbentuk");
      expect(bounds.assumed).toBe(true);
      expect(kunci(bounds.startDate)).toBe(START);
      expect(kunci(bounds.endDate)).toBe(END);
      // Dan jumlah kolomnya sama dengan kontrak yang SPMK-nya sudah terbit.
      expect(bounds.totalWeeks).toBe(18);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("baseline yang telanjur satu kolom lebih pendek", () => {
  it("dipanjangkan migrasi tanpa mengubah bentuk kurvanya", async () => {
    await db.$executeRawUnsafe(MIGRASI);

    const titik = await db.baselinePoint.findMany({
      where: { baselineId },
      orderBy: { weekNumber: "asc" },
      select: { weekNumber: true, plannedPct: true },
    });
    expect(titik).toHaveLength(18);
    // Minggu tambahan mewarisi nilai minggu terakhir – tetap monoton, tetap 100.
    expect(Number(titik[17].plannedPct)).toBeCloseTo(100, 3);
    expect(Number(titik[16].plannedPct)).toBeCloseTo(100, 3);
    for (let i = 1; i < titik.length; i++) {
      expect(Number(titik[i].plannedPct)).toBeGreaterThanOrEqual(Number(titik[i - 1].plannedPct) - 1e-9);
    }

    const jadwal = await db.baselineScheduleItem.findMany({
      where: { baselineId },
      select: { lineageKey: true, weightPct: true, weekly: true },
    });
    for (const j of jadwal) {
      const w = j.weekly as number[];
      expect(w, j.lineageKey).toHaveLength(18);
      // Kolom tambahan NOL – Σ bobot tiap baris tidak berubah.
      expect(w[17]).toBe(0);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(Number(j.weightPct), 6);
    }
  });

  it("menjalankan migrasi dua kali tidak menambah kolom dua kali", async () => {
    await db.$executeRawUnsafe(MIGRASI);
    expect(await db.baselinePoint.count({ where: { baselineId } })).toBe(18);
    const j = await db.baselineScheduleItem.findFirstOrThrow({
      where: { baselineId, lineageKey: "I" },
      select: { weekly: true },
    });
    expect((j.weekly as number[]).length).toBe(18);
  });
});
