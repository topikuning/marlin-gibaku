import type { WorkerRole } from "@/generated/prisma/enums";
import { WORKER_ROLE_LABEL, WORKER_ROLE_ORDER } from "@/lib/daily-report/constants";

/**
 * FORMAT LAPORAN HARIAN KKP — tata letak MENGIKUTI BLANKO RESMI (contoh KKP),
 * blok demi blok dengan urutan yang sama:
 *
 *   kop (logo pemilik · LAPORAN HARIAN | KONSULTAN PENGAWAS | KONTRAKTOR PELAKSANA)
 *   → Minggu Ke / Hari / Tanggal (separuh kiri) → PEKERJAAN / LOKASI / TH. ANGGARAN
 *   → TENAGA KERJA | REKAP PEMASUKAN BAHAN / MATERIAL (+ PERALATAN)
 *   → KONDISI CUACA per jam (+ SHOP DRAWING) → Jam Kerja
 *   → RENCANA PEKERJAAN | REALISASI PEKERJAAN → tanda tangan.
 *
 * Dua blok TAMBAHAN di luar blanko (progres per pekerjaan & catatan) sengaja
 * diletakkan SESUDAH rencana/realisasi supaya susunan utama blanko tidak
 * bergeser. Server component murni — data disiapkan queries.getKkpDailyData.
 */

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const orgFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const HOURS = ["07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21"];
/** Baris kosong tercetak (blanko punya kotak siap-isi walau data belum ada). */
const MIN_MATERIAL_ROWS = 8;
const MIN_EQUIPMENT_ROWS = 6;
const MIN_RR_ROWS = 6;

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
  /**
   * Rencana kerja hari ini — pecahan rencana mingguan menurut alur & metode
   * kerja (DECISIONS 163). Kosong bila minggu itu belum punya rencana.
   */
  rencana?: { name: string; unit: string | null; volume: number; picName: string | null }[];
  /** Judul pekerjaan dari kontrak (blanko: baris "PEKERJAAN"). */
  pekerjaan?: string | null;
  /**
   * Identitas pemilik pekerjaan untuk kop — dari menu Sistem, BUKAN hardcode
   * KKP, supaya satu basis kode melayani klien mana pun (DECISIONS 166).
   */
  ownerName?: string;
  ownerSubtitle?: string;
  /** URL logo pemilik (presigned, opsional). */
  ownerLogoUrl?: string | null;
  /** Penanda tangan (dari kontrak, current — null = baris kosong). */
  supervisorName?: string | null;
  supervisorSub?: string | null;
  contractorName?: string | null;
  contractorSub?: string | null;
  /** Nama perusahaan pengawas & pelaksana (di blanko: kotak "logo perusahaan"). */
  supervisorFirm?: string | null;
  contractorFirm?: string | null;
};

export function KkpDailyReport({ d }: { d: KkpDailyData }) {
  const rr = barisRencanaRealisasi(d);
  const materialRows = Math.max(MIN_MATERIAL_ROWS, d.materials.length);
  const equipmentRows = Math.max(MIN_EQUIPMENT_ROWS, d.equipment.length);

  return (
    <div className="mx-auto max-w-225 bg-white text-[11px] leading-tight text-slate-900">
      {!d.isFinal ? (
        <div className="no-print mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
          PRATINJAU — laporan belum difinalisasi; angka masih bisa berubah.
        </div>
      ) : null}

      {/* ── Kop + identitas: SATU tabel, persis blanko ────────────────────
          Kop, Minggu/Hari/Tanggal, dan PEKERJAAN/LOKASI/TH. ANGGARAN harus
          sekerangka supaya semua garis bertemu dan blok kanan tertutup:
          · baris identitas berhenti tepat di garis kanan sel "LAPORAN HARIAN";
          · kotak perusahaan pengawas/pelaksana MEMANJANG ke bawah sampai baris
            Tanggal (rowSpan), jadi sisi kanan tidak menganga;
          · PEKERJAAN/LOKASI/TH. ANGGARAN membentang penuh sampai tepi kanan. */}
      <table className="w-full table-fixed border border-slate-500">
        <colgroup>
          <col className="w-[9%]" /> {/* logo */}
          <col className="w-[14%]" /> {/* label */}
          <col className="w-[3%]" /> {/* titik dua */}
          <col className="w-[18%]" /> {/* isi — kiri berakhir di 44% */}
          <col className="w-[28%]" /> {/* konsultan pengawas */}
          <col className="w-[28%]" /> {/* kontraktor pelaksana */}
        </colgroup>
        <tbody>
          <tr>
            <Cell center>
              {d.ownerLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.ownerLogoUrl} alt="" className="mx-auto max-h-10 w-auto" />
              ) : (
                <>&nbsp;</>
              )}
            </Cell>
            <Cell colSpan={3}>
              <span className="text-sm font-bold tracking-wide uppercase">Laporan Harian</span>
            </Cell>
            <Cell head center>Konsultan Pengawas</Cell>
            <Cell head center>Kontraktor Pelaksana</Cell>
          </tr>
          {[
            ["Minggu Ke", d.weekNo != null ? String(d.weekNo) : ""],
            ["Hari", d.hari],
            ["Tanggal", d.tanggalFull],
          ].map(([label, value], i) => (
            <tr key={label}>
              <Cell colSpan={2}>{label}</Cell>
              <Cell center>:</Cell>
              <Cell>{value}</Cell>
              {i === 0 ? (
                <>
                  <Cell center rowSpan={3}>{d.supervisorFirm ?? <>&nbsp;</>}</Cell>
                  <Cell center rowSpan={3}>{d.contractorFirm ?? <>&nbsp;</>}</Cell>
                </>
              ) : null}
            </tr>
          ))}
          {[
            ["PEKERJAAN", d.pekerjaan ?? "Konstruksi"],
            ["LOKASI", `${d.locationName}, ${d.regency}, ${d.province}`],
            ["TH. ANGGARAN", String(d.tahunAnggaran)],
          ].map(([label, value]) => (
            <tr key={label}>
              <Cell colSpan={2}>{label}</Cell>
              <Cell center>:</Cell>
              <Cell colSpan={3}>{value}</Cell>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Tenaga kerja | material & peralatan ──────────────────────────── */}
      <div className="grid grid-cols-2">
        <table className="w-full border-x border-b border-slate-500">
          <thead>
            <tr>
              <Cell head center colSpan={4}>Tenaga Kerja</Cell>
            </tr>
            <tr>
              <Cell head center w>No</Cell>
              <Cell head center>Keahlian</Cell>
              <Cell head center w colSpan={2}>Jmh</Cell>
            </tr>
          </thead>
          <tbody>
            {WORKER_ROLE_ORDER.map((r, i) => (
              <tr key={r}>
                <Cell center>{i + 1}</Cell>
                <Cell>{WORKER_ROLE_LABEL[r]}</Cell>
                <Cell right>{orgFmt.format(d.workerMap[r] ?? 0)}</Cell>
                <Cell w center>org</Cell>
              </tr>
            ))}
            <tr className="font-semibold">
              <Cell colSpan={2} center>Jumlah</Cell>
              <Cell right>{orgFmt.format(d.totalWorkers)}</Cell>
              <Cell w center>org</Cell>
            </tr>
          </tbody>
        </table>

        <div>
          <table className="w-full border-r border-b border-slate-500">
            <thead>
              <tr>
                <Cell head center colSpan={5}>Rekap Pemasukan Bahan / Material</Cell>
              </tr>
              <tr>
                <Cell head center w>No</Cell>
                <Cell head center>Jenis Material / Bahan</Cell>
                <Cell head center w>Satuan</Cell>
                <Cell head center w>Diterima</Cell>
                {/* Ditolak: ada di blanko, belum ada inputnya di sistem —
                    sengaja dikosongkan untuk diisi tangan (keputusan user). */}
                <Cell head center w>Ditolak</Cell>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: materialRows }).map((_, i) => {
                const m = d.materials[i];
                return (
                  <tr key={`m${i}`}>
                    <Cell center>{i + 1}</Cell>
                    <Cell>{m?.name ?? <>&nbsp;</>}</Cell>
                    <Cell center>{m?.unit ?? ""}</Cell>
                    <Cell right>{m && m.qty != null ? volFmt.format(m.qty) : ""}</Cell>
                    <Cell></Cell>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <table className="w-full border-r border-b border-slate-500">
            <thead>
              <tr>
                <Cell head center colSpan={3}>Peralatan</Cell>
              </tr>
              <tr>
                <Cell head center w>No</Cell>
                <Cell head center>Nama Peralatan</Cell>
                <Cell head center w>Jumlah</Cell>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: equipmentRows }).map((_, i) => {
                const e = d.equipment[i];
                return (
                  <tr key={`e${i}`}>
                    <Cell center>{i + 1}</Cell>
                    <Cell>{e?.name ?? <>&nbsp;</>}</Cell>
                    <Cell center>{e ? e.count : ""}</Cell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Kondisi cuaca per jam ────────────────────────────────────────── */}
      <table className="w-full border-x border-b border-slate-500 text-center">
        <thead>
          <tr>
            <Cell head center colSpan={HOURS.length + 1}>Kondisi Cuaca</Cell>
            {/* Shop drawing: ada di blanko, belum ada datanya di sistem —
                dikosongkan untuk diisi tangan (keputusan user). */}
            <Cell head center>Shop Drawing</Cell>
          </tr>
          <tr>
            <Cell head center>Kondisi / Jam</Cell>
            {HOURS.map((h) => (
              <Cell head center key={h}>{h}.00</Cell>
            ))}
            <Cell head center></Cell>
          </tr>
        </thead>
        <tbody>
          {(["Cerah", "Mendung", "Hujan"] as const).map((cat) => (
            <tr key={cat}>
              <Cell center>{cat}</Cell>
              {HOURS.map((h) => (
                <Cell center key={h}>{d.activeWeather === cat ? "✓" : ""}</Cell>
              ))}
              <Cell center></Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="w-full table-fixed border-x border-b border-slate-500">
        <colgroup>
          <col className="w-[18%]" />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <Cell>Jam Kerja</Cell>
            <Cell>
              mulai {d.workStart ?? "……"} — selesai {d.workEnd ?? "……"}
            </Cell>
          </tr>
        </tbody>
      </table>

      {/* ── Rencana | realisasi pekerjaan ────────────────────────────────
          Rencana = pecahan rencana MINGGUAN ke hari ini menurut alur & metode
          kerja (DECISIONS 163); realisasi = pekerjaan yang benar-benar dilapor
          hari itu. Baris disamakan panjangnya supaya kedua kolom sejajar. */}
      {/* SATU tabel, bukan dua yang ditempel berdampingan: baris rencana dan
          realisasi wajib sebaris. Dengan dua tabel terpisah, satu teks
          realisasi yang membungkus jadi dua baris langsung menggeser seluruh
          sisanya dan garisnya tidak lagi bertemu. */}
      <table className="w-full table-fixed border-x border-b border-slate-500">
        <colgroup>
          <col className="w-[4%]" />
          <col className="w-[46%]" />
          <col className="w-[4%]" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <Cell head center colSpan={2}>Rencana Pekerjaan</Cell>
            <Cell head center colSpan={2}>Realisasi Pekerjaan</Cell>
          </tr>
        </thead>
        <tbody>
          {rr.map((row, i) => (
            <tr key={`rr${i}`}>
              <Cell center>{i + 1}</Cell>
              <Cell>{row.rencana ?? <>&nbsp;</>}</Cell>
              <Cell center>{i + 1}</Cell>
              <Cell>{row.realisasi ?? <>&nbsp;</>}</Cell>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Catatan (data sistem; tetap dipertahankan) ───────────────────── */}
      <table className="w-full border-x border-b border-slate-500">
        <thead>
          <tr>
            <Cell head>Catatan / Keterangan</Cell>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Cell>{d.notes || " "}</Cell>
          </tr>
        </tbody>
      </table>

      {/* ── Tanda tangan ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 border-x border-b border-slate-500">
        <div className="border-r border-slate-500 px-3 py-2 text-center">
          <div className="text-[10px] text-slate-600">Disetujui Oleh;</div>
          <div className="text-[10px] text-slate-600">Konsultan Pengawas</div>
          <div className="text-[10px] text-slate-500">{d.supervisorFirm ?? d.supervisorSub ?? ""}</div>
          <div className="mt-12 border-t border-slate-400 pt-1 font-semibold text-slate-900">
            {d.supervisorName ? `( ${d.supervisorName} )` : <span className="font-normal text-slate-500">( …………………… )</span>}
          </div>
          <div className="text-[9px] text-slate-500 italic">Inspector</div>
        </div>
        <div className="px-3 py-2 text-center">
          <div className="text-[10px] text-slate-600">Dibuat Oleh :</div>
          <div className="text-[10px] text-slate-600">Kontraktor Pelaksana</div>
          <div className="text-[10px] text-slate-500">{d.contractorFirm ?? ""}</div>
          <div className="mt-12 border-t border-slate-400 pt-1 font-semibold text-slate-900">
            {d.contractorName ? `( ${d.contractorName} )` : <span className="font-normal text-slate-500">( …………………… )</span>}
          </div>
          <div className="text-[9px] text-slate-500 italic">{d.contractorSub || "Pelaksana"}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Satu baris REALISASI PEKERJAAN = uraian pekerjaan + volume hari ini, ditambah
 * kemajuan kumulatifnya. Blanko hanya minta uraian; angka progres disisipkan di
 * baris yang sama supaya tidak perlu tabel terpisah.
 * Contoh: "Pagar Pengaman Proyek — 15 m (s/d 25 dari 120 m · 20,8%)".
 */
export function teksRealisasi(it: KkpDailyItem): string {
  const satuan = it.unit ? ` ${it.unit}` : "";
  const bagian = [`${it.name} — ${volFmt.format(it.volumeToday)}${satuan}`];
  const progres: string[] = [`s/d ${volFmt.format(it.volumeCumulative)}`];
  if (it.volumeContract != null) progres.push(`dari ${volFmt.format(it.volumeContract)}${satuan}`);
  if (it.pctCumulative != null) progres.push(`${pctFmt.format(it.pctCumulative)}%`);
  bagian.push(`(${progres.join(" · ")})`);
  return bagian.join(" ");
}

/**
 * Pasangkan baris "Rencana" dan "Realisasi" jadi satu daftar sejajar; jumlah
 * baris = yang terpanjang, minimal seperti blanko cetak supaya kotaknya tetap
 * ada untuk diisi tangan.
 */
function barisRencanaRealisasi(d: KkpDailyData): { rencana: string | null; realisasi: string | null }[] {
  const rencana = (d.rencana ?? []).map((r) =>
    `${r.name}${r.volume > 0 ? ` — ${volFmt.format(r.volume)}${r.unit ? ` ${r.unit}` : ""}` : ""}` +
    (r.picName ? ` (${r.picName})` : ""),
  );
  const realisasi = d.items.map((it) => teksRealisasi(it));
  const n = Math.max(MIN_RR_ROWS, rencana.length, realisasi.length);
  return Array.from({ length: n }, (_, i) => ({
    rencana: rencana[i] ?? null,
    realisasi: realisasi[i] ?? null,
  }));
}

function Cell({
  children,
  head,
  w,
  center,
  right,
  colSpan,
  rowSpan,
}: {
  children?: React.ReactNode;
  head?: boolean;
  w?: boolean;
  center?: boolean;
  right?: boolean;
  colSpan?: number;
  rowSpan?: number;
}) {
  const Tag = head ? "th" : "td";
  return (
    <Tag
      colSpan={colSpan}
      rowSpan={rowSpan}
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
