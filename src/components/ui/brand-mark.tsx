import { markSvgInner, MARK_VIEWBOX } from "@/lib/brand-mark";

/**
 * Ikon MARLIN untuk antarmuka web.
 *
 * Geometrinya diambil dari `lib/brand-mark` — SATU sumber dengan cap foto,
 * supaya logo di layar dan logo yang tercap di foto tidak pernah berbeda.
 * Berkas resminya tetap ada di `public/brand/` untuk keperluan di luar aplikasi
 * (kop surat, profil WhatsApp, materi cetak). DECISIONS 223.
 */
export function BrandMark({
  size = 24,
  varian = "warna",
  className,
}: {
  size?: number;
  /** `putih` untuk latar gelap. */
  varian?: "warna" | "putih";
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Logo MARLIN"
      dangerouslySetInnerHTML={{ __html: markSvgInner(0, 0, MARK_VIEWBOX, varian) }}
    />
  );
}
