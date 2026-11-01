import { Fragment } from "react";
import { penandatanganDokumen, peranSlot } from "@/lib/laporan/penandatangan";
import { kopProgresMingguan } from "@/lib/laporan/kop-progres";
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
 * yang dihitung di sini. Teks kop dari `kopProgresMingguan`, sama dengan PDF
 * dan Excel (DECISIONS 671).
 */

/** Alamat logo kop (presign singkat) – kotak PENYEDIA JASA · KONSULTAN · PEMBERI TUGAS. */
export type LogoKopProgres = { pemilik: string | null; konsultan: string | null; penyedia: string | null };

const angka = (v: number, d: number) =>
  v.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
const bobot = (v: number) => (Math.abs(v) < 0.0005 ? "–" : angka(v, 3));
const persen = (v: number) => (Math.abs(v) < 0.005 ? "–" : `${angka(v, 2)}%`);

export function KkpProgresKategori({
  r,
  ttd,
  logo,
  tanpaUang = false,
}: {
  /** Pelaksana (DECISIONS 735): kolom "NILAI PEKERJAAN (Rp)" tidak dicetak. */
  tanpaUang?: boolean;
  r: PeriodReport;
  ttd?: TtdLaporan | null;
  logo?: LogoKopProgres | null;
}) {
  const h = r.header;
  const tt = penandatanganDokumen(r.kind, h);
  const kop = kopProgresMingguan(h, r.n);
  const total = r.progresKategoriTotal;
  const dev = r.deviationPct;
  const logoPihak = [logo?.penyedia, logo?.konsultan, logo?.pemilik];

  const th = "border border-black px-1 py-0.5 text-center font-bold";
  const td = "border border-black px-1 py-0.5";

  return (
    <div className="mx-auto w-[1060px] text-[8.5px] leading-tight text-black">
      <div className="text-center text-[14px] font-bold">{kop.judul}</div>

      <div className="mt-1 flex items-start gap-4">
        <table className="flex-1 border-collapse text-[9px]">
          <tbody>
            {/* Pelaksana: baris "Nilai Kontrak …" kop tidak dicetak (DECISIONS 735). */}
            {kop.identitas.filter(([k]) => !(tanpaUang && k.startsWith("Nilai Kontrak"))).map(([k, v]) => (
              <tr key={k}>
                <td className="w-[130px] py-px pr-2 align-top font-bold whitespace-nowrap">{k}</td>
                <td className="w-3 py-px align-top">:</td>
                <td className="py-px align-top font-semibold">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="w-[380px] shrink-0 text-center">
          <div className="text-[10px] font-bold">{kop.minggu}</div>
          <div className="mt-1 border-b border-black pb-0.5 text-[10px] font-bold">{kop.periode}</div>
          <div className="grid grid-cols-3">
            {kop.pihak.map((p, i) => (
              <div key={p} className="flex flex-col items-center">
                <div className="text-[8.5px] font-bold">{p}</div>
                <div className="flex h-[58px] items-center justify-center">
                  {logoPihak[i] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoPihak[i]!} alt={`Logo ${p.toLowerCase()}`} className="max-h-[54px] max-w-[110px] object-contain" />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <table className="mt-2 w-full border-collapse border border-black" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 44 }} />
          <col />
          {tanpaUang ? null : <col style={{ width: 100 }} />}
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
            {tanpaUang ? null : <th rowSpan={3} className={th}>NILAI PEKERJAAN (Rp)</th>}
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
            const kosong = b.judulSaja === true;
            const sel = (isi: string) => <td className={`${td} text-right tabular-nums`}>{kosong ? "" : isi}</td>;
            return (
              <Fragment key={i}>
                {/* Baris jeda sebelum tiap kategori – seperti contoh Lampiran Termin. */}
                {satu ? (
                  <tr aria-hidden>
                    {Array.from({ length: tanpaUang ? 12 : 13 }).map((_, c) => (
                      <td key={c} className={`${td} h-3`} />
                    ))}
                  </tr>
                ) : null}
                <tr className={satu ? "bg-slate-50 font-bold" : undefined}>
                  <td className={`${td} ${satu ? "text-center" : "pl-2"}`}>{b.code}</td>
                  <td className={`${td} ${satu ? "" : "pl-3"}`}>{b.name}</td>
                  {tanpaUang ? null : sel(angka(b.nilai, 0))}
                  {sel(bobot(b.bobot))}
                  {sel(persen(b.progresLalu))}
                  {sel(bobot(b.bobotLalu))}
                  {sel(persen(b.progresIni))}
                  {sel(bobot(b.bobotIni))}
                  {sel(persen(b.progresSd))}
                  {sel(bobot(b.bobotSd))}
                  {sel(bobot(b.bobotRencana))}
                  {sel(persen(b.sisaProgres))}
                  {sel(bobot(b.sisaBobot))}
                </tr>
              </Fragment>
            );
          })}
          <tr className="bg-slate-100 font-bold">
            <td colSpan={2} className={`${td} text-right`}>
              JUMLAH
            </td>
            {tanpaUang ? null : <td className={`${td} text-right tabular-nums`}>{angka(total.nilai, 0)}</td>}
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
