import "server-only";
import { getLocationsProgress } from "@/lib/progress";
import { weightedRealizedPct } from "@/lib/progress-calc";
import { idLokasiDiarsipkan, lingkupLokasi } from "./lingkup-lokasi";
import type { RingkasProgresPaket } from "./progres-paket-teks";

/**
 * PROGRES AGREGAT untuk BANYAK paket sekaligus — bahan kolom di daftar paket.
 *
 * ### Satu angka, satu nama
 *
 * Angka ini WAJIB sama persis dengan KPI "Progress agregat" di halaman
 * ringkasan paket. Karena itu populasinya ditiru baris demi baris, bukan
 * ditafsirkan ulang:
 *
 * - **Lokasi yang dipakai = lokasi TER-SCOPE**, sama seperti `getPackageWorkspace`
 *   yang menyaring `locations` dengan `{ id: { in: scoped } }`. Kalau daftar
 *   menghitung dari SELURUH lokasi sementara ringkasan menghitung dari lokasi
 *   yang ditugaskan, satu paket akan punya dua angka di dua layar untuk setiap
 *   peran di luar `CROSS_LOCATION_ROLES` — dan itu sebagian besar peran.
 * - **Yang disaring HANYA `lingkup.dicabut`.** `lingkup.masuk` tidak menggeser
 *   angka, dan pengarsipan pencabutan sengaja hanya menyembunyikan TAMPILAN —
 *   ringkasan paket menegaskan tidak ada satu angka pun yang bergeser
 *   karenanya. Tiap saringan tambahan melahirkan populasi kelima.
 *
 * - **Rumusnya `weightedRealizedPct`**, lapisan kanonik yang sama. Tidak ada
 *   satu pun aritmetika baru di berkas ini; yang dikerjakan di sini
 *   pengelompokan dan pembacaan keadaan.
 *
 * ### Arsip pencabutan: menggeser KALIMAT, bukan ANGKA
 *
 * `lingkupLokasi` sengaja buta arsip, dan itu benar untuk perhitungan. Tetapi
 * CACAH yang ditampilkan ikut aturan lain: ketetapan user 2026-09-06 menuntut
 * pencabutan yang sudah diarsipkan tidak meninggalkan bekas di layar umum, dan
 * menyebut jumlahnya sama saja dengan mengumumkan keberadaannya. Karena itu
 * `lokasiDicabut` — yang dipakai kalimat sel & tooltip — dikurangi daftar
 * arsip, sementara populasi hitungnya tidak disentuh sama sekali. Halaman
 * ringkasan paket melakukan pemisahan yang persis sama.
 *
 * ### Satu putaran kueri, bukan per paket
 *
 * `getLocationsProgress` sudah batched: berapa pun banyak lokasinya, jumlah
 * round-trip-nya tetap. Jadi seluruh paket di layar dilayani SATU panggilan —
 * memanggilnya per paket berarti satu raw SQL per baris daftar. Polanya
 * disalin dari `kesiapan/builder.ts`, yang sudah melakukan hal yang sama untuk
 * papan kesiapan.
 *
 * `pct` sengaja BOLEH null dan itu bukan nol: `weightedRealizedPct`
 * mengembalikan 0 ketika penyebutnya nol, sehingga paket yang belum punya RAB
 * aktif akan tertulis "0,0%" — "belum ada datanya" terbaca "belum ada
 * kemajuannya". Null di sini berarti *tidak ada angka yang sah*, dan kalimat
 * penggantinya disusun `teksProgresPaket`.
 */
export async function progresPaketDaftar(
  paket: { id: string; locationIds: string[]; lokasiTotal: number }[],
  opts: {
    /**
     * true = pemanggilnya pemegang `location_scope.archive` (super admin), jadi
     * pencabutan yang diarsipkan tetap boleh disebut. Default false: yang lupa
     * memikirkannya jatuh ke sisi yang aman.
     */
    bolehLihatArsip?: boolean;
  } = {},
): Promise<Map<string, RingkasProgresPaket>> {
  const hasil = new Map<string, RingkasProgresPaket>();
  const kosong = (p: { id: string; locationIds: string[]; lokasiTotal: number }): RingkasProgresPaket => ({
    pct: null,
    lokasiIkut: 0,
    lokasiPenugasan: p.locationIds.length,
    lokasiTanpaRab: 0,
    lokasiDicabut: 0,
    lokasiTersembunyi: Math.max(0, p.lokasiTotal - p.locationIds.length),
    lokasiTotal: p.lokasiTotal,
  });
  if (paket.length === 0) return hasil;

  const semuaId = paket.flatMap((p) => p.locationIds);
  if (semuaId.length === 0) {
    for (const p of paket) hasil.set(p.id, kosong(p));
    return hasil;
  }

  const lingkup = await lingkupLokasi(semuaId);
  const idIkut = semuaId.filter((id) => !lingkup.dicabut.has(id));
  const [progres, arsip] = await Promise.all([
    idIkut.length > 0 ? getLocationsProgress(idIkut) : Promise.resolve(new Map()),
    opts.bolehLihatArsip ? Promise.resolve(new Set<string>()) : idLokasiDiarsipkan(semuaId),
  ]);

  for (const p of paket) {
    // Yang DISEBUT: pencabutan yang belum diarsipkan. Populasi hitung di bawah
    // tetap memakai `lingkup.dicabut` utuh, jadi angkanya tidak bergeser.
    const dicabut = p.locationIds.filter((id) => lingkup.dicabut.has(id) && !arsip.has(id)).length;
    const baris = p.locationIds
      .filter((id) => !lingkup.dicabut.has(id))
      .map((id) => progres.get(id))
      .filter((r) => r != null);
    const adaRab = baris.filter((r) => r.grandTotal > 0n);
    hasil.set(p.id, {
      // Penyebut nol = tidak ada RAB aktif di seluruh lokasi yang ikut. Itu
      // KEADAAN, bukan angka nol — lihat catatan di kepala berkas.
      pct: adaRab.length > 0 ? weightedRealizedPct(baris) : null,
      lokasiIkut: adaRab.length,
      lokasiPenugasan: p.locationIds.length,
      lokasiTanpaRab: baris.length - adaRab.length,
      lokasiDicabut: dicabut,
      lokasiTersembunyi: Math.max(0, p.lokasiTotal - p.locationIds.length),
      lokasiTotal: p.lokasiTotal,
    });
  }
  return hasil;
}
