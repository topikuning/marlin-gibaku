import type { PeriodReport } from "@/lib/periodic-report";

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const dFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" });
const pct = (n: number) => `${n.toFixed(1)}%`;

/** Laporan Mingguan/Bulanan format KKP (cover + ringkasan) — preview & cetak A4. */
export function KkpPeriodReport({ r }: { r: PeriodReport }) {
  const judul = r.kind === "mingguan" ? "Laporan Mingguan" : "Laporan Bulanan";
  const ke = r.kind === "mingguan" ? `Minggu Ke-${r.n}` : `Bulan Ke-${r.n}`;
  const dev = r.deviationPct;

  return (
    <div className="mx-auto max-w-[900px] bg-white text-slate-900">
      {/* Cover */}
      <div className="border border-slate-500 p-6 text-center">
        <div className="text-lg font-bold uppercase tracking-wide">{judul}</div>
        <div className="text-sm text-slate-600">Pembangunan Kampung Nelayan Merah Putih (KNMP)</div>
        <div className="mt-4 text-base font-semibold uppercase">{ke}</div>
        <div className="mt-1 text-sm text-slate-700">
          Periode {dFmt.format(r.periodeStart)} s/d {dFmt.format(r.periodeEnd)}
        </div>
        <div className="mx-auto mt-6 grid max-w-lg grid-cols-1 gap-1 text-left text-sm">
          <Field k="Nomor Kontrak" v={r.contractNumber} />
          <Field k="Pekerjaan" v="Konstruksi KNMP" />
          <Field k="Lokasi" v={`${r.locationName}, ${r.regency}, ${r.province}`} />
          <Field k="Tahun Anggaran" v={String(r.tahunAnggaran)} />
        </div>
      </div>

      {/* Ringkasan progres */}
      <div className="mt-4 border border-slate-500">
        <div className="border-b border-slate-500 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-600">
          Ringkasan Progres (kumulatif s/d akhir periode)
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-300 text-center">
          <Stat label="Rencana" value={pct(r.planPct)} />
          <Stat label="Realisasi" value={pct(r.actualPct)} />
          <Stat label="Deviasi" value={`${dev >= 0 ? "+" : ""}${pct(dev)}`} tone={dev < -5 ? "bad" : dev < 0 ? "warn" : "ok"} />
        </div>
      </div>

      {/* Realisasi pekerjaan */}
      <div className="mt-4 border border-slate-500">
        <div className="border-b border-slate-500 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-600">
          Realisasi Pekerjaan Periode Ini
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs text-slate-500">
              <th className="px-3 py-1 font-medium">No</th>
              <th className="px-3 py-1 font-medium">Uraian</th>
              <th className="px-3 py-1 text-right font-medium">Volume</th>
            </tr>
          </thead>
          <tbody>
            {r.items.length ? (
              r.items.map((it, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-3 py-1 text-slate-500">{i + 1}</td>
                  <td className="px-3 py-1">{it.name}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{volFmt.format(it.volume)} {it.unit}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={3} className="px-3 py-2 text-slate-400">Tidak ada realisasi tercatat pada periode ini.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Kendala & pemulihan */}
      <div className="mt-4 border border-slate-500">
        <div className="border-b border-slate-500 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-600">
          Kendala & Rencana Pemulihan
        </div>
        <div className="p-3 text-sm">
          {r.deviations.length ? (
            <ul className="space-y-2">
              {r.deviations.map((d, i) => (
                <li key={i}>
                  <span className="text-slate-500">{dFmt.format(d.at)} — </span>
                  <span className="font-medium">Deviasi:</span> {d.cause}
                  {d.recovery && (<><br /><span className="font-medium">Pemulihan:</span> {d.recovery}</>)}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-slate-400">Tidak ada catatan kendala pada periode ini.</span>
          )}
        </div>
      </div>

      {/* TTD */}
      <div className="mt-4 grid grid-cols-2 gap-4 border border-slate-500">
        <div className="border-r border-slate-500 px-3 py-3 text-center text-sm">
          <div className="text-[11px] font-semibold uppercase text-slate-600">Konsultan Pengawas</div>
          <div className="mt-12 border-t border-slate-400 pt-1 text-slate-500">( …………………… )</div>
        </div>
        <div className="px-3 py-3 text-center text-sm">
          <div className="text-[11px] font-semibold uppercase text-slate-600">Kontraktor Pelaksana</div>
          <div className="mt-12 border-t border-slate-400 pt-1 text-slate-500">( …………………… )</div>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-36 shrink-0 text-slate-500">{k}</span>
      <span className="text-slate-500">:</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-[#DC2626]" : tone === "warn" ? "text-amber-600" : "text-slate-900";
  return (
    <div className="px-3 py-3">
      <div className="text-[11px] uppercase text-slate-500">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
