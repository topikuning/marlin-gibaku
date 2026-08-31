/**
 * Pemotong KALIMAT — untuk batas yang selama ini cuma tertulis di prompt.
 *
 * MARLIN meminta beberapa keluaran AI ringkas ("maksimal 3 kalimat" pada
 * `executiveSummary`, `waSummary`, dan kesimpulan kronologi). Sampai 2026-08-31
 * permintaan itu hanya ada di instruksi, dan tidak satu baris kode pun
 * memeriksanya — sementara DECISIONS 453/454 sudah mencatat bahwa model tetap
 * sering mengirim lebih. Yang membaca di WhatsApp menerima paragraf pada tempat
 * yang dijanjikan tiga kalimat.
 *
 * Yang paling mudah salah bukan pemotongannya, melainkan APA yang dianggap
 * akhir kalimat. Angka Indonesia memakai titik sebagai pemisah ribuan
 * ("Rp 1.500.000"), jadi pemotong yang memecah di setiap titik akan memenggal
 * kalimat di tengah nominal — tepat di tempat yang paling merugikan. Karena itu
 * batas kalimat di sini menuntut titik/tanya/seru yang DIIKUTI spasi lalu huruf,
 * atau berada di ujung teks.
 */

/** Titik/tanya/seru + spasi + huruf besar, atau di ujung teks. */
const AKHIR_KALIMAT = /[.!?](?=\s+\p{Lu}|\s*$)/gu;

export function potongKalimat(teks: string, maks: number): string {
  const rapi = teks.replace(/\s+/g, " ").trim();
  if (rapi === "" || maks <= 0) return rapi === "" ? "" : rapi;

  const batas: number[] = [];
  for (const m of rapi.matchAll(AKHIR_KALIMAT)) {
    if (m.index != null) batas.push(m.index + 1);
  }
  // Kalimat lebih sedikit dari batasnya (atau tanpa tanda akhir sama sekali) —
  // dikembalikan apa adanya. Memotong teks yang tidak berkalimat berarti
  // memenggal di tengah kata.
  if (batas.length <= maks) return rapi;
  return rapi.slice(0, batas[maks - 1]).trim();
}
