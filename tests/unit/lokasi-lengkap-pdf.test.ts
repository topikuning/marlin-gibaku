/*
 * RENDERER PDF A4 LAPORAN LENGKAP LOKASI.
 *
 * PDF resmi baru diperiksa orang setelah diunduh/dikirim, jadi bentuk dasarnya
 * dijaga mesin: berkas PDF sah, A4 potret, lebih dari satu halaman untuk
 * fixture penuh, dan fixture "kosong" (tanpa kontrak/kurva/kendala) TIDAK
 * melempar. R2 sengaja dimatikan: foto yang gagal dimuat harus jadi
 * placeholder, bukan menggagalkan seluruh dokumen.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

vi.mock("@/lib/r2", () => ({
  isR2Configured: () => false,
  r2GetBuffer: async () => {
    throw new Error("R2 mati di uji");
  },
  r2PresignGet: async () => {
    throw new Error("R2 mati di uji");
  },
}));

const { renderLaporanLokasiPdf } = await import("@/lib/lokasi-lengkap/render-pdf");
const { titikKurvaGaris } = await import("@/lib/pdf/kurva-garis");
const { laporanLokasiFixture } = await import("../fixtures/laporan-lokasi-lengkap");

function jumlahHalaman(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe("renderLaporanLokasiPdf", () => {
  it("fixture penuh → PDF sah, A4 potret, lebih dari satu halaman", async () => {
    const pdf = await renderLaporanLokasiPdf(laporanLokasiFixture());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const teks = pdf.toString("latin1");
    // A4 potret = 595.28 × 841.89 pt.
    expect(teks).toMatch(/MediaBox\s*\[\s*0\s+0\s+595\.28\s+841\.89\s*\]/);
    expect(jumlahHalaman(pdf)).toBeGreaterThan(1);
  }, 30_000);

  it("fixture kosong (tanpa kontrak/kurva/RAB/kendala/temuan/foto) tidak melempar", async () => {
    const dasar = laporanLokasiFixture();
    const kosong = laporanLokasiFixture({
      identitas: { ...dasar.identitas, kontrak: null, pelaksana: null, gps: null },
      kesimpulan: ["Kemadang belum berkontrak."],
      progres: { ...dasar.progres, rencanaPct: null, deviasiPp: null, realisasiPct: 0, terverifikasiPct: 0, mingguKe: 0, totalMinggu: 0, punyaRab: false, punyaKurva: false, nilaiRab: "0", nilaiTerpasang: "0" },
      mingguan: [],
      kurva: null,
      durasi: null,
      kategori: [],
      kelengkapan: null,
      kendala: { ringkas: { terbuka: 0, kritis: 0, lewatTenggat: 0, selesai: 0, tertuaHari: null }, terbuka: [], selesaiTerbaru: [] },
      kronologi: { sejakKey: "2026-09-18", babak: [], kondisi: { ...dasar.kronologi.kondisi, kendalaTerbuka: 0, kegiatanTerakhir: null, hariTanpaKegiatan: null, kendalaTertuaHari: null }, totalPeristiwa: 0, dipotong: 0 },
      kegiatan: { total: 0, terakhir: [] },
      temuan: { ringkas: { total: 0, terbuka: 0, kritis: 0, lewatTenggat: 0, selesai: 0, inspeksi: 0, inspeksiTerakhirKey: null }, terbuka: [] },
      administrasi: { milestone: [], dokumen: { total: 0, kedaluwarsa: 0, segeraKedaluwarsa: 0, perFase: [] }, surat: { masuk: 0, keluar: 0, perluBalas: 0, lewatTenggatBalas: 0, terakhir: [] } },
      foto: { total: 0, kandidat: [] },
      rencanaMingguDepan: null,
      perhatian: [],
      limitations: [],
      sumber: [],
    });
    const pdf = await renderLaporanLokasiPdf(kosong);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(jumlahHalaman(pdf)).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("foto kandidat dengan R2 mati → placeholder, PDF tetap jadi (deterministik ukuran halaman)", async () => {
    const l = laporanLokasiFixture();
    const a = await renderLaporanLokasiPdf(l);
    const b = await renderLaporanLokasiPdf(l);
    expect(jumlahHalaman(a)).toBe(jumlahHalaman(b));
  }, 30_000);
});

describe("titikKurvaGaris – geometri murni", () => {
  const kotak = { x: 10, y: 20, w: 200, h: 100 };

  it("rencana mulai (minggu 0, 0%) di pojok kiri bawah dan berakhir 100% di pojok kanan atas", () => {
    const g = titikKurvaGaris({ totalMinggu: 4, planPct: [10, 40, 80, 100], actualPct: [8, 35, null, null] }, kotak);
    expect(g.rencana[0]).toMatchObject({ x: 10, y: 120, minggu: 0, pct: 0 });
    const akhir = g.rencana[g.rencana.length - 1];
    expect(akhir.minggu).toBe(4);
    expect(akhir.x).toBeCloseTo(210, 6);
    expect(akhir.y).toBeCloseTo(20, 6);
  });

  it("realisasi berhenti di minggu terakhir yang punya angka; null tidak digambar", () => {
    const g = titikKurvaGaris({ totalMinggu: 4, planPct: [10, 40, 80, 100], actualPct: [8, 35, null, null] }, kotak);
    expect(g.realisasi.map((t) => t.minggu)).toEqual([0, 1, 2]);
    expect(g.realisasi[2].y).toBeCloseTo(120 - 35, 6);
  });

  it("tanpa realisasi → deret realisasi kosong; grid 0..100 lima garis; label minggu terakhir selalu ada", () => {
    const g = titikKurvaGaris({ totalMinggu: 30, planPct: Array.from({ length: 30 }, (_, i) => ((i + 1) / 30) * 100), actualPct: new Array(30).fill(null) }, kotak);
    expect(g.realisasi).toEqual([]);
    expect(g.gridY.map((r) => r.label)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    expect(g.labelX[g.labelX.length - 1].label).toBe("30");
    expect(g.labelX.length).toBeLessThanOrEqual(13);
  });

  it("nilai di luar 0..100 dijepit ke kotak, tidak keluar gambar", () => {
    const g = titikKurvaGaris({ totalMinggu: 2, planPct: [150, 100], actualPct: [-5, null] }, kotak);
    expect(g.rencana[1].y).toBeCloseTo(20, 6);
    expect(g.realisasi[1].y).toBeCloseTo(120, 6);
  });
});
