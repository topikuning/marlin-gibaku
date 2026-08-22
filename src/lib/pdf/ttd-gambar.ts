import "server-only";
import {
  pihakPenyedia,
  pilihPelaksana,
  type JenisDokumen,
  type SumberPelaksana,
} from "@/lib/laporan/penandatangan";
import { ukuranTtd } from "@/lib/export/ttd-ukuran";
import type { PdfDoc } from "./document";

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

export type BerkasTtd = { ttd: Buffer | null; stempel: Buffer | null };

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
    const [{ db }, { pilihKunciTtd }, { isR2Configured, r2GetBuffer }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/export/ttd-laporan"),
      import("@/lib/r2"),
    ]);
    if (!isR2Configured()) return TANPA_TTD_PDF;

    const lokasi = await db.location.findUnique({
      where: { id: locationId },
      select: {
        pelaksanaName: true,
        pelaksanaTitle: true,
        pelaksanaTtdKey: true,
        package: {
          select: {
            pelaksanaName: true,
            pelaksanaTitle: true,
            pelaksanaTtdKey: true,
            contract: {
              select: {
                ppkTtdKey: true,
                ppkStempelKey: true,
                supervisorTtdKey: true,
                supervisorStempelKey: true,
                contractorTtdKey: true,
                contractorStempelKey: true,
                vendor: { select: { stempelKey: true } },
              },
            },
          },
        },
      },
    });
    const k = lokasi?.package.contract;
    if (!k) return TANPA_TTD_PDF;

    const pelaksana = pilihPelaksana(
      lokasi as SumberPelaksana,
      lokasi.package as SumberPelaksana,
    );
    const kunci = pilihKunciTtd({
      ...k,
      penyedia: pihakPenyedia(jenis),
      pelaksanaTtdKey: pelaksana.ttdKey,
      vendorStempelKey: k.vendor.stempelKey,
    });
    const sharp = (await import("sharp")).default;
    const png = async (key: string | null): Promise<Buffer | null> => {
      if (!key) return null;
      try {
        return await sharp(await r2GetBuffer(key)).png().toBuffer();
      } catch (err) {
        console.error(`[pdf] gambar tanda tangan/stempel "${key}" gagal dimuat:`, err);
        return null;
      }
    };

    const [pt, ps, gt, gs, yt, ys] = await Promise.all([
      png(kunci.ppk.ttd),
      png(kunci.ppk.stempel),
      png(kunci.pengawas.ttd),
      png(kunci.pengawas.stempel),
      png(kunci.penyedia.ttd),
      png(kunci.penyedia.stempel),
    ]);
    return {
      ppk: { ttd: pt, stempel: ps },
      pengawas: { ttd: gt, stempel: gs },
      penyedia: { ttd: yt, stempel: ys },
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

export function gambarTtdPdf(
  doc: PdfDoc,
  berkas: BerkasTtd,
  opsi: { xTengah: number; yDasar: number; lebarKolom: number; ruangDiAtasNama: number },
): void {
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
      // Coretan berpijak PERSIS di garis nama.
      doc.image(sebagaiArrayBuffer(berkas.ttd), xTengah - u.ttd.lebar / 2, yDasar - u.ttd.tinggi, {
        fit: [u.ttd.lebar, u.ttd.tinggi],
        align: "center",
        valign: "bottom",
      });
    }
  } catch (err) {
    // Satu gambar rusak tidak boleh menggagalkan seluruh PDF.
    console.error("[pdf] gagal menempel tanda tangan/stempel:", err);
  }
}
