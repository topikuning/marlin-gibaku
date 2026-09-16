import { formatPct } from "@/lib/format";

/**
 * KALIMAT untuk angka progres agregat sebuah paket — MURNI, tanpa DB.
 *
 * Terpisah dari `progres-paket.ts` karena berkas itu `server-only`, sementara
 * kalimat ini ikut ke baris grid (komponen klien) dan harus bisa diuji tanpa
 * basis data. Tidak ada satu pun rumus di sini: `pct` sudah jadi saat masuk,
 * dihitung `weightedRealizedPct` di lapisan kanonik.
 *
 * ### Kenapa kalimatnya, bukan cuma persennya
 *
 * 1. **Sel kosong terbaca "datanya belum diisi"**, padahal keadaannya "memang
 *    belum ada". Pola ini sudah ditetapkan di daftar paket sendiri untuk kolom
 *    Nilai Kontrak ("belum berkontrak"), dan `pctCol` bawaan justru
 *    mengembalikan string kosong untuk null.
 * 2. **Angka SEBAGIAN wajib mengaku sebagian.** Paket masuk daftar begitu SATU
 *    lokasinya ditugaskan kepada user, jadi pemegang peran ber-scope melihat
 *    progres yang dihitung dari sebagian lokasi saja. Satu label untuk dua
 *    angka yang berbeda persis yang dilarang DECISIONS 201.
 * 3. **Keterangan itu harus ikut ke CSV.** Grid ini punya tombol ekspor, dan
 *    tooltip tidak ikut terekspor — jadi penandanya hidup di teks selnya
 *    sendiri (`valueFormatter`), bukan di tooltip saja. Aturan yang sama sudah
 *    dipakai kolom "Status Data": yang kurang ditulis di tooltip DAN di CSV.
 */

export type RingkasProgresPaket = {
  /** null = tidak ada angka yang sah untuk ditampilkan (lihat `teksProgresPaket`). */
  pct: number | null;
  /** Lokasi yang BENAR-BENAR menyumbang angka (punya RAB aktif, masih dalam lingkup). */
  lokasiIkut: number;
  /** Lokasi paket ini yang ada dalam PENUGASAN user (untuk peran lintas-lokasi = semua). */
  lokasiPenugasan: number;
  /** Lokasi dalam lingkup yang belum punya revisi RAB aktif. */
  lokasiTanpaRab: number;
  /**
   * Lokasi dicabut adendum yang BOLEH DISEBUT. Pencabutan yang sudah
   * diarsipkan super admin tidak ikut: ketetapan user 2026-09-06 menuntut
   * riwayat itu tidak meninggalkan bekas di layar umum, dan menyebut
   * jumlahnya sama saja dengan mengumumkan keberadaannya. Angkanya sendiri
   * TIDAK bergeser karena arsip – penyaringan itu hanya soal tampilan.
   */
  lokasiDicabut: number;
  /** Lokasi paket ini yang di luar penugasan user; 0 untuk peran lintas-lokasi. */
  lokasiTersembunyi: number;
  /** Seluruh lokasi paket, termasuk yang tidak terlihat user. */
  lokasiTotal: number;
};

/**
 * Teks SEL (dan CSV). Persen bila ada angkanya; kalau tidak, sebabnya —
 * karena "kenapa kosong" adalah pertanyaan pertama yang ditanyakan orang.
 */
export function teksProgresPaket(r: RingkasProgresPaket): string {
  if (r.pct == null) {
    if (r.lokasiTotal === 0) return "belum ada lokasi";
    if (r.lokasiTersembunyi === r.lokasiTotal) return "lokasi di luar penugasan Anda";
    if (r.lokasiIkut + r.lokasiTanpaRab === 0) {
      // Tidak satu pun lokasi yang terlihat menyumbang baris. Sebabnya
      // disebut HANYA bila boleh disebut – kalau pencabutannya sudah
      // diarsipkan, kalimatnya netral dan tidak menyinggung adendum.
      return r.lokasiDicabut > 0 ? "semua lokasi dicabut adendum" : "tidak ada lokasi yang dihitung";
    }
    return "belum ada RAB aktif";
  }
  const persen = formatPct(r.pct);
  /*
   * Hanya disebut saat angkanya MEMANG sebagian. Menambahkan "3 dari 3" pada
   * paket yang utuh cuma menambah kebisingan pada baris yang tidak bermasalah.
   *
   * Penyebutnya SELURUH lokasi paket, dan kalimatnya berbunyi "lokasi paket
   * ini" – bukan "lokasi penugasan Anda". Dulu tertulis begitu dan itu
   * menyatakan penugasan yang tidak pernah ada: user yang ditugaskan ke SATU
   * lokasi dari tiga membaca "1 dari 3 lokasi penugasan Anda". Yang perlu
   * diketahui pembacanya cuma satu hal – angka ini tidak mencakup seluruh
   * paket – dan itu benar apa pun cacah penugasannya. Sebabnya di tooltip.
   */
  return r.lokasiTersembunyi > 0
    ? `${persen} – ${r.lokasiIkut} dari ${r.lokasiTotal} lokasi paket ini`
    : persen;
}

/**
 * Keterangan TOOLTIP. Menerangkan dasar angkanya, tanpa menambah satu pun
 * angka baru selain cacah lokasi yang memang sudah ada di barisnya — tooltip
 * yang memuat hitungan kedua akan jadi angka basi begitu definisinya bergeser.
 */
export function catatanProgresPaket(r: RingkasProgresPaket): string {
  if (r.pct == null) {
    if (r.lokasiTotal === 0) return "Paket ini belum punya lokasi, jadi belum ada yang bisa dihitung.";
    if (r.lokasiTersembunyi === r.lokasiTotal) {
      return `Seluruh ${r.lokasiTotal} lokasi paket ini di luar penugasan Anda.`;
    }
    if (r.lokasiIkut + r.lokasiTanpaRab === 0) {
      return r.lokasiDicabut > 0
        ? "Seluruh lokasi paket ini sudah dicabut lewat adendum – pekerjaannya bukan lagi bagian kontrak."
        : "Tidak ada lokasi paket ini yang ikut dihitung.";
    }
    return "Belum ada lokasi yang punya revisi RAB aktif, jadi bobot pekerjaannya belum bisa ditimbang.";
  }
  const bagian = [
    `Realisasi kumulatif s/d hari ini, ditimbang nilai RAB aktif – gabungan ${r.lokasiIkut} lokasi.`,
    "Dari laporan harian yang dikirim, disetujui, dan final.",
  ];
  if (r.lokasiTanpaRab > 0) bagian.push(`${r.lokasiTanpaRab} lokasi belum punya RAB aktif.`);
  if (r.lokasiDicabut > 0) bagian.push(`${r.lokasiDicabut} lokasi dicabut adendum, tidak ikut dihitung.`);
  if (r.lokasiTersembunyi > 0) {
    bagian.push(
      `Penugasan Anda di paket ini ${r.lokasiPenugasan} lokasi; ${r.lokasiTersembunyi} sisanya di luar penugasan – ` +
        "angka ini BUKAN progres seluruh paket.",
    );
  }
  return bagian.join(" ");
}
