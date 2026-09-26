import { getContrastText } from "@/lib/photo-stamp/format";
import { WARNA_CAP, type TandaNilai } from "@/lib/photo-stamp/tanda-nilai";
import { MONTSERRAT_800_B64, MONTSERRAT_600_B64 } from "@/lib/logo-font";
import { wordmarkSvgInner, WORDMARK_DEFS, WORDMARK_W, WORDMARK_H } from "@/lib/brand-mark";
import {
  adaTulisanDi,
  letakUnsur,
  pilihTataLetak,
  type KotakTulisan,
  type UkuranCap,
} from "@/lib/photo-stamp/tata-letak";

/** @font-face Montserrat khusus wordmark logo (family "ML"). Selalu dibenamkan. */
const LOGO_FONT_FACE =
  `<style>` +
  `@font-face{font-family:'ML';font-weight:800;src:url(data:font/ttf;base64,${MONTSERRAT_800_B64}) format('truetype');}` +
  `@font-face{font-family:'ML';font-weight:600;src:url(data:font/ttf;base64,${MONTSERRAT_600_B64}) format('truetype');}` +
  `</style>`;

/**
 * Renderer overlay stamp (SVG) — meniru MASTER LAYOUT referensi:
 *   kiri-atas  : panel perusahaan (navy, aksen vertikal, sudut kanan-bawah rounded)
 *   kanan-atas : wordmark resmi MARLIN (ikon + tulisan vektor, DECISIONS 227)
 *   kiri-bawah : badge kategori → nama lokasi → tanggal → garis → koordinat/pelapor/Photo ID
 *   bawah      : gradient keterbacaan (foto tetap background)
 * Pure & deterministik (tanpa I/O) supaya bisa dipakai server & preview.
 * Font di-embed di pemanggil (photos.ts) dan diteruskan lewat opts.
 */

export type StampRenderData = {
  companyName: string | null;
  /**
   * Logo perusahaan sebagai DATA URI (PNG). Bila ada, ia menggantikan wordmark
   * MARLIN di pojok kanan — permintaan user 2026-08-23, DECISIONS 424. Kosong →
   * wordmark MARLIN seperti semula.
   *
   * Data URI, bukan URL: librsvg hanya membaca gambar yang dibenamkan.
   */
  companyLogo?: string | null;
  /**
   * null = baris nama lokasi DISEMBUNYIKAN — foto sudah membawa tag lokasi
   * dari aplikasi kamera (DECISIONS 617).
   */
  locationName: string | null;
  /**
   * Badge besar = BANGUNAN/KATEGORI RAB (mis. "V. PEKERJAAN SHELTER"). Untuk
   * kegiatan lapangan diisi label jenis kegiatan.
   */
  categoryName: string | null;
  /**
   * Baris kecil di bawah badge = ITEM PEKERJAANNYA (mis. "Pembesian Besi Beton
   * D13"). Dipisah dari badge karena satu lokasi KNMP punya belasan bangunan
   * dan nama item kerap sama persis antar bangunan — foto "Pembesian" tanpa
   * menyebut bangunannya tidak bisa dipertanggungjawabkan (DECISIONS 218).
   * null = tidak ada (mis. foto kegiatan lapangan).
   */
  workName?: string | null;
  /**
   * Sudah diformat: "Sabtu, 25 Juli 2026 • 16:15 WIB". null = baris tanggal
   * DISEMBUNYIKAN — foto galeri "gunakan apa adanya" (user 2026-08-24): cap
   * tetap ada (lokasi/pekerjaan/logo) tapi tanpa tag koordinat & waktu.
   */
  dateTimeText: string | null;
  /** Sudah diformat: "6.871010°S, 109.253123°E" — null = sembunyikan. */
  coordinateText: string | null;
  reporterName: string | null; // null = sembunyikan
  photoId: string | null; // null = sembunyikan
  accentColor: string;
  /** Puncak alpha gradient bawah (0..1). */
  overlayAlpha: number;
  /** Skala ukuran stamp (compact .85 / standard 1 / large 1.15). */
  sizeScale: number;
  /**
   * Penanda kejujuran cap (DECISIONS 197) — sejak 2026-09-04 disampaikan lewat
   * WARNA nilainya, bukan tulisan di sebelahnya (ketetapan user: *"cukup
   * mainkan warna pada informasinya"*). Golongan & daftar warnanya di
   * `photo-stamp/tanda-nilai.ts`; `asli` = putih biasa, jadi cap yang normal
   * tidak terlihat "ditandai".
   */
  timeTanda?: TandaNilai;
  coordTanda?: TandaNilai;
  /**
   * Letak tulisan yang SUDAH ada di foto (cap aplikasi kamera, hasil OCR) –
   * cap MARLIN disusun supaya tidak menutupinya (DECISIONS 619). Kosong =
   * tata letak baku.
   */
  hindari?: KotakTulisan[];
};

type RenderOpts = { fontFamily: string; fontFaceCss: string };

const OVERLAY_RGB = "3,14,28";
const PANEL_FILL = "rgba(4,20,38,0.72)";
const TEXT_WHITE = "#FFFFFF";
const TEXT_SUBTLE = "#C7D2E0";


function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}
const clamp = (min: number, v: number, max: number) => Math.round(Math.max(min, Math.min(max, v)));
/** Estimasi lebar teks (tanpa mesin font) – cukup untuk fit & wrap. */
const estWidth = (text: string, fs: number, bold: boolean) => text.length * fs * (bold ? 0.6 : 0.52);
/** Halo gelap tipis di sekeliling teks → terbaca di atas foto terang/ramai. */
const halo = (fs: number) =>
  `paint-order="stroke" stroke="rgb(${OVERLAY_RGB})" stroke-opacity="0.55" stroke-width="${Math.max(1, fs * 0.09).toFixed(1)}" stroke-linejoin="round"`;

// Path Lucide (viewBox 24) – MapPin, UserRound, Camera.
const ICON_PATHS: Record<"map" | "user" | "camera", string> = {
  map: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  camera:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
};
function icon(name: keyof typeof ICON_PATHS, x: number, y: number, size: number, color: string): string {
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
}

/** Muat nama lokasi ke maks 2 baris; kecilkan font bertahap bila perlu (tanpa memotong). */
function fitLocation(name: string, maxW: number, fs0: number): { lines: string[]; fs: number } {
  const floor = fs0 * 0.58;
  let fs = fs0;
  while (estWidth(name, fs, true) > maxW && fs > floor) fs *= 0.95;
  if (estWidth(name, fs, true) <= maxW) return { lines: [name], fs: Math.round(fs) };
  // Dua baris: bagi kata secara greedy, kecilkan lagi bila salah satu baris meluap.
  const words = name.split(/\s+/);
  const split = () => {
    let l1 = "";
    let i = 0;
    for (; i < words.length; i++) {
      const t = l1 ? `${l1} ${words[i]}` : words[i];
      if (estWidth(t, fs, true) > maxW && l1) break;
      l1 = t;
    }
    const l2 = words.slice(i).join(" ");
    return [l1, l2];
  };
  while (fs > floor) {
    const [l1, l2] = split();
    if (l2 && estWidth(l1, fs, true) <= maxW && estWidth(l2, fs, true) <= maxW) return { lines: [l1, l2], fs: Math.round(fs) };
    if (!l2) return { lines: [l1], fs: Math.round(fs) };
    fs *= 0.95;
  }
  const [l1, l2] = split();
  return { lines: l2 ? [l1, l2] : [l1], fs: Math.round(fs) };
}

/**
 * Lebar teks badge (KAPITAL, tebal, ber-letter-spacing).
 *
 * Faktornya DIUKUR, bukan ditebak: merender ketiga contoh nyata lalu memangkas
 * tepi tintanya memberi 0,715–0,724 per huruf. Rumus lama `estWidth` (0,60 +
 * 0,03) meleset ~13% ke bawah – itulah sebabnya teks meluber keluar pill.
 * Dipakai 0,75 sebagai marjin aman; jaminan KERAS-nya tetap `textLength`
 * di bawah, supaya tidak bergantung pada font yang dipakai runtime.
 */
const badgeTextW = (text: string, fs: number) => text.length * fs * 0.75;

/**
 * Pastikan teks badge MUAT di dalam pill yang tidak melebihi lebar aman foto.
 *
 * Tanpa penjagaan ini, nama pekerjaan panjang membuat pill melar melewati tepi
 * kanan foto DAN teksnya ikut terpotong: teks di-anchor di TENGAH pill, jadi
 * begitu pill-nya lebih lebar dari kanvas, titik tengahnya bergeser ke luar
 * layar dan huruf depan ikut terbuang (terlihat di lapangan 28 Juli 2026:
 * "…EKERJAAN SONDIR …" – huruf P-nya hilang).
 *
 * Urutan: kecilkan font sampai batas bawah, baru potong dengan elipsis.
 */
function fitBadge(text: string, maxW: number, fs0: number): { text: string; fs: number } {
  const floor = Math.max(9, fs0 * 0.72);
  const totalW = (t: string, f: number) => badgeTextW(t, f) + 2 * Math.round(f * 0.95);
  let fs = fs0;
  while (totalW(text, fs) > maxW && fs > floor) fs *= 0.95;
  if (totalW(text, fs) <= maxW) return { text, fs: Math.round(fs) };
  let t = text;
  while (t.length > 4 && totalW(`${t.trimEnd()}…`, fs) > maxW) t = t.slice(0, -1);
  return { text: `${t.trimEnd()}…`, fs: Math.round(fs) };
}

/**
 * Lebar teks panel perusahaan (tebal, umumnya KAPITAL).
 *
 * Faktornya DIUKUR seperti `badgeTextW`, bukan ditebak: merender lima nama
 * perusahaan nyata lalu memangkas tepi tintanya memberi 0,566 (campuran) sampai
 * 0,695 (kapital penuh) per huruf. `estWidth` memakai 0,60 untuk tebal – itu
 * MELESET KE BAWAH untuk nama kapital, dan nama perusahaan hampir selalu
 * kapital, jadi teksnya menyembul keluar panel. Dipakai 0,72 sebagai marjin
 * aman; kelebihan lebar hanya menyisakan ruang kosong di panel, sedangkan
 * kekurangan lebar merusak cap yang sudah terbakar ke foto.
 */
const panelTextW = (text: string, fs: number) => text.length * fs * 0.72;

/** Padding + aksen + jarak di sekeliling teks panel perusahaan. */
const panelChromeW = (fs: number) =>
  Math.round(fs * 0.95) * 2 + Math.max(4, Math.round(fs * 0.26)) + Math.round(fs * 0.55);

/**
 * Pastikan panel perusahaan MUAT di ruang kiri, sebelum lockup.
 *
 * Sama polanya dengan `fitBadge`: kecilkan font sampai batas bawah, baru potong
 * dengan elipsis. Nama perusahaan lebih baik dipotong terbaca daripada utuh
 * tapi tertimbun lockup dan hilang di luar tepi foto.
 */
function fitPanel(text: string, maxW: number, fs0: number): { text: string; fs: number } {
  const floor = Math.max(11, fs0 * 0.72);
  const totalW = (t: string, f: number) => panelTextW(t, f) + panelChromeW(f);
  let fs = fs0;
  while (totalW(text, fs) > maxW && fs > floor) fs *= 0.95;
  if (totalW(text, fs) <= maxW) return { text, fs: Math.round(fs) };
  let t = text;
  while (t.length > 4 && totalW(`${t.trimEnd()}…`, fs) > maxW) t = t.slice(0, -1);
  return { text: `${t.trimEnd()}…`, fs: Math.round(fs) };
}

export function buildStampSvg(w: number, h: number, d: StampRenderData, opts: RenderOpts): string {
  const ff = opts.fontFamily;
  const base = Math.min(w, h);
  const S = d.sizeScale;
  const portrait = h > w;
  const fs = (frac: number, min = 11) => Math.max(min, Math.round(base * frac * S));
  const safeX = clamp(28, w * 0.031, 64);
  const safeY = clamp(26, h * 0.03, 56);
  const accent = d.accentColor;
  const onAccent = getContrastText(accent);
  const hindari = d.hindari ?? [];

  const parts: string[] = [];

  /* ══ UKURAN dulu, LETAK kemudian (DECISIONS 619) ══
   *
   * Letak tiap unsur dipilih `pilihTataLetak` dari ukurannya dan dari letak
   * tulisan lama di foto (cap aplikasi kamera). Tanpa tulisan lama hasilnya
   * persis tata letak sebelum 619.
   */

  // ── Kepala: panel perusahaan ⟷ logo ──
  //
  // KEDUANYA MASUK KE DALAM MARJIN AMAN dan berbagi SATU garis tengah – tata
  // letak yang diminta user 2026-08-02 lewat contoh gambar. Tinggi wordmark
  // diikat ke tinggi panel, bukan ke lebar foto: yang harus terlihat sepadan
  // adalah logo dengan nama perusahaan di seberangnya.
  const fsCoDasar = fs(0.023, 16);
  const tinggiPanel = Math.round(fsCoDasar + 2 * Math.round(fsCoDasar * 0.72));
  const wordmarkH = Math.round(tinggiPanel * 0.95);
  const wordmarkW = Math.round((wordmarkH * WORDMARK_W) / WORDMARK_H);
  /*
   * Logo perusahaan: kotaknya SELEBAR wordmark MARLIN (DECISIONS 424a) dan
   * tingginya dilonggarkan 1,25× supaya logo BUJUR SANGKAR juga terbaca. Rasio
   * logo vendor tidak diketahui; `preserveAspectRatio` menempatkannya rata ke
   * sisi luar kotak.
   */
  const logoH = d.companyLogo ? Math.round(wordmarkH * 1.25) : wordmarkH;

  // Panel BERHENTI sebelum logo. Tanpa batas ini nama perusahaan panjang
  // menyelinap di bawah logo lalu keluar tepi foto – dan cap sudah terbakar
  // ke gambar, jadi tidak ada kesempatan kedua memperbaikinya.
  const maxPanelW = Math.max(w * 0.3, w - 2 * safeX - wordmarkW - Math.round(safeX * 0.6));
  const co = d.companyName?.trim() ? fitPanel(d.companyName.trim(), maxPanelW, fsCoDasar) : null;
  const panelW = co ? Math.round(panelTextW(co.text, co.fs) + panelChromeW(co.fs)) : 0;
  const panelH = co ? Math.round(co.fs + 2 * Math.round(co.fs * 0.72)) : 0;

  // ── Blok info ──
  const maxW = portrait ? w - 2 * safeX : Math.round(w * 0.6);
  const fsBadge = fs(0.017, 12);
  const fsLoc0 = fs(0.06, 26);
  const fsDate = fs(0.028, 18);
  const fsMeta = fs(0.021, 15);

  const loc =
    d.locationName === null ? { lines: [] as string[], fs: fsLoc0 } : fitLocation(d.locationName.trim() || "–", maxW, fsLoc0);
  const metaLH = Math.round(fsMeta * 1.6);
  const iconSize = Math.round(fsMeta * 1.15);
  const metaRows: Array<{
    ic: keyof typeof ICON_PATHS;
    text: string;
    boldTail?: string;
    warna?: string;
  }> = [];
  if (d.coordinateText) {
    metaRows.push({
      ic: "map",
      text: `Koordinat: ${d.coordinateText}`,
      warna: WARNA_CAP[d.coordTanda ?? "asli"],
    });
  }
  if (d.reporterName) metaRows.push({ ic: "user", text: "Dilaporkan oleh: ", boldTail: d.reporterName });
  if (d.photoId) metaRows.push({ ic: "camera", text: `Photo ID: ${d.photoId}` });

  const badgePadV = Math.round(fsBadge * 0.5);
  const badgeH = Math.round(fsBadge + 2 * badgePadV);
  const gapBadgeLoc = Math.round(base * 0.016);
  const locLineH = Math.round(loc.fs * 1.06);
  const gapLocDate = Math.round(base * 0.011);
  const dateH = Math.round(fsDate * 1.25);
  const gapDateDiv = Math.round(base * 0.016);
  const gapDivMeta = Math.round(base * 0.014);
  const hasBadge = !!d.categoryName?.trim();
  const fsWork = Math.round(fsBadge * 0.92);
  const workLineH = Math.round(fsWork * 1.28);
  const gapWork = Math.round(base * 0.006);

  // Badge kategori. Lebarnya DIBATASI lebar aman foto; teksnya dikecilkan lalu
  // dipotong bila perlu supaya pill tidak pernah melewati tepi (lihat fitBadge).
  const maxBadgeW = w - 2 * safeX;
  const badge = hasBadge ? fitBadge(d.categoryName!.trim().toUpperCase(), maxBadgeW, fsBadge) : null;
  const badgePadH = badge ? Math.round(badge.fs * 0.95) : 0;
  const badgeW = badge ? Math.min(maxBadgeW, Math.round(badgeTextW(badge.text, badge.fs) + 2 * badgePadH)) : 0;

  // Item pekerjaan – dipotong dengan elipsis, TIDAK dipaksa selebar apa pun.
  const workAsli = d.workName?.trim() || null;
  let workText = workAsli;
  if (workText) {
    while (workText.length > 4 && badgeTextW(workText, fsWork) > maxBadgeW) workText = workText.slice(0, -2);
    if (workText !== workAsli) workText = `${workText.trimEnd()}…`;
  }

  const hasDate = d.dateTimeText != null && d.dateTimeText.trim() !== "";
  const total =
    (hasBadge ? badgeH + gapBadgeLoc : 0) +
    (workText ? workLineH + gapWork : 0) +
    loc.lines.length * locLineH +
    (loc.lines.length > 0 ? gapLocDate : 0) +
    (hasDate ? dateH : 0) +
    gapDateDiv +
    2 +
    gapDivMeta +
    metaRows.length * metaLH;

  // Lebar isi blok (perkiraan) – hanya untuk memilih letak dan lebar bayangan
  // setempat. Teks yang rata kanan di-anchor di tepi kanan, jadi perkiraan
  // yang meleset tidak pernah membuatnya keluar foto.
  const infoW = Math.min(
    w - 2 * safeX,
    Math.round(
      Math.max(
        badgeW,
        workText ? badgeTextW(workText, fsWork) * 0.85 : 0,
        ...loc.lines.map((l) => estWidth(l, loc.fs, true)),
        hasDate ? estWidth(d.dateTimeText!, fsDate, false) : 0,
        ...metaRows.map((r) => iconSize + fsMeta * 0.55 + estWidth(r.text + (r.boldTail ?? ""), fsMeta, !!r.boldTail)),
      ),
    ),
  );

  // ── Pilih letak ──
  const ukuran: UkuranCap = {
    W: w,
    H: h,
    safeX,
    safeY,
    kepalaH: Math.max(tinggiPanel, logoH),
    jarak: Math.round(base * 0.03),
    info: { w: infoW, h: total },
    logo: { w: wordmarkW, h: logoH },
    panel: co ? { w: panelW, h: panelH } : null,
  };
  const tata = pilihTataLetak(ukuran, hindari);
  const letak = letakUnsur(ukuran, tata);
  const infoAtas = tata.tegak !== "bawah";
  const kanan = tata.infoKanan;
  const xKiri = safeX;
  const xKanan = w - safeX;

  // ── Bayangan keterbacaan di belakang blok info ──
  //
  // Selebar foto seperti semula – KECUALI ada tulisan lama di pita itu: di situ
  // bayangan dipersempit ke belakang blok MARLIN saja dan memudar ke dalam,
  // supaya cap aplikasi kamera di sebelahnya tidak ikut digelapkan.
  const a = Math.max(0, Math.min(1, d.overlayAlpha));
  const band = Math.round(h * (portrait ? 0.3 : 0.34));
  // Di atas: bayangan dari tepi atas foto sampai sedikit melewati bawah blok,
  // dan tetap PEKAT sepanjang blok – baris metadata (paling redup) ada di
  // ujung bawahnya, persis di tempat bayangan mulai memudar.
  const bawahInfo = letak.info.y + total;
  const tinggiAtas = Math.min(h, Math.round(bawahInfo + Math.max(safeY * 2, total * 0.45)));
  const pita = infoAtas ? { x: 0, y: 0, w, h: tinggiAtas } : { x: 0, y: h - band, w, h: band };
  const setempat = adaTulisanDi(hindari, pita, w, h);
  const idGrad = infoAtas ? "pga" : "pg";
  let masker = "";
  if (!setempat) {
    parts.push(`<rect x="0" y="${pita.y}" width="${w}" height="${pita.h}" fill="url(#${idGrad})"/>`);
  } else {
    // Selebar blok + ruang pudar ke arah dalam foto; tepi luarnya menempel
    // tepi foto supaya tidak ada garis tegas di sisi itu.
    const pudar = Math.round(Math.max(safeX * 3, infoW * 0.4));
    const lebar = Math.min(w, safeX + infoW + pudar);
    const x0 = kanan ? w - lebar : 0;
    const y0 = infoAtas ? 0 : Math.max(0, h - Math.round(total + safeY + total * 0.35));
    const tinggi = infoAtas ? pita.h : h - y0;
    const mulaiPudar = (1 - Math.min(0.9, pudar / lebar)).toFixed(3);
    masker =
      `<linearGradient id="pm" x1="${kanan ? 1 : 0}" y1="0" x2="${kanan ? 0 : 1}" y2="0">` +
      `<stop offset="0" stop-color="#fff"/><stop offset="${mulaiPudar}" stop-color="#fff"/>` +
      `<stop offset="1" stop-color="#000"/></linearGradient>` +
      `<mask id="pmk" maskUnits="userSpaceOnUse" x="${x0}" y="${y0}" width="${lebar}" height="${tinggi}">` +
      `<rect x="${x0}" y="${y0}" width="${lebar}" height="${tinggi}" fill="url(#pm)"/></mask>`;
    parts.push(
      `<rect x="${x0}" y="${y0}" width="${lebar}" height="${tinggi}" fill="url(#${idGrad})" mask="url(#pmk)"/>`,
    );
  }

  // ── Kepala ──
  // Garis tengah kepala; di bawah bila blok info pindah ke atas (`tukar`).
  const kepalaDiBawah = tata.tegak === "tukar";
  const kepalaTengah = kepalaDiBawah ? h - safeY - tinggiPanel / 2 : safeY + tinggiPanel / 2;
  if (co) {
    const fsCo = co.fs;
    const padH = Math.round(fsCo * 0.95);
    const barW = Math.max(4, Math.round(fsCo * 0.26));
    const gap = Math.round(fsCo * 0.55);
    const px = Math.round(letak.panel!.x);
    const panelY = Math.round(kepalaTengah - panelH / 2);
    const r = Math.round(panelH * 0.28);
    parts.push(`<rect x="${px}" y="${panelY}" width="${panelW}" height="${panelH}" rx="${r}" fill="${PANEL_FILL}"/>`);
    const barH = Math.round(fsCo * 1.05);
    parts.push(
      `<rect x="${px + padH}" y="${Math.round(panelY + (panelH - barH) / 2)}" width="${barW}" height="${barH}" rx="1" fill="${accent}"/>`,
    );
    parts.push(
      `<text x="${px + padH + barW + gap}" y="${Math.round(panelY + panelH / 2 + fsCo * 0.35)}" font-family="${ff}" font-weight="700" font-size="${fsCo}" ${halo(fsCo)} fill="${TEXT_WHITE}">${esc(co.text)}</text>`,
    );
  }

  const logoX = Math.round(letak.logo.x);
  if (d.companyLogo) {
    // Sisi luar kotak dijepit ke marjin aman supaya kelonggaran tinggi tumbuh
    // ke dalam foto, tidak keluar dari tepinya.
    const kotakY = kepalaDiBawah
      ? Math.min(h - safeY - logoH, Math.round(kepalaTengah - logoH / 2))
      : Math.max(safeY, Math.round(kepalaTengah - logoH / 2));
    parts.push(
      `<image x="${logoX}" y="${kotakY}" width="${wordmarkW}" height="${logoH}" ` +
        `preserveAspectRatio="${tata.logoKiri ? "xMinYMid" : "xMaxYMid"} meet" href="${d.companyLogo}"/>`,
    );
  } else {
    parts.push(marlinLogo(logoX, Math.round(kepalaTengah - wordmarkH / 2), wordmarkW));
  }

  // ── Blok info ──
  // Rata kanan = cermin: teks di-anchor di tepi kanan, ikon di kanan teks.
  let cy = Math.round(letak.info.y);
  const anchor = kanan ? ` text-anchor="end"` : "";
  const tx0 = kanan ? xKanan : xKiri;

  if (badge) {
    const bx = kanan ? xKanan - badgeW : xKiri;
    parts.push(`<rect x="${bx}" y="${cy}" width="${badgeW}" height="${badgeH}" rx="${Math.round(badgeH / 2)}" fill="${accent}"/>`);
    // `textLength` = JAMINAN KERAS lebar teks: apa pun fontnya saat runtime,
    // teks dipaksa persis selebar bagian dalam pill, jadi tidak mungkin
    // meluber. Estimasi di atas hanya menentukan ukuran pill-nya.
    const innerW = Math.max(1, badgeW - 2 * badgePadH);
    parts.push(
      `<text x="${bx + badgePadH}" y="${cy + Math.round(badgeH / 2 + badge.fs * 0.35)}" textLength="${innerW}" lengthAdjust="spacingAndGlyphs" font-family="${ff}" font-weight="700" font-size="${badge.fs}" fill="${onAccent}">${esc(badge.text)}</text>`,
    );
    cy += badgeH + gapBadgeLoc;
  }

  // Item pekerjaan – di bawah badge bangunan, sebelum nama lokasi.
  if (workText) {
    cy += Math.round(fsWork * 0.9);
    parts.push(
      `<text x="${tx0}" y="${cy}"${anchor} font-family="${ff}" font-weight="600" font-size="${fsWork}" ${halo(fsWork)} fill="${TEXT_WHITE}">${esc(workText)}</text>`,
    );
    cy += workLineH - Math.round(fsWork * 0.9) + gapWork;
  }

  // Nama lokasi (dominan).
  for (const line of loc.lines) {
    cy += Math.round(loc.fs * 0.82);
    parts.push(
      `<text x="${tx0}" y="${cy}"${anchor} font-family="${ff}" font-weight="700" font-size="${loc.fs}" letter-spacing="${(loc.fs * -0.02).toFixed(1)}" ${halo(loc.fs)} fill="${TEXT_WHITE}">${esc(line)}</text>`,
    );
    cy += locLineH - Math.round(loc.fs * 0.82);
  }
  if (loc.lines.length > 0) cy += gapLocDate;

  // Tanggal & waktu – dilewati bila cap "apa adanya" (tanpa tag waktu).
  if (hasDate) {
    cy += Math.round(fsDate * 0.85);
    const warnaTanggal = WARNA_CAP[d.timeTanda ?? "asli"];
    parts.push(
      `<text x="${tx0}" y="${cy}"${anchor} font-family="${ff}" font-weight="400" font-size="${fsDate}" ${halo(fsDate)} fill="${warnaTanggal}">${esc(d.dateTimeText!)}</text>`,
    );
    cy += dateH - Math.round(fsDate * 0.85);
  }
  cy += gapDateDiv;

  // Garis pemisah. Rata kanan: selebar isi blok, tidak sampai ke tengah foto.
  const divW = kanan ? infoW : portrait ? maxW : Math.round(maxW * 0.9);
  parts.push(
    `<rect x="${kanan ? xKanan - divW : xKiri}" y="${cy}" width="${divW}" height="2" rx="1" fill="#FFFFFF" fill-opacity="0.22"/>`,
  );
  cy += 2 + gapDivMeta;

  // Metadata (ikon aksen + teks).
  for (const row of metaRows) {
    const ix = kanan ? xKanan - iconSize : xKiri;
    parts.push(icon(row.ic, ix, cy, iconSize, accent));
    const tx = kanan ? ix - Math.round(fsMeta * 0.55) : ix + iconSize + Math.round(fsMeta * 0.55);
    const ty = cy + Math.round(iconSize * 0.78);
    const warnaBaris = row.warna ?? TEXT_WHITE;
    // Bayangan teks hanya saat tata letaknya menyesuaikan cap lama: di situ
    // latarnya lebih tipis. Cap baku tetap persis seperti semula.
    const haloMeta = infoAtas || setempat ? ` ${halo(fsMeta)}` : "";
    if (row.boldTail) {
      parts.push(
        `<text x="${tx}" y="${ty}"${anchor} font-family="${ff}" font-weight="400" font-size="${fsMeta}"${haloMeta} fill="${TEXT_SUBTLE}">${esc(row.text)}<tspan font-weight="700" fill="${TEXT_WHITE}">${esc(row.boldTail)}</tspan></text>`,
      );
    } else {
      parts.push(
        `<text x="${tx}" y="${ty}"${anchor} font-family="${ff}" font-weight="400" font-size="${fsMeta}"${haloMeta} fill="${warnaBaris}">${esc(row.text)}</text>`,
      );
    }
    cy += metaLH;
  }

  const stops =
    `<stop offset="0" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="${a.toFixed(3)}"/>` +
    `<stop offset="0.32" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="${(a * 0.81).toFixed(3)}"/>` +
    `<stop offset="0.68" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="${(a * 0.32).toFixed(3)}"/>` +
    `<stop offset="1" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="0"/>`;
  // Atas: memudar dari tepi atas sampai sedikit melewati blok info. Lebih
  // tipis dari bayangan bawah (user 2026-09-26: *"gradient hitamnya terlalu
  // pekat pada informasi pekerjaan"*) – keterbacaannya dibantu bayangan teks.
  const akhirBlok = Math.min(0.95, bawahInfo / Math.max(1, pita.h)).toFixed(3);
  const grad = infoAtas
    ? `<linearGradient id="pga" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="${(a * 0.62).toFixed(3)}"/>` +
      `<stop offset="${akhirBlok}" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="${(a * 0.38).toFixed(3)}"/>` +
      `<stop offset="1" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="0"/></linearGradient>`
    : `<linearGradient id="pg" x1="0" y1="1" x2="0" y2="0">${stops}</linearGradient>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${opts.fontFaceCss}${LOGO_FONT_FACE}${grad}${masker}${WORDMARK_DEFS}</defs>${parts.join("")}</svg>`;
}

/**
 * Wordmark resmi MARLIN di cap foto – berkas `public/brand/marlin-wordmark.svg`
 * (user 2026-08-02): "atur supaya di pojok atas, proporsional dengan informasi
 * nama perusahaan".
 *
 * WARNA RESMI DIPERTAHANKAN (navy + merah). Yang ditambahkan hanya HALO PUTIH:
 * navy di atas bayangan malam sama gelapnya dengan latarnya, dan logo yang
 * lenyap separuh waktu lebih buruk daripada logo yang diberi garis luar. Halo
 * putih – bukan gelap – supaya di foto terang ia praktis tak terlihat dan yang
 * tampak tetap warna resmi.
 *
 * Tidak ada plat, tidak ada tagline. Hurufnya VEKTOR, jadi cap ini tidak lagi
 * bergantung pada font display yang dibenamkan; jebakan subset DECISIONS 224
 * hilang dengan sendirinya.
 */
function marlinLogo(x: number, y: number, lebar: number): string {
  return wordmarkSvgInner(x, y, lebar, { halo: "#FFFFFF" });
}

/** Puncak alpha gradient dari mode overlay (+ luminance area bawah utk mode auto). */
export function overlayAlphaFor(strength: "auto" | "light" | "standard" | "strong", bottomLuminance?: number): number {
  if (strength === "light") return 0.78;
  if (strength === "strong") return 0.97;
  if (strength === "standard") return 0.9;
  // auto: foto terang → overlay lebih kuat; gelap → lebih ringan.
  if (bottomLuminance == null) return 0.9;
  const t = Math.max(0, Math.min(1, bottomLuminance));
  return 0.78 + t * (0.97 - 0.78);
}
