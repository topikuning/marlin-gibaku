import { Fragment } from "react";
import { penandatanganDokumen, peranSlot } from "@/lib/laporan/penandatangan";
import { formatRupiah, formatTanggal } from "@/lib/format";
import type { PeriodReport } from "@/lib/periodic-report";
import { susunRencanaRealisasi } from "@/lib/laporan/rencana-realisasi-kategori";
import { gambarPihak, type TtdLaporan } from "./blok-ttd";
import { SignBlock } from "./scurve-kkp-sheet";

/**
 * LAPORAN RENCANA & REALISASI MINGGUAN PER KATEGORI (DECISIONS 674) – lembar
 * cetak (A4 lanskap). Tiap kategori dua baris (Rencana, Realisasi) × M1..Mn,
 * lalu total lokasi. Semua angka dari `susunRencanaRealisasi`; di sini hanya
 * ditata.
 */

const W_NO = 26;
const W_URAIAN = 170;
const W_BOBOT = 40;
const W_KET = 58;
const W_SD = 46;
const W_PCT = 46;

const angka = (v: number, d = 3) => v.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
/** Rencana 0 dikosongkan (seperti lembar Kurva S); realisasi 0 di minggu yang sudah lewat ditulis "–". */
const selRencana = (v: number) => (Math.abs(v) < 0.0005 ? "" : angka(v));
const selRealisasi = (v: number | null) => (v == null ? "" : Math.abs(v) < 0.0005 ? "–" : angka(v));
const persen = (v: number) => `${angka(v, 2)}%`;

export function KkpRencanaRealisasi({
  r,
  ttd,
  tanpaUang = false,
}: {
  r: PeriodReport;
  ttd?: TtdLaporan | null;
  /** Pelaksana (DECISIONS 735): "Nilai Fisik Lokasi" tidak dicetak. */
  tanpaUang?: boolean;
}) {
  const h = r.header;
  const lap = susunRencanaRealisasi(r);
  const tt = penandatanganDokumen("mingguan", h);
  const N = lap.totalMinggu;
  const WCOL = N > 26 ? 30 : N > 18 ? 36 : 42;
  const lebar = W_NO + W_URAIAN + W_BOBOT + W_KET + N * WCOL + W_SD + W_PCT;
  const kini = (w: number) => (w === lap.sampai ? "bg-amber-50 print:bg-amber-50" : "");
  const th = "border border-black px-0.5 py-0.5 text-center font-bold";
  const td = "border border-black px-0.5 py-0.5";
  const rentangKini = lap.weekRanges[lap.sampai - 1];
  const t = lap.total;

  return (
    <div className="mx-auto text-[8.5px] leading-tight text-black" style={{ width: lebar }}>
      <div className="text-center">
        <div className="text-[13px] font-bold underline">{lap.judul}</div>
        <div className="text-[9px] font-semibold">
          Posisi s/d Minggu ke-{lap.sampai}
          {rentangKini ? ` (${rentangKini})` : ""} · Periode kontrak {formatTanggal(h.contractStart)} s/d{" "}
          {formatTanggal(h.contractEnd ?? h.periodeEnd)}
        </div>
      </div>

      <div className="mt-2 flex justify-between">
        <table className="border-collapse">
          <tbody>
            {[
              ["Paket Pekerjaan", h.packageName],
              ["Lokasi", `${h.village}${h.district ? `, Kec. ${h.district}` : ""}, ${h.regency}, ${h.province}`],
              ["Nilai Fisik Lokasi", tanpaUang ? null : formatRupiah(h.locationValue)],
              ["Nomor Kontrak", h.contractNumber || "–"],
            ].filter(([, v]) => v !== null).map(([k, v]) => (
              <tr key={k}>
                <td className="pr-2 font-semibold whitespace-nowrap">{k}</td>
                <td>: {v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="border-collapse">
          <tbody>
            {[
              ["Kontraktor Pelaksana", h.vendorName],
              ["Masa Pelaksanaan", `${h.masaPelaksanaanHari} Hari Kalender`],
              ["Tahun Anggaran", String(h.tahunAnggaran)],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="pr-2 font-semibold whitespace-nowrap">{k}</td>
                <td>: {v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[8px] italic">
        Angka mingguan = bobot terhadap nilai fisik lokasi (%). Kolom &quot;% Kategori&quot; = capaian s/d minggu ke-
        {lap.sampai} terhadap kategori itu sendiri.
      </p>

      <table className="mt-1 border-collapse border border-black" style={{ tableLayout: "fixed", width: lebar }}>
        <colgroup>
          <col style={{ width: W_NO }} />
          <col style={{ width: W_URAIAN }} />
          <col style={{ width: W_BOBOT }} />
          <col style={{ width: W_KET }} />
          {Array.from({ length: N }).map((_, i) => (
            <col key={i} style={{ width: WCOL }} />
          ))}
          <col style={{ width: W_SD }} />
          <col style={{ width: W_PCT }} />
        </colgroup>
        <thead className="bg-slate-100">
          <tr>
            <th rowSpan={2} className={th}>No</th>
            <th rowSpan={2} className={th}>Uraian Pekerjaan</th>
            <th rowSpan={2} className={th}>Bobot (%)</th>
            <th rowSpan={2} className={th}>Keterangan</th>
            {lap.monthGroups.map((g, i) => (
              <th key={i} colSpan={g.span} className={th}>
                {g.label}
              </th>
            ))}
            <th rowSpan={2} className={th}>s/d M{lap.sampai}</th>
            <th rowSpan={2} className={th}>% Kategori</th>
          </tr>
          <tr>
            {Array.from({ length: N }).map((_, i) => (
              <th key={i} className={`${th} ${kini(i + 1)}`}>
                M{i + 1}
                <div className="text-[6.5px] font-normal">{lap.weekRanges[i] ?? ""}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lap.baris.map((b, i) => {
            const telat = b.ringkas.realisasiSd + 0.0005 < b.ringkas.rencanaSd;
            return (
              <Fragment key={i}>
                <tr>
                  <td rowSpan={2} className={`${td} text-center align-middle`}>{b.code}</td>
                  <td rowSpan={2} className={`${td} align-middle font-bold`}>{b.name}</td>
                  <td rowSpan={2} className={`${td} text-center align-middle tabular-nums`}>{angka(b.bobot, 2)}</td>
                  <td className={`${td} text-blue-700`}>Rencana</td>
                  {b.rencana.map((v, w) => (
                    <td key={w} className={`${td} text-right tabular-nums ${kini(w + 1)}`}>{selRencana(v)}</td>
                  ))}
                  <td className={`${td} text-right tabular-nums`}>{angka(b.ringkas.rencanaSd)}</td>
                  <td className={`${td} text-right tabular-nums`}>{persen(b.ringkas.rencanaPct)}</td>
                </tr>
                <tr>
                  <td className={`${td} text-green-700`}>Realisasi</td>
                  {b.realisasi.map((v, w) => (
                    <td key={w} className={`${td} text-right tabular-nums ${kini(w + 1)}`}>{selRealisasi(v)}</td>
                  ))}
                  <td className={`${td} text-right font-bold tabular-nums`}>{angka(b.ringkas.realisasiSd)}</td>
                  <td className={`${td} text-right font-bold tabular-nums ${telat ? "text-red-700" : ""}`}>
                    {persen(b.ringkas.realisasiPct)}
                  </td>
                </tr>
              </Fragment>
            );
          })}
          {(
            [
              ["Rencana mingguan (%)", t.rencana.map(selRencana), angka(t.ringkas.rencanaSd)],
              ["Realisasi mingguan (%)", t.realisasi.map(selRealisasi), angka(t.ringkas.realisasiSd)],
              ["Kumulatif rencana (%)", t.kumRencana.map((v) => angka(v, 2)), angka(t.kumRencana[lap.sampai - 1] ?? 0, 2)],
              [
                "Kumulatif realisasi (%)",
                t.kumRealisasi.map((v) => (v == null ? "" : angka(v, 2))),
                angka(t.kumRealisasi[lap.sampai - 1] ?? 0, 2),
              ],
              ["Deviasi (%)", t.deviasi.map((v) => (v == null ? "" : angka(v, 2))), angka(t.deviasi[lap.sampai - 1] ?? 0, 2)],
            ] as [string, string[], string][]
          ).map(([label, isi, sd]) => (
            <tr key={label} className="bg-slate-50 font-bold">
              <td colSpan={4} className={`${td} text-right`}>
                {label}
              </td>
              {isi.map((v, w) => (
                <td key={w} className={`${td} text-right tabular-nums ${kini(w + 1)}`}>{v}</td>
              ))}
              <td className={`${td} text-right tabular-nums`}>{sd}</td>
              <td className={td} />
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 flex justify-between px-8 text-center text-[8.5px]">
        <SignBlock title="MENGETAHUI :" role={peranSlot(tt.kkp, true)} name={tt.kkp.nama} sub={tt.kkp.sub} {...gambarPihak(ttd, "ppk")} />
        <SignBlock
          title="DIPERIKSA :"
          role={peranSlot(tt.konsultan, true)}
          name={tt.konsultan.nama}
          sub={tt.konsultan.sub}
          {...gambarPihak(ttd, "pengawas")}
        />
        <SignBlock
          title="DIBUAT OLEH :"
          role={peranSlot(tt.penyedia, true)}
          name={tt.penyedia.nama}
          sub={tt.penyedia.sub}
          {...gambarPihak(ttd, "penyedia")}
        />
      </div>
    </div>
  );
}
