// PESAN WHATSAPP RENCANA MINGGUAN (DECISIONS 259).
//
// Permintaan user: "aku butuh rencana ini juga dikirim ke whatsapp".
//
// Cacat yang dikunci berkas ini semuanya SENYAP — pesannya tetap terkirim,
// tetap tampak rapi di grup, dan barunya ketahuan saat pekerjaan minggu itu
// tidak jalan:
//
//  1. isi rencana cuma ada di lampiran → "sudah dikirim" tapi tak seorang pun
//     tahu harus mengerjakan apa (lampiran kerap tak terunduh di sinyal jelek);
//  2. daftar dipotong DIAM-DIAM → item yang hilang terbaca "tidak ada";
//  3. PPC null ditulis 0% → lokasi yang belum pernah berjanji terlihat gagal.
import { describe, expect, it } from "vitest";
import { MAKS_KOMITMEN_TAMPIL, pesanRencanaWa, type IsiPesanRencana } from "@/lib/plan/rencana-wa";

const dasar: IsiPesanRencana = {
  locationName: "Kedung Mutih",
  packageName: "Paket KNMP Demak",
  weekNumber: 22,
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
    { code: "1", name: "Pasangan batu", unit: "m³", target: 25, picName: "Sarno" },
    { code: "2", name: "Galian tanah", unit: "m³", target: 10, picName: null },
  ],
  totalNilai: 30_000_000,
  totalBobot: 24,
  catatan: "Butuh tambahan alat.",
  disusunOleh: "Dewi Anggraini",
};

describe("pesan WhatsApp rencana mingguan", () => {
  it("MEMUAT rencananya di badan pesan, bukan cuma menunjuk lampiran", () => {
    // Ini inti keputusannya: mandor membaca pesan, bukan mengunduh PDF di
    // sinyal 1 bar. Kalau daftar komitmen hilang dari badan pesan, "rencana
    // sudah dikirim" berhenti berarti apa-apa.
    const t = pesanRencanaWa(dasar);
    expect(t).toContain("Pasangan batu");
    expect(t).toContain("25 m³");
    expect(t).toContain("Sarno");
    expect(t).toContain("Galian tanah");
  });

  it("menyertakan proyeksi — rencana bisa dinilai tanpa membuka berkas", () => {
    const t = pesanRencanaWa(dasar);
    expect(t).toContain("19,80%");
    expect(t).toContain("23,10%");
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

  it("daftar panjang dipotong DENGAN menyebut jumlah yang tidak muncul", () => {
    // Memotong diam-diam membuat 8 item yang hilang terbaca "tidak ada".
    const banyak = Array.from({ length: MAKS_KOMITMEN_TAMPIL + 8 }, (_, i) => ({
      code: `K${i + 1}`,
      name: `Pekerjaan ${i + 1}`,
      unit: "m³",
      target: 5,
      picName: null,
    }));
    const t = pesanRencanaWa({ ...dasar, baris: banyak });
    expect(t).toContain(`Pekerjaan ${MAKS_KOMITMEN_TAMPIL}`);
    expect(t).not.toContain(`Pekerjaan ${MAKS_KOMITMEN_TAMPIL + 1}:`);
    expect(t).toContain("dan 8 item lain");
  });

  it("jumlah item & nilai disebut di kepala daftar, jadi pemotongan ketahuan", () => {
    const t = pesanRencanaWa(dasar);
    expect(t).toContain("(2 item · 24,00% · Rp 30.000.000)");
  });

  it("catatan lapangan ikut terbawa", () => {
    expect(pesanRencanaWa(dasar)).toContain("Butuh tambahan alat.");
    expect(pesanRencanaWa({ ...dasar, catatan: null })).not.toContain("*Catatan*");
  });

  it("angka memakai format Indonesia — satu konvensi dengan dokumen cetaknya", () => {
    const t = pesanRencanaWa(dasar);
    expect(t).toContain("12,40%");
    expect(t).toContain("Rp 30.000.000");
    expect(t).not.toMatch(/\d\.\d\d%/); // tidak ada "12.40%"
  });
});
