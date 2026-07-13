import { WORKER_ROLE_ORDER, WORKER_ROLE_LABEL } from "@/lib/daily-log";

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const HOURS = ["07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21"];

export type KkpDailyData = {
  locationName: string;
  regency: string;
  province: string;
  hari: string;
  tanggalFull: string;
  weekNo: number | null;
  tahunAnggaran: number;
  workerMap: Record<string, number>;
  totalWorkers: number;
  activeWeather: "Cerah" | "Mendung" | "Hujan" | null;
  workStart: string | null;
  workEnd: string | null;
  notes: string | null;
  materials: { id: string; name: string; unit: string | null; qty: number | null }[];
  equipment: { id: string; name: string; count: number }[];
  dayItems: { name: string; unit: string; volume: number }[];
};

/** FORMAT LAPORAN HARIAN KKP — form bergaris, dipakai untuk preview & cetak A4. */
export function KkpDailyReport({ d }: { d: KkpDailyData }) {
  return (
    <div className="mx-auto max-w-[900px] bg-white text-[11px] leading-tight text-slate-900">
      {/* Header */}
      <div className="grid grid-cols-4 border border-slate-500">
        <div className="col-span-2 flex flex-col justify-center border-r border-slate-500 px-3 py-2">
          <div className="text-sm font-bold uppercase tracking-wide">Laporan Harian</div>
          <div className="text-[10px] text-slate-500">Pembangunan Kampung Nelayan Merah Putih (KNMP)</div>
        </div>
        <div className="flex items-center justify-center border-r border-slate-500 px-2 py-3 text-center text-[10px] font-semibold uppercase text-slate-600">
          Konsultan Pengawas
        </div>
        <div className="flex items-center justify-center px-2 py-3 text-center text-[10px] font-semibold uppercase text-slate-600">
          Kontraktor Pelaksana
        </div>
      </div>

      {/* Info paket */}
      <table className="w-full border-x border-b border-slate-500">
        <tbody>
          <tr>
            <Cell w>Minggu Ke</Cell><Cell>{d.weekNo ?? "…"}</Cell>
            <Cell w>Pekerjaan</Cell><Cell>Konstruksi KNMP</Cell>
          </tr>
          <tr>
            <Cell w>Hari</Cell><Cell>{d.hari}</Cell>
            <Cell w>Lokasi</Cell><Cell>{`${d.locationName}, ${d.regency}, ${d.province}`}</Cell>
          </tr>
          <tr>
            <Cell w>Tanggal</Cell><Cell>{d.tanggalFull}</Cell>
            <Cell w>Th. Anggaran</Cell><Cell>{d.tahunAnggaran}</Cell>
          </tr>
        </tbody>
      </table>

      {/* Tenaga + material/peralatan */}
      <div className="grid grid-cols-2">
        <table className="w-full border-x border-b border-slate-500">
          <thead>
            <tr><Cell head w>No</Cell><Cell head>Tenaga Kerja (Keahlian)</Cell><Cell head w>Jmh</Cell></tr>
          </thead>
          <tbody>
            {WORKER_ROLE_ORDER.map((r, i) => (
              <tr key={r}>
                <Cell center>{i + 1}</Cell>
                <Cell>{WORKER_ROLE_LABEL[r]}</Cell>
                <Cell center>{d.workerMap[r] ?? 0}</Cell>
              </tr>
            ))}
            <tr className="font-semibold">
              <Cell center colSpan={2} right>Jumlah</Cell>
              <Cell center>{d.totalWorkers}</Cell>
            </tr>
          </tbody>
        </table>

        <div>
          <table className="w-full border-r border-b border-slate-500">
            <thead>
              <tr><Cell head w>No</Cell><Cell head>Rekap Pemasukan Bahan / Material</Cell><Cell head w>Sat</Cell><Cell head w>Diterima</Cell></tr>
            </thead>
            <tbody>
              {d.materials.map((m, i) => (
                <tr key={m.id}>
                  <Cell center>{i + 1}</Cell>
                  <Cell>{m.name}</Cell>
                  <Cell center>{m.unit ?? ""}</Cell>
                  <Cell center>{m.qty != null ? volFmt.format(m.qty) : ""}</Cell>
                </tr>
              ))}
              {Array.from({ length: Math.max(0, 4 - d.materials.length) }).map((_, i) => (
                <tr key={`me${i}`}>
                  <Cell center>{d.materials.length + i + 1}</Cell><Cell>&nbsp;</Cell><Cell></Cell><Cell></Cell>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full border-r border-b border-slate-500">
            <thead>
              <tr><Cell head w>No</Cell><Cell head colSpan={3}>Peralatan</Cell></tr>
            </thead>
            <tbody>
              {d.equipment.map((e, i) => (
                <tr key={e.id}>
                  <Cell center>{i + 1}</Cell>
                  <Cell colSpan={3}>{e.name}{e.count > 1 ? ` (${e.count})` : ""}</Cell>
                </tr>
              ))}
              {Array.from({ length: Math.max(0, 3 - d.equipment.length) }).map((_, i) => (
                <tr key={`ee${i}`}>
                  <Cell center>{d.equipment.length + i + 1}</Cell><Cell colSpan={3}>&nbsp;</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cuaca per jam */}
      <table className="w-full border-x border-b border-slate-500 text-center">
        <thead>
          <tr><Cell head>Kondisi / Jam</Cell>{HOURS.map((h) => <Cell head center key={h}>{h}</Cell>)}</tr>
        </thead>
        <tbody>
          {(["Cerah", "Mendung", "Hujan"] as const).map((cat) => (
            <tr key={cat}>
              <Cell>{cat}</Cell>
              {HOURS.map((h) => <Cell center key={h}>{d.activeWeather === cat ? "✓" : ""}</Cell>)}
            </tr>
          ))}
        </tbody>
      </table>
      <table className="w-full border-x border-b border-slate-500">
        <tbody>
          <tr><Cell w>Jam Kerja</Cell><Cell>mulai {d.workStart ?? "……"} — selesai {d.workEnd ?? "……"}</Cell></tr>
        </tbody>
      </table>

      {/* Rencana vs realisasi */}
      <div className="grid grid-cols-2">
        <table className="w-full border-x border-b border-slate-500">
          <thead><tr><Cell head>Rencana Pekerjaan</Cell></tr></thead>
          <tbody>
            {d.notes ? (
              <tr><Cell>{d.notes}</Cell></tr>
            ) : (
              Array.from({ length: 5 }).map((_, i) => <tr key={i}><Cell>{i + 1}.&nbsp;</Cell></tr>)
            )}
          </tbody>
        </table>
        <table className="w-full border-r border-b border-slate-500">
          <thead><tr><Cell head>Realisasi Pekerjaan (dari laporan lapangan)</Cell></tr></thead>
          <tbody>
            {d.dayItems.length ? (
              d.dayItems.map((it, i) => (
                <tr key={i}><Cell>{i + 1}. {it.name} — {volFmt.format(it.volume)} {it.unit}</Cell></tr>
              ))
            ) : (
              <tr><Cell>Tidak ada realisasi tercatat pada tanggal ini.</Cell></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Tanda tangan */}
      <div className="grid grid-cols-2 border-x border-b border-slate-500">
        <div className="border-r border-slate-500 px-3 py-2 text-center">
          <div className="text-[10px] font-semibold uppercase text-slate-600">Konsultan Pengawas</div>
          <div className="mt-12 border-t border-slate-400 pt-1 text-slate-500">( …………………… )</div>
        </div>
        <div className="px-3 py-2 text-center">
          <div className="text-[10px] font-semibold uppercase text-slate-600">Kontraktor Pelaksana</div>
          <div className="mt-12 border-t border-slate-400 pt-1 text-slate-500">( …………………… )</div>
        </div>
      </div>
    </div>
  );
}

function Cell({
  children, head, w, center, right, colSpan,
}: {
  children?: React.ReactNode; head?: boolean; w?: boolean; center?: boolean; right?: boolean; colSpan?: number;
}) {
  const Tag = head ? "th" : "td";
  return (
    <Tag
      colSpan={colSpan}
      className={[
        "border border-slate-500 px-1.5 py-0.5 align-top",
        head ? "bg-slate-50 text-[10px] font-semibold uppercase text-slate-600" : "",
        w ? "w-px whitespace-nowrap" : "",
        center ? "text-center" : right ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </Tag>
  );
}
