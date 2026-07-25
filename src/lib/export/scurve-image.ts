import "server-only";
import sharp from "sharp";

/**
 * Render grafik kurva-S (rencana putus-putus + realisasi hijau) sebagai PNG —
 * dipakai untuk MENYISIPKAN grafik ke file Excel (exceljs tak bisa gambar chart
 * garis native). Sumbu X = minggu 1..N (anchor 0 di kiri), sumbu Y = 0..100%.
 * Deterministik & server-side (sharp: SVG → PNG).
 *
 * Angka kumulatif = SAMA dgn tabel KKP & kurva PDF (satu sumber, DECISIONS 082).
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function renderScurveChartPng(input: {
  weeks: number[];
  kumulatifRencana: number[];
  kumulatifRealisasi: (number | null)[];
  title?: string;
  /** Skala render (2 = retina, lebih tajam saat di-zoom di Excel). */
  scale?: number;
}): Promise<{ buffer: Buffer; width: number; height: number }> {
  const W = 900;
  const H = 380;
  const M = { top: 34, right: 24, bottom: 34, left: 44 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const N = Math.max(1, input.weeks.length);

  const x = (w: number) => M.left + (w / N) * plotW; // w=0 → sumbu kiri
  const y = (p: number) => M.top + (1 - Math.min(100, Math.max(0, p)) / 100) * plotH;

  // Garis rencana: anchor (0,0%) lalu kumulatif tiap akhir minggu.
  const planPts = [`${x(0)},${y(0)}`, ...input.kumulatifRencana.map((p, i) => `${x(i + 1).toFixed(1)},${y(p).toFixed(1)}`)].join(" ");
  const actualIdx = input.kumulatifRealisasi
    .map((p, i) => (p == null ? null : i))
    .filter((i): i is number => i != null);
  const actualPts =
    actualIdx.length > 0
      ? [`${x(0)},${y(0)}`, ...actualIdx.map((i) => `${x(i + 1).toFixed(1)},${y(input.kumulatifRealisasi[i] as number).toFixed(1)}`)].join(" ")
      : "";

  // Label minggu di sumbu X — jarang bila periode panjang (hindari tumpang tindih).
  const step = N > 40 ? 8 : N > 24 ? 4 : N > 14 ? 2 : 1;
  const weekTicks = input.weeks.filter((w) => w === 1 || w === N || w % step === 0);

  const gridY = [0, 25, 50, 75, 100];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
  ${input.title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="14" font-weight="bold" fill="#0f172a">${esc(input.title)}</text>` : ""}
  ${gridY
    .map(
      (g) =>
        `<line x1="${M.left}" y1="${y(g).toFixed(1)}" x2="${M.left + plotW}" y2="${y(g).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>` +
        `<text x="${M.left - 6}" y="${(y(g) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${g}%</text>`,
    )
    .join("\n  ")}
  ${weekTicks
    .map(
      (w) =>
        `<line x1="${x(w).toFixed(1)}" y1="${M.top}" x2="${x(w).toFixed(1)}" y2="${M.top + plotH}" stroke="#f1f5f9" stroke-width="1"/>` +
        `<text x="${x(w).toFixed(1)}" y="${M.top + plotH + 14}" text-anchor="middle" font-size="9" fill="#64748b">M${w}</text>`,
    )
    .join("\n  ")}
  <rect x="${M.left}" y="${M.top}" width="${plotW}" height="${plotH}" fill="none" stroke="#94a3b8" stroke-width="1"/>
  <polyline points="${planPts}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="6 4"/>
  ${actualPts ? `<polyline points="${actualPts}" fill="none" stroke="#16a34a" stroke-width="2.4"/>` : ""}
  <g transform="translate(${M.left + 8}, ${M.top + 6})">
    <line x1="0" y1="0" x2="26" y2="0" stroke="#64748b" stroke-width="2" stroke-dasharray="6 4"/>
    <text x="32" y="4" font-size="11" fill="#334155">Rencana</text>
    <line x1="100" y1="0" x2="126" y2="0" stroke="#16a34a" stroke-width="2.4"/>
    <text x="132" y="4" font-size="11" fill="#334155">Realisasi</text>
  </g>
</svg>`;

  const scale = input.scale ?? 2;
  const buffer = await sharp(Buffer.from(svg), { density: 72 * scale })
    .resize(W * scale, H * scale)
    .png()
    .toBuffer();
  return { buffer, width: W, height: H };
}
