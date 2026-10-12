import { penandatanganDokumen, peranSlot } from "@/lib/laporan/penandatangan";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { terbilang } from "@/lib/daily-report/kkp-lampiran-susun";
import { keteranganDeviasi } from "@/lib/plan/rencana-format";
import type { PeriodReport } from "@/lib/periodic-report";
import { gambarPihak, type TtdLaporan } from "./blok-ttd";
import { SignBlock } from "./scurve-kkp-sheet";

/**
 * Halaman "LAPORAN PROGRES MINGGUAN" per kategori & sub-kategori – format
 * Lampiran Termin (permintaan user 2026-10-12, DECISIONS 670).
 *
 * Kolomnya sama dengan blanko rincian, hanya dirangkum per kategori RAB dan
 * sub-kategorinya. Semua angka datang dari `r.progresKategori` – tidak ada
 * yang dihitung di sini.
 */

const angka = (v: number, d: number) =>
  v.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
const bobot = (v: number) => (Math.abs(v) < 0.0005 ? "–" : angka(v, 3));
const persen = (v: number) => (Math.abs(v) < 0.005 ? "–" : `${angka(v, 2)}%`);

export function KkpProgresKategori({ r, ttd }: { r: PeriodReport; ttd?: TtdLaporan | null }) {
  const h = r.header;
  const tt = penandatanganDokumen(r.kind, h);
  const kata = terbilang(r.n);
  const total = r.progresKategoriTotal;
  const dev = r.deviationPct;
  const lokasi = `${h.village}${h.district ? `, Kec. ${h.district}` : ""}, ${h.regency}, ${h.province}`;
  const kontrak = h.contractSignedDate
    ? `${h.contractNumber || "–"}, tgl. ${formatTanggal(h.contractSignedDate, "d MMMM yyyy")}`
    : h.contractNumber || "–";

  const th = "border border-black px-1 py-0.5 text-center font-bold";
  const td = "border border-black px-1 py-0.5";

  return (
    <div className="mx-auto w-[1060px] text-[8.5px] leading-tight text-black">
      <div className="text-center">
        <div className="text-[13px] font-bold underline">LAPORAN PROGRES MINGGUAN</div>
        <div className="text-[10px] font-bold">
          MINGGU KE-{r.n}
          {kata ? ` (${kata})` : ""}
        </div>
        <div className="text-[9px] font-semibold">
          Periode tanggal {formatTanggal(h.periodeStart, "d MMMM yyyy")} s/d{" "}
          {formatTanggal(h.periodeEnd, "d MMMM yyyy")}
        </div>
      </div>

      <table className="mt-2 border-collapse text-[8.5px]">
        <tbody>
          {[
            ["Paket Pekerjaan", h.packageName],
            ["Lokasi", lokasi],
            ["Nilai Kontrak Fisik", formatRupiah(h.contractValue)],
            ["Nilai Fisik Lokasi", formatRupiah(h.locationValue)],
            ["No. dan Tanggal Kontrak", kontrak],
            ["Kontraktor Pelaksana", h.vendorName],
            ["Konsultan Pengawas", h.supervisorFirm?.trim() || h.supervisorName?.trim() || "–"],
            ["Masa Pelaksanaan", `${h.masaPelaksanaanHari} Hari Kalender`],
          ].map(([k, v]) => (
            <tr key={k}>
              <td className="pr-2 font-semibold whitespace-nowrap">{k}</td>
              <td>: {v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="mt-2 w-full border-collapse border border-black" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 44 }} />
          <col />
          <col style={{ width: 100 }} />
          <col style={{ width: 48 }} />
          {Array.from({ length: 6 }).map((_, i) => (
            <col key={i} style={{ width: i % 2 === 0 ? 52 : 46 }} />
          ))}
          <col style={{ width: 66 }} />
          <col style={{ width: 52 }} />
          <col style={{ width: 46 }} />
        </colgroup>
        <thead className="bg-slate-100">
          <tr>
            <th rowSpan={3} className={th}>NO</th>
            <th rowSpan={3} className={th}>JENIS PEKERJAAN</th>
            <th rowSpan={3} className={th}>NILAI PEKERJAAN (Rp)</th>
            <th rowSpan={3} className={th}>BOBOT (%)</th>
            <th colSpan={6} className={th}>REALISASI PEKERJAAN</th>
            <th rowSpan={3} className={th}>BOBOT RENCANA s/d MINGGU INI</th>
            <th colSpan={2} className={th}>SISA PEKERJAAN</th>
          </tr>
          <tr>
            <th colSpan={2} className={th}>MINGGU LALU</th>
            <th colSpan={2} className={th}>MINGGU INI</th>
            <th colSpan={2} className={th}>s/d MINGGU INI</th>
            <th colSpan={2} className={th}>s/d MINGGU INI</th>
          </tr>
          <tr>
            {["PROGRES", "BOBOT", "PROGRES", "BOBOT", "PROGRES", "BOBOT", "PROGRES", "BOBOT"].map((k, i) => (
              <th key={i} className={th}>
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.progresKategori.map((b, i) => {
            const satu = b.tingkat === 1;
            return (
              <tr key={i} className={satu ? "bg-slate-50 font-bold" : undefined}>
                <td className={`${td} ${satu ? "text-center" : "pl-2"}`}>{b.code}</td>
                <td className={`${td} ${satu ? "" : "pl-3"}`}>{b.name}</td>
                <td className={`${td} text-right tabular-nums`}>{angka(b.nilai, 0)}</td>
                <td className={`${td} text-right tabular-nums`}>{bobot(b.bobot)}</td>
                <td className={`${td} text-right tabular-nums`}>{persen(b.progresLalu)}</td>
                <td className={`${td} text-right tabular-nums`}>{bobot(b.bobotLalu)}</td>
                <td className={`${td} text-right tabular-nums`}>{persen(b.progresIni)}</td>
                <td className={`${td} text-right tabular-nums`}>{bobot(b.bobotIni)}</td>
                <td className={`${td} text-right tabular-nums`}>{persen(b.progresSd)}</td>
                <td className={`${td} text-right tabular-nums`}>{bobot(b.bobotSd)}</td>
                <td className={`${td} text-right tabular-nums`}>{bobot(b.bobotRencana)}</td>
                <td className={`${td} text-right tabular-nums`}>{persen(b.sisaProgres)}</td>
                <td className={`${td} text-right tabular-nums`}>{bobot(b.sisaBobot)}</td>
              </tr>
            );
          })}
          <tr className="bg-slate-100 font-bold">
            <td colSpan={2} className={`${td} text-right`}>
              JUMLAH
            </td>
            <td className={`${td} text-right tabular-nums`}>{angka(total.nilai, 0)}</td>
            <td className={`${td} text-right tabular-nums`}>{angka(total.bobot, 3)}</td>
            <td className={`${td} text-right tabular-nums`}>{persen(total.progresLalu)}</td>
            <td className={`${td} text-right tabular-nums`}>{angka(total.bobotLalu, 3)}</td>
            <td className={`${td} text-right tabular-nums`}>{persen(total.progresIni)}</td>
            <td className={`${td} text-right tabular-nums`}>{angka(total.bobotIni, 3)}</td>
            <td className={`${td} text-right tabular-nums`}>{persen(total.progresSd)}</td>
            <td className={`${td} text-right tabular-nums`}>{angka(total.bobotSd, 3)}</td>
            <td className={`${td} text-right tabular-nums`}>{angka(total.bobotRencana, 3)}</td>
            <td className={`${td} text-right tabular-nums`}>{persen(total.sisaProgres)}</td>
            <td className={`${td} text-right tabular-nums`}>{angka(total.sisaBobot, 3)}</td>
          </tr>
        </tbody>
      </table>

      <table className="mt-2 ml-auto border-collapse text-[9px]">
        <tbody>
          {[
            ["BOBOT REALISASI MINGGU INI", angka(r.totals.bobotIni, 3)],
            ["BOBOT REALISASI s/d MINGGU INI", angka(r.totals.bobotSd, 3)],
            ["BOBOT RENCANA s/d MINGGU INI", angka(r.planPct, 3)],
          ].map(([k, v]) => (
            <tr key={k}>
              <td className="pr-2 text-right font-bold">{k}</td>
              <td className="w-16 text-right font-bold tabular-nums">{v} %</td>
              <td />
            </tr>
          ))}
          <tr>
            <td className="pr-2 text-right font-bold">DEVIASI (+/-)</td>
            <td className="w-16 text-right font-bold tabular-nums">
              {dev > 0.005 ? "+" : ""}
              {angka(dev, 3)} %
            </td>
            <td className="pl-3 font-bold italic">( {keteranganDeviasi(dev)} )</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-5 flex justify-between px-8 text-center text-[8.5px]">
        <SignBlock
          title="MENGETAHUI :"
          role={peranSlot(tt.kkp, true)}
          name={tt.kkp.nama}
          sub={tt.kkp.sub}
          {...gambarPihak(ttd, "ppk")}
        />
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
