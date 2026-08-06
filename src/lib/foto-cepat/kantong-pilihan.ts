/**
 * ATURAN PILIHAN DI KANTONG FOTO CEPAT — modul murni.
 *
 * Dipisah dari komponen karena dua keluhan user 2026-08-06 keduanya berupa
 * ATURAN, bukan gaya:
 *
 * 1. *"satu foto diklik tidak terjadi apa-apa."* Penyebabnya bukan ketukan yang
 *    meleset: foto yang lokasinya belum ketahuan dulu dirender sebagai gambar
 *    mati di panel penetapan lokasi, sedangkan yang jadi tombol hanya foto yang
 *    lokasinya sudah terdeteksi. Di lapangan, geotag gagal adalah keadaan yang
 *    LAZIM — jadi bagi banyak pelapor tidak ada satu pun foto yang bisa
 *    dipilih, dan layarnya tidak menjelaskan apa pun.
 *
 * 2. *"terlalu memaksakan untuk beberapa foto yang diambil diberi tag lokasi
 *    yang sama."* Penetapan lokasi dulu memborong SELURUH foto tanpa lokasi
 *    dengan satu Combobox. Satu perjalanan lapangan lazim melewati beberapa
 *    desa, jadi memaksa satu jawaban untuk semuanya membuat penetapan yang
 *    benar mustahil — yang tersisa cuma memilih mana yang salah.
 *
 * Keduanya cacat SENYAP terhadap uji: fotonya tersimpan, kantongnya terisi,
 * tombolnya ada. Yang salah adalah foto MANA yang bisa disentuh dan foto mana
 * yang ikut terbawa saat satu jawaban diberikan. Karena itu aturannya ditulis
 * di sini dan diuji langsung, bukan disimpulkan dari markup.
 */

/**
 * Satu foto di kantong — foto yang BELUM punya induk (laporan/kegiatan).
 *
 * Tipe & label ini tinggal di modul murni, bukan di `queries.ts`, semata-mata
 * supaya aturan pilihan bisa diuji tanpa menyeret koneksi database ikut
 * dimuat. `queries.ts` mengekspor ulang keduanya, jadi pemanggil lama tidak
 * perlu tahu perpindahan ini.
 */
export type FotoKantong = {
  id: string;
  thumbUrl?: string;
  fullUrl?: string;
  takenAtIso: string;
  waktuLabel: string;
  locationId: string | null;
  locationName: string;
  /** Koordinat NYATA foto (perangkat saat jepret / EXIF). null = tidak ada. */
  lat: number | null;
  lng: number | null;
  /** true = koordinatnya bukti alat (exif/device), bukan cadangan/ketikan. */
  gpsAsli: boolean;
  reporterName: string;
  /** Arsip berkas asli ada → cap masih bisa dilengkapi saat foto dipakai. */
  bisaDilengkapi: boolean;
};

/** Nama rak untuk foto yang lokasinya belum ketahuan. */
export const LABEL_TANPA_LOKASI = "Belum ketahuan lokasinya";

export type KelompokKantong = {
  /** Nama tampil kelompok — nama lokasi, atau label "belum ketahuan". */
  nama: string;
  fotos: FotoKantong[];
  /** true untuk kelompok foto yang lokasinya belum ketahuan. */
  tanpaLokasi: boolean;
};

/**
 * Kelompokkan isi kantong untuk ditampilkan.
 *
 * Yang belum ketahuan lokasinya SELALU di depan: itu satu-satunya kelompok yang
 * menghalangi foto dipakai, dan menyelipkannya di tengah daftar berarti ia tidak
 * akan pernah dikerjakan. Urutan lokasi lainnya mengikuti urutan kemunculan —
 * kantong sudah diurutkan terbaru dulu di query, jadi lokasi yang baru dipotret
 * muncul lebih dulu.
 */
export function kelompokkanKantong(kantong: FotoKantong[]): KelompokKantong[] {
  const belum = kantong.filter((f) => f.locationId == null);
  const m = new Map<string, FotoKantong[]>();
  for (const f of kantong) {
    if (f.locationId == null) continue;
    const k = f.locationName;
    (m.get(k) ?? m.set(k, []).get(k)!).push(f);
  }
  const berlokasi = [...m.entries()].map(([nama, fotos]) => ({ nama, fotos, tanpaLokasi: false }));
  return belum.length > 0
    ? [{ nama: LABEL_TANPA_LOKASI, fotos: belum, tanpaLokasi: true }, ...berlokasi]
    : berlokasi;
}

export type TindakanKantong =
  /** Belum ada yang dipilih — tidak ada tindakan yang bisa ditawarkan. */
  | { jenis: "kosong" }
  /**
   * Ada foto terpilih yang lokasinya belum ketahuan. Itu harus dibereskan
   * lebih dulu, dan HANYA untuk foto yang dipilih — `diabaikan` menghitung foto
   * terpilih lain yang sudah berlokasi supaya UI bisa mengatakannya, bukan
   * diam-diam melewatinya.
   */
  | { jenis: "tetapkan"; fotos: FotoKantong[]; diabaikan: number }
  /** Semua terpilih sudah berlokasi, tapi lebih dari satu lokasi. */
  | { jenis: "campur_lokasi"; locationIds: string[] }
  /** Siap dipakai: satu lokasi, semua sudah berlokasi. */
  | { jenis: "pakai"; locationId: string; photoIds: string[] };

/**
 * Tentukan tindakan dari apa yang sedang dipilih.
 *
 * `terpilih` boleh memuat id yang sudah tidak ada di kantong (foto baru dipakai
 * atau dibuang di tab lain) — id semacam itu diabaikan, bukan dihitung. Kalau
 * tidak, tombolnya menjanjikan "Pakai 5 foto" padahal 3 di antaranya sudah
 * pindah, dan server menolak sebagian tanpa pelapor tahu foto mana.
 */
export function tindakanKantong(
  kantong: FotoKantong[],
  terpilih: ReadonlySet<string>,
): TindakanKantong {
  const dipilih = kantong.filter((f) => terpilih.has(f.id));
  if (dipilih.length === 0) return { jenis: "kosong" };

  const tanpaLokasi = dipilih.filter((f) => f.locationId == null);
  const berlokasi = dipilih.filter((f) => f.locationId != null);

  // Penetapan lokasi didahulukan: foto tanpa lokasi tidak boleh ditetapkan
  // diam-diam lewat penautan ke laporan (DECISIONS 254), jadi selama ada yang
  // begitu di pilihan, "pakai" bukan tindakan yang sah.
  if (tanpaLokasi.length > 0)
    return { jenis: "tetapkan", fotos: tanpaLokasi, diabaikan: berlokasi.length };

  const locationIds = [...new Set(berlokasi.map((f) => f.locationId as string))];
  if (locationIds.length > 1) return { jenis: "campur_lokasi", locationIds };
  return { jenis: "pakai", locationId: locationIds[0], photoIds: berlokasi.map((f) => f.id) };
}

/** Buang id yang sudah tidak ada di kantong; kembalikan set semula bila utuh. */
export function pangkasPilihan(
  kantong: FotoKantong[],
  terpilih: ReadonlySet<string>,
): ReadonlySet<string> {
  if (terpilih.size === 0) return terpilih;
  const ada = new Set(kantong.map((f) => f.id));
  const sisa = new Set([...terpilih].filter((id) => ada.has(id)));
  return sisa.size === terpilih.size ? terpilih : sisa;
}
