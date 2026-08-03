/**
 * IKON MARLIN sebagai geometri — SATU sumber untuk semua penyaji.
 *
 * Berkas resminya ada di `public/brand/marlin-icon*.svg` (dari user
 * 2026-08-02). Yang ditaruh di sini hanya PATH-nya, karena ikon ini dipakai di
 * tempat yang tidak bisa memuat berkas: cap foto dirakit sebagai SATU string
 * SVG lalu diraster sharp, jadi ia tidak bisa `<img src>`. Menyalin path ke
 * dua tempat berarti suatu hari keduanya berbeda — dan yang berbeda itu logo.
 *
 * Koordinat mengikuti viewBox 0 0 96 96 persis seperti berkas aslinya, supaya
 * perbandingan visual dengan berkas resmi selalu bisa dilakukan.
 *
 * DECISIONS 223.
 */

/** viewBox ikon: 0 0 96 96. */
export const MARK_VIEWBOX = 96;

/** Warna resmi dari `public/brand/README.txt`. */
export const BRAND_COLORS = {
  biru: "#1E3A8A",
  merah: "#D21F2A",
  teksUtama: "#0F172A",
  teksSekunder: "#64748B",
  latarGelap: "#08152E",
} as const;

/** Huruf "M" — bentuk dasar ikon. */
const PATH_M =
  "M10 88 L10 24 L28 24 L48 50 L68 24 L86 24 L86 88 L70 88 L70 46 L48 74 L26 46 L26 88 Z";
/** Kurva "kail" yang melintasi M, dari kiri-bawah ke kanan-atas. */
const PATH_KURVA = "M10 80 C28 80 36 66 48 50 C60 34 70 26 88 18";

/**
 * Rakit isi ikon (tanpa elemen `<svg>` pembungkus) pada skala & posisi tertentu.
 *
 * `varian`:
 * - `warna` — biru + merah, untuk latar TERANG;
 * - `putih` — M putih dengan kurva ber-outline gelap, untuk latar gelap atau
 *   FOTO. Di foto, satu warna solid tanpa outline akan lenyap begitu latarnya
 *   kebetulan seterang tinta (DECISIONS 223).
 */
export function markSvgInner(
  x: number,
  y: number,
  size: number,
  varian: "warna" | "putih" = "warna",
  /** Warna outline kurva pada varian putih — samakan dengan latar bila diketahui. */
  outline: string = BRAND_COLORS.latarGelap,
): string {
  const s = size / MARK_VIEWBOX;
  const isiM = varian === "putih" ? "#FFFFFF" : BRAND_COLORS.biru;
  const strokeLuar = varian === "putih" ? outline : "#FFFFFF";
  const strokeDalam = varian === "putih" ? "#FFFFFF" : BRAND_COLORS.merah;
  const titikLuar = varian === "putih" ? outline : "#FFFFFF";
  const titikDalam = varian === "putih" ? "#FFFFFF" : BRAND_COLORS.merah;
  return (
    `<g transform="translate(${x},${y}) scale(${s.toFixed(5)})">` +
    `<path d="${PATH_M}" fill="${isiM}"/>` +
    `<path d="${PATH_KURVA}" fill="none" stroke="${strokeLuar}" stroke-width="11" stroke-linecap="round"/>` +
    `<path d="${PATH_KURVA}" fill="none" stroke="${strokeDalam}" stroke-width="5.5" stroke-linecap="round"/>` +
    `<circle cx="88" cy="18" r="7.5" fill="${titikLuar}"/>` +
    `<circle cx="88" cy="18" r="4.5" fill="${titikDalam}"/>` +
    `</g>`
  );
}

/* ── Wordmark (ikon + tulisan MARLIN), latar transparan ─────────────────────
 * Berkas resmi: `public/brand/marlin-wordmark.svg` (user 2026-08-02).
 * viewBox 1195×300, tanpa plat.
 *
 * HURUFNYA VEKTOR, bukan teks. Itu bukan detail sepele: cap foto dulu harus
 * membenamkan font Montserrat subset hanya untuk menulis "MARLIN", dan subset
 * itu jadi jebakan (lihat DECISIONS 224). Dengan path, bentuk logo sama persis
 * di server peraster, di layar, dan di berkas resmi — tanpa font sama sekali.
 */

export const WORDMARK_W = 1195;
export const WORDMARK_H = 300;

/** Huruf M-A-R-L-I-N sebagai path (skala & posisi menyusul berkas resmi). */
const WORDMARK_HURUF: [string, number][] = [
  ["M47 0H439L536 317H1032L1133 0H1529L1017 1490H544ZM619 587 639 651C688 820 732 1008 777 1209C825 1009 874 821 926 651L946 587Z", 330],
  ["M116 0H469V513H661L934 0H1321L1010 569C1175 643 1269 789 1269 995C1269 1299 1062 1490 726 1490H116ZM469 792V1204H651C817 1204 903 1134 903 995C903 856 817 792 652 792Z", 543.544],
  ["M116 0H1092V288H469V1490H116Z", 727.557],
  ["M469 1490H116V0H469Z", 884.993],
  ["M116 0H478V617C478 711 468 873 456 1050C539 872 594 760 682 617L1063 0H1452V1490H1090V856C1090 752 1101 581 1111 432C1048 594 986 707 920 817L504 1490H116Z", 965.517],
];

/** id mask "takik" kurva pada huruf M ikon — harus ada di `<defs>` penyaji. */
export const WORDMARK_MASK_ID = "ml-wm-notch";

/** Isi `<defs>` yang WAJIB disertakan sekali oleh penyaji wordmark. */
export const WORDMARK_DEFS =
  `<mask id="${WORDMARK_MASK_ID}" maskUnits="userSpaceOnUse" x="0" y="0" width="96" height="96">` +
  `<rect x="0" y="0" width="96" height="96" fill="#fff"/>` +
  `<path d="${PATH_KURVA}" fill="none" stroke="#000" stroke-width="11" stroke-linecap="round"/>` +
  `<circle cx="88" cy="18" r="7.5" fill="#000"/>` +
  `</mask>`;

/**
 * Rakit wordmark pada lebar tertentu (tinggi mengikuti rasio 1195:300).
 *
 * `tinta` mengganti navy resmi — dipakai HANYA bila penyajinya memaksa (mis.
 * latar gelap pekat). Default memakai warna resmi.
 *
 * `halo` menambah garis luar di belakang setiap bentuk. Di cap foto itu bukan
 * hiasan: navy di atas bayangan malam sama gelapnya dengan latarnya, dan logo
 * yang lenyap separuh waktu lebih buruk daripada logo yang diberi garis.
 */
export function wordmarkSvgInner(
  x: number,
  y: number,
  width: number,
  opts: { tinta?: string; aksen?: string; halo?: string; haloTebal?: number } = {},
): string {
  const s = width / WORDMARK_W;
  const tinta = opts.tinta ?? BRAND_COLORS.biru;
  const aksen = opts.aksen ?? BRAND_COLORS.merah;
  // Huruf dan ikon hidup di RUANG KOORDINAT BERBEDA (huruf diperkecil 0,134×,
  // ikon diperbesar 3,125×). Satu angka stroke yang sama akan tampil ~23× lebih
  // tebal di ikon daripada di huruf — jadi tebalnya dihitung per ruang dari satu
  // faktor relatif.
  const t = opts.haloTebal ?? 1;
  const h = opts.halo
    ? ` paint-order="stroke" stroke="${opts.halo}" stroke-width="${(60 * t).toFixed(1)}" stroke-linejoin="round"`
    : "";
  const hIkon = opts.halo
    ? ` paint-order="stroke" stroke="${opts.halo}" stroke-width="${(3 * t).toFixed(2)}" stroke-linejoin="round"`
    : "";
  return (
    `<g transform="translate(${x},${y}) scale(${s.toFixed(6)})">` +
    `<g transform="translate(20,-15) scale(3.125)">` +
    `<path d="${PATH_M}" fill="${tinta}"${hIkon} mask="url(#${WORDMARK_MASK_ID})"/>` +
    `<path d="${PATH_KURVA}" fill="none" stroke="${aksen}" stroke-width="5.5" stroke-linecap="round"/>` +
    `<circle cx="88" cy="18" r="4.5" fill="${aksen}"/>` +
    `</g>` +
    WORDMARK_HURUF.map(
      ([d, tx]) =>
        `<path d="${d}" fill="${tinta}"${h} transform="translate(${tx},260) scale(0.13422819,-0.13422819)"/>`,
    ).join("") +
    `</g>`
  );
}

/* ── Lockup ringkas latar gelap ─────────────────────────────────────────────
 * Berkas resmi: `public/brand/marlin-lockup-compact-dark.svg` (user 2026-08-02,
 * revisi kedua). Ikon + wordmark + tagline dua baris di atas plat #08152E,
 * viewBox 1800×640.
 *
 * Revisi ini memakai merah #EF2330 (lebih terang dari #D21F2A di paket pertama)
 * dan tagline #94A3B8. Nilainya diambil apa adanya dari berkas — bukan
 * diselaraskan diam-diam ke palet lama, karena yang lebih baru adalah yang
 * dikirim belakangan. DECISIONS 224.
 */

export const LOCKUP_W = 1800;
export const LOCKUP_H = 640;
/** Merah pada revisi lockup ringkas — sengaja beda dari BRAND_COLORS.merah. */
const LOCKUP_MERAH = "#EF2330";
const LOCKUP_TAGLINE = "#94A3B8";

/**
 * Rakit lockup ringkas pada lebar tertentu (tinggi mengikuti rasio 1800:640).
 *
 * DUA keluarga font, bukan satu — dan ini bukan pilihan gaya:
 * - `fontWordmark` = font display yang dibenamkan cap ("ML"/Montserrat). Font
 *   itu SUBSET, isinya hanya huruf yang dulu dibutuhkan wordmark; ia tidak
 *   punya huruf kecil sama sekali.
 * - `fontTagline` = font teks cap (huruf lengkap). Tagline penuh huruf kecil,
 *   koma, dan "&" — dirender dengan font wordmark ia akan keluar sebagai kotak
 *   kosong, dan cacat itu baru ketahuan setelah ribuan foto tercap.
 *
 * Berkas aslinya menyebut "Inter"; nama itu TIDAK diteruskan karena server
 * peraster tidak punya Inter, dan nama font yang tidak ada berarti bentuk logo
 * berubah-ubah tergantung mesin.
 *
 * Berat tagline: berkas aslinya 600, tetapi font teks cap hanya membenamkan 400
 * & 700. Yang ditulis 700 — memilih berat yang MEMANG ada, bukan berat yang
 * harus ditebak peraster. `beratTagline` bisa dioper penyaji lain yang punya
 * 600 sungguhan.
 */
export function lockupSvgInner(
  x: number,
  y: number,
  width: number,
  fontWordmark: string,
  fontTagline: string,
  opts: { plat?: boolean; beratTagline?: number } = {},
): string {
  const s = width / LOCKUP_W;
  const wTag = opts.beratTagline ?? 700;
  const tanpaPlat = opts.plat === false;

  // TANPA PLAT: tinta putih di atas foto apa pun. Yang menggantikan plat adalah
  // halo gelap tipis di sekeliling setiap bentuk (`paint-order="stroke"`), plus
  // tagline dinaikkan dari abu #94A3B8 ke putih — abu-muda di atas langit siang
  // sama saja dengan tidak ada. Halo bukan hiasan: satu warna solid tanpa
  // outline LENYAP begitu latarnya kebetulan seterang tinta.
  const halo = (size: number) =>
    tanpaPlat
      ? ` paint-order="stroke" stroke="${BRAND_COLORS.latarGelap}" stroke-opacity="0.6" stroke-width="${Math.max(1, size * 0.11).toFixed(1)}" stroke-linejoin="round"`
      : "";
  const fillTagline = tanpaPlat ? "#FFFFFF" : LOCKUP_TAGLINE;

  const t = (
    tx: number,
    ty: number,
    size: number,
    weight: number,
    fill: string,
    tracking: number,
    teks: string,
    keluarga: string,
  ) =>
    `<text x="${tx}" y="${ty}" text-anchor="middle" font-family="${keluarga}" font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}"${halo(size)} fill="${fill}">${teks}</text>`;

  return (
    `<g transform="translate(${x},${y}) scale(${s.toFixed(5)})">` +
    (tanpaPlat
      ? ""
      : `<rect width="${LOCKUP_W}" height="${LOCKUP_H}" fill="${BRAND_COLORS.latarGelap}"/>`) +
    `<g transform="translate(70,110) scale(4.1)">` +
    `<path d="${PATH_M}" fill="#FFFFFF"${tanpaPlat ? ` paint-order="stroke" stroke="${BRAND_COLORS.latarGelap}" stroke-opacity="0.6" stroke-width="6" stroke-linejoin="round"` : ""}/>` +
    `<path d="${PATH_KURVA}" fill="none" stroke="${BRAND_COLORS.latarGelap}" stroke-width="11" stroke-linecap="round"${tanpaPlat ? ' stroke-opacity="0.6"' : ""}/>` +
    `<path d="${PATH_KURVA}" fill="none" stroke="${LOCKUP_MERAH}" stroke-width="5.5" stroke-linecap="round"/>` +
    `<circle cx="88" cy="18" r="7.5" fill="${BRAND_COLORS.latarGelap}"${tanpaPlat ? ' fill-opacity="0.6"' : ""}/>` +
    `<circle cx="88" cy="18" r="4.5" fill="${LOCKUP_MERAH}"/>` +
    `</g>` +
    t(1140, 248, 176, 800, "#FFFFFF", 2, "MARLIN", fontWordmark) +
    t(1140, 405, 48, wTag, fillTagline, 0.1, "Monitoring, Analysis, Reporting &amp; Learning", fontTagline) +
    t(1140, 480, 48, wTag, fillTagline, 0.1, "for Infrastructure Network", fontTagline) +
    `</g>`
  );
}
