import { getContrastText } from "@/lib/photo-stamp/format";
import { MONTSERRAT_800_B64, MONTSERRAT_600_B64 } from "@/lib/logo-font";

/** @font-face Montserrat khusus wordmark logo (family "ML"). Selalu dibenamkan. */
const LOGO_FONT_FACE =
  `<style>` +
  `@font-face{font-family:'ML';font-weight:800;src:url(data:font/ttf;base64,${MONTSERRAT_800_B64}) format('truetype');}` +
  `@font-face{font-family:'ML';font-weight:600;src:url(data:font/ttf;base64,${MONTSERRAT_600_B64}) format('truetype');}` +
  `</style>`;

/**
 * Renderer overlay stamp (SVG) — meniru MASTER LAYOUT referensi:
 *   kiri-atas  : panel perusahaan (navy, aksen vertikal, sudut kanan-bawah rounded)
 *   kanan-atas : MARLIN / PROJECT CONTROL
 *   kiri-bawah : badge kategori → nama lokasi → tanggal → garis → koordinat/pelapor/Photo ID
 *   bawah      : gradient keterbacaan (foto tetap background)
 * Pure & deterministik (tanpa I/O) supaya bisa dipakai server & preview.
 * Font di-embed di pemanggil (photos.ts) dan diteruskan lewat opts.
 */

export type StampRenderData = {
  companyName: string | null;
  locationName: string;
  categoryName: string | null;
  /** Sudah diformat: "Sabtu, 25 Juli 2026 • 16:15 WIB". */
  dateTimeText: string;
  /** Sudah diformat: "6.871010°S, 109.253123°E" — null = sembunyikan. */
  coordinateText: string | null;
  reporterName: string | null; // null = sembunyikan
  photoId: string | null; // null = sembunyikan
  accentColor: string;
  /** Puncak alpha gradient bawah (0..1). */
  overlayAlpha: number;
  /** Skala ukuran stamp (compact .85 / standard 1 / large 1.15). */
  sizeScale: number;
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
/** Estimasi lebar teks (tanpa mesin font) — cukup untuk fit & wrap. */
const estWidth = (text: string, fs: number, bold: boolean) => text.length * fs * (bold ? 0.6 : 0.52);
/** Halo gelap tipis di sekeliling teks → terbaca di atas foto terang/ramai. */
const halo = (fs: number) =>
  `paint-order="stroke" stroke="rgb(${OVERLAY_RGB})" stroke-opacity="0.55" stroke-width="${Math.max(1, fs * 0.09).toFixed(1)}" stroke-linejoin="round"`;

// Path Lucide (viewBox 24) — MapPin, UserRound, Camera.
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

  // ── Panel perusahaan (kiri-atas) ──
  if (d.companyName?.trim()) {
    const company = d.companyName.trim();
    const fsCo = fs(0.023, 16);
    const padH = Math.round(fsCo * 0.95);
    const padV = Math.round(fsCo * 0.72);
    const barW = Math.max(4, Math.round(fsCo * 0.26));
    const gap = Math.round(fsCo * 0.55);
    const cw = estWidth(company, fsCo, true);
    const panelW = Math.round(padH + barW + gap + cw + padH);
    const panelH = Math.round(fsCo + 2 * padV);
    const r = Math.round(panelH * 0.3);
    parts.push(
      `<path d="M0 0 H${panelW} V${panelH - r} Q${panelW} ${panelH} ${panelW - r} ${panelH} H0 Z" fill="${PANEL_FILL}"/>`,
    );
    const barH = Math.round(fsCo * 1.05);
    parts.push(`<rect x="${padH}" y="${Math.round((panelH - barH) / 2)}" width="${barW}" height="${barH}" rx="1" fill="${accent}"/>`);
    parts.push(
      `<text x="${padH + barW + gap}" y="${Math.round(panelH / 2 + fsCo * 0.35)}" font-family="${ff}" font-weight="700" font-size="${fsCo}" ${halo(fsCo)} fill="${TEXT_WHITE}">${esc(company)}</text>`,
    );
  }

  // ── Logo lockup MARLIN (kanan-atas): wordmark (A oranye) + PROJECT CONTROL, transparan ──
  parts.push(marlinLogo(w - safeX, safeY, fs(0.034, 22), accent));

  // ── Blok info (kiri-bawah) ──
  const maxW = portrait ? w - 2 * safeX : Math.round(w * 0.6);
  const fsBadge = fs(0.017, 12);
  const fsLoc0 = fs(0.06, 26);
  const fsDate = fs(0.028, 18);
  const fsMeta = fs(0.021, 15);

  const loc = fitLocation(d.locationName.trim() || "—", maxW, fsLoc0);
  const metaLH = Math.round(fsMeta * 1.6);
  const iconSize = Math.round(fsMeta * 1.15);
  const metaRows: Array<{ ic: keyof typeof ICON_PATHS; text: string; boldTail?: string }> = [];
  if (d.coordinateText) metaRows.push({ ic: "map", text: `Koordinat: ${d.coordinateText}` });
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

  const total =
    (hasBadge ? badgeH + gapBadgeLoc : 0) +
    loc.lines.length * locLineH +
    gapLocDate +
    dateH +
    gapDateDiv +
    2 +
    gapDivMeta +
    metaRows.length * metaLH;

  let cy = h - safeY - total;
  const x = safeX;

  // Badge kategori.
  if (hasBadge) {
    const cat = d.categoryName!.trim().toUpperCase();
    const badgePadH = Math.round(fsBadge * 0.95);
    const badgeW = Math.round(estWidth(cat, fsBadge, true) + 2 * badgePadH);
    parts.push(`<rect x="${x}" y="${cy}" width="${badgeW}" height="${badgeH}" rx="${Math.round(badgeH / 2)}" fill="${accent}"/>`);
    parts.push(
      `<text x="${x + badgeW / 2}" y="${cy + Math.round(badgeH / 2 + fsBadge * 0.35)}" text-anchor="middle" font-family="${ff}" font-weight="700" font-size="${fsBadge}" letter-spacing="${(fsBadge * 0.03).toFixed(1)}" fill="${onAccent}">${esc(cat)}</text>`,
    );
    cy += badgeH + gapBadgeLoc;
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

  // Tanggal & waktu.
  cy += Math.round(fsDate * 0.85);
  parts.push(
    `<text x="${x}" y="${cy}" font-family="${ff}" font-weight="400" font-size="${fsDate}" ${halo(fsDate)} fill="${TEXT_WHITE}">${esc(d.dateTimeText)}</text>`,
  );
  cy += dateH - Math.round(fsDate * 0.85);
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
    if (row.boldTail) {
      parts.push(
        `<text x="${tx}" y="${ty}" font-family="${ff}" font-weight="400" font-size="${fsMeta}" fill="${TEXT_SUBTLE}">${esc(row.text)}<tspan font-weight="700" fill="${TEXT_WHITE}">${esc(row.boldTail)}</tspan></text>`,
      );
    } else {
      parts.push(
        `<text x="${tx}" y="${ty}" font-family="${ff}" font-weight="400" font-size="${fsMeta}" fill="${TEXT_WHITE}">${esc(row.text)}</text>`,
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${opts.fontFaceCss}${LOGO_FONT_FACE}${grad}</defs>${parts.join("")}</svg>`;
}

/**
 * Wordmark MARLIN (vektor, right-aligned di rightX/topY): "MARLIN" tebal putih,
 * aksen diagonal oranye, lalu "PROJECT CONTROL" ber-tracking dgn dash oranye
 * diagonal di kirinya — meniru lockup logo referensi.
 */
// Lebar lanjut (em) Montserrat subset — hasil ukur hmtx (bukan tebakan):
const EM_MARLIN = 4.235; // total "MARLIN" @800
const EM_M = 0.954; // advance "M" @800 (untuk posisi huruf "A")
const EM_A = 0.786; // advance "A" @800
const EM_PROJECT_CONTROL = 10.236; // total "PROJECT CONTROL" @600

/**
 * Logo lockup MARLIN (transparan): wordmark Montserrat ExtraBold + segitiga
 * oranye pada huruf "A" + baris "bar oranye + PROJECT CONTROL". Lebar baris
 * bawah DISETEL SAMA dengan lebar MARLIN (seimbang) memakai lebar font terukur.
 * Oranye = warna aksen aplikasi. Halo gelap agar terbaca di foto apa pun.
 */
function marlinLogo(rightX: number, topY: number, fsM: number, accent: string): string {
  const p: string[] = [];
  const m = Math.round(fsM);
  const trackM = Math.round(fsM * 0.02);
  const mW = Math.round(EM_MARLIN * fsM + trackM * 5); // lebar wordmark (5 celah)
  const left = rightX - mW;
  const baseY = topY + Math.round(fsM * 0.82);

  // Wordmark MARLIN (putih).
  p.push(
    `<text x="${rightX}" y="${baseY}" text-anchor="end" font-family="ML" font-weight="800" font-size="${m}" letter-spacing="${trackM}" ${halo(m)} fill="#FFFFFF">MARLIN</text>`,
  );
  // Aksen: KAKI KIRI huruf "A" berwarna aksen (garis diagonal dari kaki ke apex).
  const aLeft = left + EM_M * fsM + trackM;
  const aWidth = EM_A * fsM;
  const apexX = Math.round(aLeft + aWidth / 2);
  const apexY = baseY - Math.round(fsM * 0.7);
  const footX = Math.round(aLeft + aWidth * 0.12);
  const legW = Math.max(3, Math.round(fsM * 0.16));
  p.push(
    `<line x1="${footX}" y1="${baseY}" x2="${apexX}" y2="${apexY}" stroke="${accent}" stroke-width="${legW}" stroke-linecap="butt"/>`,
  );

  // Baris bawah: bar oranye (kiri) + PROJECT CONTROL — LEBARNYA = lebar MARLIN.
  // Gap ke MARLIN dirapatkan (jangan menempel).
  const fsSub = Math.round(fsM * 0.28);
  const subBase = baseY + Math.round(fsM * 0.5) + fsSub;
  const barW = Math.round(mW * 0.17);
  const gap = Math.round(fsM * 0.16);
  const availW = mW - barW - gap;
  const lsPC = Math.max(0, (availW - EM_PROJECT_CONTROL * fsSub) / 14); // 15 huruf → 14 celah
  const barH = Math.max(4, Math.round(fsSub * 0.5));
  const barMidY = subBase - Math.round(fsSub * 0.34);
  p.push(
    `<rect x="${left}" y="${barMidY - Math.round(barH / 2)}" width="${barW}" height="${barH}" rx="${Math.round(barH / 2)}" fill="${accent}"/>`,
  );
  p.push(
    `<text x="${rightX}" y="${subBase}" text-anchor="end" font-family="ML" font-weight="600" font-size="${fsSub}" letter-spacing="${lsPC.toFixed(1)}" ${halo(fsSub)} fill="#FFFFFF">PROJECT CONTROL</text>`,
  );

  return p.join("");
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
