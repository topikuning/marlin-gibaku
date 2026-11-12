import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kurva S paket untuk berkas termin dipotong di minggu prestasi (DECISIONS 722):
 * realisasi sesudahnya kosong, dan kepala laporannya "minggu ke-n" prestasi,
 * bukan minggu saat berkasnya disiapkan.
 */

vi.mock("server-only", () => ({}));
/** Saringan lokasi yang diminta ke database. */
let saringLokasi: unknown = null;
/** Lokasi yang ikut dihitung (DECISIONS 764: dua lokasi = penanda tangan paket). */
let idLokasi = ["L1"];
vi.mock("@/lib/db", () => ({
  db: {
    package: {
      findFirst: async (q: { select: { locations: { where: unknown } } }) => {
        saringLokasi = q.select.locations.where;
        return {
          id: "P",
          name: "Paket",
          locations: idLokasi.map((id) => ({ id, name: `Desa ${id}`, regency: "K", province: "P" })),
        };
      },
    },
  },
}));
vi.mock("@/lib/auth/session", () => ({ accessibleLocationIds: async () => null }));
vi.mock("@/lib/auth/scope", () => ({ packageScopeWhere: () => ({}) }));
vi.mock("@/lib/package/lingkup-lokasi", () => ({ lingkupLokasi: async () => ({ dicabut: new Map(), masuk: new Map() }) }));
vi.mock("@/lib/baseline", () => ({
  getScurveSeriesPaket: async () => ({
    ...seri(),
  }),
}));
const seri = () => ({
  totalWeeks: 8,
  currentWeek: 6,
  planPct: [5, 12, 20, 30, 42, 55, 80, 100],
  actualPct: [4, 10, 18, 26, 33, 41, null, null],
  grandTotal: 1_000n,
  dihitung: idLokasi.length,
  totalLokasi: idLokasi.length,
  perLokasi: idLokasi.map((locationId) => ({
    locationId,
    totalWeeks: 8,
    currentWeek: 6,
    planPct: [5, 12, 20, 30, 42, 55, 80, 100],
    actualPct: [],
    grandTotal: 1_000n,
  })),
});
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
  idLokasi = ["L1"];
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
    expect(dok.report.header.locationName).toBe("Desa L1");
  });

  it("tanpa lokasiIds: semua lokasi paket, kepala menyebut jumlahnya", async () => {
    await susunKurvaPaket("P", null);
    expect(saringLokasi).toEqual({});
  });
});

describe("penanda tangan Kurva S paket (DECISIONS 764)", () => {
  it("gabungan lebih dari satu lokasi: PPK + penyedia (`kurva_paket`), bukan Wakil Sah lokasi acuan", async () => {
    idLokasi = ["L1", "L2", "L3"];
    const dok = await susunKurvaPaket("P", null);
    if (typeof dok === "string") throw new Error(dok);
    expect(dok.report.header.locationName).toBe("3 lokasi");
    expect(dok.jenisTtd).toBe("kurva_paket");
  });

  it("satu lokasi (berkas termin per desa): penanda tangan lokasi itu (`jadwal`)", async () => {
    idLokasi = ["L1"];
    const dok = await susunKurvaPaket("P", null, { lokasiIds: ["L1"] });
    if (typeof dok === "string") throw new Error(dok);
    expect(dok.jenisTtd).toBe("jadwal");
  });
});

describe("pagar: gambar tanda tangan Kurva S paket mengikuti jenis dokumennya (DECISIONS 764)", () => {
  /*
   * Blok teks memakai `dok.jenisTtd`. Kalau gambarnya dimuat dengan jenis lain
   * (mis. "jadwal" yang dulu ditanam), slot PPK mendapat coretan Wakil Sah –
   * tanda tangan orang lain di bawah nama PPK.
   */
  it("setiap pemuatan tanda tangan di jalur Kurva S paket memakai dok.jenisTtd", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const akar = join(__dirname, "..", "..");
    for (const berkas of ["src/lib/pdf/periodik-kkp.ts", "src/app/api/laporan/kurva-paket/[id]/xlsx/route.ts"]) {
      const kode = readFileSync(join(akar, berkas), "utf8");
      const panggil = [...kode.matchAll(/muatTtdPdf\(([^)]*lokasiAcuanId[^)]*)\)/g)].map((m) => m[1]);
      expect(panggil.length, berkas).toBeGreaterThan(0);
      for (const argumen of panggil) expect(argumen, berkas).toMatch(/\.jenisTtd\s*$/);
    }
  });
});

