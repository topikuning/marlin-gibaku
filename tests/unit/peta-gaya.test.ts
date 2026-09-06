// GAYA PETA — apa yang digambar, dari sumber siapa, dan siapa yang disebut.
//
// Keluhan user 2026-09-06: *"aku sangat tidak puas dengan leaflet. apa tidak
// ada yang lebih baik? misal MapLibre GL JS"*, lalu ia memilih peta dasar
// milik sendiri (Protomaps di R2) + lapisan satelit.
//
// Empat hal dijaga di sini, karena keempatnya sunyi saat rusak — peta tetap
// tampil, hanya salah:
//
//   1. Peta TIDAK PERNAH lagi menarik ubin dari server komunitas OSM. Itu
//      bukan soal selera: kebijakan mereka melarang pemakaian produksi, dan
//      sekali diblokir, peta mati tanpa pesan.
//   2. Atribusi citra satelit IKUT TERBAWA. Atribusi adalah syarat pemakaian;
//      mengganti sumber tanpa menggantinya = memakai citra orang tanpa
//      menyebut pemiliknya.
//   3. Sumber yang tidak ada tidak menghasilkan lapisan hantu — layar harus
//      bisa tahu bahwa tidak ada yang bisa digambar, lalu mengatakannya.
//   4. Ganti mode tidak menghapus lapisan, hanya menyembunyikan — itu yang
//      membuat peta tidak melompat ke posisi awal saat orang menekan
//      "Satelit".
import { describe, expect, it } from "vitest";
import {
  LAPIS_SATELIT,
  adaSumber,
  gayaPeta,
  modeTersedia,
  type SumberPeta,
} from "@/lib/peta/gaya";

const LENGKAP: SumberPeta = {
  pmtiles: "https://r2.example.com/peta/basemap.pmtiles?sig=abc",
  satelit: "https://citra.example.com/{z}/{y}/{x}",
  satelitAtribusi: "Citra: Esri, Maxar",
};

describe("sumber ubin", () => {
  it("peta dasar dibaca dari berkas pmtiles milik sendiri, bukan server ubin OSM", () => {
    const gaya = gayaPeta(LENGKAP);
    const teks = JSON.stringify(gaya);
    expect(teks).not.toContain("tile.openstreetmap.org");
    expect(teks).not.toContain("tile.osm.org");
    const dasar = gaya.sources["dasar"];
    expect(dasar).toMatchObject({ type: "vector" });
    expect((dasar as { url: string }).url).toBe(`pmtiles://${LENGKAP.pmtiles}`);
  });

  it("atribusi citra satelit ikut ke dalam gaya – itu syarat pemakaiannya", () => {
    const satelit = gayaPeta(LENGKAP).sources["satelit"] as { attribution: string; tiles: string[] };
    expect(satelit.attribution).toBe("Citra: Esri, Maxar");
    expect(satelit.tiles).toEqual([LENGKAP.satelit]);
  });

  it("atribusi OpenStreetMap tetap melekat pada peta dasar", () => {
    const dasar = gayaPeta(LENGKAP).sources["dasar"] as { attribution: string };
    expect(dasar.attribution).toContain("openstreetmap.org/copyright");
  });
});

describe("sumber yang tidak ada", () => {
  it("tanpa pmtiles: tidak ada sumber dasar, dan layar tahu peta cuma satelit", () => {
    const s: SumberPeta = { ...LENGKAP, pmtiles: null };
    const gaya = gayaPeta(s, "satelit");
    expect(gaya.sources["dasar"]).toBeUndefined();
    expect(gaya.sources["satelit"]).toBeDefined();
    expect(modeTersedia(s)).toEqual(["satelit"]);
    expect(adaSumber(s)).toBe(true);
  });

  it("tanpa satelit: tidak ada lapisan satelit sama sekali", () => {
    const s: SumberPeta = { ...LENGKAP, satelit: null, satelitAtribusi: null };
    const gaya = gayaPeta(s);
    expect(gaya.layers.some((l) => l.id === LAPIS_SATELIT)).toBe(false);
    expect(modeTersedia(s)).toEqual(["peta"]);
  });

  it("tanpa keduanya: gaya kosong DAN dinyatakan kosong – bukan kanvas abu-abu diam", () => {
    const s: SumberPeta = { pmtiles: null, satelit: null, satelitAtribusi: null };
    const gaya = gayaPeta(s);
    expect(gaya.layers).toHaveLength(0);
    expect(Object.keys(gaya.sources)).toHaveLength(0);
    expect(adaSumber(s)).toBe(false);
    expect(modeTersedia(s)).toEqual([]);
  });
});

describe("ganti mode", () => {
  it("kedua lapisan SELALU ada di gaya; yang berubah cuma yang terlihat", () => {
    const peta = gayaPeta(LENGKAP, "peta");
    const satelit = gayaPeta(LENGKAP, "satelit");
    // Jumlah lapisan identik: mode tidak menambah/mengurangi, hanya
    // menyembunyikan — itu yang membuat peralihan tidak memuat ulang peta dan
    // tidak melempar orang kembali ke tampilan awal.
    expect(satelit.layers.length).toBe(peta.layers.length);

    const lihat = (g: typeof peta, id: string) =>
      g.layers.find((l) => l.id === id)?.layout?.visibility;
    expect(lihat(peta, LAPIS_SATELIT)).toBe("none");
    expect(lihat(satelit, LAPIS_SATELIT)).toBe("visible");

    const idDasar = peta.layers.find((l) => l.id !== LAPIS_SATELIT)!.id;
    expect(lihat(peta, idDasar)).toBe("visible");
    expect(lihat(satelit, idDasar)).toBe("none");
  });

  it("satelit berada DI BAWAH peta dasar – citra adalah latar, bukan penutup", () => {
    const gaya = gayaPeta(LENGKAP);
    expect(gaya.layers[0]!.id).toBe(LAPIS_SATELIT);
  });
});

describe("huruf peta", () => {
  it("glyphs & sprite terisi – tanpa keduanya label vektor tidak bisa digambar", () => {
    const gaya = gayaPeta(LENGKAP);
    expect(gaya.glyphs).toContain("{fontstack}");
    expect(gaya.sprite).toBeTruthy();
  });
});

describe("penanda mematikan peta", () => {
  /*
   * Teguran user 2026-09-06: *"kenapa di dev dengan app_env test map gak
   * muncul!"* — versi pertama mematikan peta berdasarkan `APP_ENV === "test"`,
   * padahal APP_ENV menandai LINGKUNGAN, bukan "sedang menjalankan uji", dan
   * lingkungan dev memakai nilai yang sama. Akibatnya peta mati justru di
   * tempat yang dipakai orang untuk memeriksa apakah petanya bekerja.
   *
   * Uji ini menjaga BATAS penandanya: hanya `PETA_MATI` yang boleh mematikan
   * peta, dan tidak ada satu pun tempat di kode peta yang membaca APP_ENV.
   */
  it("kode peta tidak pernah membaca APP_ENV", async () => {
    const { readFileSync } = await import("node:fs");
    for (const berkas of ["src/lib/peta/sumber.ts", "src/lib/peta/gaya.ts"]) {
      const isi = readFileSync(new URL(`../../${berkas}`, import.meta.url), "utf8");
      // Boleh disebut di komentar (sejarahnya penting), tidak boleh dibaca.
      expect(isi, berkas).not.toContain("env.APP_ENV");
    }
  });

  it("penandanya khusus dan hanya diset job E2E di CI", async () => {
    const { readFileSync } = await import("node:fs");
    const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(ci).toContain('PETA_MATI: "1"');
    // Hanya SATU tempat — kalau ia menyebar ke job atau lingkungan lain,
    // petanya akan mati lagi di tempat yang tidak diduga.
    expect(ci.match(/PETA_MATI/g)?.length).toBe(2); // komentar + nilainya
  });
});
