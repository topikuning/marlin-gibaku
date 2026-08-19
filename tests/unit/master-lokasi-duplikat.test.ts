import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const { cariDuplikat, statusKatalog, tanpaKoordinat } = await import(
  "../../src/lib/master-location/queries"
);

/**
 * DUA ATURAN yang diminta user 2026-08-19 saat katalog lokasi mendapat jalur
 * "Tambah Lokasi" manual (DECISIONS 368):
 *
 *  1. Koordinat boleh kosong — lokasinya tetap tersimpan, tapi berstatus
 *     "Perlu verifikasi".
 *  2. Sebelum menyimpan, sistem memeriksa duplikasi berdasarkan kombinasi
 *     wilayah, supaya tidak lahir lokasi ganda.
 *
 * Yang bikin aturan kedua tidak sepele: indeks unik basis data sudah ada, tapi
 * ia hanya menangkap yang hurufnya PERSIS sama. Lokasi ganda yang benar-benar
 * terjadi lahir dari ejaan yang berbeda tipis — "Kedungmutih" vs "Kedung
 * Mutih", kasus nyata di data ini — dan itu lolos indeks dengan mulus.
 */

const K = (id: string, province: string, regency: string, district: string | null, village: string) => ({
  id,
  province,
  regency,
  district,
  village,
});

const L = (
  id: string,
  name: string,
  province: string,
  regency: string,
  district: string | null,
  village: string,
) => ({ id, name, province, regency, district, village });

const KATALOG = [
  K("k1", "Jawa Tengah", "Demak", "Bonang", "Betahwalang"),
  K("k2", "Jawa Tengah", "Demak", "Wedung", "Kedungmutih"),
  K("k3", "Jawa Timur", "Bangkalan", "Sepulu", "Tanjung Bumi"),
];

describe("pencegahan lokasi ganda saat menambah manual", () => {
  it("kombinasi wilayah yang sama persis dikenali sebagai duplikat", () => {
    const hasil = cariDuplikat(
      { province: "Jawa Tengah", regency: "Demak", district: "Bonang", village: "Betahwalang" },
      KATALOG,
      [],
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].id).toBe("k1");
    expect(hasil[0].kemiripan).toBe("persis");
  });

  it("beda huruf besar-kecil dan spasi berlebih tetap 'persis'", () => {
    // Orang mengetik apa adanya; pembandingnya yang harus tahan.
    const hasil = cariDuplikat(
      { province: "JAWA TENGAH", regency: " Demak ", district: "bonang", village: "Betahwalang" },
      KATALOG,
      [],
    );
    expect(hasil[0]?.kemiripan).toBe("persis");
  });

  it("EJAAN berbeda tertangkap sebagai 'mirip' — inilah yang lolos indeks unik", () => {
    /*
     * "Kedung Mutih" vs "Kedungmutih": indeks unik menerimanya sebagai baris
     * baru, dan sejak itu satu desa punya dua entri. Angkanya terpecah dua dan
     * tidak ada yang menyadarinya sampai berbulan-bulan kemudian.
     */
    const hasil = cariDuplikat(
      { province: "Jawa Tengah", regency: "Demak", district: "Wedung", village: "Kedung Mutih" },
      KATALOG,
      [],
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].id).toBe("k2");
    expect(hasil[0].kemiripan).toBe("mirip");
  });

  it("kecamatan kosong di salah satu sisi tetap dianggap mungkin sama", () => {
    // Kecamatan kolom opsional dan sering tidak diisi. Menuntutnya sama persis
    // membuat penjaga ini tidak pernah berbunyi justru saat paling dibutuhkan.
    const hasil = cariDuplikat(
      { province: "Jawa Tengah", regency: "Demak", district: null, village: "Betahwalang" },
      KATALOG,
      [],
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].kemiripan).toBe("mirip");
  });

  it("desa senama di KECAMATAN BERBEDA bukan duplikat", () => {
    // Ini data yang benar, dan melarangnya berarti melarang kenyataan.
    const katalog = [K("k1", "Jawa Tengah", "Demak", "Bonang", "Sidorejo")];
    const hasil = cariDuplikat(
      { province: "Jawa Tengah", regency: "Demak", district: "Wedung", village: "Sidorejo" },
      katalog,
      [],
    );
    expect(hasil).toEqual([]);
  });

  it("desa senama di KABUPATEN BERBEDA bukan duplikat", () => {
    const hasil = cariDuplikat(
      { province: "Jawa Tengah", regency: "Jepara", district: "Bonang", village: "Betahwalang" },
      KATALOG,
      [],
    );
    expect(hasil).toEqual([]);
  });

  it("lokasi yang SUDAH jadi proyek ikut diperiksa, bukan cuma katalog", () => {
    /*
     * Bentuk lokasi ganda yang paling merepotkan: desanya sudah berjalan
     * sebagai proyek, lalu seseorang menambahkannya lagi ke katalog. Dua-duanya
     * hidup, dan angkanya terpisah.
     */
    const riil = [L("r1", "Kedung Mutih", "Jawa Tengah", "Demak", "Wedung", "Kedung Mutih")];
    const hasil = cariDuplikat(
      { province: "Jawa Tengah", regency: "Demak", district: "Wedung", village: "Kedung Mutih" },
      [],
      riil,
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].sumber).toBe("lokasi");
    expect(hasil[0].nama).toBe("Kedung Mutih");
  });

  it("yang 'persis' selalu di atas — ia yang menentukan boleh-tidaknya menyimpan", () => {
    // Tombol "tetap simpan sebagai baru" hanya muncul kalau TIDAK ada yang
    // persis; kalau yang persis tenggelam di bawah daftar, keputusannya salah.
    const katalog = [
      K("mirip", "Jawa Tengah", "Demak", null, "Kedungmutih"),
      K("persis", "Jawa Tengah", "Demak", "Wedung", "Kedung Mutih"),
    ];
    const hasil = cariDuplikat(
      { province: "Jawa Tengah", regency: "Demak", district: "Wedung", village: "Kedung Mutih" },
      katalog,
      [],
    );
    expect(hasil.map((h) => h.kemiripan)).toEqual(["persis", "mirip"]);
  });

  it("katalog kosong tidak menghalangi apa pun", () => {
    expect(
      cariDuplikat({ province: "Bali", regency: "Buleleng", district: null, village: "Sumberkima" }, [], []),
    ).toEqual([]);
  });
});

describe("status katalog turunan", () => {
  const koordinat = { latitude: "-6.815", longitude: "110.627" };
  const tanpa = { latitude: null, longitude: null };

  it("koordinat kosong → Perlu verifikasi, BUKAN ditolak", () => {
    // Permintaan user: lokasi tetap bisa disimpan, tapi ditandai.
    expect(statusKatalog({ assignedLocationId: null, ...tanpa }, false)).toBe("perlu_verifikasi");
  });

  it("koordinat lengkap dan belum dipakai → Tersedia", () => {
    expect(statusKatalog({ assignedLocationId: null, ...koordinat }, false)).toBe("tersedia");
  });

  it("sudah ada sebagai lokasi riil mengalahkan 'perlu verifikasi'", () => {
    // Baris ini tidak menunggu koordinat — ia sudah tidak bisa dipakai lagi
    // untuk membuat proyek baru, dan itulah kabar yang berguna.
    expect(statusKatalog({ assignedLocationId: null, ...tanpa }, true)).toBe("sudah_ada");
  });

  it("sudah terpakai mengalahkan semuanya", () => {
    expect(statusKatalog({ assignedLocationId: "loc-1", ...tanpa }, true)).toBe("terpakai");
  });

  it("setengah koordinat dihitung TIDAK berkoordinat", () => {
    // Lintang tanpa bujur tidak menunjuk tempat mana pun; kalau ia dianggap
    // terisi, barisnya lolos dari daftar yang perlu diperbaiki.
    expect(tanpaKoordinat({ latitude: "-6.815", longitude: null })).toBe(true);
    expect(tanpaKoordinat({ latitude: null, longitude: "110.627" })).toBe(true);
    expect(tanpaKoordinat(koordinat)).toBe(false);
  });
});
