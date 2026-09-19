/*
 * KESIMPULAN LOKASI — templat DETERMINISTIK, bukan keluaran model.
 *
 * Yang dijaga: tiap angka di kalimat SAMA dengan sumbernya di snapshot
 * (dibaca dari fixture, bukan diketik ulang di asersi), cabang teks hidup untuk
 * lokasi bermasalah maupun sehat, dan lokasi tanpa RAB/kurva/kontrak tidak
 * dipaksa mengaku punya angka yang tidak ada.
 */
import { describe, expect, it } from "vitest";
import { laporanLokasiFixture } from "../fixtures/laporan-lokasi-lengkap";
import { babakBulanan, kesimpulanLokasi, labelBulan } from "@/lib/lokasi-lengkap/kesimpulan";
import type { Peristiwa } from "@/lib/kronologi/susun";

const id = (n: number, d = 1) =>
  n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });

describe("kesimpulanLokasi – lokasi bermasalah (fixture asli)", () => {
  const l = laporanLokasiFixture();
  const k = kesimpulanLokasi(l);

  it("tiga kalimat, tiap ≤ 220 karakter", () => {
    expect(k.length).toBe(3);
    for (const s of k) expect(s.length).toBeLessThanOrEqual(220);
  });

  it("kalimat 1: nama lokasi + posisi progres dari snapshot (koma desimal)", () => {
    const p = l.progres;
    expect(k[0]).toContain(l.identitas.nama);
    expect(k[0]).toContain(`minggu ke-${p.mingguKe} dari ${p.totalMinggu}`);
    expect(k[0]).toContain(`${id(p.realisasiPct)}%`);
    expect(k[0]).toContain(`${id(p.rencanaPct!)}%`);
    expect(k[0]).toContain(`${id(p.deviasiPp!)} pp`);
    expect(k[0]).toContain("21,4%");
    expect(k[0]).toContain("-6,5 pp");
  });

  it("kalimat 2: penahan – kendala terbuka, judul yang lewat tenggat, temuan kritis, hari tanpa laporan", () => {
    const r = l.kendala.ringkas;
    expect(k[1]).toContain(`${r.terbuka} kendala terbuka`);
    expect(k[1]).toContain(`${r.lewatTenggat} di antaranya lewat tenggat`);
    const telat = l.kendala.terbuka.find((x) => x.lewatTenggat)!;
    expect(k[1]).toContain(telat.judul);
    expect(k[1]).toContain(`${telat.umurHari} hari`);
    expect(k[1]).toContain(`${l.temuan.ringkas.kritis} temuan kritis`);
    expect(k[1]).toContain(`${l.kelengkapan!.hariTanpaLaporan} hari tanpa laporan`);
  });

  it("kalimat 3: kondisi terkini – laporan terakhir & kegiatan terakhir", () => {
    expect(k[2]).toContain(`${l.kelengkapan!.hariSejakLaporanTerakhir} hari lalu`);
    expect(k[2]).toContain(l.kegiatan.terakhir[0].judul);
  });

  it("tidak memakai em-dash di teks", () => {
    // Em-dash ditulis lewat kode karakter: menuliskannya harfiah di string
    // literal akan memerahkan `tests/unit/tanda-pisah-ui.test.ts` (DECISIONS 385).
    const emDash = String.fromCharCode(0x2014);
    for (const s of k) expect(s).not.toContain(emDash);
  });

  it("deterministik: dua panggilan menghasilkan teks identik", () => {
    expect(kesimpulanLokasi(l)).toEqual(k);
  });
});

describe("kesimpulanLokasi – lokasi sehat", () => {
  const dasar = laporanLokasiFixture();
  const l = laporanLokasiFixture({
    progres: { ...dasar.progres, realisasiPct: 31.25, deviasiPp: 3.35 },
    kendala: { ringkas: { terbuka: 0, kritis: 0, lewatTenggat: 0, selesai: 3, tertuaHari: null }, terbuka: [], selesaiTerbaru: dasar.kendala.selesaiTerbaru },
    temuan: { ringkas: { ...dasar.temuan.ringkas, terbuka: 0, kritis: 0, lewatTenggat: 0 }, terbuka: [] },
    kelengkapan: { ...dasar.kelengkapan!, hariTanpaLaporan: 0, hariSejakLaporanTerakhir: 0, laporanTerakhirKey: "2026-09-18" },
    durasi: { totalHari: 120, hariBerjalan: 49, sisaHari: 71, pctWaktu: 40.8 },
  });
  const k = kesimpulanLokasi(l);

  it("deviasi positif ditulis dengan tanda plus", () => {
    expect(k[0]).toContain("+3,4 pp");
    expect(k[0]).toContain("31,3%");
  });

  it("tanpa penahan: dikatakan tidak ada penahan, bukan dibiarkan kosong", () => {
    expect(k[1].toLowerCase()).toContain("tidak ada penahan");
    expect(k[1]).not.toMatch(/\d+ kendala terbuka/);
    expect(k[1]).not.toMatch(/^Yang menahan/);
  });

  it("laporan hari ini disebut 'hari ini', bukan '0 hari lalu'", () => {
    expect(k[2]).toContain("hari ini");
    expect(k[2]).not.toContain("0 hari lalu");
  });
});

describe("kesimpulanLokasi – data yang tidak ada tidak dikarang", () => {
  it("tanpa kurva-S: tidak menyebut rencana/deviasi, mengaku belum punya kurva-S", () => {
    const dasar = laporanLokasiFixture();
    const l = laporanLokasiFixture({
      progres: { ...dasar.progres, rencanaPct: null, deviasiPp: null, punyaKurva: false },
      kurva: null,
    });
    const k = kesimpulanLokasi(l);
    expect(k[0]).toContain("belum punya kurva-S");
    expect(k[0]).toContain(`${id(dasar.progres.realisasiPct)}%`);
    expect(k[0]).not.toContain("rencana");
    expect(k[0]).not.toContain("pp");
  });

  it("tanpa RAB: mengaku belum ada RAB, tidak menulis realisasi 0% seolah data", () => {
    const dasar = laporanLokasiFixture();
    const l = laporanLokasiFixture({
      progres: { ...dasar.progres, rencanaPct: null, deviasiPp: null, realisasiPct: 0, punyaKurva: false, punyaRab: false, nilaiRab: "0" },
      kurva: null,
      kategori: [],
    });
    const k = kesimpulanLokasi(l);
    expect(k[0]).toContain("belum ada RAB");
    expect(k[0]).not.toContain("0,0%");
  });

  it("tanpa kontrak: tidak menyebut minggu kontrak; kelengkapan null tidak melempar", () => {
    const dasar = laporanLokasiFixture();
    const l = laporanLokasiFixture({
      identitas: { ...dasar.identitas, kontrak: null },
      progres: { ...dasar.progres, mingguKe: 0, rencanaPct: null, deviasiPp: null, punyaKurva: false },
      kurva: null,
      durasi: null,
      kelengkapan: null,
      mingguan: [],
      kegiatan: { total: 0, terakhir: [] },
    });
    const k = kesimpulanLokasi(l);
    expect(k[0]).toContain("belum berkontrak");
    expect(k[0]).not.toContain("minggu ke-");
    expect(k.length).toBeGreaterThanOrEqual(2);
    for (const s of k) expect(s.length).toBeLessThanOrEqual(220);
  });

  it("kalimat 3 boleh kosong hanya bila memang tidak ada bahan", () => {
    const dasar = laporanLokasiFixture();
    const l = laporanLokasiFixture({
      kelengkapan: null,
      durasi: null,
      kegiatan: { total: 0, terakhir: [] },
    });
    const k = kesimpulanLokasi(l);
    expect(k.length).toBe(2);
  });
});

describe("babakBulanan", () => {
  const p = (tanggal: string, kunci: string): Peristiwa => ({
    kunci,
    tanggal,
    jenis: "kegiatan",
    judul: kunci,
    rincian: [],
    tingkat: null,
    status: "final",
    berjalan: false,
    lewatTenggat: false,
  });

  it("mengelompokkan per bulan, terbaru dulu, label Indonesia", () => {
    const babak = babakBulanan([p("2026-09-12", "a"), p("2026-08-26", "b"), p("2026-09-05", "c"), p("2026-07-01", "d")]);
    expect(babak.map((b) => b.bulanKey)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(babak[0].label).toBe("September 2026");
    expect(babak[1].label).toBe("Agustus 2026");
    expect(babak[0].peristiwa.map((x) => x.kunci)).toEqual(["a", "c"]);
  });

  it("kosong → tidak ada babak", () => {
    expect(babakBulanan([])).toEqual([]);
  });

  it("labelBulan", () => {
    expect(labelBulan("2026-01")).toBe("Januari 2026");
    expect(labelBulan("2025-12")).toBe("Desember 2025");
  });
});
