import { gridEndFrac } from "./generate";

/**
 * PROFIL KURVA-S — bentuk bawaan "awal lambat" (permintaan user 2026-09-19).
 *
 * Berkas MURNI: tanpa basis data, tanpa "server-only". Dipakai generator
 * baseline, layar pilihan sesudah impor RAB, dan unit test.
 *
 * ### Kenapa awal harus lambat
 *
 * *"dalam 3 minggu, bahkan kalau bisa 4 minggu pertama, itu banyak tidak ada
 * kegiatan karena persiapan dan bisa jadi di lapangan lahan bermasalah, jadi
 * sebisa mungkin 1-6 minggu di awal sangat lambat."*
 *
 * Penjadwal berbasis urutan pekerjaan (`sequencing.ts`) menaruh persiapan dan
 * pekerjaan tanah di minggu-minggu pertama, lalu kurvanya naik sejak minggu
 * satu. Secara metode itu benar — dan di produksi ia menghasilkan deviasi
 * negatif pada minggu-minggu yang di lapangan memang belum bisa dikerjakan.
 * Rencana yang mustahil ditepati bukan rencana; ia cuma alarm yang berbunyi
 * terus sampai orang berhenti mendengarkannya.
 *
 * ### Rasio yang dipakai
 *
 * `ANCHOR_LAMBAT` adalah RASIO, bukan daftar minggu. Ia diberikan user sebagai
 * 15 angka; jumlah minggu kontrak yang sesungguhnya bisa berapa pun. Karena itu
 * ia diperlakukan sebagai BENTUK yang dibaca pada fraksi waktu berjalan:
 * titik ke-i berlaku pada t = (i+1)/15, dan t = 0 bernilai 0%. Kurva minggu ke-k
 * dibaca pada fraksi akhir minggu itu — jadi grid minggu tak seragam (M1 pendek
 * pada mode Senin–Minggu, DECISIONS 427b) otomatis ikut terhormati: M1 dua hari
 * menanggung porsi lebih kecil daripada M1 tujuh hari, tanpa aturan kedua.
 *
 * Pada kontrak 15 minggu ia mereproduksi daftar user persis. Pada kontrak lebih
 * panjang, minggu-minggu awal justru LEBIH landai lagi — yang memang diminta.
 */

/** Rasio kumulatif % dari user, dibaca sebagai bentuk (lihat docblock). */
export const ANCHOR_LAMBAT: readonly number[] = [
  1, 3, 6, 11, 18, 28, 40, 54, 68, 80, 89, 94, 97, 99, 100,
] as const;

export const PROFIL_KURVA = ["lambat", "optimal", "manual"] as const;
export type ProfilKurva = (typeof PROFIL_KURVA)[number];
export const PROFIL_KURVA_DEFAULT: ProfilKurva = "lambat";

export const PROFIL_KURVA_LABEL: Record<ProfilKurva, string> = {
  lambat: "Awal lambat (bawaan)",
  optimal: "Optimalisasi pekerjaan",
  manual: "Saya susun sendiri",
};

export const PROFIL_KURVA_KETERANGAN: Record<ProfilKurva, string> = {
  lambat:
    "Persiapan dan urusan lahan sering memakan 3–4 minggu pertama, jadi kurva sengaja landai di awal lalu mengejar di tengah.",
  optimal:
    "Dijadwalkan dari urutan pekerjaan dan bobot biaya tiap kategori – naik sejak minggu pertama. Pilih bila lahan sudah siap dan pekerjaan benar-benar bisa langsung jalan.",
  manual:
    "Tidak membuat kurva-S sekarang. Susun sendiri di tab Kurva-S, atau impor jadwal dari Excel dan dipakai apa adanya.",
};

/** Kunci apa pun → profil yang dikenal; yang tak dikenal jatuh ke bawaan. */
export function profilKurva(key: string | null | undefined): ProfilKurva {
  return key && (PROFIL_KURVA as readonly string[]).includes(key)
    ? (key as ProfilKurva)
    : PROFIL_KURVA_DEFAULT;
}

/** Nilai profil pada fraksi waktu berjalan `t` (0..1), interpolasi linear. */
function nilaiPada(t: number): number {
  const n = ANCHOR_LAMBAT.length;
  if (t <= 0) return 0;
  if (t >= 1) return 100;
  const x = t * n;
  const i = Math.min(n - 1, Math.floor(x));
  const frac = x - i;
  const bawah = i === 0 ? 0 : ANCHOR_LAMBAT[i - 1];
  const atas = ANCHOR_LAMBAT[i];
  return bawah + (atas - bawah) * frac;
}

/**
 * Deret kumulatif % profil lambat untuk minggu 1..totalWeeks.
 *
 * `weekEndFracs` = fraksi hari berjalan pada akhir tiap minggu (grid tak
 * seragam). Minggu terakhir DIPAKSA 100 supaya penjaga `validateBaselinePoints`
 * tidak bergantung pada pembulatan.
 */
export function kurvaProfilLambat(totalWeeks: number, weekEndFracs?: number[] | null): number[] {
  const n = Math.max(1, Math.floor(totalWeeks));
  const out: number[] = [];
  for (let week = 1; week <= n; week++) {
    const t = gridEndFrac(week, n, weekEndFracs);
    out.push(Math.round(nilaiPada(t) * 100) / 100);
  }
  out[n - 1] = 100;
  // Pembulatan bisa membuat minggu sebelum terakhir melewati 100 pada kontrak
  // satu-dua minggu; kurva tidak boleh turun.
  for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1]);
  return out;
}

/**
 * Warp jadwal per kategori supaya AGREGATNYA mengikuti `target`, tanpa
 * mengubah bobot satu pun kategori dan tanpa mengacak urutan lapangan.
 *
 * Caranya memundurkan JAM, bukan menimpa angka: kurva agregat asli
 * `A(u)` (kontinu, linear antar-minggu) dicari titik `u` tempat ia bernilai
 * `target[k]`, lalu SETIAP kategori dibaca pada `u` yang sama. Karena
 * Σ kategori pada `u` menurut definisi = `A(u)` = `target[k]`, agregatnya
 * menjadi persis profil yang diminta — sementara tiap kategori tetap membawa
 * bobot penuhnya dan tetap selesai dalam urutan semula.
 *
 * Alternatif yang DITOLAK: menimpa deret agregat saja dan membiarkan matriks
 * kategori apa adanya. Itu memecah jaminan "grafik == tabel KKP == deviasi"
 * (DECISIONS 103) — satu dokumen dengan dua rencana di dalamnya.
 *
 * @param weeklyRows increment % per minggu per kategori (panjang sama semua)
 * @param target     kumulatif % yang dikehendaki, panjang = jumlah minggu
 */
export function warpKeProfil(weeklyRows: number[][], target: number[]): number[][] {
  if (weeklyRows.length === 0) return [];
  const n = target.length;

  // Kumulatif tiap kategori pada batas minggu 0..n (indeks 0 = sebelum mulai).
  const kum = weeklyRows.map((row) => {
    const c = new Array<number>(n + 1).fill(0);
    for (let k = 1; k <= n; k++) c[k] = c[k - 1] + (row[k - 1] ?? 0);
    return c;
  });
  const agg = new Array<number>(n + 1).fill(0);
  for (const c of kum) for (let k = 0; k <= n; k++) agg[k] += c[k];

  /** Titik waktu kontinu u (0..n) tempat agregat asli bernilai `nilai`. */
  const waktuSaat = (nilai: number): number => {
    if (nilai <= 0) return 0;
    if (nilai >= agg[n]) return n;
    for (let k = 1; k <= n; k++) {
      if (agg[k] >= nilai) {
        const naik = agg[k] - agg[k - 1];
        // Minggu datar: ambil tepi paling AWAL supaya pekerjaan tidak digeser
        // mundur tanpa sebab.
        return naik <= 1e-12 ? k - 1 : k - 1 + (nilai - agg[k - 1]) / naik;
      }
    }
    return n;
  };

  /** Kumulatif satu kategori pada waktu kontinu u. */
  const bacaPada = (c: number[], u: number): number => {
    const k = Math.floor(u);
    if (k >= n) return c[n];
    return c[k] + (c[k + 1] - c[k]) * (u - k);
  };

  const u = target.map(waktuSaat);
  return kum.map((c) => {
    const baris: number[] = [];
    let sebelum = 0;
    for (let k = 0; k < n; k++) {
      const kini = bacaPada(c, u[k]);
      baris.push(Math.max(0, kini - sebelum));
      sebelum = kini;
    }
    return baris;
  });
}
