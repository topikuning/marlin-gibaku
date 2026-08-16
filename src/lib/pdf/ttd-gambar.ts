import "server-only";
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
export async function muatTtdPdf(locationId: string): Promise<TtdPdf> {
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
        package: {
          select: {
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

    const kunci = pilihKunciTtd({ ...k, vendorStempelKey: k.vendor.stempelKey });
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
 * Gambar tanda tangan + stempel di TENGAH sebuah kotak.
 *
 * `xTengah` = titik tengah kolom tanda tangan, `yDasar` = garis tempat coretan
 * berpijak (biasanya tepat di atas baris nama). Keduanya dalam poin PDF, sistem
 * koordinat pdfkit (y tumbuh ke BAWAH), sehingga gambar digambar di ATAS
 * `yDasar`.
 *
 * Stempel digambar LEBIH DULU supaya tanda tangan berada di atasnya — urutan
 * yang sama dengan penyaji HTML.
 */
export function gambarTtdPdf(
  doc: PdfDoc,
  berkas: BerkasTtd,
  opsi: { xTengah: number; yDasar: number; tinggi: number },
): void {
  const { xTengah, yDasar, tinggi } = opsi;
  const u = ukuranTtd(tinggi);
  // Diangkat `u.naik` dari garis pijak (y mengecil ke ATAS di pdfkit) supaya
  // sisi atasnya menimpa baris teks di atasnya — seperti stempel yang dicap di
  // kertas, bukan gambar yang ditempel rapi di ruang kosong. DECISIONS 329.
  const dasar = yDasar - u.naik;
  try {
    if (berkas.stempel) {
      doc.image(
        berkas.stempel,
        xTengah - u.stempel.lebar / 2 - u.geser,
        dasar - u.stempel.tinggi,
        { fit: [u.stempel.lebar, u.stempel.tinggi], align: "center", valign: "bottom" },
      );
    }
    if (berkas.ttd) {
      doc.image(berkas.ttd, xTengah - u.ttd.lebarMaks / 2, dasar - u.ttd.tinggi, {
        fit: [u.ttd.lebarMaks, u.ttd.tinggi],
        align: "center",
        valign: "bottom",
      });
    }
  } catch (err) {
    // Satu gambar rusak tidak boleh menggagalkan seluruh PDF.
    console.error("[pdf] gagal menempel tanda tangan/stempel:", err);
  }
}
