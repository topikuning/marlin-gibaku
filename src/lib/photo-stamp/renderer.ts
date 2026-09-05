import { getContrastText } from "@/lib/photo-stamp/format";
import { WARNA_CAP, type TandaNilai } from "@/lib/photo-stamp/tanda-nilai";
import { MONTSERRAT_800_B64, MONTSERRAT_600_B64 } from "@/lib/logo-font";
import { wordmarkSvgInner, WORDMARK_DEFS, WORDMARK_W, WORDMARK_H } from "@/lib/brand-mark";

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
  locationName: string;
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

  const parts: string[] = [];

  // ── Gradient keterbacaan (bawah) ──
  const a = Math.max(0, Math.min(1, d.overlayAlpha));
  const band = Math.round(h * (portrait ? 0.3 : 0.34));
  parts.push(
    `<rect x="0" y="${h - band}" width="${w}" height="${band}" fill="url(#pg)"/>`,
  );

  // ── Baris kepala: panel perusahaan (kiri) ⟷ wordmark MARLIN (kanan) ──
  //
  // KEDUANYA MASUK KE DALAM MARJIN AMAN dan berbagi SATU garis tengah –
  // tata letak yang diminta user 2026-08-02 lewat contoh gambar. Sebelumnya
  // panel menempel mati di sudut (0,0) sementara wordmark inset, jadi keduanya
  // tidak pernah sejajar dan jarak ke tepi foto berbeda kiri-kanan.
  //
  // Tinggi wordmark diikat ke tinggi panel, bukan ke lebar foto: yang harus
  // terlihat sepadan adalah logo dengan nama perusahaan di seberangnya, dan
  // ukuran yang mengikuti lebar foto membuat hubungan itu berubah-ubah antara
  // potret dan lanskap.
  const fsCoDasar = fs(0.023, 16);
  const tinggiPanel = Math.round(fsCoDasar + 2 * Math.round(fsCoDasar * 0.72));
  const wordmarkH = Math.round(tinggiPanel * 0.95);
  const wordmarkW = Math.round((wordmarkH * WORDMARK_W) / WORDMARK_H);
  const logoKiri = w - safeX - wordmarkW;
  const kepalaTengah = safeY + tinggiPanel / 2;

  if (d.companyName?.trim()) {
    // Panel BERHENTI sebelum wordmark. Tanpa batas ini nama perusahaan panjang
    // menyelinap di bawah logo lalu keluar tepi kanan foto – dan cap sudah
    // terbakar ke gambar, jadi tidak ada kesempatan kedua memperbaikinya.
    const maxPanelW = Math.max(w * 0.3, logoKiri - safeX - Math.round(safeX * 0.6));
    const co = fitPanel(d.companyName.trim(), maxPanelW, fsCoDasar);
    const company = co.text;
    const fsCo = co.fs;
    const padH = Math.round(fsCo * 0.95);
    const barW = Math.max(4, Math.round(fsCo * 0.26));
    const gap = Math.round(fsCo * 0.55);
    const panelW = Math.round(panelTextW(company, fsCo) + panelChromeW(fsCo));
    const panelH = Math.round(fsCo + 2 * Math.round(fsCo * 0.72));
    const panelY = Math.round(kepalaTengah - panelH / 2);
    const r = Math.round(panelH * 0.28);
    parts.push(
      `<rect x="${safeX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="${r}" fill="${PANEL_FILL}"/>`,
    );
    const barH = Math.round(fsCo * 1.05);
    parts.push(
      `<rect x="${safeX + padH}" y="${Math.round(panelY + (panelH - barH) / 2)}" width="${barW}" height="${barH}" rx="1" fill="${accent}"/>`,
    );
    parts.push(
      `<text x="${safeX + padH + barW + gap}" y="${Math.round(panelY + panelH / 2 + fsCo * 0.35)}" font-family="${ff}" font-weight="700" font-size="${fsCo}" ${halo(fsCo)} fill="${TEXT_WHITE}">${esc(company)}</text>`,
    );
  }

  /*
   * ── Logo kanan: milik PERUSAHAAN bila ada, kalau tidak wordmark MARLIN ──
   *
   * Rasio logo vendor tidak diketahui (bisa bujur sangkar, bisa memanjang).
   * Kotak muatnya dipatok pada TINGGI wordmark dan lebar maksimum 2,2× tinggi
   * itu, lalu `preserveAspectRatio` menempatkannya rata kanan. Tanpa batas
   * lebar, logo memanjang akan menabrak panel nama perusahaan – dan cap sudah
   * terbakar ke gambar, jadi tidak ada kesempatan kedua. DECISIONS 424.
   */
  const logoY = Math.round(kepalaTengah - wordmarkH / 2);
  if (d.companyLogo) {
    /*
     * Kotaknya SELEBAR wordmark MARLIN, bukan lebih sempit (DECISIONS 424a).
     *
     * Versi pertama memakai 2,2× tinggi wordmark. Wordmark MARLIN sendiri
     * hampir 4:1, jadi logo perusahaan yang juga memanjang dipaskan pada lebar
     * yang jauh lebih sempit dan menyusut tinggal seperempatnya – persis yang
     * dikeluhkan user. Memakai lebar yang sama tidak menambah risiko tabrakan:
     * `logoKiri` (yang membatasi panel nama perusahaan) memang dihitung dari
     * lebar itu.
     *
     * Tingginya dilonggarkan 1,25× supaya logo BUJUR SANGKAR juga terbaca, dan
     * sisi atasnya dijepit ke marjin aman supaya kelonggaran itu tumbuh ke
     * bawah, tidak keluar dari tepi foto.
     */
    const kotakH = Math.round(wordmarkH * 1.25);
    const kotakY = Math.max(safeY, Math.round(kepalaTengah - kotakH / 2));
    parts.push(
      `<image x="${logoKiri}" y="${kotakY}" width="${wordmarkW}" height="${kotakH}" ` +
        `preserveAspectRatio="xMaxYMid meet" href="${d.companyLogo}"/>`,
    );
  } else {
    parts.push(marlinLogo(logoKiri, logoY, wordmarkW));
  }

  // ── Blok info (kiri-bawah) ──
  const maxW = portrait ? w - 2 * safeX : Math.round(w * 0.6);
  const fsBadge = fs(0.017, 12);
  const fsLoc0 = fs(0.06, 26);
  const fsDate = fs(0.028, 18);
  const fsMeta = fs(0.021, 15);

  const loc = fitLocation(d.locationName.trim() || "–", maxW, fsLoc0);
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
  const workText = d.workName?.trim() || null;
  const fsWork = Math.round(fsBadge * 0.92);
  const workLineH = Math.round(fsWork * 1.28);
  const gapWork = Math.round(base * 0.006);

  const hasDate = d.dateTimeText != null && d.dateTimeText.trim() !== "";
  const total =
    (hasBadge ? badgeH + gapBadgeLoc : 0) +
    (workText ? workLineH + gapWork : 0) +
    loc.lines.length * locLineH +
    gapLocDate +
    (hasDate ? dateH : 0) +
    gapDateDiv +
    2 +
    gapDivMeta +
    metaRows.length * metaLH;

  let cy = h - safeY - total;
  const x = safeX;

  // Badge kategori. Lebarnya DIBATASI lebar aman foto; teksnya dikecilkan lalu
  // dipotong bila perlu supaya pill tidak pernah melewati tepi (lihat fitBadge).
  if (hasBadge) {
    const cat = d.categoryName!.trim().toUpperCase();
    const maxBadgeW = w - 2 * safeX;
    const fit = fitBadge(cat, maxBadgeW, fsBadge);
    const badgePadH = Math.round(fit.fs * 0.95);
    const badgeW = Math.min(maxBadgeW, Math.round(badgeTextW(fit.text, fit.fs) + 2 * badgePadH));
    parts.push(`<rect x="${x}" y="${cy}" width="${badgeW}" height="${badgeH}" rx="${Math.round(badgeH / 2)}" fill="${accent}"/>`);
    // `textLength` = JAMINAN KERAS lebar teks: apa pun fontnya saat runtime,
    // teks dipaksa persis selebar bagian dalam pill, jadi tidak mungkin
    // meluber. Estimasi di atas hanya menentukan ukuran pill-nya.
    const innerW = Math.max(1, badgeW - 2 * badgePadH);
    parts.push(
      `<text x="${x + badgePadH}" y="${cy + Math.round(badgeH / 2 + fit.fs * 0.35)}" textLength="${innerW}" lengthAdjust="spacingAndGlyphs" font-family="${ff}" font-weight="700" font-size="${fit.fs}" fill="${onAccent}">${esc(fit.text)}</text>`,
    );
    cy += badgeH + gapBadgeLoc;
  }

  // Item pekerjaan – di bawah badge bangunan, sebelum nama lokasi. Dipotong
  // dengan elipsis, TIDAK dipaksa selebar apa pun: ini kalimat, bukan pill.
  if (workText) {
    const maxW = w - 2 * safeX;
    let teks = workText;
    while (teks.length > 4 && badgeTextW(teks, fsWork) > maxW) {
      teks = teks.slice(0, -2);
    }
    if (teks !== workText) teks = `${teks.trimEnd()}…`;
    cy += Math.round(fsWork * 0.9);
    parts.push(
      `<text x="${x}" y="${cy}" font-family="${ff}" font-weight="600" font-size="${fsWork}" ${halo(fsWork)} fill="${TEXT_WHITE}">${esc(teks)}</text>`,
    );
    cy += workLineH - Math.round(fsWork * 0.9) + gapWork;
  }

  // Nama lokasi (dominan).
  for (const line of loc.lines) {
    cy += Math.round(loc.fs * 0.82);
    parts.push(
      `<text x="${x}" y="${cy}" font-family="${ff}" font-weight="700" font-size="${loc.fs}" letter-spacing="${(loc.fs * -0.02).toFixed(1)}" ${halo(loc.fs)} fill="${TEXT_WHITE}">${esc(line)}</text>`,
    );
    cy += locLineH - Math.round(loc.fs * 0.82);
  }
  cy += gapLocDate;

  // Tanggal & waktu – dilewati bila cap "apa adanya" (tanpa tag waktu).
  if (hasDate) {
    cy += Math.round(fsDate * 0.85);
    const warnaTanggal = WARNA_CAP[d.timeTanda ?? "asli"];
    parts.push(
      `<text x="${x}" y="${cy}" font-family="${ff}" font-weight="400" font-size="${fsDate}" ${halo(fsDate)} fill="${warnaTanggal}">${esc(d.dateTimeText!)}</text>`,
    );
    cy += dateH - Math.round(fsDate * 0.85);
  }
  cy += gapDateDiv;

  // Garis pemisah.
  const divW = portrait ? maxW : Math.round(maxW * 0.9);
  parts.push(`<rect x="${x}" y="${cy}" width="${divW}" height="2" rx="1" fill="#FFFFFF" fill-opacity="0.22"/>`);
  cy += 2 + gapDivMeta;

  // Metadata (ikon aksen + teks).
  for (const row of metaRows) {
    parts.push(icon(row.ic, x, cy, iconSize, accent));
    const tx = x + iconSize + Math.round(fsMeta * 0.55);
    const ty = cy + Math.round(iconSize * 0.78);
    const warnaBaris = row.warna ?? TEXT_WHITE;
    if (row.boldTail) {
      parts.push(
        `<text x="${tx}" y="${ty}" font-family="${ff}" font-weight="400" font-size="${fsMeta}" fill="${TEXT_SUBTLE}">${esc(row.text)}<tspan font-weight="700" fill="${TEXT_WHITE}">${esc(row.boldTail)}</tspan></text>`,
      );
    } else {
      parts.push(
        `<text x="${tx}" y="${ty}" font-family="${ff}" font-weight="400" font-size="${fsMeta}" fill="${warnaBaris}">${esc(row.text)}</text>`,
      );
    }
    cy += metaLH;
  }

  const grad =
    `<linearGradient id="pg" x1="0" y1="1" x2="0" y2="0">` +
    `<stop offset="0" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="${a.toFixed(3)}"/>` +
    `<stop offset="0.32" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="${(a * 0.81).toFixed(3)}"/>` +
    `<stop offset="0.68" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="${(a * 0.32).toFixed(3)}"/>` +
    `<stop offset="1" stop-color="rgb(${OVERLAY_RGB})" stop-opacity="0"/>` +
    `</linearGradient>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${opts.fontFaceCss}${LOGO_FONT_FACE}${grad}${WORDMARK_DEFS}</defs>${parts.join("")}</svg>`;
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
