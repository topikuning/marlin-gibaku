/**
 * Membaca papan klip spreadsheet menjadi deret angka.
 *
 * **Permintaan user 2026-09-20**: *"kebutuhanku aku bisa kopas dari excel
 * beberapa baris langsung diakomodir di situ."*
 *
 * Kenapa bukan grid (yang user tanyakan lebih dulu): tempel-RENTANG di AG Grid
 * adalah fitur Enterprise, sementara repo ini memakai Community dan Enterprise
 * dilarang. Mengganti tabel %-mingguan dengan grid berarti kehilangan input yang
 * sudah ada TANPA mendapat kemampuan tempel — jadi yang dipasang adalah
 * penangkap `paste` pada kolomnya sendiri, dan berkas ini bagian yang
 * memutuskan angkanya.
 *
 * Dipisah dari komponen karena di sinilah kesalahan bisa terjadi tanpa
 * bersuara: papan klip spreadsheet tidak pernah berupa "satu angka bersih per
 * baris". Excel mengirim tab antar kolom, CRLF antar baris, baris kosong di
 * ujung, koma desimal gaya Indonesia, titik ribuan, tanda persen, dan spasi tak
 * putus dari sel yang diformat.
 */

/** Satu sel → angka, atau `null` kalau ia bukan angka sama sekali. */
function selKeAngka(sel: string): number | null {
  let t = sel
    .replace(/ /g, " ") // spasi tak putus dari sel berformat
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .trim();
  if (t === "") return null;

  /**
   * Titik dan koma dua-duanya bisa berarti desimal ATAU ribuan, tergantung
   * setelan wilayah orang yang menyalin. Yang selalu benar: pemisah desimal
   * adalah tanda yang MUNCUL TERAKHIR, dan yang lain pasti pemisah ribuan.
   * Menebak dari satu tanda saja membuat "1.234" terbaca 1,234 — selisih
   * seribu kali, diam-diam.
   */
  const titik = t.lastIndexOf(".");
  const koma = t.lastIndexOf(",");
  if (titik >= 0 && koma >= 0) {
    const desimal = Math.max(titik, koma);
    const ribuan = Math.min(titik, koma);
    t = t.slice(0, ribuan) + t.slice(ribuan + 1);
    const geser = desimal - 1;
    t = `${t.slice(0, geser)}.${t.slice(geser + 1)}`;
  } else if (koma >= 0) {
    t = t.replace(",", ".");
  }

  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Papan klip → deret angka, dibaca urut kiri-ke-kanan lalu turun (urutan baca
 * yang sama dengan mata orang di Excel).
 *
 * Mengembalikan `null` — BUKAN deret kosong atau deret bertambal nol — bila
 * tempelannya kosong atau memuat sel yang bukan angka. Menelan sel berisi teks
 * sebagai 0 akan menulis rencana 0% pada minggu yang sebenarnya tidak diketahui;
 * angka yang tidak diketahui tidak boleh dikarang (DECISIONS 203). Penolakan
 * yang disebutkan alasannya jauh lebih murah daripada baseline yang salah diam-
 * diam.
 */
export function parseTempelanDeret(teks: string): number[] | null {
  const sel = teks
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((baris) => baris.split("\t"))
    .map((s) => s.trim())
    .filter((s) => s !== "");

  if (sel.length === 0) return null;

  const angka: number[] = [];
  for (const s of sel) {
    const n = selKeAngka(s);
    if (n === null) return null;
    angka.push(n);
  }
  return angka;
}
