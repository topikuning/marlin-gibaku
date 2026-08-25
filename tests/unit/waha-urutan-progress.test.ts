import { describe, expect, it } from "vitest";
import { urutkanProgress } from "@/lib/waha/urutan-progress";
import { bacaUrutan, rencanaDeterministik } from "@/lib/waha/parser-niat";
import type { LokasiKatalog } from "@/lib/waha/tanya-niat";

/**
 * "PROGRESS TERBAIK" HARUS BENAR-BENAR TERBAIK (DECISIONS 390).
 *
 * Cacat produksi 2026-08-20: *"progress terbaik"* dijawab tiga lokasi
 * ber-realisasi 0,00% – yaitu justru yang terburuk, diurut abjad. Kata
 * superlatifnya dibuang diam-diam, dan penanya tidak menerima satu pun tanda
 * bahwa permintaannya tidak dipenuhi.
 *
 * Diuji di sini, BUKAN hanya di integrasi: lokasi uji integrasi semuanya
 * berealisasi 0,00%, jadi asersi "menurun" dan "menaik" sama-sama lolos di
 * sana. Uji itu terlihat hijau tanpa pernah menguji apa pun – ketahuan lewat
 * uji gigi (pengurutan dilepas, uji integrasi tetap hijau).
 */

const katalog: LokasiKatalog[] = [
  { id: "a", nama: "Air Kuning", desa: "Air Kuning", kecamatan: null, kabupaten: "Jembrana", provinsi: "Bali" },
  { id: "b", nama: "Kemantren", desa: "Kemantren", kecamatan: null, kabupaten: "Lamongan", provinsi: "Jawa Timur" },
];

describe("bacaUrutan", () => {
  it("mengenali permintaan TERBAIK dalam berbagai kata", () => {
    for (const t of [
      "progress terbaik",
      "progress tertinggi",
      "progress paling bagus",
      "progress paling tinggi",
      "lokasi terbesar progresnya",
    ]) {
      expect(bacaUrutan(t), t).toBe("terbaik");
    }
  });

  it("mengenali permintaan TERBURUK dalam berbagai kata", () => {
    for (const t of [
      "progress terburuk",
      "progress terendah",
      "progress paling rendah",
      "progress paling parah",
      "yang paling tertinggal",
    ]) {
      expect(bacaUrutan(t), t).toBe("terburuk");
    }
  });

  it("pertanyaan biasa tidak dianggap minta urutan", () => {
    expect(bacaUrutan("progress hari ini")).toBeNull();
    expect(bacaUrutan("kendala di Tengket")).toBeNull();
  });
});

describe("urutkanProgress", () => {
  const baris = [
    { lokasi: "Air Kuning", realisasiPct: 0 },
    { lokasi: "Kemantren", realisasiPct: 12.5 },
    { lokasi: "Tengket", realisasiPct: 3.2 },
  ];

  it("terbaik = realisasi TERBESAR dulu", () => {
    expect(urutkanProgress(baris, "terbaik").map((b) => b.lokasi)).toEqual([
      "Kemantren",
      "Tengket",
      "Air Kuning",
    ]);
  });

  it("terburuk = realisasi TERKECIL dulu", () => {
    expect(urutkanProgress(baris, "terburuk").map((b) => b.lokasi)).toEqual([
      "Air Kuning",
      "Tengket",
      "Kemantren",
    ]);
  });

  it("tidak mengubah larik aslinya", () => {
    const salinan = [...baris];
    urutkanProgress(baris, "terbaik");
    expect(baris).toEqual(salinan);
  });
});

describe("urutan sampai ke rencana deterministik", () => {
  it('"progress terbaik" dijawab TANPA AI, membawa urutannya', () => {
    const r = rencanaDeterministik("progress terbaik", katalog);
    expect(r.jenis).toBe("jalan");
    if (r.jenis !== "jalan") return;
    expect(r.niat).toBe("progress");
    expect(r.urutan).toBe("terbaik");
    // Kata superlatifnya TIDAK tersisa sebagai "nama lokasi tak dikenal".
    expect(r.lokasiDisebut).toEqual([]);
  });

  it('"yang paling tertinggal" dibaca sebagai deviasi + urutan terburuk', () => {
    const r = rencanaDeterministik("yang paling tertinggal", katalog);
    expect(r.jenis).toBe("jalan");
    if (r.jenis !== "jalan") return;
    expect(r.niat).toBe("deviasi");
    expect(r.urutan).toBe("terburuk");
  });

  it("superlatif pada niat yang tidak punya angka untuk diurut → diserahkan ke AI", () => {
    /*
     * "kendala terparah" tidak punya sumbu angka di MARLIN. Yang SALAH adalah
     * menjawabnya sambil membuang kata "terparah" – persis kesalahan yang
     * sedang diperbaiki. Menyerahkannya ke AI setidaknya jujur.
     */
    const r = rencanaDeterministik("kendala terparah", katalog);
    expect(r.jenis).toBe("serahkan_ai");
  });

  it("lokasi yang disebut tetap terbaca meski ada kata urutan", () => {
    const r = rencanaDeterministik("progress terbaik di Kemantren", katalog);
    expect(r.jenis).toBe("jalan");
    if (r.jenis !== "jalan") return;
    expect(r.urutan).toBe("terbaik");
    expect(r.lokasiDisebut).toEqual(["kemantren"]);
  });
});
