/**
 * Teks pengingat laporan harian — MODUL MURNI (DECISIONS 202).
 *
 * Dipisah dari pengirimnya supaya isinya bisa diuji tanpa DB/WAHA, dan supaya
 * satu-satunya tempat kalimatnya ditulis ada di sini. Pesan ini masuk ke HP
 * orang lapangan setiap sore: kalau kalimatnya salah atau menuduh, itu langsung
 * jadi masalah manusia, bukan sekadar bug tampilan.
 */

export type LokasiTertagih = {
  nama: string;
  /** true = barisnya ada tapi masih draft (bukan belum sama sekali). */
  adaDraft: boolean;
};

/**
 * Bangun pesan untuk SATU penanggung jawab. `null` = tidak ada yang perlu
 * ditagih, jadi orangnya TIDAK dikirimi apa pun — pengingat yang selalu datang
 * setiap hari akan berhenti dibaca.
 */
export function pesanPengingat(
  namaPenerima: string,
  tanggalTampil: string,
  lokasi: LokasiTertagih[],
): string | null {
  if (lokasi.length === 0) return null;

  const baris = lokasi.map((l) =>
    l.adaDraft ? `• ${l.nama} – masih DRAF, belum dikirim` : `• ${l.nama} – belum ada laporan`,
  );
  const kata = lokasi.length === 1 ? "1 lokasi" : `${lokasi.length} lokasi`;

  return [
    `*MARLIN – Laporan Harian ${tanggalTampil}*`,
    "",
    `Halo ${namaPenerima}, ${kata} yang Anda tangani belum tercatat lengkap hari ini:`,
    ...baris,
    "",
    "Mohon diisi lewat menu *Hari Ini* di MARLIN sebelum tutup hari.",
    "",
    "_Pesan otomatis. Bila laporannya sudah dikirim setelah pesan ini terkirim, abaikan saja._",
  ].join("\n");
}
