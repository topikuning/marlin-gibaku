import { describe, expect, it } from "vitest";
import {
  AMBANG_NIHIL_BERUNTUN,
  alasanTidakBisaNihil,
  judulKendalaDariNihil,
  nihilBeruntun,
  nihilKarenaMenunggu,
  teksNihilCetak,
} from "@/lib/daily-report/nihil";

/**
 * DECISIONS 396 — hari tanpa kegiatan.
 *
 * Yang dijaga di sini bukan "boleh kosong", melainkan bahwa hari nihil tetap
 * merupakan PERNYATAAN yang bisa dibaca dan dihitung. Laporan yang lupa diisi
 * dan hari yang memang nihil berlawanan artinya; begitu keduanya terlihat sama,
 * seluruh data harian kehilangan gunanya.
 */

describe("alasanTidakBisaNihil", () => {
  const kosong = { jumlahItem: 0, jumlahMaterial: 0, jumlahAlat: 0 };

  it("hari yang benar-benar kosong boleh dinyatakan nihil", () => {
    expect(alasanTidakBisaNihil(kosong)).toBeNull();
  });

  it("REGRESI: nihil DAN ada item pekerjaan ditolak", () => {
    /*
     * Dua pernyataan yang saling menyangkal. Membiarkannya berdiri bersama
     * berarti laporan mengatakan dua hal sekaligus, dan pembacanya yang disuruh
     * memilih mana yang benar.
     */
    expect(alasanTidakBisaNihil({ ...kosong, jumlahItem: 1 })).toMatch(/item pekerjaan/i);
  });

  it("REGRESI: material masuk ITU kegiatan – tidak bisa nihil", () => {
    // Kedatangan material adalah kejadian yang perlu dibuktikan; menyebut
    // harinya "tidak ada kegiatan" menghapus bukti itu.
    expect(alasanTidakBisaNihil({ ...kosong, jumlahMaterial: 1 })).toMatch(/material/i);
  });

  it("REGRESI: alat tercatat ITU kegiatan – tidak bisa nihil", () => {
    expect(alasanTidakBisaNihil({ ...kosong, jumlahAlat: 1 })).toMatch(/alat/i);
  });
});

describe("nihilKarenaMenunggu", () => {
  it("hanya 'menunggu' yang berarti pekerjaan TERHAMBAT", () => {
    expect(nihilKarenaMenunggu("menunggu_material")).toBe(true);
    expect(nihilKarenaMenunggu("menunggu_lahan_izin")).toBe(true);
  });

  it("hujan, libur, force majeure berlalu sendiri – bukan kendala", () => {
    /*
     * Hujan dan libur tidak menunggu siapa pun. Menjadikannya kendala akan
     * memenuhi papan dengan baris yang tidak bisa ditagih ke siapa-siapa, dan
     * papan yang penuh baris tak-tertagih akan berhenti dibaca.
     */
    expect(nihilKarenaMenunggu("hujan")).toBe(false);
    expect(nihilKarenaMenunggu("libur")).toBe(false);
    expect(nihilKarenaMenunggu("force_majeure")).toBe(false);
    expect(nihilKarenaMenunggu("lainnya")).toBe(false);
    expect(nihilKarenaMenunggu(null)).toBe(false);
  });
});

describe("judulKendalaDariNihil", () => {
  it("alasan bukan-menunggu tidak menghasilkan usulan kendala", () => {
    expect(judulKendalaDariNihil("hujan")).toBeNull();
    expect(judulKendalaDariNihil("libur", "Idul Adha")).toBeNull();
  });

  it("REGRESI: judulnya TIDAK memuat tanggal", () => {
    /*
     * Menunggu material hari ini dan besok adalah masalah yang SAMA. Judul
     * ber-tanggal akan lolos dari penjaga duplikat, dan papan terisi satu
     * masalah berkali-kali — persis cacat yang baru saja diperbaiki di
     * DECISIONS 392.
     */
    const a = judulKendalaDariNihil("menunggu_material")!;
    expect(a).not.toMatch(/\d{4}|\d{1,2}\s+(Agu|Jan|Feb)/);
    expect(judulKendalaDariNihil("menunggu_material")).toBe(a);
  });

  it("catatan pendek ikut ke judul supaya barang berbeda tidak dilebur", () => {
    const besi = judulKendalaDariNihil("menunggu_material", "besi D13");
    const semen = judulKendalaDariNihil("menunggu_material", "semen PCC");
    expect(besi).toContain("besi D13");
    expect(besi).not.toBe(semen);
  });

  it("catatan panjang TIDAK ikut – judul papan harus terbaca sekali lihat", () => {
    const panjang = "x".repeat(200);
    expect(judulKendalaDariNihil("menunggu_material", panjang)).not.toContain("xxx");
  });
});

describe("nihilBeruntun", () => {
  const h = (tgl: string, nihil: boolean) => ({ dateKey: tgl, nihil });

  it("menghitung mundur dari hari yang diminta", () => {
    const hari = [
      h("2026-08-18", true),
      h("2026-08-19", true),
      h("2026-08-20", true),
    ];
    expect(nihilBeruntun(hari, "2026-08-20")).toBe(3);
  });

  it("hari berisi memutus hitungan", () => {
    const hari = [
      h("2026-08-18", true),
      h("2026-08-19", false),
      h("2026-08-20", true),
    ];
    expect(nihilBeruntun(hari, "2026-08-20")).toBe(1);
  });

  it("REGRESI: hari TANPA LAPORAN memutus hitungan, bukan dianggap nihil", () => {
    /*
     * "Belum lapor" bukan pernyataan apa pun. Memperlakukannya sebagai nihil
     * akan melahirkan peringatan berhenti-bekerja untuk lokasi yang sebenarnya
     * cuma telat mengisi — dua masalah berbeda dengan penanganan berbeda, dan
     * peringatan yang salah sasaran akan dimatikan orang.
     */
    const hari = [h("2026-08-18", true), h("2026-08-20", true)]; // 19 tidak ada
    expect(nihilBeruntun(hari, "2026-08-20")).toBe(1);
  });

  it("hari yang diminta bukan nihil → 0", () => {
    expect(nihilBeruntun([h("2026-08-20", false)], "2026-08-20")).toBe(0);
    expect(nihilBeruntun([], "2026-08-20")).toBe(0);
  });

  it("ambangnya 3 – satu dua hari hujan itu biasa", () => {
    expect(AMBANG_NIHIL_BERUNTUN).toBe(3);
  });
});

describe("teksNihilCetak", () => {
  it("hari biasa tidak menghasilkan teks apa pun", () => {
    expect(teksNihilCetak(false, null)).toBeNull();
  });

  it("REGRESI: blanko menyebut KALIMAT, bukan dibiarkan kosong", () => {
    /*
     * Blanko kosong terbaca seperti ada yang lupa mengisi. Pemeriksa di sisi
     * PPK harus bisa melihat bahwa ini pernyataan sengaja.
     */
    const t = teksNihilCetak(true, "hujan", "hujan deras sejak subuh")!;
    expect(t).toContain("TIDAK ADA KEGIATAN");
    expect(t).toContain("Hujan");
    expect(t).toContain("hujan deras sejak subuh");
  });

  it("tanpa catatan tetap menyebut alasannya", () => {
    expect(teksNihilCetak(true, "libur")).toBe("TIDAK ADA KEGIATAN – Libur / cuti bersama");
  });
});
