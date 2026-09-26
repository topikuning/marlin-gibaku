import "server-only";
import dataBahasa from "@tesseract.js-data/eng";
import type { KotakTulisan } from "@/lib/photo-stamp/tata-letak";

/**
 * PEMBACA TULISAN DI FOTO — OCR lokal (Tesseract, WASM), tanpa layanan AI
 * luar dan tanpa biaya per foto (DECISIONS 617).
 *
 * Dipakai untuk satu pertanyaan saja: apakah foto sudah membawa cap lokasi /
 * tanggal dari aplikasi kamera. Aturannya ada di `tag-bawaan.ts`; di sini
 * hanya cara membaca tulisannya.
 *
 * ### Kenapa foto "disaring putih" dulu
 *
 * Uji ke foto lapangan sungguhan (2026-09-25): membaca foto mentah memakan
 * 5–6 detik dan menghasilkan sampah dari rumput, kabel, dan payung. Tulisan
 * cap aplikasi kamera hampir selalu PUTIH terang (di atas bayangan/kotak
 * gelap) — jadi yang disisakan hanya piksel sangat terang, dibalik menjadi
 * tulisan hitam di atas putih. Hasilnya ±0,3 detik dan jauh lebih bersih.
 * Satu ambang tidak cocok untuk semua foto (langit terang, tulisan kecil),
 * jadi dibaca TIGA kali dengan ambang/ukuran berbeda lalu digabung.
 *
 * ### Tidak pernah menahan unggahan
 *
 * Satu mesin OCR, dipakai bergantian (server 1 CPU). Ada batas waktu; gagal
 * atau lewat waktu = null, dan foto diberi cap lengkap seperti sebelum fitur
 * ini ada. Membaca foto bukan alasan sah menolak unggahan.
 */

type Worker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

/** Ambang terang (0..255) × lebar baca — hasil uji 2026-09-25, lihat atas. */
const LINTASAN: { ambang: number; lebar: number }[] = [
  { ambang: 200, lebar: 1400 },
  { ambang: 185, lebar: 2200 },
  { ambang: 215, lebar: 1400 },
];
/** Kata dengan keyakinan di bawah ini dibuang — sisa tekstur foto. */
const KEYAKINAN_MIN = 60;
const BATAS_WAKTU_MS = 8_000;
/**
 * Menunggu giliran lebih lama dari ini = server sedang dibanjiri unggahan;
 * foto ini tidak dibaca dan diberi cap lengkap. Tanpa batas ini unggahan ke-30
 * dalam satu gelombang menunggu 29 pembacaan sebelumnya.
 */
const BATAS_ANTRE_MS = 5_000;

let mesin: Promise<Worker> | null = null;
let antrean: Promise<unknown> = Promise.resolve();

async function ambilMesin(): Promise<Worker> {
  if (!mesin) {
    mesin = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const w = await createWorker("eng", 1, {
        // Path dari paket datanya sendiri (__dirname-nya), bukan dirakit dari
        // cwd: di image standalone tidak ada node_modules di folder induk.
        langPath: dataBahasa.langPath,
        cacheMethod: "none",
        gzip: true,
      });
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      return w;
    })().catch((e) => {
      mesin = null;
      throw e;
    });
  }
  return mesin;
}

export type TulisanFoto = {
  /** Tulisan, digabung per baris – bahan `nilaiTagBawaan`. */
  teks: string;
  /**
   * Letak baris-baris tulisan itu (pecahan lebar/tinggi foto, sudah diputar
   * sesuai EXIF) – supaya cap MARLIN tidak menutupinya (DECISIONS 619).
   * Diperluas setengah tinggi baris: cap aplikasi kamera punya ikon, logo, dan
   * latar di sekitar hurufnya.
   */
  kotak: KotakTulisan[];
};

async function bacaSekali(gambar: Buffer): Promise<TulisanFoto> {
  const sharp = (await import("sharp")).default;
  const w = await ambilMesin();
  const baris: string[] = [];
  const kotak: KotakTulisan[] = [];
  for (const l of LINTASAN) {
    const { data: png, info } = await sharp(gambar)
      .rotate()
      .resize({ width: l.lebar, height: l.lebar, fit: "inside", withoutEnlargement: true })
      .grayscale()
      .threshold(l.ambang)
      .negate()
      .png()
      .toBuffer({ resolveWithObject: true });
    const { data } = await w.recognize(png, {}, { blocks: true });
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const ln of p.lines) {
          const kata = ln.words.filter((k) => k.confidence >= KEYAKINAN_MIN);
          if (!kata.length) continue;
          baris.push(kata.map((k) => k.text).join(" "));
          // Letak: hanya kata yang cukup yakin DAN berisi ≥2 huruf/angka –
          // satu-dua "kata" dari tekstur tidak boleh memindahkan cap.
          const nyata = kata.filter((k) => (k.text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2);
          if (!nyata.length) continue;
          const x0 = Math.min(...nyata.map((k) => k.bbox.x0));
          const y0 = Math.min(...nyata.map((k) => k.bbox.y0));
          const x1 = Math.max(...nyata.map((k) => k.bbox.x1));
          const y1 = Math.max(...nyata.map((k) => k.bbox.y1));
          const d = (y1 - y0) * 0.5;
          const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
          kotak.push({
            x: r4(Math.max(0, (x0 - d) / info.width)),
            y: r4(Math.max(0, (y0 - d) / info.height)),
            w: r4(Math.min(1, (x1 - x0 + 2 * d) / info.width)),
            h: r4(Math.min(1, (y1 - y0 + 2 * d) / info.height)),
          });
        }
  }
  // Dibatasi: disimpan di baris foto, dan ratusan kotak tidak menambah arti.
  return { teks: baris.join(" | "), kotak: kotak.slice(0, 120) };
}

/** Tulisan yang terbaca di foto + letaknya; null bila OCR gagal atau lewat batas waktu. */
export async function bacaTulisanFoto(gambar: Buffer): Promise<TulisanFoto | null> {
  const masuk = Date.now();
  const giliran = antrean.then(() => {
    if (Date.now() - masuk > BATAS_ANTRE_MS) throw new Error("antrean OCR terlalu panjang – dilewati");
    return Promise.race([
      bacaSekali(gambar),
      new Promise<never>((_, tolak) => setTimeout(() => tolak(new Error("OCR lewat batas waktu")), BATAS_WAKTU_MS)),
    ]);
  });
  // Antrean tidak boleh macet oleh satu kegagalan.
  antrean = giliran.catch(() => undefined);
  try {
    return await giliran;
  } catch (e) {
    console.error("[ocr] membaca tulisan foto gagal – cap lengkap dipakai:", e instanceof Error ? e.message : e);
    return null;
  }
}
