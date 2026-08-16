/**
 * Pengelompokan pemetaan RAB → AHSP untuk DILIHAT ORANG. MURNI. DECISIONS 326.
 *
 * ### Kenapa per URAIAN, bukan per baris RAB
 *
 * Keputusannya memang per uraian: satu uraian yang muncul di 12 baris RAB adalah
 * SATU pilihan, bukan 12 — dan karena kunci padanan bersifat global (DECISIONS
 * 319), pilihan itu bahkan berlaku di lokasi lain. Menampilkan per baris
 * menyodorkan 1.616 baris untuk 480 keputusan: 3,4 kali lebih banyak dari yang
 * benar-benar perlu diputuskan, dengan uraian yang sama berulang-ulang.
 *
 * Yang HILANG kalau digabung — berapa baris dan berapa rupiah yang bergantung
 * pada satu keputusan — justru dikembalikan sebagai kolom, dan dipakai
 * mengurutkan: yang paling mahal dikerjakan lebih dulu.
 */

export type KeadaanUraian =
  | "belum"
  | "usulan"
  | "disetujui"
  | "koreksi"
  | "tidak_ada"
  | "putus";

/** Bentuk masukan — sengaja seminimal mungkin supaya bisa diuji tanpa db. */
export type BarisUntukKelompok = {
  code: string;
  uraian: string;
  unit: string | null;
  volume: number | null;
  amount: bigint;
  tanda: string;
  keadaan: KeadaanUraian;
  skor: number | null;
  meyakinkan: boolean;
  catatan: string | null;
  petunjuk: string | null;
  ahsp: {
    id: string;
    kode: string;
    uraian: string;
    satuan: string;
    jumlahKomponen: number;
    perluVerifikasi: boolean;
  } | null;
};

export type BarisUraian = {
  tanda: string;
  /** Uraian apa adanya dari baris RAB pertama yang memakainya. */
  uraian: string;
  unit: string | null;
  /** Kode RAB pertama — untuk ditelusuri balik ke dokumennya. */
  kodeContoh: string;
  /** Berapa baris RAB memakai uraian ini di lokasi yang sedang dibuka. */
  jumlahBaris: number;
  /** Jumlah volume seluruh baris itu; null bila ada yang tidak bervolume. */
  volume: number | null;
  /** Nilai rupiah seluruh baris itu — inilah yang menentukan urutan kerja. */
  nilai: bigint;
  keadaan: KeadaanUraian;
  skor: number | null;
  meyakinkan: boolean;
  catatan: string | null;
  petunjuk: string | null;
  ahsp: BarisUntukKelompok["ahsp"];
};

/**
 * Gabungkan baris RAB jadi satu baris per uraian.
 *
 * Diurut dari NILAI TERBESAR: daftar pekerjaan yang berguna dimulai dari yang
 * paling menentukan uang, bukan dari yang kebetulan paling atas di dokumen.
 */
export function kelompokkanPerUraian(baris: BarisUntukKelompok[]): BarisUraian[] {
  const peta = new Map<string, BarisUraian>();
  for (const b of baris) {
    const ada = peta.get(b.tanda);
    if (!ada) {
      peta.set(b.tanda, {
        tanda: b.tanda,
        uraian: b.uraian,
        unit: b.unit,
        kodeContoh: b.code,
        jumlahBaris: 1,
        volume: b.volume,
        nilai: b.amount,
        keadaan: b.keadaan,
        skor: b.skor,
        meyakinkan: b.meyakinkan,
        catatan: b.catatan,
        petunjuk: b.petunjuk,
        ahsp: b.ahsp,
      });
      continue;
    }
    ada.jumlahBaris += 1;
    ada.nilai += b.amount;
    // Volume dijumlahkan HANYA bila semua barisnya bervolume. Satu baris tanpa
    // volume membuat jumlahnya tidak lagi berarti, dan angka yang tidak berarti
    // lebih buruk daripada kolom kosong.
    ada.volume = ada.volume === null || b.volume === null ? null : ada.volume + b.volume;
  }
  return [...peta.values()].sort(
    (a, b) => Number(b.nilai - a.nilai) || a.uraian.localeCompare(b.uraian, "id"),
  );
}

export type Tahap = "petakan" | "setujui" | "kebutuhan" | "harga";

export type KemajuanTahap = {
  tahap: Tahap;
  judul: string;
  /** Berapa uraian yang MENUNGGU dikerjakan pada tahap ini. */
  sisa: number;
  /** Berapa uraian yang sudah lewat tahap ini. */
  selesai: number;
  /** Nilai rupiah yang masih menunggu di tahap ini. */
  nilaiSisa: bigint;
  /** true = tahap ini yang sedang perlu dikerjakan. */
  aktif: boolean;
  /** Kalimat pendek: apa yang harus dilakukan sekarang. */
  ajakan: string;
};

/**
 * Hitung kemajuan per tahap dari daftar uraian.
 *
 * Tahap AKTIF adalah tahap terawal yang masih punya sisa — bukan tahap yang
 * kebetulan dibuka. Orang yang membuka halaman ini seharusnya langsung melihat
 * satu pekerjaan yang jelas, bukan empat tabel dan harus menebak mulai dari mana.
 */
export function hitungTahap(uraian: BarisUraian[]): KemajuanTahap[] {
  const belumDipetakan = uraian.filter((u) => u.keadaan === "belum" || u.keadaan === "putus");
  const menunggu = uraian.filter((u) => u.keadaan === "usulan");
  const diputuskan = uraian.filter(
    (u) => u.keadaan === "disetujui" || u.keadaan === "koreksi" || u.keadaan === "tidak_ada",
  );
  const terpakai = uraian.filter((u) => u.keadaan === "disetujui" || u.keadaan === "koreksi");
  const nilai = (d: BarisUraian[]) => d.reduce((a, b) => a + b.nilai, 0n);

  const tahapan: Omit<KemajuanTahap, "aktif">[] = [
    {
      tahap: "petakan",
      judul: "Petakan",
      sisa: belumDipetakan.length,
      selesai: uraian.length - belumDipetakan.length,
      nilaiSisa: nilai(belumDipetakan),
      ajakan:
        belumDipetakan.length > 0
          ? "Cari padanan AHSP untuk uraian yang belum punya."
          : "Semua uraian sudah dicarikan padanannya.",
    },
    {
      tahap: "setujui",
      judul: "Setujui",
      sisa: menunggu.length,
      selesai: diputuskan.length,
      nilaiSisa: nilai(menunggu),
      ajakan:
        menunggu.length > 0
          ? "Periksa usulan mesin, lalu setujui atau ganti."
          : "Tidak ada usulan yang menunggu.",
    },
    {
      tahap: "kebutuhan",
      judul: "Kebutuhan",
      sisa: 0,
      selesai: terpakai.length,
      nilaiSisa: 0n,
      ajakan:
        terpakai.length > 0
          ? "Lihat kebutuhan bahan/upah/alat, atau unduh Excel-nya."
          : "Belum ada padanan disetujui, jadi belum ada kebutuhan yang bisa dihitung.",
    },
    {
      tahap: "harga",
      judul: "Harga",
      sisa: 0,
      selesai: 0,
      nilaiSisa: 0n,
      ajakan: "Belum dikerjakan — harga satuan dasar per lokasi adalah langkah berikutnya.",
    },
  ];

  // Tahap aktif = yang paling awal dan masih bersisa. Kalau dua tahap pertama
  // sudah bersih, yang aktif adalah "kebutuhan".
  const pertamaBersisa = tahapan.findIndex((t) => t.sisa > 0);
  const indeksAktif = pertamaBersisa >= 0 ? pertamaBersisa : 2;
  return tahapan.map((t, i) => ({ ...t, aktif: i === indeksAktif }));
}
