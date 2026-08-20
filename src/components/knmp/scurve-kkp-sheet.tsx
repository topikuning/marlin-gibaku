import { buildKurvaSheet } from "@/lib/scurve/kkp-sheet";
import { formatRupiah, formatTanggal } from "@/lib/format";
import type { PeriodReport } from "@/lib/periodic-report";
import { RuangTtd, gambarPihak, type TtdLaporan } from "./blok-ttd";

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

export function ScurveKkpSheet({
  r,
  titleOverride,
  periodeOverride,
  ttd,
}: {
  r: PeriodReport;
  /** Judul dokumen (default: "KURVA S MINGGU/BULAN KE-N"). Utk dokumen jadwal berdiri sendiri. */
  titleOverride?: string;
  /** Rentang periode di subjudul (default: periode laporan). Utk jadwal = seluruh masa kontrak. */
  periodeOverride?: { start: Date; end: Date };
  /** Gambar tanda tangan & stempel; null = ruang kosong utk tanda tangan pena. */
  ttd?: TtdLaporan | null;
}) {
  const sheet = buildKurvaSheet({
    categories: r.kurvaSchedule,
    totalWeeks: r.totalWeeks,
    contractStart: r.header.contractStart,
    actualCum: r.scurve.actualPct,
    currentWeek: r.scurve.currentWeek,
    planCumOfficial: r.scurve.planPct,
  });
  const N = sheet.totalWeeks;
  const M = sheet.categories.length;
  const WCOL = N > 26 ? 30 : N > 18 ? 38 : 46; // kolom minggu menyempit bila periode panjang
  const plotW = N * WCOL;
  const plotH = M * ROW_H;
  // Lebar intrinsik dokumen (format cetak fixed-layout) — caller membungkus
  // dengan overflow-x-auto sehingga di layar sempit dokumen di-scroll, bukan
  // melebarkan halaman.
  const docW = LEFT + plotW + W_KET;
  const title = titleOverride ?? `KURVA S ${r.kind === "mingguan" ? "MINGGU" : "BULAN"} KE - ${r.n}`;
  const periodeStart = periodeOverride?.start ?? r.header.periodeStart;
  const periodeEnd = periodeOverride?.end ?? r.header.periodeEnd;

  // Titik kurva (x = akhir minggu w, y = 1 − kumulatif/100). Anchor minggu-0 = 0%.
  const xFor = (w: number) => (w / N) * plotW;
  const yFor = (p: number) => (1 - Math.min(100, Math.max(0, p)) / 100) * plotH;
  const planPts = [`0,${plotH}`, ...sheet.kumulatifRencana.map((p, i) => `${xFor(i + 1).toFixed(1)},${yFor(p).toFixed(1)}`)].join(" ");
  const actualIdx = sheet.kumulatifRealisasi.map((p, i) => (p == null ? null : i)).filter((i): i is number => i != null);
  const actualPts = ["0," + plotH, ...actualIdx.map((i) => `${xFor(i + 1).toFixed(1)},${yFor(sheet.kumulatifRealisasi[i] as number).toFixed(1)}`)].join(" ");

  const hdr = r.header;

  return (
    <div className="mx-auto text-[8.5px] leading-tight text-black" style={{ width: docW }}>
      {/* Judul */}
      <div className="text-center">
        <div className="text-[13px] font-bold underline">{title}</div>
        <div className="text-[9px] font-semibold">
          Periode tanggal {formatTanggal(periodeStart)} s/d {formatTanggal(periodeEnd)}
        </div>
      </div>

      {/* Header info kiri/kanan */}
      <div className="mt-2 flex justify-between text-[8.5px]">
        <table className="border-collapse">
          <tbody>
            {[
              ["Paket Pekerjaan", `: ${hdr.packageName}`],
              ["Lokasi", `: ${hdr.village}${hdr.district ? `, Kec. ${hdr.district}` : ""}, ${hdr.regency}`],
              ["Nilai Fisik Lokasi", `: ${formatRupiah(hdr.locationValue)}`],
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
              <td>: <span className="inline-block h-0 w-8 border-t-2 border-solid border-blue-600 align-middle" /></td>
            </tr>
            <tr>
              <td className="pr-2 font-semibold">Realisasi</td>
              <td>: <span className="inline-block h-0 w-8 border-t-2 border-green-600 align-middle" /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tabel + overlay kurva */}
      <div className="relative mt-2">
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
                {/* Bobot = Σ sebaran mingguan di barisnya (di Excel: =SUM(M1:MN)) */}
                <td className="border border-black text-center">{num(c.bobotShown, 2)}</td>
                {c.weeklyShown.map((v, i) => (
                  <td key={i} className="border border-black text-center text-[7px]">
                    {v > 0 ? num(v, 3) : ""}
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
                {/* Total kolom bobot = Σ bobot kategori (bukan "100,00" tempelan) */}
                <td className="border border-black text-center">
                  {label.startsWith("Kumulatif Rencana") ? num(sheet.totalBobotShown, 2) : ""}
                </td>
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
          <polyline points={planPts} fill="none" stroke="#2563eb" strokeWidth={1.4} />
          {sheet.kumulatifRencana.map((p, i) => (
            <circle key={i} cx={xFor(i + 1)} cy={yFor(p)} r={1.8} fill="#2563eb" />
          ))}
          {actualIdx.length > 0 ? (
            <>
              <polyline points={actualPts} fill="none" stroke="#16a34a" strokeWidth={1.6} />
              {actualIdx.map((i) => (
                <circle key={i} cx={xFor(i + 1)} cy={yFor(sheet.kumulatifRealisasi[i] as number)} r={1.8} fill="#16a34a" />
              ))}
            </>
          ) : null}
        </svg>

        {/* KETERANGAN: batang skala 0–100% kotak-kotak hitam-putih + label */}
        <div
          className="pointer-events-none absolute"
          style={{ left: LEFT + plotW, top: HEAD_H * 2, width: W_KET, height: plotH }}
        >
          {/* batang checkerboard: 10 pita (10% tiap pita) × 2 kolom, hitam-putih selang-seling */}
          {Array.from({ length: 10 }).map((_, band) => (
            <div key={band} className="absolute flex" style={{ left: 6, top: (band / 10) * plotH, width: 12, height: plotH / 10 }}>
              <div className="h-full w-1/2" style={{ background: band % 2 === 0 ? "#000" : "#fff" }} />
              <div className="h-full w-1/2" style={{ background: band % 2 === 0 ? "#fff" : "#000" }} />
            </div>
          ))}
          <div className="absolute border border-black" style={{ left: 6, top: 0, width: 12, height: plotH }} />
          {[100, 75, 50, 25, 0].map((g) => (
            <div key={g} className="absolute text-[7px] font-semibold text-slate-800" style={{ top: yFor(g) - 4, left: 21 }}>
              {g}
            </div>
          ))}
        </div>
      </div>

      {/* Tanda tangan */}
      <div className="mt-6 flex justify-between px-8 text-center text-[8.5px]">
        <SignBlock
          title="MENGETAHUI :"
          role="PEJABAT PEMBUAT KOMITMEN"
          name={hdr.ppkName}
          sub={hdr.ppkNip ? `NIP. ${hdr.ppkNip}` : null}
          {...gambarPihak(ttd, "ppk")}
        />
        <SignBlock
          title="DIPERIKSA :"
          role="KONSULTAN PENGAWAS"
          name={hdr.supervisorName}
          sub={hdr.supervisorFirm}
          {...gambarPihak(ttd, "pengawas")}
        />
        <SignBlock
          title="DIBUAT OLEH :"
          role={`PENYEDIA JASA – ${hdr.vendorName}`}
          name={hdr.contractorSignerName}
          sub={hdr.contractorSignerTitle}
          {...gambarPihak(ttd, "penyedia")}
        />
      </div>
    </div>
  );
}

/** Blok tanda tangan: judul, peran, nama (dlm kurung), baris sub (NIP/instansi/jabatan). */
function SignBlock({
  title,
  role,
  name,
  sub,
  ttd,
  stempel,
}: {
  title: string;
  role: string;
  name: string | null;
  sub: string | null;
  ttd?: { url: string } | null;
  stempel?: { url: string } | null;
}) {
  return (
    <div>
      <div className="font-semibold">{title}</div>
      <div className="font-semibold">{role}</div>
      {/* 40px = `mt-10` yang dulu dipakai; lembar ini berhuruf 8,5px sehingga
          ruangnya paling sempit — perbandingan stempel:ttd tetap sama karena
          keduanya diturunkan dari angka ini. */}
      <RuangTtd tinggi={72} ttd={ttd} stempel={stempel} />
      <div className="font-semibold underline">{name ? `( ${name} )` : "( ................................ )"}</div>
      {sub ? <div>{sub}</div> : null}
    </div>
  );
}
