import type { ScurveSeries } from "@/lib/baseline";

/**
 * Kurva-S rencana vs realisasi (SVG, tanpa lib chart). Server component —
 * port dari b6e77af src/components/knmp/scurve-chart.tsx; warna hardcoded
 * lama diganti CSS var design token supaya konsisten dgn tema.
 * X = minggu, Y = progress kumulatif %.
 */
export function ScurveChart({
  series,
}: {
  series: Pick<ScurveSeries, "totalWeeks" | "currentWeek" | "planPct" | "actualPct">;
}) {
  const { planPct, actualPct, currentWeek, totalWeeks } = series;

  if (totalWeeks === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Belum ada baseline kurva-S untuk lokasi ini. Impor RAB untuk membuatnya otomatis.
      </p>
    );
  }

  const W = 640;
  const H = 280;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = totalWeeks;

  // Ada data realisasi? (pratinjau editor kirim semua null → sembunyikan.)
  const hasActual = actualPct.some((v) => v != null);

  // Sumbu-X = akhir minggu 0..n; indeks 0 = MULAI proyek (0%), indeks k = akhir
  // minggu k. Anchor 0% di awal supaya kurva mulai dari 0 (bukan "agak naik").
  const plan = [0, ...planPct];
  const actual: (number | null)[] = [hasActual ? 0 : null, ...actualPct];

  const xFor = (i: number) => padL + (i / n) * plotW;
  const yFor = (pct: number) => padT + (1 - Math.min(Math.max(pct, 0), 100) / 100) * plotH;

  const planPts = plan.map((p, i) => `${xFor(i)},${yFor(p)}`).join(" ");
  const actualIdx = actual
    .map((p, i) => (p == null ? null : i))
    .filter((i): i is number => i != null);
  const actualPts = actualIdx.map((i) => `${xFor(i)},${yFor(actual[i] as number)}`).join(" ");

  const gridY = [0, 25, 50, 75, 100];
  const lastActual = actualIdx.length ? (actual[actualIdx[actualIdx.length - 1]] as number) : 0;
  const lastPlan = planPct[currentWeek - 1] ?? planPct[planPct.length - 1] ?? 0;

  // Label minggu: mulai (0), tengah, akhir.
  const weekTicks = [...new Set([0, Math.round(n / 2), n])];

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Kurva-S rencana vs realisasi"
      >
        {/* gridlines + label Y */}
        {gridY.map((g) => {
          const y = yFor(g);
          return (
            <g key={g}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--color-border)" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--color-ink-faint)">
                {g}%
              </text>
            </g>
          );
        })}

        {/* penanda minggu berjalan (akhir minggu berjalan = indeks currentWeek) */}
        {hasActual && (
          <line
            x1={xFor(currentWeek)}
            y1={padT}
            x2={xFor(currentWeek)}
            y2={padT + plotH}
            stroke="var(--color-border-strong)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* kurva rencana */}
        <polyline
          points={planPts}
          fill="none"
          stroke="var(--color-ink-faint)"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        {/* kurva realisasi */}
        {actualPts && (
          <polyline points={actualPts} fill="none" stroke="var(--color-primary)" strokeWidth={2.5} />
        )}
        {actualIdx.map((i) => (
          <circle key={i} cx={xFor(i)} cy={yFor(actualPct[i] as number)} r={2.5} fill="var(--color-primary)" />
        ))}

        {/* label minggu — anchor tepi supaya label pertama/terakhir tidak keklip */}
        {weekTicks.map((i) => {
          const anchor = i === 0 ? "start" : i === n ? "end" : "middle";
          return (
            <text key={i} x={xFor(i)} y={H - 8} textAnchor={anchor} fontSize={10} fill="var(--color-ink-faint)">
              {i === 0 ? "mulai" : `mgg ${i}`}
            </text>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
        {hasActual && (
          <span className="flex items-center gap-1.5 text-ink">
            <span aria-hidden className="inline-block h-0.5 w-5 bg-primary" /> Realisasi (
            {lastActual.toFixed(1)}%)
          </span>
        )}
        <span className="flex items-center gap-1.5 text-ink">
          <span aria-hidden className="inline-block h-0.5 w-5 border-t-2 border-dashed border-ink-faint" /> Rencana (
          {lastPlan.toFixed(1)}%)
        </span>
        {hasActual && (
          <span className="text-ink-muted">
            Minggu {currentWeek}/{totalWeeks}
          </span>
        )}
      </div>
    </div>
  );
}
