import type { WorkerRole } from "@/generated/prisma/enums";
import { WORKER_ROLE_LABEL, WORKER_ROLE_ORDER } from "@/lib/daily-report/constants";

/**
 * FORMAT LAPORAN HARIAN KKP — form bergaris A4, dipakai preview & cetak.
 * Port layout lama (kop, identitas, tenaga per keahlian, material masuk,
 * peralatan, ceklis cuaca per jam, jam kerja, blok tanda tangan) + tabel
 * progres per kegiatan (vol kontrak, s/d lalu, hari ini, s/d, %).
 * Server component murni — data disiapkan queries.getKkpDailyData.
 */

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const pctFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const HOURS = ["07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21"];

export type KkpDailyItem = {
  code: string;
  name: string;
  unit: string | null;
  volumeContract: number | null;
  volumeBefore: number; // s/d laporan lalu
  volumeToday: number; // hari ini
  volumeCumulative: number; // s/d hari ini
  pctCumulative: number | null;
};

export type KkpDailyData = {
  locationName: string;
  regency: string;
  province: string;
  hari: string;
  tanggalFull: string;
  weekNo: number | null;
  tahunAnggaran: number;
  workerMap: Partial<Record<WorkerRole, number>>;
  totalWorkers: number;
  activeWeather: "Cerah" | "Mendung" | "Hujan" | null;
  workStart: string | null;
  workEnd: string | null;
  notes: string | null;
  materials: { name: string; unit: string | null; qty: number | null }[];
  equipment: { name: string; count: number }[];
  items: KkpDailyItem[];
  /** false = pratinjau dari data live (belum dibekukan finalSnapshot). */
  isFinal: boolean;
  /** Penanda tangan (dari kontrak, current — null = baris kosong). */
  supervisorName?: string | null;
  supervisorSub?: string | null;
  contractorName?: string | null;
  contractorSub?: string | null;
};

export function KkpDailyReport({ d }: { d: KkpDailyData }) {
  return (
    <div className="mx-auto max-w-225 bg-white text-[11px] leading-tight text-slate-900">
      {!d.isFinal ? (
        <div className="no-print mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
          PRATINJAU — laporan belum difinalisasi; angka masih bisa berubah.
        </div>
      ) : null}

      {/* Kop */}
      <div className="grid grid-cols-4 border border-slate-500">
        <div className="col-span-2 flex flex-col justify-center border-r border-slate-500 px-3 py-2">
          <div className="text-sm font-bold tracking-wide uppercase">Laporan Harian</div>
          <div className="text-[10px] text-slate-500">
            Pembangunan Kampung Nelayan Merah Putih (KNMP) · Kementerian Kelautan dan Perikanan
          </div>
        </div>
        <div className="flex items-center justify-center border-r border-slate-500 px-2 py-3 text-center text-[10px] font-semibold text-slate-600 uppercase">
          Konsultan Pengawas
        </div>
        <div className="flex items-center justify-center px-2 py-3 text-center text-[10px] font-semibold text-slate-600 uppercase">
          Kontraktor Pelaksana
        </div>
      </div>

      {/* Identitas proyek */}
      <table className="w-full border-x border-b border-slate-500">
        <tbody>
          <tr>
            <Cell w>Minggu Ke</Cell>
            <Cell>{d.weekNo ?? "…"}</Cell>
            <Cell w>Pekerjaan</Cell>
            <Cell>Konstruksi KNMP</Cell>
          </tr>
          <tr>
            <Cell w>Hari</Cell>
            <Cell>{d.hari}</Cell>
            <Cell w>Lokasi</Cell>
            <Cell>{`${d.locationName}, ${d.regency}, ${d.province}`}</Cell>
          </tr>
          <tr>
            <Cell w>Tanggal</Cell>
            <Cell>{d.tanggalFull}</Cell>
            <Cell w>Th. Anggaran</Cell>
            <Cell>{d.tahunAnggaran}</Cell>
          </tr>
        </tbody>
      </table>

      {/* Progres per kegiatan */}
      <table className="w-full border-x border-b border-slate-500">
        <thead>
          <tr>
            <Cell head w>No</Cell>
            <Cell head>Uraian Pekerjaan (Progres Hari Ini)</Cell>
            <Cell head w>Sat</Cell>
            <Cell head w>Vol Kontrak</Cell>
            <Cell head w>s/d Lalu</Cell>
            <Cell head w>Hari Ini</Cell>
            <Cell head w>s/d</Cell>
            <Cell head w>%</Cell>
          </tr>
        </thead>
        <tbody>
          {d.items.length ? (
            d.items.map((it, i) => (
              <tr key={`${it.code}-${i}`}>
                <Cell center>{i + 1}</Cell>
                <Cell>{it.name}</Cell>
                <Cell center>{it.unit ?? ""}</Cell>
                <Cell right>{it.volumeContract != null ? volFmt.format(it.volumeContract) : ""}</Cell>
                <Cell right>{volFmt.format(it.volumeBefore)}</Cell>
                <Cell right>{volFmt.format(it.volumeToday)}</Cell>
                <Cell right>{volFmt.format(it.volumeCumulative)}</Cell>
                <Cell right>{it.pctCumulative != null ? pctFmt.format(it.pctCumulative) : ""}</Cell>
              </tr>
            ))
          ) : (
            <tr>
              <Cell center colSpan={8}>Tidak ada realisasi tercatat pada tanggal ini.</Cell>
            </tr>
          )}
        </tbody>
      </table>

      {/* Tenaga + material/peralatan */}
      <div className="grid grid-cols-2">
        <table className="w-full border-x border-b border-slate-500">
          <thead>
            <tr>
              <Cell head w>No</Cell>
              <Cell head>Tenaga Kerja (Keahlian)</Cell>
              <Cell head w>Jmh</Cell>
            </tr>
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
              <Cell colSpan={2} right>Jumlah</Cell>
              <Cell center>{d.totalWorkers}</Cell>
            </tr>
          </tbody>
        </table>

        <div>
          <table className="w-full border-r border-b border-slate-500">
            <thead>
              <tr>
                <Cell head w>No</Cell>
                <Cell head>Rekap Pemasukan Bahan / Material</Cell>
                <Cell head w>Sat</Cell>
                <Cell head w>Diterima</Cell>
              </tr>
            </thead>
            <tbody>
              {d.materials.map((m, i) => (
                <tr key={`${m.name}-${i}`}>
                  <Cell center>{i + 1}</Cell>
                  <Cell>{m.name}</Cell>
                  <Cell center>{m.unit ?? ""}</Cell>
                  <Cell center>{m.qty != null ? volFmt.format(m.qty) : ""}</Cell>
                </tr>
              ))}
              {Array.from({ length: Math.max(0, 4 - d.materials.length) }).map((_, i) => (
                <tr key={`me${i}`}>
                  <Cell center>{d.materials.length + i + 1}</Cell>
                  <Cell>&nbsp;</Cell>
                  <Cell></Cell>
                  <Cell></Cell>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full border-r border-b border-slate-500">
            <thead>
              <tr>
                <Cell head w>No</Cell>
                <Cell head colSpan={3}>Peralatan</Cell>
              </tr>
            </thead>
            <tbody>
              {d.equipment.map((e, i) => (
                <tr key={`${e.name}-${i}`}>
                  <Cell center>{i + 1}</Cell>
                  <Cell colSpan={3}>
                    {e.name}
                    {e.count > 1 ? ` (${e.count})` : ""}
                  </Cell>
                </tr>
              ))}
              {Array.from({ length: Math.max(0, 3 - d.equipment.length) }).map((_, i) => (
                <tr key={`ee${i}`}>
                  <Cell center>{d.equipment.length + i + 1}</Cell>
                  <Cell colSpan={3}>&nbsp;</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cuaca per jam */}
      <table className="w-full border-x border-b border-slate-500 text-center">
        <thead>
          <tr>
            <Cell head>Kondisi / Jam</Cell>
            {HOURS.map((h) => (
              <Cell head center key={h}>{h}</Cell>
            ))}
          </tr>
        </thead>
        <tbody>
          {(["Cerah", "Mendung", "Hujan"] as const).map((cat) => (
            <tr key={cat}>
              <Cell>{cat}</Cell>
              {HOURS.map((h) => (
                <Cell center key={h}>{d.activeWeather === cat ? "✓" : ""}</Cell>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <table className="w-full border-x border-b border-slate-500">
        <tbody>
          <tr>
            <Cell w>Jam Kerja</Cell>
            <Cell>
              mulai {d.workStart ?? "……"} — selesai {d.workEnd ?? "……"}
            </Cell>
          </tr>
        </tbody>
      </table>

      {/* Catatan */}
      <table className="w-full border-x border-b border-slate-500">
        <thead>
          <tr>
            <Cell head>Catatan / Keterangan</Cell>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Cell>{d.notes || " "}</Cell>
          </tr>
        </tbody>
      </table>

      {/* Tanda tangan */}
      <div className="grid grid-cols-2 border-x border-b border-slate-500">
        <div className="border-r border-slate-500 px-3 py-2 text-center">
          <div className="text-[10px] font-semibold text-slate-600 uppercase">Konsultan Pengawas</div>
          <div className="mt-12 border-t border-slate-400 pt-1 font-semibold text-slate-900">
            {d.supervisorName ? `( ${d.supervisorName} )` : <span className="font-normal text-slate-500">( …………………… )</span>}
          </div>
          {d.supervisorSub ? <div className="text-[9px] text-slate-500">{d.supervisorSub}</div> : null}
        </div>
        <div className="px-3 py-2 text-center">
          <div className="text-[10px] font-semibold text-slate-600 uppercase">Kontraktor Pelaksana</div>
          <div className="mt-12 border-t border-slate-400 pt-1 font-semibold text-slate-900">
            {d.contractorName ? `( ${d.contractorName} )` : <span className="font-normal text-slate-500">( …………………… )</span>}
          </div>
          {d.contractorSub ? <div className="text-[9px] text-slate-500">{d.contractorSub}</div> : null}
        </div>
      </div>
    </div>
  );
}

function Cell({
  children,
  head,
  w,
  center,
  right,
  colSpan,
}: {
  children?: React.ReactNode;
  head?: boolean;
  w?: boolean;
  center?: boolean;
  right?: boolean;
  colSpan?: number;
}) {
  const Tag = head ? "th" : "td";
  return (
    <Tag
      colSpan={colSpan}
      className={[
        "border border-slate-500 px-1.5 py-0.5 align-top",
        head ? "bg-slate-50 text-[10px] font-semibold text-slate-600 uppercase" : "",
        w ? "w-px whitespace-nowrap" : "",
        center ? "text-center" : right ? "text-right tabular-nums" : "text-left",
      ].join(" ")}
    >
      {children}
    </Tag>
  );
}
