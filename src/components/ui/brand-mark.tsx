import {
  markSvgInner,
  MARK_VIEWBOX,
  wordmarkSvgInner,
  WORDMARK_DEFS,
  WORDMARK_W,
  WORDMARK_H,
} from "@/lib/brand-mark";

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

/**
 * Wordmark MARLIN (ikon + tulisan) — `public/brand/marlin-wordmark.svg`.
 *
 * Dipakai di tempat yang dulu merakit sendiri "ikon + teks MARLIN" berdampingan
 * (sidebar, topbar mobile, halaman Masuk). Rakitan itu bergantung pada font UI
 * yang kebetulan terpasang, jadi jarak huruf & bobotnya tidak pernah persis
 * sama dengan logo resmi. Di sini hurufnya VEKTOR — bentuknya identik di semua
 * mesin, dan identik dengan yang tercap di foto. DECISIONS 227.
 *
 * `tinggi` yang dipakai, bukan lebar: wordmark selalu bersanding dengan teks,
 * dan yang harus selaras adalah tinggi optisnya.
 */
export function BrandWordmark({ tinggi = 28, className }: { tinggi?: number; className?: string }) {
  const width = Math.round((tinggi * WORDMARK_W) / WORDMARK_H);
  return (
    <svg
      viewBox={`0 0 ${WORDMARK_W} ${WORDMARK_H}`}
      width={width}
      height={tinggi}
      className={className}
      role="img"
      aria-label="MARLIN"
      dangerouslySetInnerHTML={{
        __html: `<defs>${WORDMARK_DEFS}</defs>${wordmarkSvgInner(0, 0, WORDMARK_W)}`,
      }}
    />
  );
}
