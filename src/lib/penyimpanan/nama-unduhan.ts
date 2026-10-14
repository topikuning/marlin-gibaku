/**
 * NAMA BERKAS SAAT DIUNDUH (DECISIONS 676).
 *
 * Laporan user 2026-10-14: dokumen yang diunduh dari /dokumen bernama
 * `ZG9jdW1lbnRzLzIwMjYv….tmwvg0.hmrEsx…` – token alamat arsip Lenovo, bukan
 * nama yang diunggah, dan "ekstensinya" adalah ekor tanda tangan token.
 * Peramban menamai berkas dari `Content-Disposition`, dan kalau itu tidak ada,
 * dari ruas terakhir alamatnya. Penampil PDF bawaan peramban bahkan cenderung
 * memakai ruas alamat saja. Jadi nama yang benar harus ada di DUA tempat:
 * header dan ruas terakhir alamat.
 *
 * Nama yang dipakai adalah nama saat diunggah, dirapikan seperlunya: tanpa
 * folder, tanpa karakter yang ditolak Windows/Android, tidak lebih dari 150
 * karakter, dan berakhiran ekstensi yang sesuai jenis isinya.
 */

/** Jenis isi → ekstensi yang sah (yang pertama dipakai bila perlu ditambahkan). */
const EKSTENSI: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/heic": ["heic"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "application/vnd.ms-excel": ["xls"],
  "application/msword": ["doc"],
  "application/zip": ["zip"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "audio/ogg": ["ogg", "opus"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a"],
  "video/mp4": ["mp4"],
};

/** Sistem berkas umumnya membatasi 255 byte; sisakan ruang untuk "(1)" dsb. */
const MAKS_PANJANG = 150;

function jenisDasar(mime: string | null | undefined): string {
  return (mime ?? "").toLowerCase().split(";")[0].trim();
}

export function namaUnduhan(asli: string | null | undefined, mime: string | null | undefined, cadangan = "dokumen"): string {
  const bersih = ((asli ?? "").split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");

  const m = /^(.*?)(?:\.([A-Za-z0-9]{1,8}))?$/.exec(bersih);
  let badan = m?.[1] ?? bersih;
  let eks = m?.[2] ?? "";
  const sah = EKSTENSI[jenisDasar(mime)];
  if (sah && !sah.includes(eks.toLowerCase())) {
    // "laporan.final" ber-isi PDF → "laporan.final.pdf"; nama tanpa ekstensi diberi ekstensi.
    badan = bersih;
    eks = sah[0];
  }
  badan = badan.replace(/[.\s]+$/, "").trim() || cadangan;

  const ruang = MAKS_PANJANG - (eks ? eks.length + 1 : 0);
  const huruf = [...badan];
  if (huruf.length > ruang) badan = huruf.slice(0, ruang).join("").replace(/[.\s]+$/, "");
  return eks ? `${badan}.${eks}` : badan;
}

/**
 * Jenis yang aman dibuka langsung di tab peramban. Selain ini diunduh –
 * berkas unggahan yang dibuka dari domain MARLIN tidak boleh dijalankan
 * peramban sebagai halaman (mis. HTML/SVG kiriman WA).
 */
export function bolehTampilLangsung(mime: string | null | undefined): boolean {
  const j = jenisDasar(mime);
  return /^(application\/pdf|image\/(jpeg|png|webp|gif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/.test(j);
}

/** Header `Content-Disposition` dengan nama ASCII cadangan + nama UTF-8 lengkap. */
export function kepalaDisposisi(nama: string, mime: string | null | undefined): string {
  const cara = bolehTampilLangsung(mime) ? "inline" : "attachment";
  const ascii = nama
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\%]/g, "_");
  const utf8 = encodeURIComponent(nama).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${cara}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** Ruas alamat yang membawa nama berkas (ruas terakhir URL unduhan). */
export function ruasNama(nama: string): string {
  return encodeURIComponent(nama);
}

/** Kebalikan `ruasNama`, aman untuk ruas yang sudah atau belum di-decode. */
export function bacaRuasNama(ruas: string): string {
  try {
    return decodeURIComponent(ruas);
  } catch {
    return ruas;
  }
}
