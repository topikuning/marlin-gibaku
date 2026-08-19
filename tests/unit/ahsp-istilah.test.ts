import { describe, expect, it } from "vitest";
import { bacaAturanIstilah, bacaIstilah, bacaPenulangan } from "@/lib/ahsp/istilah";
import { siapkanKandidat, usulkanPadanan, peringkatPadanan } from "@/lib/ahsp/cocok";

/**
 * Lapisan istilah dari `matching_engine` berkas AHSP skema 2.1.0 (DECISIONS 321).
 *
 * Aturan uji ini memakai potongan `matching_engine` YANG SEBENARNYA — supaya
 * kalau bentuk berkasnya berubah, ujinya ikut memerah, bukan diam-diam menguji
 * struktur karangan sendiri.
 */
const MESIN = {
  terminology_aliases: {
    penulangan: ["penulangan", "pembesian", "besi beton", "tulangan", "rebar", "reinforcement"],
    bjts: ["bjts", "baja tulangan sirip", "besi ulir", "besi deform", "deformed bar"],
    bjtp: ["bjtp", "baja tulangan polos", "besi polos", "plain bar"],
    slab: ["slab", "pelat", "plat", "pelat lantai", "plat lantai"],
    timbunan: ["timbunan", "urugan", "pengurugan"],
  },
  reinforcement_matching: {
    synonyms: ["penulangan", "pembesian", "besi beton", "tulangan", "rebar", "reinforcement"],
    element_rules: [
      { signals: ["slab", "pelat", "plat", "pelat lantai", "plat lantai"], element_group: "slab" },
      {
        signals: ["kolom", "balok", "ring balk", "ring balok", "ringbalk", "sloof"],
        element_group: "frame",
      },
      {
        signals: ["shearwall", "shear wall", "dinding geser"],
        element_group: "frame_ge12_in_current_ahsp",
      },
    ],
    verified_records: {
      slab_BjTP_lt12: "2.2.1.1.1",
      slab_BjTS_lt12: "2.2.1.1.1.a",
      slab_BjTP_ge12: "2.2.1.1.2",
      slab_BjTS_ge12: "2.2.1.1.2.a",
      frame_BjTP_lt12: "2.2.1.1.3",
      frame_BjTS_lt12: "2.2.1.1.3.a",
      frame_BjTP_ge12: "2.2.1.1.4",
      frame_BjTS_ge12: "2.2.1.1.4.a",
    },
  },
};

const ATURAN = bacaAturanIstilah(MESIN);

function baca(uraian: string) {
  const b = bacaIstilah(uraian, ATURAN);
  return { b, rein: bacaPenulangan(uraian, ATURAN, b) };
}

describe("bacaAturanIstilah", () => {
  it("berkas tanpa matching_engine menghasilkan aturan kosong, bukan tebakan", () => {
    // Terbitan lama tidak membawa lapisan ini. Yang benar adalah pencocokan
    // turun mutunya, BUKAN memakai daftar padanan karangan MARLIN.
    const kosong = bacaAturanIstilah(null);
    expect(kosong.padanan.size).toBe(0);
    expect(kosong.penulanganTerverifikasi.size).toBe(0);
    expect(bacaPenulangan("Pekerjaan Pembesian D13", kosong, bacaIstilah("x", kosong))).toBeNull();
  });

  it("membaca padanan istilah dan tabel penulangan terverifikasi", () => {
    expect(ATURAN.penulanganTerverifikasi.size).toBe(8);
    expect(ATURAN.padanan.get("pembesian")).toBe("penulangan");
    expect(ATURAN.padanan.get("besi beton")).toBe("penulangan");
  });
});

describe("bacaIstilah", () => {
  it('"pembesian" dan "penulangan" jadi istilah yang sama', () => {
    // Sebagai teks keduanya tidak beririsan sama sekali — inilah yang bikin
    // seluruh pekerjaan pembesian RAB lapangan luput sebelum lapisan ini ada.
    expect(baca("Pekerjaan Pembesian Besi Beton").b.istilah.has("penulangan")).toBe(true);
    expect(baca("Penulangan slab untuk BjTS").b.istilah.has("penulangan")).toBe(true);
  });

  it("frasa panjang menang atas potongannya", () => {
    // "baja tulangan sirip" harus tertangkap utuh sebagai bjts, bukan dimakan
    // sepotong oleh "tulangan".
    expect(baca("Besi baja tulangan sirip D16").b.istilah.has("bjts")).toBe(true);
  });

  it("membaca KELAS diameter, bukan diameter persis", () => {
    // AHSP penulangan hanya membedakan < 12 mm dan ≥ 12 mm; D10 vs D8 bukan
    // pertentangan, D10 vs D13 baru pertentangan.
    expect(baca("Pembesian D10-150").b.kelasDiameter).toBe("lt12");
    expect(baca("Pembesian D13-150").b.kelasDiameter).toBe("ge12");
    expect(baca("Pembesian Ø 8 mm").b.kelasDiameter).toBe("lt12");
  });

  it("uraian bercampur dua kelas diameter TIDAK mengaku tahu kelasnya", () => {
    expect(baca("Pembesian D10 dan D16").b.kelasDiameter).toBeNull();
  });

  it('notasi "8D10" terbaca walau menempel tanpa spasi', () => {
    // Jumlah batang (8) sengaja diabaikan — berkasnya menyebutnya bukan bagian
    // pemilihan kelas diameter.
    expect(baca("Pembesian 8D10").b.kelasDiameter).toBe("lt12");
  });
});

describe("bacaPenulangan", () => {
  it("D = BjTS, tapi Ø saja BUKAN penentu jenis baja", () => {
    /*
     * Aturan berkasnya, bukan tafsir sendiri: notasi D adalah sinyal kuat
     * BjTS, sedangkan "Øxx tanpa kata polos/sirip" → unknown, dengan tindakan
     * "jangan menebak jenis baja". Menebaknya berarti memilih analisa dengan
     * koefisien yang berbeda atas dasar simbol.
     */
    expect(baca("Pembesian Besi Beton D13-150 mm").rein!.jenisBaja).toBe("bjts");
    expect(baca("Pembesian Besi Beton Ø10-150 mm").rein!.jenisBaja).toBeNull();
    expect(baca("Pembesian besi polos Ø10").rein!.jenisBaja).toBe("bjtp");
  });

  it("elemen struktur tidak disebut → PERLU KONTEKS, bukan dipilih paksa", () => {
    // Aturan eksplisit berkasnya. Pembesian pelat dan pembesian kolom memakai
    // analisa berbeda; RAB yang tak menyebut elemennya tak bisa diputuskan.
    const r = baca("Pembesian Besi Beton D13-150 mm secara semi mekanis").rein!;
    expect(r.elemen).toBeNull();
    expect(r.perluKonteks).toBe(true);
    expect(r.kodeKandidat.sort()).toEqual(["2.2.1.1.2.a", "2.2.1.1.4.a"]);
    expect(r.alasan.join(" ")).toMatch(/elemen struktur/i);
  });

  it("elemen + jenis baja + kelas diameter lengkap → SATU analisa", () => {
    const r = baca("Pembesian pelat lantai D13-150 mm").rein!;
    expect(r.perluKonteks).toBe(false);
    expect(r.kodeKandidat).toEqual(["2.2.1.1.2.a"]);
  });

  it("shearwall masuk kelompok frame", () => {
    const r = baca("Pembesian dinding geser D16").rein!;
    expect(r.elemen).toBe("frame");
    expect(r.kodeKandidat).toEqual(["2.2.1.1.4.a"]);
  });

  it("Ø tanpa elemen menyisakan EMPAT kandidat – dan itu jawaban yang benar", () => {
    const r = baca("Pembesian Besi Beton Ø 10-150 mm").rein!;
    expect(r.kodeKandidat).toHaveLength(4);
    expect(r.perluKonteks).toBe(true);
  });

  it("pekerjaan bukan penulangan tidak masuk jalur ini", () => {
    expect(baca("Pekerjaan Urugan Sirtu").rein).toBeNull();
  });
});

describe("pencocokan dengan lapisan istilah", () => {
  const kandidat = siapkanKandidat(
    [
      {
        id: "a",
        kode: "2.2.1.1.2.a",
        uraian: "1 kg Penulangan slab untuk BjTS diameter ≥ 12 mm, cara Semi mekanis",
        satuan: "kg",
        bidang: "cipta_karya",
        perluVerifikasi: false,
        jumlahKomponen: 4,
        aliases: ["penulangan", "pembesian", "besi beton", "bjts", "slab", "pelat"],
      },
      {
        id: "b",
        kode: "2.2.1.1.4.a",
        uraian:
          "1 kg Penulangan kolom, balok, ring balk, sloof, dan shearwall untuk BjTS diameter ≥ 12 mm, cara Semi mekanis",
        satuan: "kg",
        bidang: "cipta_karya",
        perluVerifikasi: false,
        jumlahKomponen: 4,
        aliases: ["penulangan", "pembesian", "besi beton", "bjts", "ring balk"],
      },
      {
        id: "c",
        kode: "2.3.1.4",
        uraian: "1 kg Pekerjaan baja pelat secara semi mekanis",
        satuan: "kg",
        bidang: "bina_marga",
        perluVerifikasi: false,
        jumlahKomponen: 4,
        aliases: [],
      },
    ],
    ATURAN,
  );

  it("TIDAK memaksa memilih saat elemen struktur tak disebut", () => {
    /*
     * Salah-cocok yang benar-benar terjadi pada RAB Kedung Mutih SEBELUM jalur
     * aturan ini ada: "Pembesian Besi Beton D13-150 mm secara semi mekanis"
     * menang ke "1 kg Pekerjaan baja pelat secara semi mekanis" dengan 45% —
     * pekerjaan yang sama sekali lain, menang karena kata "baja"/"pelat"/
     * "semi mekanis". 56 baris pembesian tercocok begitu.
     */
    const u = usulkanPadanan(
      { uraian: "Pembesian Besi Beton D13-150 mm secara semi mekanis", satuan: "kg" },
      kandidat,
      ATURAN,
    );
    expect(u).toBeNull();
  });

  it("kandidat yang BENAR muncul paling atas saat manusia mengoreksi", () => {
    // Tidak memilih bukan berarti tidak membantu: dua analisa yang sah harus
    // terlihat lebih dulu, bukan terkubur di bawah kemiripan nama.
    const daftar = peringkatPadanan(
      { uraian: "Pembesian Besi Beton D13-150 mm secara semi mekanis", satuan: "kg" },
      kandidat,
      8,
      ATURAN,
    );
    expect(daftar.slice(0, 2).map((d) => d.kandidat.kode).sort()).toEqual([
      "2.2.1.1.2.a",
      "2.2.1.1.4.a",
    ]);
  });

  it("elemen disebut → dipetakan otomatis ke analisa yang tepat", () => {
    const u = usulkanPadanan(
      { uraian: "Pembesian pelat lantai D13-150 mm secara semi mekanis", satuan: "kg" },
      kandidat,
      ATURAN,
    );
    expect(u?.kandidat.kode).toBe("2.2.1.1.2.a");
    expect(u?.meyakinkan).toBe(true);
    expect(u?.alasan).toMatch(/tabel terverifikasi/i);
  });

  it("tanpa aturan istilah, kasus yang sama jatuh ke padanan yang SALAH", () => {
    // Uji ini merekam kenapa lapisan istilah itu perlu: dengan aturan kosong,
    // pencocok kata memilih "Pekerjaan baja pelat" — dan tampak wajar.
    const tanpaAturan = siapkanKandidat([
      {
        id: "c",
        kode: "2.3.1.4",
        uraian: "1 kg Pekerjaan baja pelat secara semi mekanis",
        satuan: "kg",
        bidang: "bina_marga",
        perluVerifikasi: false,
        jumlahKomponen: 4,
      },
    ]);
    const u = usulkanPadanan(
      { uraian: "Pembesian Besi Beton D13-150 mm secara semi mekanis", satuan: "kg" },
      tanpaAturan,
    );
    expect(u?.kandidat.kode).toBe("2.3.1.4");
  });
});
