import type { ReactNode } from "react";
import type { PeriodCategory, PeriodReport } from "@/lib/periodic-report";

/**
 * Laporan Mingguan/Bulanan format KKP — layout tabel besar A4 landscape-friendly.
 * Struktur & format dipertahankan dari versi lama (b6e77af):
 * kop → identitas → resume kemajuan → rincian per kategori/item → agregat
 * tenaga/material/alat/cuaca → kendala → blok tanda tangan.
 * Server component murni (tanpa state) — dipakai preview inline dan halaman cetak.
 */

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const rupiahFmt = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const dFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" });
const p1 = (n: number) => `${n.toFixed(1)}%`;
const p2 = (n: number) => `${n.toFixed(2)}%`;
const dash = (n: number) => (n > 0 ? volFmt.format(n) : "–");

export function KkpPeriodReport({ r }: { r: PeriodReport }) {
  const judul = r.kind === "mingguan" ? "LAPORAN MINGGUAN PEKERJAAN" : "LAPORAN BULANAN PEKERJAAN";
  const ke = r.kind === "mingguan" ? `Minggu Ke-${r.n}` : `Bulan Ke-${r.n}`;
  const periodeLabel = r.kind === "mingguan" ? "Minggu" : "Bulan";
  const dev = r.deviationPct;
  const h = r.header;

  return (
    <div className="mx-auto min-w-[900px] max-w-[1050px] bg-white p-2 text-[11px] text-slate-900">
      {/* ── Kop ── */}
      <div className="border-b-2 border-slate-800 pb-2 text-center">
        <div className="text-base font-bold tracking-wide uppercase">{judul}</div>
        <div className="text-sm font-semibold">{ke}</div>
        <div className="text-xs text-slate-600">
          Periode {dFmt.format(h.periodeStart)} s/d {dFmt.format(h.periodeEnd)}
        </div>
      </div>

      {/* ── Identitas paket ── */}
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2">
        <KV k="Paket Pekerjaan" v={h.packageName} />
        <KV k="Masa Pelaksanaan" v={`${h.masaPelaksanaanHari} Hari Kalender`} />
        <KV k="Lokasi" v={`${h.locationName} — ${h.village}, ${h.regency}, ${h.province}`} />
        <KV k="Nilai Kontrak" v={rupiahFmt.format(Number(h.contractValue))} />
        <KV k="Nomor Kontrak" v={h.contractNumber} />
        <KV k="Kontraktor Pelaksana" v={h.vendorName} />
        <KV k="Tahun Anggaran" v={String(h.tahunAnggaran)} />
        <KV k={`${periodeLabel} ke`} v={`${r.n} dari ${r.maxN}`} />
      </div>

      {/* Resume kurva-S & rekap kelompok ada di HALAMAN KURVA-S (hal. 1) —
          tidak diulang di sini agar tidak redundan. Halaman ini fokus rincian item. */}

      {/* ── 1. Rincian capaian per item ── */}
      <SectionTitle>1. Rincian Capaian per Item Pekerjaan</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] border-collapse text-[9.5px]">
          <thead>
            <tr className="bg-slate-100 text-center">
              <Th rowSpan={2} w="30px">No</Th>
              <Th rowSpan={2} align="left">Uraian Pekerjaan</Th>
              <Th rowSpan={2} align="right" w="66px">Vol. Kontrak</Th>
              <Th rowSpan={2} w="40px">Sat.</Th>
              <Th rowSpan={2} align="right" w="76px">Harga Satuan</Th>
              <Th rowSpan={2} align="right" w="48px">Bobot %</Th>
              <Th colSpan={2}>Realisasi Lalu</Th>
              <Th colSpan={2}>Realisasi {periodeLabel} Ini</Th>
              <Th colSpan={3}>S/d {periodeLabel} Ini</Th>
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
              <Td colSpan={5}>J U M L A H</Td>
              <Td align="right">{p2(r.categories.reduce((s, c) => s + c.subtotalBobot, 0))}</Td>
              <Td colSpan={2} align="right">{p2(r.totals.bobotLalu)}</Td>
              <Td colSpan={2} align="right">{p2(r.totals.bobotIni)}</Td>
              <Td colSpan={3} align="right">{p2(r.totals.bobotSd)}</Td>
              <Td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-0.5 text-[10px] sm:w-[380px]">
        <KV k={`Bobot Realisasi ${periodeLabel} Ini`} v={p2(r.totals.bobotIni)} />
        <KV k="Bobot Realisasi s/d Periode" v={p2(r.totals.bobotSd)} />
        <KV k="Bobot Rencana s/d Periode" v={p2(r.planPct)} />
        <KV k="Deviasi (+/-)" v={`${dev >= 0 ? "+" : ""}${p2(dev)}`} />
      </div>

      {/* ── 3. Sumber daya periode ── */}
      <SectionTitle>2. Tenaga Kerja, Material &amp; Peralatan (Agregat Periode)</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ResourceTable
          title="Tenaga Kerja"
          head={["Peran", "Orang-hari"]}
          rows={r.tenaga.map((t) => [t.label, String(t.count)])}
        />
        <ResourceTable
          title="Material Masuk"
          head={["Material", "Jumlah"]}
          rows={r.material.map((m) => [m.name, `${volFmt.format(m.qty)}${m.unit ? ` ${m.unit}` : ""}`])}
        />
        <ResourceTable
          title="Peralatan"
          head={["Alat", "Unit-hari"]}
          rows={r.alat.map((a) => [a.name, String(a.count)])}
        />
      </div>
      <div className="mt-1.5 text-[10px]">
        <span className="text-slate-500">Ringkasan cuaca periode: </span>
        <span className="font-medium">{r.cuacaRingkas}</span>
      </div>

      {/* ── 4. Kendala ── */}
      <SectionTitle>3. Kendala Lapangan</SectionTitle>
      {r.kendala.length === 0 ? (
        <p className="text-[10px] text-slate-400">Tidak ada kendala tercatat pada periode ini.</p>
      ) : (
        <ul className="space-y-1 text-[10px]">
          {r.kendala.map((k, i) => (
            <li key={i}>
              <span className="text-slate-500">{dFmt.format(k.createdAt)} — </span>
              <b>{k.title}</b>
              <span className="text-slate-500">
                {" "}· tingkat {k.severity} · status {k.status.replace(/_/g, " ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── TTD ── */}
      <div className="mt-8 grid grid-cols-3 gap-4 text-center text-[10px]">
        <Sign title="Mengetahui" role="Pejabat Pembuat Komitmen" name={h.ppkName} sub={h.ppkNip ? `NIP. ${h.ppkNip}` : null} />
        <Sign title="Diperiksa" role="Konsultan Pengawas" name={h.supervisorName} sub={h.supervisorFirm} />
        <Sign title="Dibuat Oleh" role={`Penyedia Jasa — ${h.vendorName}`} name={h.contractorSignerName} sub={h.contractorSignerTitle} />
      </div>
    </div>
  );
}

function CategoryBlock({ c }: { c: PeriodCategory }) {
  return (
    <>
      <tr className="bg-slate-50 font-semibold">
        <Td>{c.code}</Td>
        <Td colSpan={4}>{c.name}</Td>
        <Td align="right">{p2(c.subtotalBobot)}</Td>
        <Td colSpan={9} />
      </tr>
      {c.rows.map((it) => (
        <tr key={it.no} className="border-b border-slate-100">
          <Td align="right">{it.no}</Td>
          <Td>{it.name}</Td>
          <Td align="right">{volFmt.format(it.volK)}</Td>
          <Td align="center">{it.unit}</Td>
          <Td align="right">{it.hargaSatuan > 0 ? volFmt.format(it.hargaSatuan) : "–"}</Td>
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

/**
 * Rencana vs realisasi kumulatif per minggu (bentuk tabel).
 * Catatan: komponen chart kurva-S (@/components/knmp/scurve-chart) dibuat slice
 * lain — bila sudah tersedia, bagian ini bisa diganti chart tanpa mengubah data.
 */
function ScurveTable({
  planPct,
  actualPct,
  currentWeek,
}: {
  planPct: number[];
  actualPct: (number | null)[];
  currentWeek: number;
}) {
  const len = Math.max(planPct.length, actualPct.length);
  if (len === 0) {
    return (
      <div className="flex items-center border border-slate-400 p-2 text-[10px] text-slate-400">
        Baseline kurva-S belum tersedia.
      </div>
    );
  }
  const weeks = Array.from({ length: len }, (_, i) => i + 1);
  return (
    <div className="overflow-x-auto border border-slate-400 p-1">
      <table className="w-full border-collapse text-[8.5px]">
        <tbody>
          <tr>
            <th className="border border-slate-200 bg-slate-100 px-1 py-0.5 text-left whitespace-nowrap">Minggu</th>
            {weeks.map((w) => (
              <td
                key={w}
                className={`border border-slate-200 px-1 py-0.5 text-center tabular-nums ${w === currentWeek ? "bg-amber-50 font-bold" : ""}`}
              >
                {w}
              </td>
            ))}
          </tr>
          <tr>
            <th className="border border-slate-200 bg-slate-100 px-1 py-0.5 text-left whitespace-nowrap">Rencana %</th>
            {weeks.map((w) => (
              <td key={w} className="border border-slate-200 px-1 py-0.5 text-right tabular-nums">
                {planPct[w - 1] != null ? planPct[w - 1].toFixed(1) : "–"}
              </td>
            ))}
          </tr>
          <tr>
            <th className="border border-slate-200 bg-slate-100 px-1 py-0.5 text-left whitespace-nowrap">Realisasi %</th>
            {weeks.map((w) => {
              const v = actualPct[w - 1];
              return (
                <td key={w} className="border border-slate-200 px-1 py-0.5 text-right font-medium tabular-nums">
                  {v == null ? "–" : v.toFixed(1)}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ResourceTable({
  title,
  head,
  rows,
}: {
  title: string;
  head: [string, string];
  rows: [string, string][];
}) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-semibold">{title}</div>
      <table className="w-full border-collapse text-[9.5px]">
        <thead>
          <tr className="bg-slate-100">
            <Th align="left">{head[0]}</Th>
            <Th align="right" w="80px">{head[1]}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={2}>
                <span className="text-slate-400">Tidak ada data periode ini</span>
              </Td>
            </tr>
          ) : (
            rows.map(([a, b], i) => (
              <tr key={i} className="border-b border-slate-100">
                <Td>{a}</Td>
                <Td align="right">{b}</Td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 mb-1.5 border-b-2 border-slate-700 pb-0.5 text-xs font-bold tracking-wide uppercase">
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
  children?: ReactNode;
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
  children?: ReactNode;
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
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-slate-900";
  return (
    <div className={`px-2.5 py-2 ${border ? "border-t border-slate-300" : ""}`}>
      <div className="text-[9px] text-slate-500 uppercase">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Sign({
  title,
  role,
  name,
  sub,
}: {
  title: string;
  role: string;
  name?: string | null;
  sub?: string | null;
}) {
  return (
    <div>
      <div className="text-[9px] text-slate-500 uppercase">{title}</div>
      <div className="font-semibold">{role}</div>
      <div className="mt-12 border-t border-slate-400 pt-1 font-semibold text-ink">
        {name ? `( ${name} )` : <span className="font-normal text-slate-500">( …………………………… )</span>}
      </div>
      {sub ? <div className="text-[9px] text-slate-500">{sub}</div> : null}
    </div>
  );
}
