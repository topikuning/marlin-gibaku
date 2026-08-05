import { jarakMeter, type LokasiBerkoordinat } from "./jarak";

/**
 * DETEKSI LOKASI DARI GEOTAG FOTO (DECISIONS 254).
 *
 * Permintaan user: *"bahkan tidak perlu input lokasi. kalau bisa kamu deteksi
 * lokasi berdasarkan geotagnya."* Betul — koordinat foto sudah menjawab
 * pertanyaan "ini di mana", jadi menyuruh pelapor menjawabnya lagi itu kerja
 * dobel di tempat yang paling tidak nyaman untuk mengetik.
 *
 * TAPI DETEKSI YANG SALAH LEBIH BURUK DARIPADA TIDAK ADA DETEKSI. Foto yang
 * masuk ke desa sebelah tidak menerbitkan galat apa pun; ia baru ketahuan
 * berminggu-minggu kemudian saat laporan KKP disusun — kalau ketahuan.
 *
 * ### Ambangnya diukur, bukan ditebak
 *
 * 73 lokasi KNMP berkoordinat (katalog master, 2026-08-05):
 *
 * | ukuran | jarak ke tetangga terdekat |
 * |---|---|
 * | pasangan paling berdekatan | **474 m** (Kedungmalang Jepara ↔ Kedungmutih Demak) |
 * | persentil 5 | 912 m |
 * | persentil 25 | 3,4 km |
 * | median | 6,7 km |
 *
 * Artinya ambang JARAK TETAP tidak akan pernah cukup: 2 km terlalu longgar untuk
 * pasangan 474 m, sementara 300 m terlalu ketat untuk lokasi yang titik
 * proyeknya dipasang di ujung desa. Karena itu aturannya RELATIF — yang
 * diputuskan bukan "cukup dekat?" melainkan "cukup JELAS lebih dekat daripada
 * kandidat berikutnya?".
 */

/**
 * Sejauh mana koordinat masih dianggap "di lokasi itu".
 *
 * Titik proyek dicatat setingkat desa, sedangkan area kerja KNMP hanya beberapa
 * ratus meter. 1 km memberi kelonggaran untuk titik yang dipasang di ujung area
 * tanpa menjangkau desa berikutnya (pasangan terdekat pun 474 m TERPISAH, bukan
 * bertumpuk).
 */
export const RADIUS_LOKASI_M = 1000;

/** Kandidat berikutnya harus sekian kali lebih jauh. */
export const RASIO_MINIMAL = 2;

/**
 * DAN sekian meter lebih jauh. Dua syarat sekaligus dengan sengaja: rasio saja
 * lolos pada angka kecil (30 m vs 70 m = 2,3× padahal selisihnya cuma 40 m,
 * masih di dalam galat GPS), sedangkan selisih saja lolos pada dua lokasi yang
 * sama-sama jauh.
 */
export const SELISIH_MINIMAL_M = 300;

export type KandidatLokasi<T extends LokasiBerkoordinat = LokasiBerkoordinat> = T & {
  jarakMeter: number;
};

export type HasilDeteksi<T extends LokasiBerkoordinat = LokasiBerkoordinat> =
  /** Yakin — satu lokasi jelas paling dekat. */
  | { status: "cocok"; lokasi: KandidatLokasi<T> }
  /** Foto tidak membawa koordinat sama sekali. */
  | { status: "tanpa_koordinat" }
  /** Ada koordinat, tapi tidak ada lokasi dalam radius. */
  | { status: "jauh"; terdekat: KandidatLokasi<T> | null }
  /** Dua lokasi sama-sama masuk akal — JANGAN menebak. */
  | { status: "ambigu"; kandidat: KandidatLokasi<T>[] };

/**
 * Tentukan lokasi dari koordinat foto.
 *
 * Yang dikembalikan bukan cuma jawabannya, melainkan ALASANNYA — supaya UI bisa
 * mengatakan "tidak terdeteksi KARENA apa", bukan sekadar gagal. Pelapor yang
 * tahu sebabnya ("terdekat Kranji 4,2 km") bisa langsung menilai apakah dia
 * memang belum sampai, atau titik proyeknya yang salah.
 */
export function deteksiLokasi<T extends LokasiBerkoordinat>(
  posisi: { lat: number; lng: number } | null,
  lokasi: T[],
): HasilDeteksi<T> {
  if (!posisi) return { status: "tanpa_koordinat" };

  const berjarak: KandidatLokasi<T>[] = lokasi
    .filter((l): l is T & { lat: number; lng: number } => l.lat != null && l.lng != null)
    .map((l) => ({ ...l, jarakMeter: Math.round(jarakMeter(posisi.lat, posisi.lng, l.lat, l.lng)) }))
    .sort((a, b) => a.jarakMeter - b.jarakMeter);

  if (berjarak.length === 0) return { status: "jauh", terdekat: null };

  const [pertama, kedua] = berjarak;
  if (pertama.jarakMeter > RADIUS_LOKASI_M) return { status: "jauh", terdekat: pertama };

  // Satu-satunya kandidat dalam radius → tidak ada yang bisa dikacaukan.
  if (!kedua) return { status: "cocok", lokasi: pertama };

  const cukupJelas =
    kedua.jarakMeter >= pertama.jarakMeter * RASIO_MINIMAL &&
    kedua.jarakMeter - pertama.jarakMeter >= SELISIH_MINIMAL_M;

  // Berdiri TEPAT di titik proyek: jarak 0 membuat rasio tak berarti (0 × 2 = 0),
  // jadi selisihnya sendiri yang menentukan — dan itu memang sudah cukup.
  const tepatDiTitik = pertama.jarakMeter === 0 && kedua.jarakMeter >= SELISIH_MINIMAL_M;

  if (cukupJelas || tepatDiTitik) return { status: "cocok", lokasi: pertama };
  return { status: "ambigu", kandidat: berjarak.slice(0, 3) };
}

/** Kalimat sebab-akibat untuk UI — satu tempat, supaya tidak beranak di banyak layar. */
export function alasanDeteksi(h: HasilDeteksi<LokasiBerkoordinat>): string | null {
  switch (h.status) {
    case "cocok":
      return null;
    case "tanpa_koordinat":
      return "foto tidak membawa koordinat";
    case "jauh":
      return h.terdekat
        ? `lokasi terdekat (${h.terdekat.name}) berjarak ${(h.terdekat.jarakMeter / 1000).toFixed(1)} km`
        : "belum ada lokasi yang punya titik proyek";
    case "ambigu":
      return `terlalu berdekatan dengan ${h.kandidat
        .slice(0, 2)
        .map((k) => `${k.name} (${k.jarakMeter} m)`)
        .join(" dan ")}`;
  }
}
