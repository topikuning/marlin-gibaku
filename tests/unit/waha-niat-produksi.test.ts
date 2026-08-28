import { describe, expect, it } from "vitest";
import { parseNiatDeterministik } from "@/lib/waha/parser-niat";
import { balasProduksi, barisTafsir } from "@/lib/waha/tanya-format";
import { NIAT } from "@/lib/waha/tanya-niat";

/**
 * PERINTAH MEMBUAT ARTEFAK TIDAK BOLEH DIBACA SEBAGAI PERTANYAAN
 * (audit 2026-08-28).
 *
 * Cacat yang ditutup di sini bukan "tidak mengerti", melainkan salah paham yang
 * PERCAYA DIRI. Parser mencocokkan kata benda dan mengabaikan kata kerja, jadi
 * *"buatkan laporan eksekutif untuk direksi"* keluar sebagai niat `laporan` dan
 * berstatus `yakin` — tidak jatuh ke AI, tidak menawarkan pilihan. Penanya
 * menerima ISI LAPORAN HARIAN HARI INI: rapi, bersumber, dan bukan yang diminta.
 *
 * Register eksekutif justru imperatif ("buatkan", "kirimkan", "export"), jadi
 * kegagalan ini paling sering mengenai pembaca yang paling berpengaruh.
 */

const niatDari = (teks: string) => {
  const h = parseNiatDeterministik(teks);
  return h.jenis === "yakin" ? h.kandidat.niat : h.jenis;
};

describe("kata KERJA menang atas kata benda", () => {
  const PERINTAH = [
    "buatkan laporan eksekutif untuk direksi",
    "buatkan laporan bulanan",
    "buat rekap mingguan",
    "bikinkan paparan untuk rapat",
    "susun ringkasan proyek",
    "cetak laporan harian kemarin",
    "export excel progress semua lokasi",
    "ekspor rekap ke excel",
    "download laporan",
    "kirimkan pdf laporan ke pak ppk",
    "kirim excel progress",
  ];
  for (const teks of PERINTAH) {
    it(`"${teks}" → produksi`, () => {
      expect(niatDari(teks)).toBe("produksi");
    });
  }
});

describe("dua jebakan bahasa Indonesia tidak boleh termakan", () => {
  it('"buat" yang berarti UNTUK bukan perintah membuat', () => {
    // "laporan buat direksi" = laporan UNTUK direksi. Kalau ini terbaca sebagai
    // perintah produksi, permintaan melihat laporan berubah jadi penolakan.
    expect(niatDari("laporan buat direksi")).toBe("laporan");
    expect(niatDari("progress buat pak ppk")).toBe("progress");
  });

  it('"sudah/belum kirim laporan" TIDAK dibaca sebagai perintah', () => {
    /*
     * Pelapor yang MENGAKU sudah mengirim tidak sedang menyuruh MARLIN
     * mengirimkan apa pun. Yang dijaga di sini cuma satu: kalimat itu tidak
     * boleh jatuh ke `produksi`.
     *
     * Ke mana ia jatuh SESUDAHNYA sengaja tidak dipatok. "sudah kirim laporan"
     * hari ini terbaca `laporan` dan "belum kirim laporan" jadi ambigu — dua
     * perilaku yang sudah ada sebelum perubahan ini dan bukan urusannya.
     * Mematoknya di sini berarti uji ini ikut menjaga keputusan orang lain.
     */
    expect(niatDari("sudah kirim laporan")).not.toBe("produksi");
    expect(niatDari("belum kirim laporan")).not.toBe("produksi");
  });
});

describe("pertanyaan biasa tidak ikut tergeser", () => {
  const TETAP: [string, string][] = [
    ["progress hari ini", "progress"],
    ["laporan tanggal 12 juni", "laporan"],
    ["laporan mingguan", "laporan_mingguan"],
    ["siapa yang belum lapor kemarin", "kelengkapan"],
    ["rencana minggu depan", "rencana"],
    ["mana yang tertinggal", "deviasi"],
  ];
  for (const [teks, niat] of TETAP) {
    it(`"${teks}" tetap → ${niat}`, () => {
      expect(niatDari(teks)).toBe(niat);
    });
  }
});

/**
 * TAFSIR DITULIS DI DEPAN — supaya salah baca AI ketahuan dalam satu detik.
 *
 * Mode gagal jalur AI berbeda dari jalur parser: AI selalu memilih, tidak
 * pernah menawar. Kalau pilihannya meleset, jawabannya tetap rapi, bersumber,
 * dan salah — dan makin rapi, makin lama ketahuannya.
 */
describe("baris tafsir", () => {
  it("menyebut niat yang dipakai, dengan kata yang dimengerti orang", () => {
    expect(barisTafsir("progress")).toContain("Saya baca sebagai");
    expect(barisTafsir("progress")).toContain("progress pekerjaan");
    expect(barisTafsir("kelengkapan")).toContain("kelengkapan laporan harian");
  });

  it("tidak muncul untuk niat yang tafsirnya tidak menambah apa pun", () => {
    // `bantuan` sudah menjelaskan dirinya; `produksi` seluruh balasannya
    // memang tentang apa yang dibaca MARLIN.
    expect(barisTafsir("bantuan")).toBeNull();
    expect(barisTafsir("produksi")).toBeNull();
  });

  it("REGRESI: tiap niat baru wajib punya tafsir atau dikecualikan sadar", () => {
    // Niat yang lahir tanpa label akan menghasilkan "Saya baca sebagai:
    // undefined" di WhatsApp – kalimat yang lebih buruk daripada tidak ada.
    for (const n of NIAT) {
      const baris = barisTafsir(n);
      if (baris !== null) expect(baris).not.toMatch(/undefined/);
    }
  });
});

describe("balasan produksi: mengaku, menunjukkan jalan, menawarkan yang bisa", () => {
  const t = balasProduksi();

  it("MENGAKU tidak bisa, tanpa berpura-pura sedang mengerjakan", () => {
    expect(t).toMatch(/belum bisa lewat chat/i);
  });

  it("menyebut ALASANNYA – angka beku, bukan sekadar aturan", () => {
    expect(t).toMatch(/review/i);
    expect(t).toMatch(/dibekukan/i);
  });

  it("menunjukkan JALAN yang benar, bukan berhenti pada penolakan", () => {
    expect(t).toContain("Report Studio");
  });

  it("menawarkan hal terdekat yang BISA dilakukan sekarang", () => {
    // Orang yang minta laporan biasanya butuh angkanya, bukan berkasnya.
    expect(t).toMatch(/progress minggu ini/);
    expect(t).toMatch(/laporan mingguan/);
  });
});
