import { describe, expect, it } from "vitest";
import {
  normalisasiSatuan,
  peringkatPadanan,
  siapkanKandidat,
  tandaItem,
  tokenisasi,
  usulkanPadanan,
} from "@/lib/ahsp/cocok";

/**
 * Pencocokan item RAB → analisa AHSP (DECISIONS 318).
 *
 * Kasus-kasus di sini BUKAN karangan: semuanya diambil dari pengukuran terhadap
 * RAB KNMP sungguhan (Kedung Mutih, 1.657 item) melawan 5.550 analisa. Dua di
 * antaranya adalah salah-cocok yang benar-benar terjadi sebelum aturannya
 * diperbaiki — dikunci di sini supaya tidak kambuh.
 */

function kandidat(
  rows: [kode: string, uraian: string, satuan: string][],
  over: Partial<{ perluVerifikasi: boolean; jumlahKomponen: number }> = {},
) {
  return siapkanKandidat(
    rows.map(([kode, uraian, satuan], i) => ({
      id: `id${i}`,
      kode,
      uraian,
      satuan,
      bidang: "cipta_karya",
      perluVerifikasi: over.perluVerifikasi ?? false,
      jumlahKomponen: over.jumlahKomponen ?? 3,
    })),
  );
}

describe("normalisasiSatuan", () => {
  it("menyamakan superskrip RAB dengan tulisan AHSP", () => {
    // RAB memakai m³/m²/m¹; AHSP memakai m3/m2/m'. Tanpa ini, satuan yang
    // sebenarnya sama akan dihitung sebagai bukti pekerjaan yang berbeda.
    expect(normalisasiSatuan("m³")).toBe(normalisasiSatuan("m3"));
    expect(normalisasiSatuan("m²")).toBe(normalisasiSatuan("m2"));
    expect(normalisasiSatuan("m¹")).toBe(normalisasiSatuan("m'"));
    expect(normalisasiSatuan("Meter Kubik")).toBe("m3");
    expect(normalisasiSatuan("Buah")).toBe(normalisasiSatuan("bh"));
  });

  it("kosong tetap kosong – bukan ditebak", () => {
    expect(normalisasiSatuan(null)).toBe("");
    expect(normalisasiSatuan("  ")).toBe("");
  });
});

describe("tokenisasi", () => {
  it("membuang awalan satuan pada uraian AHSP", () => {
    // "1 m3 Beton…" — awalan itu penanda satuan analisa, bukan nama pekerjaan.
    expect(tokenisasi("1 m3 Beton mutu rendah").kata).not.toContain("m3");
    expect(tokenisasi("1 m3 Beton mutu rendah").kata).toContain("beton");
  });

  it("memisahkan angka dari kata", () => {
    const t = tokenisasi("Beton fc = 25 Mpa");
    expect(t.angka).toContain("25");
    expect(t.kata).toContain("beton");
  });

  it("membuang kata yang muncul di mana-mana", () => {
    const t = tokenisasi("Pekerjaan Pemasangan dengan Biaya Satuan");
    expect(t.kata).toEqual([]);
  });

  it("membuang satuan ukur yang menempel di uraian", () => {
    // "cm"/"mm" muncul di ribuan uraian tak berhubungan.
    expect(tokenisasi("Urugan Sirtu t = 10 cm").kata).toEqual(["urugan", "sirtu"]);
  });
});

describe("usulkanPadanan", () => {
  it("memilih mutu beton yang BENAR – angka yang membedakannya", () => {
    // Dua kandidat nyaris identik sebagai teks; fc 10 dan fc 25 berbeda mutu,
    // komposisi, dan harga. Salah pilih di sini bukan salah ketik.
    const k = kandidat([
      ["A.1", "1 m3 Beton mutu rendah fc' 10 Mpa, Slump (10 ± 2,5) cm", "m3"],
      ["A.2", "1 m3 Beton mutu rendah fc' 25 Mpa, Slump (10 ± 2,5) cm", "m3"],
    ]);
    const u = usulkanPadanan({ uraian: "Pekerjaan beton setara fc = 25", satuan: "m³" }, k);
    expect(u?.kandidat.kode).toBe("A.2");
  });

  it("angka yang kebetulan sama TIDAK menyelamatkan pekerjaan yang berbeda", () => {
    // Salah-cocok yang benar-benar terjadi: "Urugan Sirtu t = 10 cm" menang ke
    // "Shotcrete Wiremesh M10 (t = 10 cm)" dengan 65% karena "cm" dan "10".
    const k = kandidat([
      ["S.1", "Shotcrete Dengan Wiremesh M10 (t = 10 cm)", "m3"],
      ["S.2", "1 m3 Timbunan dan Pemadatan Sirtu secara manual", "m3"],
    ]);
    const u = usulkanPadanan({ uraian: "Pekerjaan Urugan Sirtu t = 10 cm", satuan: "m³" }, k);
    expect(u?.kandidat.kode).toBe("S.2");
  });

  it("angka TIDAK boleh mengalahkan kandidat yang katanya lebih cocok", () => {
    /*
     * Kasus yang memisahkan "angka menajamkan" dari "angka menyelamatkan":
     *
     *   item : [urugan, sirtu] + angka 25
     *   A    : [beton, mutu, tinggi, sirtu] + angka 25  → kemiripan kata 0,33
     *   B    : [sirtu, timbunan]            tanpa angka → kemiripan kata 0,50
     *
     * Tanpa pagar `AMBANG_KATA`, angka 25 yang cocok mengangkat A di atas B
     * padahal katanya jelas lebih jauh. Uji ini yang menjaga pagar itu — versi
     * sebelumnya lolos tanpa pagarnya, jadi pagarnya belum benar-benar teruji.
     */
    const k = kandidat([
      ["A.1", "Beton Mutu Tinggi Sirtu 25", "m3"],
      ["B.1", "Sirtu Timbunan", "m3"],
    ]);
    const u = usulkanPadanan({ uraian: "Pekerjaan Urugan Sirtu 25", satuan: "m³" }, k);
    expect(u?.kandidat.kode).toBe("B.1");
  });

  it("SATUAN yang berbeda menjatuhkan skor – m3 vs kg bukan variasi penulisan", () => {
    const k = kandidat([["B.1", "Pembesian besi beton polos", "kg"]]);
    const denganSatuanSalah = usulkanPadanan({ uraian: "Pembesian besi beton", satuan: "m³" }, k);
    const denganSatuanBenar = usulkanPadanan({ uraian: "Pembesian besi beton", satuan: "kg" }, k);
    expect(denganSatuanBenar!.skor).toBeGreaterThan(denganSatuanSalah?.skor ?? 0);
  });

  it("TIDAK ADA padanan lebih baik daripada padanan asal-asalan", () => {
    // Baris tanpa padanan harus terlihat sebagai lubang yang bisa diperbaiki,
    // bukan terisi angka karangan yang tampak meyakinkan.
    const k = kandidat([["X.1", "Pengecatan dinding interior", "m2"]]);
    expect(usulkanPadanan({ uraian: "Sewa Rumah untuk Direksi Keet", satuan: "bln" }, k)).toBeNull();
  });

  it("menandai pilihan yang beda tipis dengan kandidat lain", () => {
    const k = kandidat([
      ["T.1", "Timbunan dan Pemadatan Sirtu secara manual", "m3"],
      ["T.2", "Timbunan dan Pemadatan Sirtu secara mekanis", "m3"],
    ]);
    const u = usulkanPadanan({ uraian: "Pekerjaan Pemadatan Sirtu", satuan: "m³" }, k);
    expect(u).not.toBeNull();
    expect(u!.meyakinkan).toBe(false);
    expect(u!.alasan).toMatch(/beda tipis/i);
  });

  it("analisa yang perlu verifikasi kalah dari yang kanonik pada teks yang sama", () => {
    const kanonik = kandidat([["K.1", "Timbunan dan Pemadatan Sirtu secara manual", "m3"]])[0];
    const supp = kandidat([["S.9", "Timbunan dan Pemadatan Sirtu secara manual", "m3"]], {
      perluVerifikasi: true,
    })[0];
    const u = usulkanPadanan({ uraian: "Pemadatan Sirtu", satuan: "m³" }, [supp, kanonik]);
    expect(u?.kandidat.kode).toBe("K.1");
  });

  it("analisa tanpa koefisien terstruktur kalah – ia tidak bisa dipakai menghitung", () => {
    const berisi = kandidat([["C.1", "Galian tanah biasa sedalam 1 m", "m3"]])[0];
    const kosong = kandidat([["C.9", "Galian tanah biasa sedalam 1 m", "m3"]], {
      jumlahKomponen: 0,
    })[0];
    const u = usulkanPadanan({ uraian: "Pekerjaan Galian Tanah s/d 1 m", satuan: "m³" }, [
      kosong,
      berisi,
    ]);
    expect(u?.kandidat.kode).toBe("C.1");
  });

  it("uraian tanpa kata berarti tidak dipaksakan cocok", () => {
    const k = kandidat([["Z.1", "Galian tanah biasa", "m3"]]);
    expect(usulkanPadanan({ uraian: "Pekerjaan dengan biaya", satuan: "m³" }, k)).toBeNull();
  });
});

describe("tandaItem", () => {
  it("menyamakan yang cuma beda cara mengetik", () => {
    // Ini yang bikin satu koreksi berlaku untuk semua lokasi: 83 lokasi KNMP
    // memakai templat RAB yang sama, tapi spasi/tanda baca/huruf besarnya tidak
    // pernah persis seragam.
    expect(tandaItem("Pekerjaan  Urugan Sirtu, t = 10 cm", "m³")).toBe(
      tandaItem("pekerjaan urugan sirtu t 10 cm", "m3"),
    );
  });

  it("TIDAK menyamakan ketebalan yang berbeda", () => {
    // Kalau tanda dibangun dari token pencocokan, "cm"/"mm" ikut dibuang dan
    // kedua baris ini jatuh ke padanan yang sama. 10 cm dan 10 mm bukan variasi
    // penulisan — satu koreksi tidak boleh merembet ke pekerjaan lain.
    expect(tandaItem("Urugan Sirtu t = 10 cm", "m3")).not.toBe(
      tandaItem("Urugan Sirtu t = 10 mm", "m3"),
    );
  });

  it("satuan ikut jadi kunci – pekerjaan sama nama beda satuan bukan satu hal", () => {
    expect(tandaItem("Pembesian besi beton", "kg")).not.toBe(
      tandaItem("Pembesian besi beton", "m3"),
    );
  });
});

describe("peringkatPadanan", () => {
  it("memberi beberapa pilihan saat manusia mengoreksi, bukan cuma juaranya", () => {
    // Ambangnya lebih longgar dari usulkanPadanan: kalau sudah ada yang
    // memeriksa, kandidat 30% yang ternyata benar lebih berguna di layar
    // daripada disembunyikan.
    const k = kandidat([
      ["T.1", "Timbunan dan Pemadatan Sirtu secara manual", "m3"],
      ["T.2", "Timbunan dan Pemadatan Sirtu secara mekanis", "m3"],
      ["T.3", "Galian tanah biasa sedalam 1 m", "m3"],
    ]);
    const hasil = peringkatPadanan({ uraian: "Pekerjaan Pemadatan Sirtu", satuan: "m³" }, k);
    expect(hasil.length).toBe(2);
    expect(hasil[0].skor).toBeGreaterThanOrEqual(hasil[1].skor);
    expect(hasil.map((h) => h.kandidat.kode)).not.toContain("T.3");
  });

  it("menghormati batas jumlah – daftar koreksi bukan tumpahan 5.550 baris", () => {
    const k = kandidat([
      ["A.1", "Timbunan Sirtu manual", "m3"],
      ["A.2", "Timbunan Sirtu mekanis", "m3"],
      ["A.3", "Timbunan Sirtu padat", "m3"],
    ]);
    expect(peringkatPadanan({ uraian: "Timbunan Sirtu", satuan: "m³" }, k, 2)).toHaveLength(2);
  });

  it("uraian tanpa kata berarti tidak menghasilkan pilihan apa pun", () => {
    const k = kandidat([["Z.1", "Galian tanah biasa", "m3"]]);
    expect(peringkatPadanan({ uraian: "Pekerjaan dengan biaya", satuan: "m³" }, k)).toEqual([]);
  });
});
