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
 * Porsi tiap item yang diisi seed, bertahap: semua item lebih dulu sampai 60%,
 * lalu – bila sasaran belum tercapai – sampai 95%. Tidak pernah 100%, supaya
 * setiap item masih punya sisa volume: laporan baru (oleh user maupun uji E2E)
 * tetap bisa menambah progres di item mana pun. Dua tahap, bukan satu batas:
 * batas 60% saja membuat realisasi lokasi tidak pernah melewati 60%, dan lokasi
 * yang rencananya 80% jatuh ke kritis (terlihat 2026-10-01 di Kedung Mutih).
 */
export const TAHAP_PORSI_ITEM = [0.6, 0.95] as const;

/**
 * Volume per item sehingga Σ nilai terpasang ≈ `sasaran` (rupiah), mengikuti
 * `tahap` (porsi kumulatif per item). Urutan item = urutan RAB, jadi pekerjaan
 * awal (persiapan, tanah) berjalan lebih dulu – sama seperti lapangan.
 */
export function volumeUntukSasaran(
  items: ItemDemo[],
  sasaran: bigint,
  tahap: readonly number[] = TAHAP_PORSI_ITEM,
): { id: string; volume: number }[] {
  // Volume Decimal(15,3): dibulatkan ke bawah supaya tidak melampaui sasaran.
  const bulat = (v: number) => Math.floor(v * 1000) / 1000;
  const porsi = new Map<string, number>();
  let sisa = sasaran;
  for (const batas of tahap) {
    for (const it of items) {
      if (sisa <= 0n) break;
      if (it.volume <= 0 || it.amount <= 0n) continue;
      const sudah = porsi.get(it.id) ?? 0;
      if (sudah >= batas) continue;
      const tambahNilai = BigInt(Math.floor(Number(it.amount) * (batas - sudah)));
      if (tambahNilai <= sisa) {
        porsi.set(it.id, batas);
        sisa -= tambahNilai;
      } else {
        porsi.set(it.id, sudah + Number(sisa) / Number(it.amount));
        sisa = 0n;
      }
    }
  }
  return items
    .filter((it) => porsi.has(it.id))
    .map((it) => ({ id: it.id, volume: bulat(it.volume * porsi.get(it.id)!) }))
    .filter((r) => r.volume > 0);
}
