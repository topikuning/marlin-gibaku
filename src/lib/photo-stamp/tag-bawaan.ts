/**
 * TAG BAWAAN FOTO — apakah foto SUDAH membawa cap lokasi dan/atau tanggal dari
 * aplikasi kamera (Timemark, GPS Map Camera, dll.) — DECISIONS 617.
 *
 * Ketetapan user 2026-09-25: *"kalau sudah ada tag lokasi, maka jangan kasih
 * tag lokasi, kalau sudah ada tanggal jangan beri tag tanggal. jika ada
 * dua2nya ya jangan kasih dua2nya"*. Letak dan bentuk cap aplikasi kamera
 * dianggap ACAK (banyak orang, banyak aplikasi), jadi yang dinilai di sini
 * ISI tulisannya, bukan posisinya — tulisan seluruh foto yang terbaca OCR.
 *
 * Modul MURNI: masukannya teks, keluarannya keputusan + buktinya. Aturannya
 * sengaja berat ke sisi "belum ber-tag": salah menganggap sudah ber-tag
 * berarti foto kehilangan tanggal/lokasi MARLIN, sedangkan salah ke arah
 * sebaliknya hanya cap ganda seperti sebelum fitur ini ada.
 */

export type TagBawaan = {
  /** Foto sudah membawa tag lokasi → MARLIN tidak mencetak lokasi & koordinat. */
  lokasi: boolean;
  /** Foto sudah membawa tanggal → MARLIN tidak mencetak tanggal-jam. */
  waktu: boolean;
  /** Potongan tulisan yang menjadi dasar keputusan — untuk ditelusuri. */
  bukti: { lokasi?: string; waktu?: string };
};

const BULAN = [
  "jan", "januari", "january", "feb", "februari", "february", "mar", "maret", "march",
  "apr", "april", "mei", "may", "jun", "juni", "june", "jul", "juli", "july",
  "agu", "agt", "agus", "agustus", "aug", "august", "sep", "sept", "september",
  "okt", "oktober", "oct", "october", "nov", "nop", "november", "des", "desember", "dec", "december",
].join("|");

/** Tahun yang masuk akal untuk foto proyek — menyaring "No. 12/2026"-an tanpa hari. */
const TAHUN = "20[2-3]\\d";

const POLA_TANGGAL: RegExp[] = [
  // 25/09/2026 · 25-09-2026 · 25.09.2026
  new RegExp(`\\b([0-2]?\\d|3[01])\\s?[/.\\-]\\s?(0?[1-9]|1[0-2])\\s?[/.\\-]\\s?${TAHUN}\\b`),
  // 2026-09-25 · 2026/09/25
  new RegExp(`\\b${TAHUN}\\s?[/.\\-]\\s?(0?[1-9]|1[0-2])\\s?[/.\\-]\\s?([0-2]?\\d|3[01])\\b`),
  // 25 Sep 2026 · 25 September 2026
  new RegExp(`\\b([0-2]?\\d|3[01])\\s+(${BULAN})\\.?,?\\s+${TAHUN}\\b`, "i"),
  // Sep 25, 2026
  new RegExp(`\\b(${BULAN})\\.?\\s+([0-2]?\\d|3[01]),?\\s+${TAHUN}\\b`, "i"),
];

/** Koordinat desimal di dalam kotak wilayah Indonesia (lintang −11..6, bujur 95..141). */
function koordinatDesimal(teks: string): string | null {
  const angka = [...teks.matchAll(/-?\d{1,3}[.,]\d{3,8}/g)].map((m) => ({
    s: m[0],
    v: Number(m[0].replace(",", ".")),
  }));
  const lintang = angka.find((a) => a.v >= -11.5 && a.v <= 6.5 && Math.abs(a.v) >= 0.001 && /[.,]\d{4,}/.test(a.s));
  const bujur = angka.find((a) => a.v >= 94.5 && a.v <= 141.5 && /[.,]\d{4,}/.test(a.s));
  // Bujur saja sudah cukup kuat: angka 95..141 dengan ≥4 desimal hampir tidak
  // pernah muncul di foto lapangan selain sebagai koordinat. Lintang saja
  // tidak — "6.1234" bisa ukuran apa pun.
  if (bujur) return lintang ? `${lintang.s}, ${bujur.s}` : bujur.s;
  // Lintang + penanda arah/kata "Lat" masih bisa dipercaya.
  if (lintang && /\b(lat|lintang)\b|°\s*[ns]\b/i.test(teks)) return lintang.s;
  return null;
}

/** 7°03'21"S · 112°44'10"E · 6°52'16"S (OCR sering salah membaca ° jadi o/º). */
const POLA_DMS = /\b\d{1,3}\s*[°ºo˚]\s*\d{1,2}\s*['’′]\s*\d{1,2}(?:[.,]\d+)?\s*["”″']{0,2}\s*[NSEWUTBL]\b|\b\d{1,2}["”″']\s*\d{1,2}(?:[.,]\d+)?["”″']?\s*[NSEW]\b/i;

function potong(teks: string, idx: number, panjang: number): string {
  return teks.slice(Math.max(0, idx - 10), Math.min(teks.length, idx + panjang + 25)).trim();
}

/**
 * Nilai tulisan yang terbaca di foto.
 *
 * - **waktu**: ada tanggal lengkap (hari+bulan+tahun) dalam format apa pun. Jam
 *   saja tidak cukup – jam dinding atau layar alat bisa tertangkap kamera.
 * - **lokasi**: HANYA koordinat (desimal di wilayah Indonesia, atau derajat-
 *   menit-detik). Nama wilayah/alamat – walau bersama tanggal – BUKAN tag
 *   lokasi (DECISIONS 629). Teguran user 2026-09-29 pada dua foto yang capnya
 *   hanya "Kecamatan Taman, Indonesia" dan "PROYEK KNMP DESA KLIDANG LOR":
 *   *"foto asli tidak ada tag lokasi, kenapa kamu nggak ngasih tag lokasi?!"*.
 *   Tag lokasi MARLIN adalah bukti TITIK (koordinat); nama tempat tidak
 *   menggantikannya.
 */
export function nilaiTagBawaan(teks: string): TagBawaan {
  const t = teks.replace(/\s+/g, " ");
  const bukti: TagBawaan["bukti"] = {};

  let waktu = false;
  for (const p of POLA_TANGGAL) {
    const m = p.exec(t);
    if (m) {
      waktu = true;
      bukti.waktu = potong(t, m.index, m[0].length);
      break;
    }
  }

  let lokasi = false;
  const desimal = koordinatDesimal(t);
  const dms = POLA_DMS.exec(t);
  if (desimal) {
    lokasi = true;
    bukti.lokasi = desimal;
  } else if (dms) {
    lokasi = true;
    bukti.lokasi = potong(t, dms.index, dms[0].length);
  }

  return { lokasi, waktu, bukti };
}
