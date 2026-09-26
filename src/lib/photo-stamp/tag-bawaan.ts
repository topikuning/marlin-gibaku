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

/** Penanda alamat yang dipakai cap aplikasi kamera. */
const POLA_ALAMAT =
  /\b(jl|jln|jalan|kec|kecamatan|kab|kabupaten|kel|kelurahan|desa|kota|provinsi|prov|indonesia|jawa timur|jawa tengah|jawa barat|sulawesi|sumatera|sumatra|kalimantan|nusa tenggara|maluku|papua|bali|banten|aceh|riau|jambi|bengkulu|lampung|gorontalo|yogyakarta)\b\.?/i;

/** Jarak ubah (Levenshtein) – OCR sering salah SATU huruf: "Lamengan", "Pacirg". */
function jarak(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/**
 * Nama wilayah lokasi yang tertulis di foto, toleran satu salah huruf (dua
 * untuk nama ≥8 huruf). Nama pendek (<5 huruf) harus persis: "Desa"/"Kota"
 * yang kebetulan mirip nama tempat tidak boleh lolos.
 */
function wilayahTertulis(t: string, nama: string[]): string | null {
  const kata = t.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  for (const n of nama) {
    for (const bagian of n.toLowerCase().split(/\s+/).filter((b) => b.length >= 4)) {
      const toleransi = bagian.length >= 8 ? 2 : bagian.length >= 5 ? 1 : 0;
      if (kata.some((k) => Math.abs(k.length - bagian.length) <= toleransi && jarak(k, bagian) <= toleransi)) return n;
    }
  }
  return null;
}

function potong(teks: string, idx: number, panjang: number): string {
  return teks.slice(Math.max(0, idx - 10), Math.min(teks.length, idx + panjang + 25)).trim();
}

/**
 * Nilai tulisan yang terbaca di foto.
 *
 * - **waktu**: ada tanggal lengkap (hari+bulan+tahun) dalam format apa pun. Jam
 *   saja tidak cukup – jam dinding atau layar alat bisa tertangkap kamera.
 * - **lokasi**: ada koordinat (desimal di wilayah Indonesia, atau derajat-menit-
 *   detik), ATAU ada alamat/nama wilayah lokasi itu BERSAMA tanggal. Syarat
 *   "bersama tanggal" ada karena papan nama proyek, spanduk, dan kop surat di
 *   foto lapangan juga menulis kecamatan/kabupaten – dan itu bukan cap.
 */
export function nilaiTagBawaan(teks: string, opsi: { namaWilayah?: string[] } = {}): TagBawaan {
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
  } else if (waktu) {
    const alamat = POLA_ALAMAT.exec(t);
    const wilayah = wilayahTertulis(t, (opsi.namaWilayah ?? []).map((n) => n.trim()).filter(Boolean));
    if (alamat) {
      lokasi = true;
      bukti.lokasi = potong(t, alamat.index, alamat[0].length);
    } else if (wilayah) {
      lokasi = true;
      bukti.lokasi = wilayah;
    }
  }

  return { lokasi, waktu, bukti };
}
