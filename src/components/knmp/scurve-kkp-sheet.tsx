import { buildKurvaSheet } from "@/lib/scurve/kkp-sheet";
import { formatRupiah, formatTanggal } from "@/lib/format";
import type { PeriodReport } from "@/lib/periodic-report";

/**
 * Halaman-1 laporan periodik: sheet "KURVA S" resmi KKP (landscape A4).
 * Tabel bobot kategori × minggu (increment) + baris prestasi + GARIS kurva-S
 * (rencana putus-putus + realisasi hijau) dibubuhkan di atas area kolom minggu,
 * plus sumbu % kanan. Struktur & label mengikuti format contoh KKP.
 */

// Dimensi tetap supaya overlay SVG selaras dgn kolom minggu (table-layout fixed).
const W_NO = 26;
const W_URAIAN = 200;
const W_BOBOT = 42;
const W_KET = 42;
const LEFT = W_NO + W_URAIAN + W_BOBOT; // offset kiri area plot
const HEAD_H = 16; // tinggi tiap baris header (2 baris: bulan + minggu)
const ROW_H = 26; // tinggi baris kategori
const num = (v: number, d = 3) => v.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number | null, d = 2) => (v == null ? "" : `${v.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d })}%`);

export function ScurveKkpSheet({ r }: { r: PeriodReport }) {
  const sheet = buildKurvaSheet({
    categories: r.categories.map((c) => ({ code: c.code, name: c.name, bobot: c.subtotalBobot })),
    totalWeeks: r.totalWeeks,
    contractStart: r.header.contractStart,
    actualCum: r.scurve.actualPct,
    currentWeek: r.scurve.currentWeek,
  });
  const N = sheet.totalWeeks;
  const M = sheet.categories.length;
  const WCOL = N > 26 ? 30 : N > 18 ? 38 : 46; // kolom minggu menyempit bila periode panjang
  const plotW = N * WCOL;
  const plotH = M * ROW_H;
  const title = `KURVA S ${r.kind === "mingguan" ? "MINGGU" : "BULAN"} KE - ${r.n}`;

  // Titik kurva (x = akhir minggu w, y = 1 − kumulatif/100). Anchor minggu-0 = 0%.
  const xFor = (w: number) => (w / N) * plotW;
  const yFor = (p: number) => (1 - Math.min(100, Math.max(0, p)) / 100) * plotH;
  const planPts = [`0,${plotH}`, ...sheet.kumulatifRencana.map((p, i) => `${xFor(i + 1).toFixed(1)},${yFor(p).toFixed(1)}`)].join(" ");
  const actualIdx = sheet.kumulatifRealisasi.map((p, i) => (p == null ? null : i)).filter((i): i is number => i != null);
  const actualPts = ["0," + plotH, ...actualIdx.map((i) => `${xFor(i + 1).toFixed(1)},${yFor(sheet.kumulatifRealisasi[i] as number).toFixed(1)}`)].join(" ");

  const hdr = r.header;

  return (
    <div className="mx-auto w-full text-[8.5px] leading-tight text-black">
      {/* Judul */}
      <div className="text-center">
        <div className="text-[13px] font-bold underline">{title}</div>
        <div className="text-[9px] font-semibold">
          Periode tanggal {formatTanggal(hdr.periodeStart)} s/d {formatTanggal(hdr.periodeEnd)}
        </div>
      </div>

      {/* Header info kiri/kanan */}
      <div className="mt-2 flex justify-between text-[8.5px]">
        <table className="border-collapse">
          <tbody>
            {[
              ["Paket Pekerjaan", `: ${hdr.packageName}`],
              ["Lokasi", `: ${hdr.village}, ${hdr.regency}`],
              ["Nilai Kontrak Fisik", `: ${formatRupiah(hdr.contractValue)}`],
              ["Nomor dan Tanggal Kontrak", `: ${hdr.contractNumber || "-"}`],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="pr-2 font-semibold whitespace-nowrap">{k}</td>
                <td className="whitespace-nowrap">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="border-collapse">
          <tbody>
            <tr>
              <td className="pr-2 font-semibold">Masa Pelaksanaan</td>
              <td>: {hdr.masaPelaksanaanHari} Hari Kalender</td>
            </tr>
            <tr>
              <td className="pr-2 font-semibold">Tahun Anggaran</td>
              <td>: {hdr.tahunAnggaran}</td>
            </tr>
            <tr>
              <td className="pr-2 font-semibold">Rencana</td>
              <td>: <span className="inline-block h-0 w-8 border-t-2 border-dashed border-slate-500 align-middle" /></td>
            </tr>
            <tr>
              <td className="pr-2 font-semibold">Realisasi</td>
              <td>: <span className="inline-block h-0 w-8 border-t-2 border-green-600 align-middle" /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tabel + overlay kurva */}
      <div className="relative mt-2 overflow-x-auto">
        <table className="border-collapse border border-black" style={{ tableLayout: "fixed", width: LEFT + plotW + W_KET }}>
          <colgroup>
            <col style={{ width: W_NO }} />
            <col style={{ width: W_URAIAN }} />
            <col style={{ width: W_BOBOT }} />
            {sheet.weeks.map((w) => (
              <col key={w} style={{ width: WCOL }} />
            ))}
            <col style={{ width: W_KET }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} className="border border-black" style={{ height: HEAD_H * 2 }}>No.</th>
              <th rowSpan={2} className="border border-black">Uraian Pekerjaan</th>
              <th rowSpan={2} className="border border-black">Bobot (%)</th>
              {sheet.monthGroups.map((g, i) => (
                <th key={i} colSpan={g.span} className="border border-black" style={{ height: HEAD_H }}>
                  {g.label}
                </th>
              ))}
              <th rowSpan={2} className="border border-black">KET</th>
            </tr>
            <tr>
              {sheet.weeks.map((w) => (
                <th key={w} className="border border-black font-normal" style={{ height: HEAD_H }}>
                  M{w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.categories.map((c) => (
              <tr key={c.code} style={{ height: ROW_H }}>
                <td className="border border-black text-center font-semibold">{c.code}</td>
                <td className="border border-black px-1 font-semibold">{c.name}</td>
                <td className="border border-black text-center">{num(c.bobot, 2)}</td>
                {c.weekly.map((v, i) => (
                  <td key={i} className="border border-black text-center text-[7px]">
                    {v >= 0.0005 ? num(v, 3) : ""}
                  </td>
                ))}
                <td className="border border-black" />
              </tr>
            ))}
            {/* Baris prestasi */}
            {(
              [
                ["Rencana Prestasi %", sheet.rencanaPerWeek, false],
                ["Kumulatif Rencana Prestasi %", sheet.kumulatifRencana, true],
                ["Realisasi Prestasi %", sheet.realisasiPerWeek, false],
                ["Kumulatif Realisasi Prestasi %", sheet.kumulatifRealisasi, true],
                ["Deviasi +/-", sheet.deviasi, true],
              ] as [string, (number | null)[], boolean][]
            ).map(([label, arr, bold]) => (
              <tr key={label} style={{ height: HEAD_H }}>
                <td colSpan={2} className={`border border-black pr-1 text-right ${bold ? "font-semibold" : ""}`}>
                  {label}
                </td>
                <td className="border border-black text-center">{label.startsWith("Kumulatif Rencana") ? "100,00" : ""}</td>
                {arr.map((v, i) => (
                  <td key={i} className={`border border-black text-center text-[7px] ${bold ? "font-semibold" : ""}`}>
                    {pct(v, 2)}
                  </td>
                ))}
                <td className="border border-black" />
              </tr>
            ))}
          </tbody>
        </table>

        {/* Overlay kurva-S di atas area kolom minggu × baris kategori */}
        <svg
          className="pointer-events-none absolute"
          style={{ left: LEFT + 1, top: HEAD_H * 2 + 1, width: plotW, height: plotH }}
          viewBox={`0 0 ${plotW} ${plotH}`}
          preserveAspectRatio="none"
        >
          {/* garis bantu 0/25/50/75/100% */}
          {[0, 25, 50, 75, 100].map((g) => (
            <line key={g} x1={0} y1={yFor(g)} x2={plotW} y2={yFor(g)} stroke="#cbd5e1" strokeWidth={0.5} />
          ))}
          <polyline points={planPts} fill="none" stroke="#64748b" strokeWidth={1.2} strokeDasharray="4 3" />
          {actualIdx.length > 0 ? (
            <polyline points={actualPts} fill="none" stroke="#16a34a" strokeWidth={1.6} />
          ) : null}
        </svg>

        {/* Sumbu % kanan */}
        <div className="pointer-events-none absolute text-[7px] text-slate-500" style={{ left: LEFT + plotW + 3, top: HEAD_H * 2 }}>
          {[100, 80, 60, 40, 20, 0].map((g) => (
            <div key={g} style={{ position: "absolute", top: yFor(g) - 4 }}>
              {g}%
            </div>
          ))}
        </div>
      </div>

      {/* Tanda tangan */}
      <div className="mt-6 flex justify-between px-8 text-center text-[8.5px]">
        <div>
          <div className="font-semibold">MENGETAHUI :</div>
          <div className="font-semibold">PEJABAT PEMBUAT KOMITMEN</div>
          <div className="mt-10">( ................................ )</div>
        </div>
        <div>
          <div className="font-semibold">DIPERIKSA :</div>
          <div className="font-semibold">KONSULTAN PENGAWAS</div>
          <div className="mt-10">( ................................ )</div>
        </div>
        <div>
          <div className="font-semibold">DIBUAT OLEH :</div>
          <div className="font-semibold">PENYEDIA JASA — {hdr.vendorName}</div>
          <div className="mt-10">( ................................ )</div>
        </div>
      </div>
    </div>
  );
}
