import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AMBANG_BARIS_PDF,
  keteranganBerkas,
  namaBerkasTabel,
  perluPdf,
  petaLokasi,
  tabelDeviasi,
  tabelKendala,
} from "@/lib/waha/tanya-tabel";
import { balasKendala, bertanda, pct } from "@/lib/waha/tanya-format";
import type { LokasiKatalog } from "@/lib/waha/tanya-niat";

const { buildTabelWaPdf } = await import("@/lib/pdf/wa-tabel");

/**
 * Jawaban WhatsApp berdata → tabel PDF (DECISIONS 448).
 *
 * Yang dijaga: tabelnya menuangkan baris yang SAMA dengan balasan teks, angka
 * diformat fungsi yang sama, wilayah tidak pernah ditebak, dan keputusan
 * "pakai berkas atau tidak" bertumpu pada dua hal yang bisa dibaca ulang.
 */

const KATALOG: LokasiKatalog[] = [
  {
    id: "1",
    nama: "Kedungmutih",
    desa: "Kedungmutih",
    kecamatan: "Wedung",
    kabupaten: "Kabupaten Demak",
    provinsi: "Jawa Tengah",
    pelaksana: "PT Samudra Karya",
  },
  {
    id: "2",
    nama: "Tengket",
    desa: "Tengket",
    kecamatan: null,
    kabupaten: "Kabupaten Bangkalan",
    provinsi: "Jawa Timur",
    pelaksana: "CV Bahari Jaya",
  },
];

const kendala = (n: number) => ({
  lokasi: n % 2 ? "Kedungmutih" : "Tengket",
  judul: `Kendala nomor ${n}`,
  tingkat: n % 3 === 0 ? "kritis" : "sedang",
  status: "terbuka",
  umurHari: n,
});

describe("perluPdf", () => {
  it("banyak rincian → berkas", () => {
    expect(perluPdf(1, AMBANG_BARIS_PDF)).toBe(true);
    expect(perluPdf(1, AMBANG_BARIS_PDF - 1)).toBe(false);
  });

  it("teks yang tidak muat satu pesan → berkas, walau rinciannya sedikit", () => {
    // Beberapa gelembung yang urutannya harus dirakit sendiri oleh pembaca
    // adalah persis keadaan yang berkas ini gantikan.
    expect(perluPdf(2, 3)).toBe(true);
  });

  it("tidak ada rincian → TIDAK PERNAH berkas", () => {
    // "Tidak ada yang cocok" sebagai lampiran PDF adalah lelucon yang mahal.
    expect(perluPdf(5, 0)).toBe(false);
  });
});

describe("tabelKendala", () => {
  const peta = petaLokasi(KATALOG);
  const t = tabelKendala(
    { judul: "Kendala belum selesai", tanggal: "hari ini · 26 Agustus 2026", baris: [kendala(1), kendala(2)] },
    peta,
  );

  it("kolomnya dibuka perusahaan, lalu lokasi & wilayahnya", () => {
    expect(t.kolom.map((k) => k.label)).toEqual([
      "No",
      "Perusahaan",
      "Lokasi",
      "Kabupaten/Kota",
      "Provinsi",
      "Tingkat",
      "Status",
      "Umur",
      "Kendala",
    ]);
    // Baris pertama = perusahaan paling awal menurut abjad (CV Bahari Jaya),
    // bukan baris pertama masukan.
    expect(t.baris[0].map((s) => s.teks)).toEqual([
      "1",
      "CV Bahari Jaya",
      "Tengket",
      "Kabupaten Bangkalan",
      "Jawa Timur",
      "sedang",
      "terbuka",
      "2 hari",
      "Kendala nomor 2",
    ]);
  });

  it("lokasi di luar katalog diberi tanda, BUKAN ditebak", () => {
    const x = tabelKendala(
      { judul: "Kendala", tanggal: "hari ini", baris: [{ ...kendala(1), lokasi: "Entah" }] },
      peta,
    );
    // perusahaan, kabupaten, provinsi — ketiganya tidak diketahui.
    expect(x.baris[0][1].teks).toBe("–");
    expect(x.baris[0][3].teks).toBe("–");
    expect(x.baris[0][4].teks).toBe("–");
  });

  it("diurutkan per PERUSAHAAN lalu lokasi; yang tak diketahui di belakang", () => {
    const baris = [
      { ...kendala(1), lokasi: "Kedungmutih" }, // PT Samudra Karya
      { ...kendala(3), lokasi: "Entah" }, // tanpa perusahaan
      { ...kendala(5), lokasi: "Tengket" }, // CV Bahari Jaya
    ];
    const x = tabelKendala({ judul: "Kendala", tanggal: "hari ini", baris }, peta);
    expect(x.baris.map((r) => r[1].teks)).toEqual(["CV Bahari Jaya", "PT Samudra Karya", "–"]);
    // Nomornya ikut urutan baca, bukan urutan masukan.
    expect(x.baris.map((r) => r[0].teks)).toEqual(["1", "2", "3"]);
  });

  it("jawaban yang berupa PERINGKAT tidak disusun ulang", () => {
    const baris = [
      { ...kendala(1), lokasi: "Kedungmutih" },
      { ...kendala(5), lokasi: "Tengket" },
    ];
    const x = tabelKendala({ judul: "Kendala", tanggal: "hari ini", baris }, peta, {
      peringkat: true,
    });
    expect(x.baris.map((r) => r[2].teks)).toEqual(["Kedungmutih", "Tengket"]);
  });

  it("satu baris per LOKASI, dan tidak satu pun kendala hilang dari selnya", () => {
    // Register lama memakai satu baris per kendala, jadi satu lokasi bisa
    // memakan tiga baris untuk dua persoalan (keberatan user 2026-08-27).
    const baris = Array.from({ length: 7 }, (_, i) => kendala(i + 1));
    const teks = balasKendala({ tanggal: "hari ini", baris, lokasiDiperiksa: 2, judul: "Kendala" });
    const tabel = tabelKendala({ judul: "Kendala", tanggal: "hari ini", baris }, peta);
    // 7 kendala di 2 lokasi → 2 baris.
    expect(tabel.baris).toHaveLength(2);
    const semuaSel = tabel.baris.flat().map((s) => s.teks).join("\n");
    for (const b of baris) {
      expect(teks).toContain(b.judul);
      expect(semuaSel).toContain(b.judul);
    }
  });
});

describe("tabelDeviasi", () => {
  it("angkanya diformat fungsi yang sama dengan balasan teks", () => {
    const t = tabelDeviasi(
      {
        judul: "Deviasi negatif – 1 dari 2 lokasi",
        tanggal: "hari ini",
        baris: [{ lokasi: "Tengket", deviasiPct: -30.925, realisasiPct: 12.3, rencanaPct: 43.225 }],
      },
      petaLokasi(KATALOG),
    );
    expect(t.baris[0][5].teks).toBe(bertanda(-30.925));
    expect(t.baris[0][6].teks).toBe(pct(12.3));
    expect(t.baris[0][7].teks).toBe(pct(43.225));
  });
});

describe("catatan & pengantar berkas", () => {
  const peta = petaLokasi(KATALOG);

  it("pengakuan 'jawaban ini sebagian' ikut, dan urutannya tetap", () => {
    const t = tabelKendala({ judul: "Kendala", tanggal: "hari ini", baris: [kendala(1)] }, peta, {
      penandaLingkup: "Dijawab untuk paket grup ini saja.",
      catatanPeriode: "Keadaan sekarang, bukan pada tanggal itu.",
      catatanBatas: "Ditampilkan 15 dari 40 kendala.",
    });
    expect(t.catatan).toEqual([
      "Dijawab untuk paket grup ini saja.",
      "Keadaan sekarang, bukan pada tanggal itu.",
      "Ditampilkan 15 dari 40 kendala.",
    ]);
  });

  it("keterangan berkas berdiri sendiri: judul, jumlah, dan catatannya", () => {
    const t = tabelKendala({ judul: "Kendala belum selesai", tanggal: "26 Agustus 2026", baris: [kendala(1)] }, peta, {
      catatanBatas: "Ditampilkan 15 dari 40 kendala.",
    });
    const k = keteranganBerkas(t);
    expect(k).toContain("Kendala belum selesai");
    expect(k).toContain("26 Agustus 2026");
    expect(k).toContain("1 baris");
    expect(k).toContain("Ditampilkan 15 dari 40 kendala.");
  });

  it("kendala yang dipadatkan menyebut RINCIANNYA, bukan cuma jumlah baris", () => {
    // 3 kendala di satu lokasi = 1 baris; "1 baris" akan terbaca "1 kendala".
    const t = tabelKendala(
      {
        judul: "Kendala",
        tanggal: "hari ini",
        baris: [
          { ...kendala(1), lokasi: "Tengket", judul: "Menunggu lahan" },
          { ...kendala(2), lokasi: "Tengket", judul: "Akses jalan sempit" },
          { ...kendala(3), lokasi: "Tengket", judul: "Sosialisasi warga" },
        ],
      },
      peta,
    );
    expect(t.baris).toHaveLength(1);
    expect(t.jumlahIsi).toBe(3);
    expect(keteranganBerkas(t)).toContain("3 rincian di 1 baris");
  });

  it("nama berkas terbaca manusia dan menyebut tanggalnya", () => {
    const t = tabelKendala({ judul: "Kendala belum selesai", tanggal: "x", baris: [] }, peta);
    expect(namaBerkasTabel(t, "2026-08-26")).toBe("marlin-kendala-belum-selesai-2026-08-26.pdf");
  });
});

describe("buildTabelWaPdf", () => {
  it("PDF sah untuk daftar kosong maupun daftar yang memaksa pindah halaman", async () => {
    const peta = petaLokasi(KATALOG);
    for (const jumlah of [0, 120]) {
      const t = tabelKendala(
        {
          judul: "Kendala belum selesai",
          tanggal: "hari ini · 26 Agustus 2026",
          baris: Array.from({ length: jumlah }, (_, i) => kendala(i + 1)),
        },
        peta,
        { catatanBatas: "Ditampilkan 120 dari 300 kendala." },
      );
      const buf = await buildTabelWaPdf(t, { untuk: "Hery", dibuatPada: new Date("2026-08-26T03:00:00Z") });
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(buf.length).toBeGreaterThan(1000);
    }
  });

  it("KERTASNYA A4, dan tetap A4 (permintaan user 2026-08-28)", async () => {
    /*
     * *"pastikan pdfnya itu ukuran A4 atau kertas yang standar."*
     *
     * Berkas ini diteruskan ke PPK dan DICETAK. Ukuran non-standar — atau
     * ukuran yang ikut melar mengikuti jumlah kolom — membuat cetakannya
     * mengecil sendiri di printer, atau terpotong.
     *
     * Diperiksa dari MediaBox di byte PDF-nya, bukan dari konstanta di kode:
     * yang dicetak orang adalah berkasnya, bukan niat penulisnya. A4 lanskap =
     * 841,89 × 595,28 pt (A4 tegak yang diputar), dan lanskap memang perlu —
     * tabel kendala punya enam kolom.
     */
    const peta = petaLokasi(KATALOG);
    const t = tabelKendala(
      { judul: "Kendala belum selesai", tanggal: "26 Agustus 2026", baris: [kendala(1)] },
      peta,
      {},
    );
    const buf = await buildTabelWaPdf(t, { dibuatPada: new Date("2026-08-26T03:00:00Z") });
    const mediaBox = [...buf.toString("latin1").matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) =>
      m[1].trim().split(/\s+/).map(Number),
    );
    expect(mediaBox.length, "PDF wajib menyatakan MediaBox").toBeGreaterThan(0);
    for (const box of mediaBox) {
      const lebar = Math.round(box[2] - box[0]);
      const tinggi = Math.round(box[3] - box[1]);
      expect([lebar, tinggi]).toEqual([842, 595]);
    }
  });
});
