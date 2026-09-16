// IMPOR REKAP: yang DIJANJIKAN pratinjau harus sama dengan yang MASUK basis data.
//
// Aturan penggabungannya sudah diuji murni di `tests/unit/recap-import.test.ts`.
// Yang TIDAK bisa dibuktikan di sana justru penyebab kerusakannya: `commitRecap`
// menyimpan lewat `upsertItem` pada kunci unik (reportId, lineageKey), jadi dua
// baris untuk hari & pekerjaan yang sama membuat yang kedua MENIMPA yang pertama.
// Pratinjau menjanjikan 3+4, yang tersimpan 4 — dan `itemsSaved` tetap dua.
// Audit 2026-09-15 (C-2).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

const { db } = await import("@/lib/db");
const { buildRecapPreview, commitRecap } = await import("@/lib/daily-report/recap-import");

const suffix = `rk${Date.now().toString(36)}`;
let locationId = "";
let userId = "";

/** Berkas rekap dengan header standar template MARLIN. */
async function berkasRekap(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rekap");
  ws.addRow(["Rekap Laporan Harian"]);
  ws.addRow(["Tanggal", "Kode", "Uraian Pekerjaan", "Volume"]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: `Lokasi ${suffix}`, slug: `lok-${suffix}`,
      village: "D", regency: "K", province: "P", isActive: true, status: "berjalan",
    },
  });
  locationId = loc.id;
  const u = await db.user.create({
    data: { orgId: org.id, username: `sm-${suffix}`, fullName: "Mandor Uji", role: "site_manager", passwordHash: "x" },
  });
  userId = u.id;
  const rev = await db.rabRevision.create({
    data: { locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 10_000n },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN TANAH", amount: 10_000n, lineageKey: "I", sortOrder: 1 },
  });
  await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1.1", name: "Galian Tanah",
      volume: 100, unit: "m3", unitPrice: 100, amount: 10_000n, lineageKey: "I#1", sortOrder: 2,
    },
  });
});

beforeEach(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_report_items, daily_report_status_history, daily_reports, audit_logs
     RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_report_items, daily_report_status_history, daily_reports, issues,
     rab_nodes, rab_revisions, audit_logs, locations, packages, users, organizations
     RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("impor rekap – dua baris untuk hari & pekerjaan yang sama", () => {
  it("volume yang TERSIMPAN sama dengan yang dijanjikan pratinjau", async () => {
    const buf = await berkasRekap([
      ["2026-07-12", "1.1", "Galian Tanah", 3], // pagi
      ["2026-07-12", "1.1", "Galian Tanah", 4], // sore
    ]);

    const pratinjau = await buildRecapPreview(locationId, buf);
    expect(pratinjau.rows.map((r) => r.status)).toEqual(["ok", "digabung"]);
    expect(pratinjau.okCount).toBe(1);
    // Baris kedua BUKAN masalah – volumenya ikut tersimpan, bukan dibuang.
    expect(pratinjau.problemCount).toBe(0);
    expect(pratinjau.totalValue).toBe(700); // (3+4) × 100

    const hasil = await commitRecap(locationId, buf, userId);
    expect(hasil.errors).toEqual([]);
    expect(hasil.itemsSaved).toBe(1);

    const item = await db.dailyReportItem.findFirstOrThrow({
      where: { report: { locationId, reportDate: new Date("2026-07-12T00:00:00Z") } },
      select: { volumeDone: true, valueDone: true },
    });
    expect(Number(item.volumeDone)).toBe(7);
    expect(item.valueDone).toBe(700n);
  });

  it("tanggal BERBEDA tetap dua laporan berdiri sendiri", async () => {
    const buf = await berkasRekap([
      ["2026-07-12", "1.1", "Galian Tanah", 3],
      ["2026-07-13", "1.1", "Galian Tanah", 4],
    ]);
    const hasil = await commitRecap(locationId, buf, userId);
    expect(hasil.itemsSaved).toBe(2);
    expect(hasil.reportsTouched).toBe(2);

    const volume = await db.dailyReportItem.findMany({
      where: { report: { locationId } },
      select: { volumeDone: true },
      orderBy: { volumeDone: "asc" },
    });
    expect(volume.map((v) => Number(v.volumeDone))).toEqual([3, 4]);
  });
});
