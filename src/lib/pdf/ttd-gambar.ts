import "server-only";
import type { JenisDokumen } from "@/lib/laporan/penandatangan";
import { kotakTtdKetik, rasioPng, ukuranTtd } from "@/lib/export/ttd-ukuran";
import { PDF_FONT, type PdfDoc } from "./document";
import { PAD_X_GRID, PAD_Y_GRID } from "./grid";

/**
 * Tempel tanda tangan & stempel ke PDF (DECISIONS 328).
 *
 * PDF-nya BUKAN salinan hiasan dari halaman cetak — itulah berkas yang benar-
 * benar beredar lewat WhatsApp ke pengawas dan KKP. Kalau tanda tangan hanya
 * muncul di halaman web, permintaan user tidak terpenuhi untuk jalur yang
 * paling banyak dipakai.
 *
 * Ukurannya diambil dari `lib/export/ttd-ukuran` — sumber yang SAMA dengan
 * penyaji HTML. Dengan begitu tidak mungkin kertas dan layar memakai
 * perbandingan yang berbeda, yang justru dikeluhkan user ("pastikan semua
 * dokumen itu stempel dan ttdnya proporsional di posisinya").
 *
 * Berkas gambar diambil sebagai PNG lewat sharp: pdfkit hanya menerima PNG/JPEG,
 * sementara yang tersimpan di R2 adalah WebP.
 */

export type BerkasTtd = {
  ttd: Buffer | null;
  stempel: Buffer | null;
  /** `ttd` adalah tanda tangan KETIK dari nama (DECISIONS 763) – lebarnya mengikuti nama. */
  ttdKetik?: boolean;
};

export type TtdPdf = {
  ppk: BerkasTtd;
  pengawas: BerkasTtd;
  penyedia: BerkasTtd;
};

export const TANPA_TTD_PDF: TtdPdf = {
  ppk: { ttd: null, stempel: null },
  pengawas: { ttd: null, stempel: null },
  penyedia: { ttd: null, stempel: null },
};

/**
 * Muat gambar tanda tangan & stempel satu lokasi sebagai PNG siap-tempel.
 *
 * Kegagalan apa pun menghasilkan null, tidak pernah melempar: laporan tanpa
 * tanda tangan masih bisa dicetak lalu ditandatangani pena — laporan yang gagal
 * terbit tidak berguna sama sekali. Cacat yang sama pernah menghilangkan logo
 * diam-diam di semua keluaran PDF, jadi kegagalannya DICATAT.
 */
export async function muatTtdPdf(locationId: string, jenis: JenisDokumen): Promise<TtdPdf> {
  try {
    const [{ penandatanganLokasi }, { isR2Configured }, { ambilBerkas }, { ttdKetikPng }] = await Promise.all([
      import("@/lib/export/ttd-laporan"),
      import("@/lib/r2"),
      import("@/lib/penyimpanan/berkas"),
      import("@/lib/export/ttd-ketik"),
    ]);
    // Orang & kuncinya dipilih di tempat yang SAMA dengan halaman cetak.
    const t = await penandatanganLokasi(locationId, jenis);
    if (!t) return TANPA_TTD_PDF;
    const { kunci, nama } = t;
    // Tanpa R2 gambar unggahan tidak bisa diambil – tanda tangan ketik tetap jalan.
    const adaR2 = isR2Configured();
    const sharp = (await import("sharp")).default;
    const { hapusLatarPutih } = await import("@/lib/export/ttd-latar");
    const png = async (key: string | null): Promise<Buffer | null> => {
      if (!key || !adaR2) return null;
      try {
        // Dikecilkan dulu: di kertas gambar ini tidak pernah lebih besar dari
        // ±70 pt, sementara pindaian stempel bisa ribuan piksel. Tanpa batas
        // ini, memindai pikselnya di bawah membebani kontainer 512 MB tanpa
        // menambah ketajaman apa pun.
        const { data, info } = await sharp(await ambilBerkas(key))
          .resize(600, 600, { fit: "inside", withoutEnlargement: true })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        // Latar putihnya dibuang — pdfkit tidak punya `mix-blend-multiply`
        // seperti penyaji HTML, jadi tanpa ini kertas putih di sekeliling
        // stempel MENGHAPUS baris nama di bawahnya (lihat lib/export/ttd-latar).
        hapusLatarPutih(data);
        return await sharp(data, {
          raw: { width: info.width, height: info.height, channels: 4 },
        })
          .png()
          .toBuffer();
      } catch (err) {
        console.error(`[pdf] gambar tanda tangan/stempel "${key}" gagal dimuat:`, err);
        return null;
      }
    };

    // Tanda tangan yang belum diunggah diisi tanda tangan KETIK dari namanya
    // (DECISIONS 763). Hanya coretannya – stempel tidak pernah dibuatkan, dan
    // slot tanpa nama tetap kosong.
    const ttdAtauKetik = async (key: string | null, orang: string | null) => {
      const unggahan = await png(key);
      if (unggahan) return { ttd: unggahan, ttdKetik: false };
      const ketik = await ttdKetikPng(orang);
      return { ttd: ketik, ttdKetik: ketik != null };
    };
    const [pt, ps, gt, gs, yt, ys] = await Promise.all([
      ttdAtauKetik(kunci.ppk.ttd, nama.kkp.nama),
      png(kunci.ppk.stempel),
      ttdAtauKetik(kunci.pengawas.ttd, nama.konsultan.nama),
      png(kunci.pengawas.stempel),
      ttdAtauKetik(kunci.penyedia.ttd, nama.penyedia.nama),
      png(kunci.penyedia.stempel),
    ]);
    return {
      ppk: { ...pt, stempel: ps },
      pengawas: { ...gt, stempel: gs },
      penyedia: { ...yt, stempel: ys },
    };
  } catch (err) {
    console.error("[pdf] tanda tangan & stempel gagal disiapkan:", err);
    return TANPA_TTD_PDF;
  }
}

/**
 * Gambar tanda tangan + stempel di TENGAH sebuah kolom tanda tangan.
 *
 * `lebarKolom` yang menentukan ukurannya (lihat lib/export/ttd-ukuran);
 * `ruangDiAtasNama` = jarak tepi ATAS blok ke garis nama; stempel tidak
 * pernah melebihinya, sehingga mustahil menembus tabel di atas blok.
 * `xTengah` = titik tengah kolom, `yDasar` = garis tempat coretan berpijak
 * (tepat di atas baris nama). Semua dalam poin PDF; y tumbuh ke BAWAH, jadi
 * gambar digambar di ATAS `yDasar`.
 *
 * Stempel digambar LEBIH DULU supaya coretan berada di atasnya — urutan yang
 * sama dengan penyaji HTML.
 */
/**
 * pdfkit yang di-vendor (`assets/pdfkit-standalone.cjs`) TIDAK menerima
 * `Buffer` — ia menyangka argumennya nama berkas lalu memanggil
 * `fs.readFileSync`, yang di bundel itu sengaja dikosongkan. Hasilnya
 * `TypeError` yang ditelan `try/catch` di bawah, dan gambarnya hilang DIAM-DIAM.
 *
 * Persis kegagalan senyap yang sudah pernah menghilangkan logo dari semua
 * keluaran PDF, dan yang sudah diperingatkan di catatan modul ini sendiri —
 * lalu tetap terulang di sini. Konversinya nol-salinan, sama seperti helper
 * `sebagaiArrayBuffer` di `harian-kkp-lampiran.ts`.
 */
function sebagaiArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/**
 * URUTAN GAMBAR: stempel → tanda tangan → TEKS (DECISIONS 412).
 *
 * Keluhan user 2026-08-22 dengan tangkapan layar: stempel perusahaan menutupi
 * tulisan "Dibuat Oleh : / Kontraktor Pelaksana / CV. …" di blok tanda tangan.
 *
 * Sebabnya bukan ukuran atau posisi, melainkan URUTAN MENGGAMBAR. **PDF tidak
 * punya z-index**: yang digambar belakangan menimpa yang lebih dulu, titik.
 * Blok teksnya digambar lebih dulu, lalu gambar stempel ditempel di atasnya —
 * dan stempel hasil pindaian membawa latar putih yang tidak tembus pandang,
 * jadi ia benar-benar menghapus teks di bawahnya.
 *
 * Di layar tidak kelihatan karena penyaji HTML memakai `mix-blend-multiply`
 * (`components/knmp/blok-ttd.tsx`) — latar putihnya jadi transparan di sana.
 * pdfkit tidak menyediakan blend mode, jadi kertas TIDAK bisa memakai obat yang
 * sama.
 *
 * Pembungkus ini yang menegakkan urutannya: gambar dulu, teks sesudahnya. Teks
 * diserahkan sebagai closure supaya pemanggil TIDAK BISA menaruhnya lebih dulu
 * tanpa sengaja — persis kesalahan yang sedang diperbaiki. Nilai kembalian
 * closure diteruskan apa adanya (biasanya `y` berikutnya dari `gridRow`).
 */
export function blokTandaTanganPdf<T>(
  doc: PdfDoc,
  gambar: { berkas: BerkasTtd; opsi: OpsiGambarTtd }[],
  teks: () => T,
): T {
  for (const g of gambar) gambarTtdPdf(doc, g.berkas, g.opsi);
  return teks();
}

export type OpsiGambarTtd = {
  xTengah: number;
  yDasar: number;
  lebarKolom: number;
  ruangDiAtasNama: number;
};

export function gambarTtdPdf(doc: PdfDoc, berkas: BerkasTtd, opsi: OpsiGambarTtd): void {
  const { xTengah, yDasar, lebarKolom, ruangDiAtasNama } = opsi;
  const u = ukuranTtd(lebarKolom, ruangDiAtasNama);
  try {
    if (berkas.stempel) {
      // Turun sedikit melewati garis pijak supaya menimpa baris nama; sisanya
      // melimpah ke atas menutupi baris nama perusahaan.
      doc.image(
        sebagaiArrayBuffer(berkas.stempel),
        xTengah - u.stempel.lebar / 2 - u.geser,
        yDasar + u.turun - u.stempel.tinggi,
        { fit: [u.stempel.lebar, u.stempel.tinggi], align: "center", valign: "bottom" },
      );
    }
    if (berkas.ttd) {
      // Coretan berpijak PERSIS di garis nama. Tanda tangan ketik: setinggi
      // coretan, selebar namanya (DECISIONS 763).
      const rasio = berkas.ttdKetik ? rasioPng(berkas.ttd) : null;
      const k = rasio ? kotakTtdKetik(u, lebarKolom, rasio) : u.ttd;
      doc.image(sebagaiArrayBuffer(berkas.ttd), xTengah - k.lebar / 2, yDasar - k.tinggi, {
        fit: [k.lebar, k.tinggi],
        align: "center",
        valign: "bottom",
      });
    }
  } catch (err) {
    // Satu gambar rusak tidak boleh menggagalkan seluruh PDF.
    console.error("[pdf] gagal menempel tanda tangan/stempel:", err);
  }
}

/**
 * Jarak dari tepi ATAS sel blok tanda tangan (`gridRow`) sampai tepi atas baris
 * nama "( … )" – DIUKUR, bukan ditebak. `atas` = teks sel sebelum baris-baris
 * kosong (judul, peran, firma), `pemisah` = teks persis di antara `atas` dan
 * nama (mis. "\n\n\n\n\n").
 *
 * Penyaji PDF dulu memakai angka tetap (68/70 pt), padahal tinggi `atas`
 * berubah menurut peran dan firma yang terbungkus. Hasilnya coretan berpijak
 * di bawah baris nama dan menimpanya – terlihat jelas begitu tanda tangan
 * ketik (DECISIONS 763) mengisi setiap slot bernama.
 */
export function ruangSampaiNama(
  doc: PdfDoc,
  o: { atas: string; pemisah: string; lebarKolom: number; fontSize: number },
): number {
  const w = Math.max(4, o.lebarKolom - PAD_X_GRID * 2);
  doc.font(PDF_FONT.regular).fontSize(o.fontSize);
  return PAD_Y_GRID + doc.heightOfString(`${o.atas}${o.pemisah}.`, { width: w }) - doc.heightOfString(".", { width: w });
}
