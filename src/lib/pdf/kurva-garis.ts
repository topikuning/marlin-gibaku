/**
 * PENGGAMBAR KURVA-S SEDERHANA UNTUK PDF — MURNI, hanya MEMFORMAT deret
 * menjadi koordinat. Tidak ada angka progres yang dihitung di sini: deret
 * rencana/realisasi datang dari `getScurveSeries` (calculation layer) lewat
 * snapshot; berkas ini cuma memetakan (minggu, %) → (x, y) di dalam kotak.
 *
 * Dipisah dari renderer supaya geometrinya bisa diuji tanpa pdfkit, dan supaya
 * renderer A4 maupun deck memakai pemetaan yang sama.
 */

export type Titik = { x: number; y: number; minggu: number; pct: number };

export type DeretKurva = {
  totalMinggu: number;
  /** Rencana kumulatif % per minggu (index 0 = minggu 1). */
  planPct: number[];
  /** Realisasi kumulatif % per minggu; null = minggu belum tiba. */
  actualPct: (number | null)[];
};

export type Kotak = { x: number; y: number; w: number; h: number };

export type GeometriKurva = {
  /** Titik rencana, dimulai dari (minggu 0, 0%). */
  rencana: Titik[];
  /** Titik realisasi, dimulai dari (minggu 0, 0%); kosong bila belum ada realisasi. */
  realisasi: Titik[];
  /** Garis bantu horizontal 0/25/50/75/100 %. */
  gridY: { y: number; label: string }[];
  /** Label sumbu minggu (dijarangkan supaya tidak bertumpuk). */
  labelX: { x: number; label: string }[];
  /** x untuk sebuah nomor minggu — dipakai penanda minggu berjalan. */
  xMinggu: (minggu: number) => number;
};

export function titikKurvaGaris(deret: DeretKurva, kotak: Kotak): GeometriKurva {
  const n = Math.max(1, deret.totalMinggu);
  const xMinggu = (m: number) => kotak.x + (Math.max(0, Math.min(n, m)) / n) * kotak.w;
  const yPct = (p: number) => kotak.y + kotak.h - (Math.max(0, Math.min(100, p)) / 100) * kotak.h;

  const rencana: Titik[] = [{ x: xMinggu(0), y: yPct(0), minggu: 0, pct: 0 }];
  for (let i = 0; i < n; i++) {
    const p = deret.planPct[i];
    if (p == null || !Number.isFinite(p)) continue;
    rencana.push({ x: xMinggu(i + 1), y: yPct(p), minggu: i + 1, pct: p });
  }

  const adaRealisasi = deret.actualPct.some((v) => v != null);
  const realisasi: Titik[] = adaRealisasi ? [{ x: xMinggu(0), y: yPct(0), minggu: 0, pct: 0 }] : [];
  if (adaRealisasi) {
    for (let i = 0; i < n; i++) {
      const v = deret.actualPct[i];
      if (v == null || !Number.isFinite(v)) break;
      realisasi.push({ x: xMinggu(i + 1), y: yPct(v), minggu: i + 1, pct: v });
    }
  }

  const gridY = [0, 25, 50, 75, 100].map((p) => ({ y: yPct(p), label: `${p}%` }));

  // Jarak label minggu: paling banyak ±12 label supaya tidak bertumpuk.
  const langkah = Math.max(1, Math.ceil(n / 12));
  const labelX: { x: number; label: string }[] = [];
  for (let m = langkah; m <= n; m += langkah) labelX.push({ x: xMinggu(m), label: String(m) });
  if (labelX.length === 0 || labelX[labelX.length - 1].label !== String(n)) {
    labelX.push({ x: xMinggu(n), label: String(n) });
  }

  return { rencana, realisasi, gridY, labelX, xMinggu };
}
