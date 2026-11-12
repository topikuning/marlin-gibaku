import "server-only";
import path from "node:path";

/**
 * TANDA TANGAN KETIK – pengisi awal slot yang namanya sudah ada tetapi gambar
 * tanda tangannya belum diunggah (DECISIONS 763).
 *
 * Permintaan user 2026-11-12: *"jika tanda tangan belum diupload, bisakah kamu
 * membuatkan tanda tangan dengan model font handwriting untuk pengisi awal,
 * dengan lebar menyesuaikan"*, dan *"kan hanya untuk yang kosong, supaya tidak
 * terlihat kosong waktu dicetak. keputusan akhir kan di manusia di dunia nyata"*.
 *
 * Yang dikerjakan modul ini hanya MENGGAMBAR nama dengan huruf tulisan tangan.
 * Kapan gambar ini dipakai diputuskan pemuatnya (`muatTtdPdf`, `muatTtdLaporan`):
 * hanya bila gambar unggahan tidak ada dan nama penanda tangannya ada. Begitu
 * tanda tangan asli diunggah, yang ini tidak dipakai lagi – tidak ada yang
 * disimpan.
 *
 * Gambarnya PNG berlatar bening, setinggi tetap, dan LEBARNYA mengikuti panjang
 * nama. Penyaji HTML, PDF, dan Excel sudah menempatkan gambar tanda tangan
 * dengan menjaga rasionya di dalam kotak tanda tangan (`ttd-ukuran.ts`), jadi
 * nama panjang mengecil sampai muat, tidak terpotong dan tidak diregangkan.
 *
 * Hurufnya berlisensi SIL OFL (`assets/fonts/*-OFL.txt`) dan dimuat langsung
 * dari berkasnya, bukan dari font sistem – sama alasannya dengan cap foto
 * (`lib/photos.ts`): fontconfig server tidak bisa diandalkan.
 */

/** Dua huruf tulisan tangan; dipilih menurut nama supaya satu halaman tidak seragam. */
export const HURUF_TTD = [
  { berkas: "HerrVonMuellerhoff-Regular.ttf", keluarga: "Herr Von Muellerhoff" },
  { berkas: "MrsSaintDelafield-Regular.ttf", keluarga: "Mrs Saint Delafield" },
] as const;

/** Biru tua tinta pulpen. */
const TINTA = "#1e3a8a";
/** Ukuran huruf saat digambar (pt pada 72 dpi = px). Cukup tajam untuk dicetak ±5 cm. */
const UKURAN = 120;
/** Ruang bening di sekeliling coretan supaya tepinya tidak terpotong. */
const TEPI = 6;

/** Gelar di DEPAN nama yang tidak ditulis sebagai tanda tangan. */
const GELAR_DEPAN = new Set(["ir", "dr", "drs", "dra", "prof", "h", "hj", "kh", "ny", "tn"]);
/** Gelar akademik di BELAKANG tanpa koma: "S.T", "M.Si.", "S.Kom", "Ph.D". */
const GELAR_BELAKANG = /^[A-Za-z]{1,3}\.[A-Za-z]{1,4}\.?$/;

/**
 * Nama yang ditulis sebagai tanda tangan: tanpa gelar depan maupun belakang.
 * "Ir. H. Ahmad Fauzi, S.T., M.T." → "Ahmad Fauzi". Singkatan yang bagian dari
 * nama ("Muh.", "Moh.") tetap ada. Null bila tidak ada nama yang tersisa.
 */
export function namaUntukTtd(nama: string | null | undefined): string | null {
  if (!nama) return null;
  const kata = (nama.split(",")[0] ?? "").trim().split(/\s+/).filter(Boolean);
  while (kata.length > 0 && GELAR_DEPAN.has(kata[0]!.replace(/\.$/, "").toLowerCase()) && kata[0]!.endsWith(".")) {
    kata.shift();
  }
  while (kata.length > 1 && GELAR_BELAKANG.test(kata[kata.length - 1]!)) kata.pop();
  const hasil = kata.join(" ");
  return hasil.length > 0 ? hasil : null;
}

/** Indeks huruf untuk nama ini – tetap untuk nama yang sama. */
export function pilihHuruf(nama: string): number {
  const kunci = nama.trim().replace(/\s+/g, " ").toLowerCase();
  let h = 0;
  for (let i = 0; i < kunci.length; i++) h = (h * 31 + kunci.charCodeAt(i)) >>> 0;
  return h % HURUF_TTD.length;
}

const lolos = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Gambar yang sudah jadi – nama penanda tangan sedikit dan berulang di tiap dokumen. */
const simpanan = new Map<string, Promise<Buffer | null>>();
const SIMPANAN_MAKS = 256;

async function gambar(teks: string, huruf: number): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    const h = HURUF_TTD[huruf]!;
    const { data } = await sharp({
      text: {
        text: `<span foreground="${TINTA}">${lolos(teks)}</span>`,
        font: `${h.keluarga} ${UKURAN}`,
        fontfile: path.join(/*turbopackIgnore: true*/ process.cwd(), "assets", "fonts", h.berkas),
        rgba: true,
        dpi: 72,
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    return await sharp(data)
      .extend({ top: TEPI, bottom: TEPI, left: TEPI, right: TEPI, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch (err) {
    // Tidak pernah menggagalkan dokumen: tanpa gambar ini slotnya tetap
    // tercetak dengan nama dan ruang untuk tanda tangan basah.
    console.error("[ttd] tanda tangan ketik gagal digambar:", err);
    return null;
  }
}

/**
 * PNG tanda tangan ketik untuk satu nama; null bila tidak ada nama.
 * `huruf` hanya untuk uji – biasanya dipilih dari namanya.
 */
export function ttdKetikPng(nama: string | null | undefined, opsi?: { huruf?: number }): Promise<Buffer | null> {
  const teks = namaUntukTtd(nama);
  if (!teks) return Promise.resolve(null);
  const huruf = opsi?.huruf ?? pilihHuruf(teks);
  const kunci = `${huruf}|${teks}`;
  const ada = simpanan.get(kunci);
  if (ada) return ada;
  const jadi = gambar(teks, huruf);
  if (simpanan.size >= SIMPANAN_MAKS) simpanan.delete(simpanan.keys().next().value!);
  simpanan.set(kunci, jadi);
  // Yang gagal jangan disimpan – percobaan berikutnya boleh berhasil.
  void jadi.then((b) => {
    if (!b) simpanan.delete(kunci);
  });
  return jadi;
}

/** Versi alamat data (`data:image/png;base64,…`) untuk `<img>` halaman cetak. */
export async function ttdKetikDataUrl(nama: string | null | undefined): Promise<string | null> {
  const png = await ttdKetikPng(nama);
  return png ? `data:image/png;base64,${png.toString("base64")}` : null;
}
