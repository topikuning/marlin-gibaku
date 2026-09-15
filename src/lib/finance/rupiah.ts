/**
 * SATU pembaca nominal rupiah yang diketik orang — murni, tanpa DB.
 *
 * Laporan audit 2026-09-15 (J-1): aturan lama membuang SEMUA titik dan koma
 * (`s.replace(/[.,\s]/g, "")`), jadi nominal yang disalin dari invoice vendor
 * dalam format Indonesia berubah seratus kali lipat tanpa suara:
 *
 * | yang diketik   | aturan lama       | yang dimaksud |
 * |----------------|-------------------|---------------|
 * | `1.500.000,00` | **150.000.000**   | 1.500.000     |
 * | `15.000,50`    | **1.500.050**     | 15.000,50     |
 *
 * DECISIONS 203 melarang angka pengguna "dibetulkan" diam-diam. Yang dipakai di
 * sini aturan yang sama: **hanya yang PASTI yang ditafsirkan, sisanya ditolak
 * dengan menyebut sebabnya** — bukan ditebak.
 *
 * Yang diterima:
 *
 * 1. Angka polos: `1500000`, `Rp 1500000`.
 * 2. Titik sebagai pemisah ribuan dengan pengelompokan Indonesia yang utuh:
 *    `1.500`, `1.500.000`. Kelompok setelah titik WAJIB tepat tiga digit, jadi
 *    `1.5` (yang bisa berarti satu setengah) tidak pernah lolos sebagai 15.
 * 3. Koma sebagai desimal, ASAL pecahannya nol: `1.500.000,00` → 1.500.000.
 *
 * Yang ditolak — dan alasannya dikatakan:
 *
 * - Pecahan bukan nol (`15.000,50`): rupiah di MARLIN bilangan bulat (BigInt),
 *   dan membulatkannya sendiri berarti mengubah angka orang.
 * - Pengelompokan yang tidak utuh (`1.5`, `12.34`): ambigu antara desimal dan
 *   ribuan, dan menebaknya mengalikan atau membagi dengan 1000.
 * - Apa pun yang bukan nominal (`NIP 1991…`, `Termin 2`).
 */

export type HasilRupiah = { ok: true; nilai: bigint } | { ok: false; pesan: string };

const HIASAN = /^(?:rp\.?|idr)?\s*/i;

export function bacaRupiah(mentah: string): HasilRupiah {
  const teks = mentah.trim().replace(HIASAN, "").replace(/\s+/g, "");
  if (!teks) return { ok: false, pesan: "Jumlah wajib diisi" };

  const tolak = (sebab: string): HasilRupiah => ({
    ok: false,
    pesan: `Jumlah "${mentah.trim()}" tidak terbaca: ${sebab}`,
  });

  if (!/^[\d.,]+$/.test(teks)) return { ok: false, pesan: "Jumlah harus angka rupiah bulat" };

  const koma = (teks.match(/,/g) ?? []).length;
  if (koma > 1) return tolak("ada lebih dari satu koma");

  let bulat = teks;
  if (koma === 1) {
    const [depan, pecahan] = teks.split(",");
    if (!/^\d*$/.test(pecahan)) return tolak("pecahannya bukan angka");
    // Pecahan nol boleh — "1.500.000,00" jelas maksudnya 1.500.000.
    if (pecahan.length > 0 && Number(pecahan) !== 0) {
      return tolak("rupiah di MARLIN bilangan bulat, tidak menerima pecahan");
    }
    bulat = depan;
  }

  if (bulat === "") return tolak("tidak ada angka di depan koma");

  if (bulat.includes(".")) {
    // Pengelompokan ribuan Indonesia yang UTUH; selain itu ambigu.
    if (!/^\d{1,3}(?:\.\d{3})+$/.test(bulat)) {
      return tolak("titiknya tidak membentuk pemisah ribuan (contoh yang benar: 1.500.000)");
    }
    bulat = bulat.replace(/\./g, "");
  }

  if (!/^\d+$/.test(bulat)) return { ok: false, pesan: "Jumlah harus angka rupiah bulat" };
  return { ok: true, nilai: BigInt(bulat) };
}
