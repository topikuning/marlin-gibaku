// PESAN WHATSAPP PENGIRING laporan harian ringkas (DECISIONS 261).
//
// Penerimanya sama dengan rencana mingguan: PPK, dinas, pejabat. Yang dikunci
// berkas ini semuanya cacat SENYAP — pesannya tetap terkirim dan tetap rapi:
//
//  1. keadaan dokumen tidak dinyatakan → draf terbaca seperti angka final oleh
//     orang yang tidak membuka lampiran;
//  2. nama pelaksana bocor ke forum pengawasan;
//  3. daftar dipotong diam-diam → yang hilang terbaca "tidak ada";
//  4. hari kosong tetap ditulis seolah ada isinya.
import { describe, expect, it } from "vitest";
import {
  MAKS_KENDALA_TAMPIL,
  kalimatStatus,
  pesanRingkasHarianWa,
  type IsiPesanRingkas,
} from "@/lib/daily-report/ringkas-wa";

const dasar: IsiPesanRingkas = {
  locationName: "Kedung Mutih",
  packageName: "Paket KNMP Demak — Kedungmutih",
  hari: "Rabu",
  tanggalFull: "5 Agustus 2026",
  status: "dikirim",
  weekNumber: 22,
  totalWeeks: 30,
  realizedPct: 41.86,
  planPct: 55.2,
  deviationPct: -13.34,
  bobotHariIni: 1.24,
  nilaiHariIni: 96_874_380n,
  jumlahPekerjaan: 4,
  jumlahKegiatan: 2,
  jumlahFoto: 6,
  kendala: [{ title: "Pasokan besi D16 terlambat", severity: "tinggi", status: "ditangani" }],
};

describe("pesan ringkasan harian (forum PPK/dinas)", () => {
  it("KEADAAN DOKUMEN dinyatakan — bukan cuma nama statusnya", () => {
    // Inti keputusan "tanpa gerbang": draf boleh dikirim, tapi pembaca harus
    // tahu. "Dikirim" saja tidak memberi tahu bahwa belum ada yang memeriksa.
    const t = pesanRingkasHarianWa(dasar);
    expect(t).toMatch(/BELUM diverifikasi/);
  });

  it("tiap status punya kalimatnya sendiri, dan hanya final yang tanpa peringatan", () => {
    expect(kalimatStatus("final")).toMatch(/dikunci/i);
    expect(kalimatStatus("disetujui")).toMatch(/belum difinalkan/i);
    expect(kalimatStatus("dikirim")).toMatch(/BELUM diverifikasi/);
    expect(kalimatStatus("perlu_koreksi")).toMatch(/belum bisa dipakai/i);
    expect(kalimatStatus("draft")).toMatch(/masih bisa berubah/i);
    expect(kalimatStatus(null)).toMatch(/belum ada laporan/i);
  });

  it("TIDAK menyebut pelaksana per item — forum ini pengawasan, bukan pengarahan", () => {
    const t = pesanRingkasHarianWa(dasar);
    expect(t).not.toMatch(/PIC/i);
    expect(t).not.toMatch(/mandor/i);
  });

  it("memuat dasar penilaian: realisasi, rencana, deviasi", () => {
    const t = pesanRingkasHarianWa(dasar);
    expect(t).toContain("41,86%");
    expect(t).toContain("55,20%");
    expect(t).toContain("-13,34%");
    expect(t).toContain("minggu ke-22 dari 30");
  });

  it("tanpa baseline → dikatakan, bukan ditulis rencana 0%", () => {
    const t = pesanRingkasHarianWa({ ...dasar, totalWeeks: 0, planPct: 0 });
    expect(t).toMatch(/belum ada baseline/i);
    expect(t).not.toMatch(/minggu ke-/);
  });

  it("lingkup hari itu sebagai agregat + nilai rupiah", () => {
    const t = pesanRingkasHarianWa(dasar);
    expect(t).toContain("4 item pekerjaan · 1,24% · Rp 96.874.380");
    expect(t).toContain("2 kegiatan lapangan");
    expect(t).toContain("6 foto dokumentasi");
  });

  it("hari tanpa pekerjaan DAN tanpa kegiatan dikatakan kosong, bukan disamarkan", () => {
    const t = pesanRingkasHarianWa({
      ...dasar,
      jumlahPekerjaan: 0,
      jumlahKegiatan: 0,
      jumlahFoto: 0,
      nilaiHariIni: 0n,
      bobotHariIni: 0,
    });
    expect(t).toMatch(/Tidak ada pekerjaan maupun kegiatan yang tercatat/);
  });

  it("kegiatan tanpa volume pekerjaan tetap dilaporkan apa adanya", () => {
    const t = pesanRingkasHarianWa({ ...dasar, jumlahPekerjaan: 0, nilaiHariIni: 0n });
    expect(t).toMatch(/Tidak ada volume pekerjaan yang dilaporkan/);
    expect(t).toContain("2 kegiatan lapangan");
  });

  it("kendala yang banyak dipotong DENGAN menyebut jumlahnya", () => {
    const banyak = Array.from({ length: MAKS_KENDALA_TAMPIL + 2 }, (_, i) => ({
      title: `Kendala ${i + 1}`,
      severity: "sedang",
      status: "terbuka",
    }));
    const t = pesanRingkasHarianWa({ ...dasar, kendala: banyak });
    expect(t).toContain(`Kendala ${MAKS_KENDALA_TAMPIL}`);
    expect(t).not.toContain(`Kendala ${MAKS_KENDALA_TAMPIL + 1}`);
    expect(t).toContain("dan 2 permasalahan lain");
  });

  it("tanpa kendala → bagiannya tidak muncul sama sekali", () => {
    expect(pesanRingkasHarianWa({ ...dasar, kendala: [] })).not.toContain("Permasalahan");
  });

  it("menunjuk berkas terlampir untuk rincian & foto", () => {
    expect(pesanRingkasHarianWa(dasar)).toMatch(/berkas terlampir/);
  });

  it("angka memakai format Indonesia", () => {
    const t = pesanRingkasHarianWa(dasar);
    expect(t).toContain("Rp 96.874.380");
    expect(t).not.toMatch(/\d\.\d\d%/); // tidak ada "41.86%"
  });
});
