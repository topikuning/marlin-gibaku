import type { PeriodReport, PeriodCategory } from "@/lib/periodic-report";

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const dFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" });
const p1 = (n: number) => `${n.toFixed(1)}%`;
const p2 = (n: number) => `${n.toFixed(2)}%`;
const dash = (n: number) => (n > 0 ? volFmt.format(n) : "–");

/** Laporan Mingguan/Bulanan format KKP: kurva-S resume + rincian + dokumentasi. */
export function KkpPeriodReport({ r }: { r: PeriodReport }) {
  const judul = r.kind === "mingguan" ? "LAPORAN MINGGUAN PEKERJAAN" : "LAPORAN BULANAN PEKERJAAN";
  const ke = r.kind === "mingguan" ? `Minggu Ke-${r.n}` : `Bulan Ke-${r.n}`;
  const dev = r.deviationPct;

  return (
    <div className="mx-auto max-w-[1000px] bg-white text-[11px] text-slate-900">
      {/* ── Kop ── */}
      <div className="text-center">
        <div className="text-base font-bold uppercase tracking-wide">{judul}</div>
        <div className="text-sm font-semibold">{ke}</div>
        <div className="text-xs text-slate-600">
          Periode {dFmt.format(r.periodeStart)} s/d {dFmt.format(r.periodeEnd)}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2">
        <KV k="Paket Pekerjaan" v={r.paketName} />
        <KV k="Masa Pelaksanaan" v={`${r.masaPelaksanaanHari} Hari Kalender`} />
        <KV k="Lokasi" v={`${r.locationName}, ${r.regency}, ${r.province}`} />
        <KV k="Nilai Kontrak Fisik" v={r.contractValueStr} />
        <KV k="Nomor Kontrak" v={r.contractNumber} />
        <KV k="Kontraktor Pelaksana" v={r.contractorName} />
      </div>

      {/* ── 1. Kurva-S (resume semua pekerjaan) ── */}
      <SectionTitle>1. Kurva-S — Resume Kemajuan Pekerjaan</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_260px]">
        <ScurveMini
          planned={r.scurve.plannedPct}
          actual={r.scurve.actualPct}
          currentWeek={r.scurve.currentWeek}
        />
        <div className="border border-slate-400">
          <Stat label="Rencana (s/d periode)" value={p2(r.planPct)} />
          <Stat label="Realisasi (s/d periode)" value={p2(r.actualPct)} border />
          <Stat
            label="Deviasi"
            value={`${dev >= 0 ? "+" : ""}${p2(dev)}`}
            tone={dev < -5 ? "bad" : dev < 0 ? "warn" : "ok"}
            border
          />
        </div>
      </div>

      {/* Resume per kelompok pekerjaan */}
      <table className="mt-2 w-full border-collapse text-[10px]">
        <thead>
          <tr className="bg-slate-100 text-left">
            <Th w="36px">No.</Th>
            <Th>Uraian Kelompok Pekerjaan</Th>
            <Th align="right" w="90px">Bobot (%)</Th>
            <Th align="right" w="110px">Realisasi s/d (%)</Th>
          </tr>
        </thead>
        <tbody>
          {r.categories.map((c, i) => (
            <tr key={i} className="border-b border-slate-200">
              <Td>{c.roman || i + 1}</Td>
              <Td>{c.name}</Td>
              <Td align="right">{p2(c.bobot)}</Td>
              <Td align="right">{p2(c.bobotSd)}</Td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-bold">
            <Td colSpan={2}>JUMLAH</Td>
            <Td align="right">{p2(r.categories.reduce((s, c) => s + c.bobot, 0))}</Td>
            <Td align="right">{p2(r.totalBobotSd)}</Td>
          </tr>
        </tbody>
      </table>

      {/* ── 2. Rincian capaian per item ── */}
      <SectionTitle>2. Rincian Capaian per Item Pekerjaan</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[9.5px]">
          <thead>
            <tr className="bg-slate-100 text-center">
              <Th rowSpan={2} w="30px">No</Th>
              <Th rowSpan={2} align="left">Uraian Pekerjaan</Th>
              <Th rowSpan={2} align="right" w="70px">Vol. Kontrak</Th>
              <Th rowSpan={2} w="42px">Sat.</Th>
              <Th rowSpan={2} align="right" w="52px">Bobot %</Th>
              <Th colSpan={2}>Realisasi Lalu</Th>
              <Th colSpan={2}>Realisasi {r.kind === "mingguan" ? "Minggu" : "Bulan"} Ini</Th>
              <Th colSpan={3}>S/d {r.kind === "mingguan" ? "Minggu" : "Bulan"} Ini</Th>
              <Th colSpan={2}>Sisa</Th>
            </tr>
            <tr className="bg-slate-100 text-center text-[8.5px]">
              <Th align="right">Vol</Th><Th align="right">%</Th>
              <Th align="right">Vol</Th><Th align="right">%</Th>
              <Th align="right">Vol</Th><Th align="right">%</Th><Th align="right">Bobot%</Th>
              <Th align="right">Vol</Th><Th align="right">%</Th>
            </tr>
          </thead>
          <tbody>
            {r.categories.map((c, ci) => (
              <CategoryBlock key={ci} c={c} />
            ))}
            <tr className="bg-slate-100 font-bold">
              <Td colSpan={4}>J U M L A H</Td>
              <Td align="right">{p2(r.categories.reduce((s, c) => s + c.bobot, 0))}</Td>
              <Td colSpan={2} />
              <Td colSpan={2} align="right">Bobot ini: {p2(r.totalBobotIni)}</Td>
              <Td colSpan={3} align="right">s/d: {p2(r.totalBobotSd)}</Td>
              <Td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-0.5 text-[10px] sm:w-[360px]">
        <KV k={`Bobot Realisasi ${r.kind === "mingguan" ? "Minggu" : "Bulan"} Ini`} v={p2(r.totalBobotIni)} />
        <KV k="Bobot Realisasi s/d Periode" v={p2(r.totalBobotSd)} />
        <KV k="Bobot Rencana s/d Periode" v={p2(r.totalBobotRencanaSd)} />
        <KV k="Deviasi (+/-)" v={`${dev >= 0 ? "+" : ""}${p2(dev)}`} />
      </div>

      {/* ── 3. Kendala & pemulihan ── */}
      {r.deviations.length > 0 && (
        <>
          <SectionTitle>Kendala &amp; Rencana Pemulihan</SectionTitle>
          <ul className="space-y-1 text-[10px]">
            {r.deviations.map((d, i) => (
              <li key={i}>
                <span className="text-slate-500">{dFmt.format(d.at)} — </span>
                <b>Deviasi:</b> {d.cause}
                {d.recovery && (<> · <b>Pemulihan:</b> {d.recovery}</>)}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── 4. Dokumentasi pekerjaan ── */}
      <SectionTitle>3. Dokumentasi Pekerjaan</SectionTitle>
      {r.photos.length === 0 ? (
        <p className="text-[10px] text-slate-400">Belum ada dokumentasi foto pada periode ini.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {r.photos.map((ph) => (
            <figure key={ph.id} className="border border-slate-400">
              <div className="flex items-center justify-between bg-slate-100 px-1.5 py-0.5 text-[8.5px] font-semibold">
                <span className="truncate">{ph.caption}</span>
                <span className="shrink-0 text-slate-600">Bobot {p1(ph.bobot)}</span>
              </div>
              {ph.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ph.thumbUrl} alt={ph.caption} className="h-32 w-full object-cover" />
              ) : (
                <div className="flex h-32 w-full items-center justify-center bg-slate-50 text-[8.5px] text-slate-400">
                  (foto)
                </div>
              )}
            </figure>
          ))}
        </div>
      )}

      {/* ── TTD ── */}
      <div className="mt-6 grid grid-cols-3 gap-4 text-center text-[10px]">
        <Sign title="Mengetahui" role="Pejabat Pembuat Komitmen" />
        <Sign title="Diperiksa" role="Konsultan Pengawas" />
        <Sign title="Dibuat Oleh" role="Penyedia Jasa" />
      </div>
    </div>
  );
}

function CategoryBlock({ c }: { c: PeriodCategory }) {
  return (
    <>
      <tr className="bg-slate-50 font-semibold">
        <Td>{c.roman}</Td>
        <Td colSpan={3}>{c.name}</Td>
        <Td align="right">{p2(c.bobot)}</Td>
        <Td colSpan={9} />
      </tr>
      {c.rows.map((it) => (
        <tr key={it.no} className="border-b border-slate-100">
          <Td align="right">{it.no}</Td>
          <Td>{it.name}</Td>
          <Td align="right">{volFmt.format(it.volumeKontrak)}</Td>
          <Td align="center">{it.unit}</Td>
          <Td align="right">{it.bobot.toFixed(2)}</Td>
          <Td align="right">{dash(it.volLalu)}</Td>
          <Td align="right">{it.prestasiLalu > 0 ? p1(it.prestasiLalu) : "–"}</Td>
          <Td align="right">{dash(it.volIni)}</Td>
          <Td align="right">{it.prestasiIni > 0 ? p1(it.prestasiIni) : "–"}</Td>
          <Td align="right">{dash(it.volSd)}</Td>
          <Td align="right">{it.prestasiSd > 0 ? p1(it.prestasiSd) : "–"}</Td>
          <Td align="right">{it.bobotSd > 0 ? it.bobotSd.toFixed(2) : "–"}</Td>
          <Td align="right">{dash(it.sisaVol)}</Td>
          <Td align="right">{it.sisaPrestasi > 0 ? p1(it.sisaPrestasi) : "–"}</Td>
        </tr>
      ))}
    </>
  );
}

/** Kurva-S mini inline SVG (rencana vs realisasi). */
function ScurveMini({
  planned,
  actual,
  currentWeek,
}: {
  planned: number[];
  actual: (number | null)[];
  currentWeek: number;
}) {
  const W = 560;
  const H = 200;
  const padL = 34;
  const padB = 22;
  const padT = 10;
  const padR = 8;
  const n = Math.max(planned.length, 1);
  const x = (i: number) => padL + (i / Math.max(n - 1, 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / 100) * (H - padT - padB);
  const planPath = planned.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const actPts = actual
    .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter((s): s is string => s !== null);
  const actPath = actPts.length ? "M" + actPts.join(" L") : "";
  const grid = [0, 20, 40, 60, 80, 100];

  return (
    <div className="border border-slate-400 p-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 210 }}>
        {grid.map((g) => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={padL - 4} y={y(g) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{g}%</text>
          </g>
        ))}
        {currentWeek > 0 && currentWeek <= n && (
          <line x1={x(currentWeek - 1)} y1={padT} x2={x(currentWeek - 1)} y2={H - padB} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
        )}
        {planPath && <path d={planPath} fill="none" stroke="#1e3a8a" strokeWidth="2" />}
        {actPath && <path d={actPath} fill="none" stroke="#16a34a" strokeWidth="2" />}
        <text x={W - padR} y={H - 6} textAnchor="end" fontSize="9" fill="#94a3b8">Minggu 1..{n}</text>
      </svg>
      <div className="flex gap-4 px-1 pb-0.5 text-[9px]">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[#1e3a8a]" /> Rencana</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[#16a34a]" /> Realisasi</span>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 mb-1.5 border-b-2 border-slate-700 pb-0.5 text-xs font-bold uppercase tracking-wide">
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="w-40 shrink-0 text-slate-500">{k}</span>
      <span className="text-slate-500">:</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function Th({
  children,
  align = "center",
  w,
  colSpan,
  rowSpan,
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  w?: string;
  colSpan?: number;
  rowSpan?: number;
}) {
  return (
    <th
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={w ? { width: w } : undefined}
      className={`border border-slate-300 px-1 py-0.5 font-semibold ${align === "right" ? "text-right" : align === "left" ? "text-left" : "text-center"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  colSpan,
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`border border-slate-200 px-1 py-0.5 ${align === "right" ? "text-right tabular-nums" : align === "center" ? "text-center" : "text-left"}`}
    >
      {children}
    </td>
  );
}

function Stat({
  label,
  value,
  tone,
  border,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
  border?: boolean;
}) {
  const color = tone === "bad" ? "text-[#DC2626]" : tone === "warn" ? "text-amber-600" : "text-slate-900";
  return (
    <div className={`px-2.5 py-2 ${border ? "border-t border-slate-300" : ""}`}>
      <div className="text-[9px] uppercase text-slate-500">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Sign({ title, role }: { title: string; role: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase text-slate-500">{title}</div>
      <div className="font-semibold">{role}</div>
      <div className="mt-10 border-t border-slate-400 pt-1 text-slate-500">( …………………… )</div>
    </div>
  );
}
