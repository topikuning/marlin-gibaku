// PROGRES HARIAN DAN MINGGUAN HARUS BISA DIBEDAKAN (DECISIONS 458).
//
// Keluhan user 2026-08-28, dengan tangkapan layar WhatsApp: "progres kemantren
// kemarin" dan "laporan mingguan di kemantren" sama-sama dibalas
//
//     realisasi 7,19% · rencana 5,06% · deviasi +2,13%
//
// — angka yang sama persis, dua pertanyaan yang berbeda. *"progress kemarin dan
// total progress mingguan tidak bisa dibedakan."*
//
// Balasannya tidak salah; ia cuma tidak menjawab. `realizedPct` SELALU
// kumulatif s/d tanggal yang ditanya, jadi selama tidak ada laporan baru di
// antara kedua tanggal itu angkanya memang identik. Yang hilang ada dua:
// TAMBAHAN pada rentang yang ditanya, dan satu kata yang mengaku bahwa sisanya
// kumulatif.
import { describe, expect, it } from "vitest";
import { balasMingguan, balasProgress } from "@/lib/waha/tanya-format";

/** Angka yang sama persis dengan tangkapan layar user. */
const KUMULATIF = { realisasiPct: 7.19, rencanaPct: 5.06, deviasiPct: 2.13 };

const harian = (tambahanPct: number | null) =>
  balasProgress({
    tanggal: "kemarin · 27 Agustus 2026",
    baris: [
      {
        lokasi: "Kemantren",
        ...KUMULATIF,
        tambahanPct,
        itemHariIni: 4,
        statusHariIni: "Dikirim",
      },
    ],
  });

const mingguan = (tambahanPct: number | null) =>
  balasMingguan({
    periode: "pekan 24 Agustus 2026 – 30 Agustus 2026",
    baris: [
      {
        lokasi: "Kemantren",
        realisasiPct: KUMULATIF.realisasiPct,
        rencanaPct: KUMULATIF.rencanaPct,
        deviasiPct: KUMULATIF.deviasiPct,
        tambahanPct,
        hariBerlaporan: 4,
        totalHari: 5,
      },
    ],
  });

describe("balasan progres harian", () => {
  it("menyebut TAMBAHAN hari itu, bukan cuma kumulatifnya", () => {
    const t = harian(0.42);
    expect(t).toContain("+0,42% hari itu");
  });

  it("angka kumulatif MENGAKU kumulatif", () => {
    // "realisasi 7,19%" terbaca sebagai capaian hari itu. Satu kata inilah
    // bedanya antara jawaban yang benar dan jawaban yang dipahami.
    expect(harian(0.42)).toContain("kumulatif 7,19%");
    expect(harian(0.42)).not.toMatch(/\brealisasi 7,19%/);
  });

  it("hari yang TIDAK bergerak ditulis apa adanya, bukan dihilangkan", () => {
    /*
     * Nol adalah jawaban — "kemarin tidak ada kemajuan" persis yang ingin
     * diketahui penanya. Menyembunyikan baris ini saat nol membuat hari yang
     * mandek terlihat sama dengan hari yang produktif.
     */
    expect(harian(0)).toContain("+0,00% hari itu");
  });

  it("tanggal yang tak terbaca TIDAK dikarang jadi nol", () => {
    // null = tambahannya tidak punya arti; menulis "+0,00%" di situ berarti
    // menyatakan sesuatu yang tidak diketahui.
    expect(harian(null)).not.toContain("hari itu");
    expect(harian(null)).toContain("kumulatif 7,19%");
  });
});

describe("balasan rekap mingguan", () => {
  it("menyebut tambahan SEPANJANG PEKAN", () => {
    expect(mingguan(1.95)).toContain("+1,95% sepanjang pekan");
  });

  it("kumulatifnya juga mengaku kumulatif", () => {
    expect(mingguan(1.95)).toContain("kumulatif 7,19%");
  });

  it("lokasi tanpa kurva-S tetap tidak dicetak rencana 0%", () => {
    // Perilaku lama yang WAJIB bertahan: rencana yang belum ada bukan rencana
    // nol, dan di sini nol akan terbaca sebagai prestasi.
    const t = balasMingguan({
      periode: "pekan 24 Agustus 2026 – 30 Agustus 2026",
      baris: [
        {
          lokasi: "Tanpa Kurva",
          realisasiPct: 3,
          rencanaPct: null,
          deviasiPct: null,
          tambahanPct: 3,
          hariBerlaporan: 1,
          totalHari: 5,
        },
      ],
    });
    expect(t).toContain("rencana belum ada (kurva-S belum disusun)");
  });
});

describe("REGRESI: dua pertanyaan, dua jawaban", () => {
  it("harian dan mingguan TIDAK lagi identik walau kumulatifnya sama", () => {
    /*
     * Inilah keadaan yang dikeluhkan, direproduksi apa adanya: kumulatifnya
     * memang sama (7,19%) karena tidak ada laporan baru di antaranya — dan itu
     * BENAR, keduanya memang menyebut posisi yang sama. Yang dulu tidak ada
     * adalah baris yang membedakan pertanyaannya: 0,00 pada hari itu vs 1,95
     * sepanjang pekan.
     *
     * Karena itu yang diuji bukan "angkanya berbeda" — melainkan bahwa tiap
     * balasan memuat satu baris yang TIDAK ADA di balasan satunya. Pada kode
     * lama tidak ada baris seperti itu sama sekali: kedua balasan hanya
     * berbeda judul.
     */
    const a = harian(0);
    const b = mingguan(1.95);
    const barisKhas = (x: string, y: string) =>
      x.split("\n").filter((l) => l.trim() && !y.includes(l));
    expect(barisKhas(a, b)).toContain("  +0,00% hari itu");
    expect(barisKhas(b, a)).toContain("  +1,95% sepanjang pekan");
  });
});
