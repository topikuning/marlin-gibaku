import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kurva S paket untuk berkas termin dipotong di minggu prestasi (DECISIONS 722):
 * realisasi sesudahnya kosong, dan kepala laporannya "minggu ke-n" prestasi,
 * bukan minggu saat berkasnya disiapkan.
 */

vi.mock("server-only", () => ({}));
/** Saringan lokasi yang diminta ke database. */
let saringLokasi: unknown = null;
vi.mock("@/lib/db", () => ({
  db: {
    package: {
      findFirst: async (q: { select: { locations: { where: unknown } } }) => {
        saringLokasi = q.select.locations.where;
        return { id: "P", name: "Paket", locations: [{ id: "L1", name: "Desa", regency: "K", province: "P" }] };
      },
    },
  },
}));
vi.mock("@/lib/auth/session", () => ({ accessibleLocationIds: async () => null }));
vi.mock("@/lib/auth/scope", () => ({ packageScopeWhere: () => ({}) }));
vi.mock("@/lib/package/lingkup-lokasi", () => ({ lingkupLokasi: async () => ({ dicabut: new Map(), masuk: new Map() }) }));
vi.mock("@/lib/baseline", () => ({
  getScurveSeriesPaket: async () => ({
    totalWeeks: 8,
    currentWeek: 6,
    planPct: [5, 12, 20, 30, 42, 55, 80, 100],
    actualPct: [4, 10, 18, 26, 33, 41, null, null],
    grandTotal: 1_000n,
    dihitung: 1,
    totalLokasi: 1,
    perLokasi: [{ locationId: "L1", totalWeeks: 8, currentWeek: 6, planPct: [5, 12, 20, 30, 42, 55, 80, 100], actualPct: [], grandTotal: 1_000n }],
  }),
}));
const mingguKepala: number[] = [];
vi.mock("@/lib/periodic-report", () => ({
  getPeriodBounds: async () => ({ currentWeek: 6, startDate: new Date("2026-07-01"), endDate: new Date("2026-08-26"), assumed: false }),
  getPeriodReport: async (_l: string, _k: string, n: number) => {
    mingguKepala.push(n);
    return { header: { masaPelaksanaanHari: 56 } };
  },
}));

const { susunKurvaPaket } = await import("@/lib/laporan/kurva-paket");

beforeEach(() => {
  mingguKepala.length = 0;
  saringLokasi = null;
});

describe("susunKurvaPaket sampaiMinggu", () => {
  it("dipotong di minggu prestasi: realisasi sesudahnya kosong, kepala laporan minggu itu", async () => {
    const dok = await susunKurvaPaket("P", null, { sampaiMinggu: 4 });
    if (typeof dok === "string") throw new Error(dok);
    expect(dok.report.scurve.actualPct).toEqual([4, 10, 18, 26, null, null, null, null]);
    expect(dok.report.scurve.currentWeek).toBe(4);
    expect(dok.report.n).toBe(4);
    expect(dok.report.scurve.planPct).toHaveLength(8);
    expect(mingguKepala).toEqual([4]);
  });

  it("tanpa batas: tetap s.d. minggu berjalan seperti unduhan Kurva-S paket", async () => {
    const dok = await susunKurvaPaket("P", null);
    if (typeof dok === "string") throw new Error(dok);
    expect(dok.report.scurve.currentWeek).toBe(6);
    expect(dok.report.scurve.actualPct[5]).toBe(41);
    expect(mingguKepala).toEqual([6]);
  });
});

describe("susunKurvaPaket lokasiIds (DECISIONS 725)", () => {
  it("Kurva S satu lokasi untuk berkas termin: hanya lokasi itu yang dimuat, kepalanya memakai nama lokasinya", async () => {
    const dok = await susunKurvaPaket("P", null, { sampaiMinggu: 4, lokasiIds: ["L1"] });
    if (typeof dok === "string") throw new Error(dok);
    expect(saringLokasi).toEqual({ AND: [{ id: { in: ["L1"] } }] });
    expect(dok.report.header.locationName).toBe("Desa");
  });

  it("tanpa lokasiIds: semua lokasi paket, kepala menyebut jumlahnya", async () => {
    await susunKurvaPaket("P", null);
    expect(saringLokasi).toEqual({});
  });
});
