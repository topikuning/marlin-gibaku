/**
 * Sebab "tidak ada pesan terkirim" — MURNI, tanpa DB, supaya bisa diuji tanpa
 * env. Dipisah dari `penjadwal.ts` karena di sanalah `lib/db` diimpor, dan
 * satu import itu membuat seluruh modul tidak bisa disentuh uji unit.
 *
 * DECISIONS 221.
 */

/** Angka pendukung agar "0 terkirim" bisa menjelaskan dirinya (DECISIONS 221). */
export type DiagnosaPengingat = {
  lokasiDalamLingkup: number;
  lokasiSudahLapor: number;
  lokasiPerluDitagih: number;
  lokasiTanpaPenugasan: number;
  orangDitugaskan: number;
  orangTanpaNomorWa: number;
  orangNonaktif: number;
};


/**
 * Susun sebab "tidak ada yang dikirim" jadi kalimat yang bisa DITINDAKLANJUTI.
 * Mengembalikan null bila memang tidak ada yang perlu ditagih — itu keadaan
 * sehat, bukan masalah.
 */
export function sebabTidakAdaPenerima(d: DiagnosaPengingat): string | null {
  if (d.lokasiDalamLingkup === 0) {
    return (
      "Belum ada lokasi yang masuk lingkup pengingat. Syaratnya: status lokasi berjalan, " +
      "paket tahap pelaksanaan, dan tanggal SPMK kontrak sudah lewat."
    );
  }
  if (d.lokasiPerluDitagih === 0) return null; // semua sudah lapor — memang sehat
  if (d.orangDitugaskan === 0) {
    return (
      `${d.lokasiPerluDitagih} lokasi belum melapor, tapi TIDAK ADA orang yang ditugaskan ke ` +
      "lokasi-lokasi itu. Tugaskan penanggung jawab di halaman Lokasi."
    );
  }
  if (d.orangTanpaNomorWa > 0 || d.orangNonaktif > 0) {
    const bagian: string[] = [];
    if (d.orangTanpaNomorWa > 0) bagian.push(`${d.orangTanpaNomorWa} belum punya nomor WhatsApp`);
    if (d.orangNonaktif > 0) bagian.push(`${d.orangNonaktif} akunnya nonaktif`);
    return (
      `${d.lokasiPerluDitagih} lokasi belum melapor dan ${d.orangDitugaskan} orang ditugaskan, ` +
      `tetapi ${bagian.join(" dan ")} — jadi tidak ada tujuan yang bisa dikirimi. ` +
      "Isi nomor WhatsApp mereka di Administrasi → Pengguna."
    );
  }
  return null;
}

