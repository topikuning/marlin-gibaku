// PESAN WHATSAPP RENCANA MINGGUAN (DECISIONS 259).
//
// Permintaan user: "aku butuh rencana ini juga dikirim ke whatsapp".
// Koreksi user 2026-08-05: grup WA paket berisi **PPK, dinas, pejabat** —
// BUKAN mandor. Itu forum pertanggungjawaban, bukan pengarahan kerja.
//
// Yang dikunci berkas ini semuanya cacat SENYAP — pesannya tetap terkirim dan
// tetap rapi di grup:
//
//  1. daftar item beserta nama PIC bocor ke forum pejabat → pengarahan internal
//     pindah ke ruang pengawasan, dan orang tanpa konteks menilai per-orang;
//  2. pesan tidak memuat dasar penilaian (deviasi/proyeksi/PPC) → forum
//     menyetujui rencana tanpa tahu rencana itu mengejar atau tidak;
//  3. daftar dipotong DIAM-DIAM → yang hilang terbaca "tidak ada";
//  4. PPC null ditulis 0% → lokasi yang belum pernah berjanji terlihat gagal.
import { describe, expect, it } from "vitest";
import { MAKS_KELOMPOK_TAMPIL, pesanRencanaWa, type IsiPesanRencana } from "@/lib/plan/rencana-wa";

const dasar: IsiPesanRencana = {
  locationName: "Kedung Mutih",
  regency: "Demak",
  province: "Jawa Tengah",
  packageName: "Paket KNMP Demak",
  weekNumber: 22,
  totalWeeks: 22,
  periodeStart: new Date("2026-07-26T00:00:00.000Z"),
  periodeEnd: new Date("2026-08-01T00:00:00.000Z"),
  actualPct: 12.4,
  targetPct: 23.1,
  deviationPct: -10.7,
  status: "kritis",
  proyeksi: {
    tambahanPct: 7.4,
    proyeksiPct: 19.8,
    targetPct: 23.1,
    selisihPct: -3.3,
    masihTertinggal: true,
  },
  ppc: { jumlah: 3, tuntas: 1, pct: 33.3, volumePct: 60 },
  tidakTuntas: [
    { code: "1", name: "Pasangan batu", unit: "m³", target: 30, realisasi: 10 },
    { code: "2", name: "Galian tanah", unit: "m³", target: 20, realisasi: 0 },
  ],
  baris: [
    { categoryName: "PEKERJAAN PERSIAPAN" },
    { categoryName: "PEKERJAAN PERSIAPAN" },
    { categoryName: "PEKERJAAN REVETMENT" },
  ],
  totalNilai: 30_000_000,
  totalBobot: 24,
  catatan: "Butuh tambahan alat.",
  disusunOleh: "Dewi Anggraini",
};

describe("pesan WhatsApp rencana mingguan (forum PPK/dinas)", () => {
  it("nama lokasi LENGKAP dengan kabupatennya (permintaan user 2026-08-06)", () => {
    expect(pesanRencanaWa(dasar)).toContain("Kedung Mutih — Demak, Jawa Tengah");
  });

  it("TIDAK menyebut pelaksana per item — itu bukan urusan forum pengawasan", () => {
    // Inti koreksinya: grup ini berisi PPK, dinas, pejabat. Menyebut siapa
    // mengerjakan apa memindahkan pengarahan internal ke ruang pengawasan.
    const t = pesanRencanaWa(dasar);
    expect(t).not.toMatch(/PIC/i);
    expect(t).not.toContain("Sarno");
  });

  it("lingkup disajikan sebagai AGREGAT: jumlah item, bobot, nilai, kelompok", () => {
    // Cukup untuk menilai "pekerjaan apa dan sebesar apa", tanpa jadi perintah kerja.
    const t = pesanRencanaWa(dasar);
    expect(t).toContain("3 item pekerjaan · bobot 24,00% · Rp 30.000.000");
    expect(t).toContain("PEKERJAAN PERSIAPAN (2 item)");
    expect(t).toContain("PEKERJAAN REVETMENT (1 item)");
  });

  it("memuat dasar penilaian, jadi forum tidak menyetujui rencana buta", () => {
    const t = pesanRencanaWa(dasar);
    expect(t).toContain("12,40%"); // realisasi
    expect(t).toContain("-10,70%"); // deviasi
    expect(t).toContain("Kritis");
    expect(t).toContain("19,80%"); // proyeksi
    expect(t).toMatch(/Masih tertinggal 3,30%/);
  });

  it("rencana yang cukup TIDAK ditulis tertinggal", () => {
    const t = pesanRencanaWa({
      ...dasar,
      proyeksi: { ...dasar.proyeksi, proyeksiPct: 25, selisihPct: 1.9, masihTertinggal: false },
    });
    expect(t).not.toMatch(/Masih tertinggal/);
    expect(t).toContain("Menutup ketertinggalan");
  });

  it("PPC minggu lalu disebut BESERTA komitmen yang belum tuntas", () => {
    // Pertanggungjawaban janji lama mendahului janji baru (Last Planner).
    const t = pesanRencanaWa(dasar);
    expect(t).toContain("PPC 33,30%");
    expect(t).toContain("1 dari 3 komitmen tuntas");
    expect(t).toContain("10 m³ dari 30 m³");
  });

  it("tidak ada rencana minggu lalu → dikatakan, BUKAN ditulis 0%", () => {
    const t = pesanRencanaWa({
      ...dasar,
      ppc: { jumlah: 0, tuntas: 0, pct: null, volumePct: null },
      tidakTuntas: [],
    });
    expect(t).toContain("Tidak ada rencana tercatat");
    expect(t).not.toContain("PPC 0");
  });

  it("kelompok pekerjaan yang banyak dipotong DENGAN menyebut jumlahnya", () => {
    // Memotong diam-diam membuat kelompok yang hilang terbaca "tidak ada".
    const banyak = Array.from({ length: MAKS_KELOMPOK_TAMPIL + 3 }, (_, i) => ({
      categoryName: `PEKERJAAN ${i + 1}`,
    }));
    const t = pesanRencanaWa({ ...dasar, baris: banyak });
    expect(t).toContain(`PEKERJAAN ${MAKS_KELOMPOK_TAMPIL} (1 item)`);
    expect(t).not.toContain(`PEKERJAAN ${MAKS_KELOMPOK_TAMPIL + 1} (`);
    expect(t).toContain("dan 3 kelompok pekerjaan lain");
  });

  it("menunjuk berkas terlampir untuk rincian per item", () => {
    expect(pesanRencanaWa(dasar)).toContain("Rincian per item");
  });

  it("catatan lapangan ikut terbawa", () => {
    expect(pesanRencanaWa(dasar)).toContain("Butuh tambahan alat.");
    expect(pesanRencanaWa({ ...dasar, catatan: null })).not.toContain("*Catatan*");
  });

  it("angka memakai format Indonesia — satu konvensi dengan dokumen cetaknya", () => {
    const t = pesanRencanaWa(dasar);
    expect(t).toContain("Rp 30.000.000");
    expect(t).not.toMatch(/\d\.\d\d%/); // tidak ada "12.40%"
  });
});
