import type { ScurveSeries } from "@/lib/scurve-data";

/**
 * Kurva-S rencana vs realisasi (SVG, tanpa lib). Server component.
 * X = minggu, Y = progress kumulatif %.
 */
export function ScurveChart({ series }: { series: ScurveSeries }) {
  const { plannedPct, actualPct, currentWeek, totalWeeks } = series;

  if (totalWeeks === 0) {
    return (
      <p className="text-sm text-[#64748B]">
        Belum ada jadwal (milestone) untuk lokasi ini.
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

  const xFor = (i: number) => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const yFor = (pct: number) => padT + (1 - Math.min(Math.max(pct, 0), 100) / 100) * plotH;

  const plannedPts = plannedPct.map((p, i) => `${xFor(i)},${yFor(p)}`).join(" ");
  const actualIdx = actualPct
    .map((p, i) => (p == null ? null : i))
    .filter((i): i is number => i != null);
  const actualPts = actualIdx.map((i) => `${xFor(i)},${yFor(actualPct[i] as number)}`).join(" ");

  const gridY = [0, 25, 50, 75, 100];
  const lastActual = actualIdx.length ? (actualPct[actualIdx[actualIdx.length - 1]] as number) : 0;
  const lastPlanned = plannedPct[currentWeek - 1] ?? plannedPct[plannedPct.length - 1] ?? 0;

  // Label minggu: awal, tengah, akhir (hindari berdempet).
  const weekTicks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

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
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#E2E8F0" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#94A3B8">
                {g}%
              </text>
            </g>
          );
        })}

        {/* penanda minggu berjalan */}
        <line
          x1={xFor(currentWeek - 1)}
          y1={padT}
          x2={xFor(currentWeek - 1)}
          y2={padT + plotH}
          stroke="#CBD5E1"
          strokeWidth={1}
          strokeDasharray="3 3"
        />

        {/* kurva rencana */}
        <polyline
          points={plannedPts}
          fill="none"
          stroke="#94A3B8"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        {/* kurva realisasi */}
        {actualPts && (
          <polyline points={actualPts} fill="none" stroke="#1e3a8a" strokeWidth={2.5} />
        )}
        {actualIdx.map((i) => (
          <circle key={i} cx={xFor(i)} cy={yFor(actualPct[i] as number)} r={2.5} fill="#1e3a8a" />
        ))}

        {/* label minggu — anchor tepi supaya label pertama/terakhir tidak keklip */}
        {weekTicks.map((i) => {
          const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
          return (
            <text key={i} x={xFor(i)} y={H - 8} textAnchor={anchor} fontSize={10} fill="#94A3B8">
              mgg {i + 1}
            </text>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-[#1e3a8a]" /> Realisasi ({lastActual.toFixed(1)}%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-[#94A3B8]" /> Rencana ({lastPlanned.toFixed(1)}%)
        </span>
        <span className="text-[#64748B]">Minggu {currentWeek}/{totalWeeks}</span>
      </div>
    </div>
  );
}
