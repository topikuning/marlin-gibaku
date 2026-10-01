/**
 * TANGGAL & REALISASI DATA DEMO MENGIKUTI HARI SEED DIJALANKAN (DECISIONS 639).
 *
 * Permintaan user 2026-10-01: *"untuk implemen server dev baru, aku ingin
 * data2mu menyesuaikan tanggal deploy terbaru, jadi tidak semua proyek jadi
 * terlambat semua. hanya untuk data dummy server test/dev"*.
 *
 * Dua penyebabnya, keduanya di data seed, bukan di rumus:
 *  1. Tanggal SPMK/selesai di `seed-data/*.json` terpatok (Maret–November
 *     2026). Server yang di-seed sesudah tanggal-tanggal itu melihat proyek
 *     yang sudah lewat masa kontrak.
 *  2. Realisasi hampir nol di semua lokasi (hanya beberapa laporan Kedung
 *     Mutih), jadi lokasi mana pun yang rencananya sudah berjalan otomatis
 *     berdeviasi negatif – "terlambat" semua.
 *
 * Modul ini MURNI (tanpa DB) supaya bisa diuji; `demo.ts` yang memakainya.
 * Hanya dipakai seed – data produksi tidak pernah melewatinya.
 */

const DAY = 24 * 3600 * 1000;

/**
 * Hari yang menjadi "hari ini" bagi tanggal di `seed-data/*.json`. Pada
 * tanggal ini semua lokasi demo sedang berjalan (SPMK Maret–Mei, selesai
 * Juli–November) dengan sisa waktu yang beragam. Seed menggeser semua tanggal
 * sejauh jarak hari seed dari tanggal ini, jadi sebaran itu selalu terjaga.
 */
export const ACUAN_TANGGAL_SEED = "2026-06-15";

const tanggal = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Jumlah hari dari {@link ACUAN_TANGGAL_SEED} ke `hariIni` (tanggal UTC). */
export function hariGeserSeed(hariIni: Date): number {
  const kunci = hariIni.toISOString().slice(0, 10);
  return Math.round((tanggal(kunci).getTime() - tanggal(ACUAN_TANGGAL_SEED).getTime()) / DAY);
}

/** Geser tanggal ISO `YYYY-MM-DD` sejauh `hari`. */
export function geserTanggalIso(iso: string, hari: number): string {
  return new Date(tanggal(iso).getTime() + hari * DAY).toISOString().slice(0, 10);
}

/**
 * Deviasi sasaran (poin persen) per lokasi, berurutan menurut urutan lokasi di
 * seed. Sebaran yang sengaja tidak seragam – sebagian besar aman/di depan
 * rencana, sebagian terlambat ringan, dua kritis (< −10, ambang `dashboard.ts`)
 * – supaya setiap warna dan daftar di dasbor punya isi. Urutan lokasi =
 * slug alfabetis; indeks 4 = Kedung Mutih (lokasi demo utama akun SM/mandor)
 * sengaja positif.
 */
export const DEVIASI_SASARAN_PP = [1.5, -4, 3, 0.5, 2.5, -13, -2, 1, 4, -7, 0.8, 2, -15, 1.2, -3, 3.5] as const;

/** Realisasi sasaran (%) = rencana + deviasi sasaran, dibatasi 0–100. */
export function realisasiSasaranPct(rencanaPct: number, urutan: number): number {
  const dev = DEVIASI_SASARAN_PP[urutan % DEVIASI_SASARAN_PP.length];
  return Math.max(0, Math.min(100, rencanaPct + dev));
}

export type ItemDemo = { id: string; volume: number; amount: bigint };

/**
 * Volume per item sehingga Σ nilai terpasang ≈ `sasaran` (rupiah): item diisi
 * PENUH berurutan, item terakhir sebagian. Urutan item = urutan RAB, jadi
 * pekerjaan awal (persiapan, tanah) selesai lebih dulu – sama seperti
 * lapangan.
 */
export function volumeUntukSasaran(items: ItemDemo[], sasaran: bigint): { id: string; volume: number }[] {
  const hasil: { id: string; volume: number }[] = [];
  let sisa = sasaran;
  for (const it of items) {
    if (sisa <= 0n) break;
    if (it.volume <= 0 || it.amount <= 0n) continue;
    if (it.amount <= sisa) {
      hasil.push({ id: it.id, volume: it.volume });
      sisa -= it.amount;
    } else {
      // Volume Decimal(15,3): dibulatkan ke bawah supaya tidak melampaui sasaran.
      const volume = Math.floor(((it.volume * Number(sisa)) / Number(it.amount)) * 1000) / 1000;
      if (volume > 0) hasil.push({ id: it.id, volume });
      sisa = 0n;
    }
  }
  return hasil;
}
