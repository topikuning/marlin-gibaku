import type { ReactNode } from "react";
import { LABEL_STATUS } from "@/lib/plan/rencana-format";
import type { BarisRencana, RencanaMingguan } from "@/lib/plan/rencana-mingguan";
import { jejakPenyusun, pihakTandaTanganRencana } from "@/lib/plan/rencana-ttd";
import { RuangTtd, gambarPihak, type TtdLaporan } from "./blok-ttd";

/**
 * FORMULIR RENCANA KERJA MINGGUAN — A4 portrait (DECISIONS 258).
 *
 * Ini jawaban atas keberatan user: *"aku sudah buat rencana, lalu apa? mana
 * outputnya? kemana bisa aku laporkan?"* Rencana yang hanya ada di layar tidak
 * bisa dibawa ke rapat mingguan, tidak bisa ditandatangani, tidak bisa dikirim
 * ke PPK. Berkas inilah keluarannya.
 *
 * ### Susunan & alasannya
 *
 * Urutannya dibalik dari kebiasaan lokal (yang biasanya langsung ke tabel
 * item), mengikuti dua praktik yang sudah mapan:
 *
 * 1. **Ringkasan kinerja dulu** (Earned Value Management) — pembaca pertama
 *    dokumen ini adalah orang yang MENYETUJUI, bukan yang mengerjakan. Ia
 *    butuh empat angka: di mana kita sekarang, di mana seharusnya, seberapa
 *    jauh selisihnya, dan **kalau rencana ini dijalankan penuh, sampai di
 *    mana**. Angka terakhir itu yang membuat rencana bisa dinilai SEBELUM
 *    dijalankan — tanpa dia, tanda tangan persetujuan tidak berarti apa-apa.
 * 2. **Evaluasi janji minggu lalu (PPC)** sebelum janji minggu ini — inti
 *    Last Planner System. Rencana baru yang disodorkan tanpa
 *    mempertanggungjawabkan rencana lama akan terus jadi daftar harapan.
 * 3. Baru **tabel komitmen**, lalu catatan, lalu tanda tangan.
 *
 * Semua penanda status ditulis DENGAN KATA, tidak pernah warna saja: berkas ini
 * dicetak hitam-putih dan difoto lalu dikirim lewat WhatsApp.
 *
 * Server component murni — dipakai pratinjau di layar dan halaman cetak.
 */

// SATU konvensi angka untuk seluruh berkas: id-ID, koma sebagai desimal.
// Mencampur "2,5" (volume) dengan "0.38" (bobot) dalam satu baris tabel membuat
// dokumen resmi terbaca seperti tempelan dua sistem.
const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const rupiahFmt = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const dFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" });
const p2 = (n: number) => `${pctFmt.format(n)}%`;
/** Selisih SELALU bertanda — "3,20%" dan "-3,20%" adalah dua kabar berbeda. */
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${pctFmt.format(Math.abs(n))}%`;
const vol = (n: number, unit: string | null) => `${volFmt.format(n)}${unit ? ` ${unit}` : ""}`;
/**
 * Bobot kolom tabel. Nilai yang bukan nol tapi membulat ke 0,00 ditulis
 * "< 0,01" — mencetak "0,00" untuk item senilai Rp 350.000 membuatnya terbaca
 * tidak punya nilai sama sekali.
 */
const bobot = (n: number) => (n <= 0 ? "–" : n < 0.005 ? "< 0,01" : pctFmt.format(n));

export function KkpWeeklyPlan({ r, ttd }: { r: RencanaMingguan; ttd?: TtdLaporan | null }) {
  const h = r.header;
  const byCategory = groupByCategory(r.baris);
  const jejak = jejakPenyusun(r, (d) => dFmt.format(d));

  return (
    <div className="mx-auto min-w-[720px] max-w-[820px] bg-white p-2 text-[11px] text-slate-900">
      {/* ── Kop ── */}
      <div className="border-b-2 border-slate-800 pb-2 text-center">
        <div className="text-base font-bold tracking-wide uppercase">Rencana Kerja Mingguan</div>
        <div className="text-sm font-semibold">Minggu Ke-{r.weekNumber}</div>
        <div className="text-xs text-slate-600">
          Periode {dFmt.format(h.periodeStart)} s/d {dFmt.format(h.periodeEnd)}
        </div>
      </div>

      {/* ── Identitas ── */}
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2">
        <KV k="Paket Pekerjaan" v={h.packageName} />
        <KV k="Masa Pelaksanaan" v={`${h.masaPelaksanaanHari} Hari Kalender`} />
        <KV
          k="Lokasi"
          v={`${h.locationName} — ${h.village}${h.district ? `, Kec. ${h.district}` : ""}, ${h.regency}, ${h.province}`}
        />
        <KV k="Nilai Fisik Lokasi" v={rupiahFmt.format(Number(h.locationValue))} />
        <KV k="Nomor Kontrak" v={h.contractNumber} />
        <KV k="Kontraktor Pelaksana" v={h.vendorName} />
        <KV k="Tahun Anggaran" v={String(h.tahunAnggaran)} />
        <KV
          k="Minggu ke"
          v={`${r.weekNumber} dari ${r.totalWeeks}${r.weekNumber === r.currentWeek ? " (minggu berjalan)" : ""}`}
        />
      </div>

      {/* ── A. Posisi & proyeksi ── */}
      <SectionTitle>A. Posisi Kemajuan &amp; Proyeksi Akhir Minggu</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Metric label="Realisasi s/d saat ini" value={p2(r.actualPct)} />
        <Metric label={`Rencana kurva-S s/d minggu ${r.weekNumber}`} value={p2(r.targetPct)} />
        <Metric
          label="Deviasi terhadap kurva-S"
          value={signed(r.deviationPct)}
          note={LABEL_STATUS[r.status]}
          emphasis={r.status !== "aman"}
        />
        <Metric
          label="Bobot rencana minggu ini"
          value={signed(r.proyeksi.tambahanPct)}
          note={rupiahFmt.format(r.totalNilai)}
        />
      </div>

      {/* Kalimat proyeksi ditulis PENUH, bukan cuma angka di kotak: inilah satu
          hal yang harus terbaca oleh orang yang menandatangani. */}
      <div className="mt-1.5 border border-slate-400 bg-slate-50 p-2 text-[10.5px] leading-relaxed">
        <b>Proyeksi:</b> bila seluruh komitmen dalam formulir ini dikerjakan penuh, realisasi pada
        akhir minggu ke-{r.weekNumber} menjadi{" "}
        <b className="tabular-nums">{p2(r.proyeksi.proyeksiPct)}</b>, sedangkan kurva-S menuntut{" "}
        <b className="tabular-nums">{p2(r.proyeksi.targetPct)}</b> —{" "}
        {r.proyeksi.masihTertinggal ? (
          <>
            <b>masih tertinggal {p2(Math.abs(r.proyeksi.selisihPct))}</b>. Rencana ini belum cukup
            untuk kembali ke jadwal; perlu tambahan sumber daya, perpanjangan jam kerja, atau
            penyesuaian jadwal yang disepakati.
          </>
        ) : (
          <>
            <b>menutup ketertinggalan dengan selisih {signed(r.proyeksi.selisihPct)}</b>. Rencana ini
            cukup untuk kembali ke jadwal bila dijalankan penuh.
          </>
        )}
      </div>

      {/* ── B. Evaluasi komitmen minggu lalu ── */}
      <SectionTitle>B. Evaluasi Komitmen Minggu Ke-{r.weekNumber - 1} (PPC)</SectionTitle>
      {r.ppc.pct == null ? (
        <p className="text-[10px] text-slate-500">
          Tidak ada rencana tercatat untuk minggu sebelumnya — tidak ada komitmen yang bisa
          dievaluasi. Ini <i>bukan</i> nilai 0%.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Metric
              label="PPC (Percent Plan Complete)"
              value={p2(r.ppc.pct)}
              note={`${r.ppc.tuntas} dari ${r.ppc.jumlah} komitmen tuntas`}
              emphasis={r.ppc.pct < 70}
            />
            <Metric
              label="Pencapaian volume"
              value={r.ppc.volumePct == null ? "—" : p2(r.ppc.volumePct)}
              note="pelengkap, bukan pengganti PPC"
            />
            <div className="col-span-2 border border-slate-300 p-1.5 text-[9.5px] leading-relaxed text-slate-600">
              PPC dihitung <b>per komitmen dan biner</b> — tuntas atau tidak. Pekerjaan yang baru 80%
              selesai tidak melepaskan pekerjaan penerusnya, jadi ia dihitung <b>tidak tuntas</b>.
              Ambang sehat lapangan: <b>≥ 70%</b>.
            </div>
          </div>
          {r.tidakTuntas.length > 0 ? (
            <table className="mt-1.5 w-full border-collapse text-[9.5px]">
              <thead>
                <tr className="bg-slate-100 text-center">
                  <Th w="26px">No</Th>
                  <Th align="left">Komitmen minggu lalu yang belum tuntas</Th>
                  <Th align="right" w="90px">Target</Th>
                  <Th align="right" w="90px">Terealisasi</Th>
                  <Th align="right" w="80px">Kekurangan</Th>
                </tr>
              </thead>
              <tbody>
                {r.tidakTuntas.map((t, i) => (
                  <tr key={`${t.code}-${i}`} className="border-b border-slate-100">
                    <Td align="right">{i + 1}</Td>
                    <Td>
                      {/* Kode RAB dipisah tegas dari uraian: tanpa pemisah,
                          "1 Buat Bedeng" terbaca sebagai satu kalimat dan kode
                          item hilang justru saat dipakai mengacu ke RAB. */}
                      <span className="text-slate-500">{t.code}</span>
                      <span className="text-slate-400"> · </span>
                      {t.name}
                    </Td>
                    <Td align="right">{vol(t.target, t.unit)}</Td>
                    <Td align="right">{vol(t.realisasi, t.unit)}</Td>
                    <Td align="right">{vol(Math.max(0, t.target - t.realisasi), t.unit)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-slate-500">
              Seluruh komitmen minggu lalu tuntas.
            </p>
          )}
        </>
      )}

      {/* ── C. Komitmen minggu ini ── */}
      <SectionTitle>C. Komitmen Pekerjaan Minggu Ke-{r.weekNumber}</SectionTitle>
      {r.baris.length === 0 ? (
        <p className="text-[10px] text-slate-500">
          Belum ada komitmen yang dimasukkan untuk minggu ini.
        </p>
      ) : (
        <table className="w-full border-collapse text-[9.5px]">
          <thead>
            <tr className="bg-slate-100 text-center">
              <Th rowSpan={2} w="26px">No</Th>
              <Th rowSpan={2} align="left">Uraian Pekerjaan</Th>
              <Th rowSpan={2} w="36px">Satuan</Th>
              <Th colSpan={3}>Posisi Volume</Th>
              <Th rowSpan={2} align="right" w="66px">Target Minggu Ini</Th>
              <Th rowSpan={2} align="right" w="44px">Bobot</Th>
              <Th rowSpan={2} align="right" w="86px">Nilai</Th>
              <Th rowSpan={2} w="72px">PIC</Th>
            </tr>
            <tr className="bg-slate-100 text-center text-[8.5px]">
              <Th align="right" w="60px">Kontrak</Th>
              <Th align="right" w="60px">Realisasi</Th>
              <Th align="right" w="60px">Sisa</Th>
            </tr>
          </thead>
          <tbody>
            {byCategory.map((c, ci) => (
              <CategoryBlock key={ci} name={c.name} rows={c.rows} startNo={c.startNo} />
            ))}
            <tr className="bg-slate-100 font-bold">
              <Td colSpan={6} align="right">
                JUMLAH KOMITMEN MINGGU INI
              </Td>
              <Td align="right">{r.baris.length} item</Td>
              <Td align="right">{p2(r.totalBobot)}</Td>
              <Td align="right">{rupiahFmt.format(r.totalNilai)}</Td>
              <Td />
            </tr>
          </tbody>
        </table>
      )}
      <p className="mt-1 text-[9px] text-slate-500">
        Kolom <b>Bobot</b> = nilai target dibagi nilai fisik lokasi ({rupiahFmt.format(Number(h.locationValue))}),
        dinyatakan dalam poin persen — dasar yang sama dengan kurva-S dan laporan mingguan KKP.
        Kolom <b>Realisasi</b> adalah volume kumulatif s/d saat formulir ini disusun.
      </p>

      {/* ── D. Catatan ── */}
      <SectionTitle>D. Catatan, Kendala &amp; Kebutuhan Dukungan</SectionTitle>
      {r.catatan?.trim() ? (
        <p className="text-[10px] whitespace-pre-wrap">{r.catatan}</p>
      ) : (
        <div className="h-12 border border-slate-300" />
      )}

      {/* ── TTD ── */}
      <div className="mt-6 grid grid-cols-3 gap-4 text-center text-[10px]">
        {/* Isi blok TTD dari SATU sumber bersama dengan PDF & Excel
            (lib/plan/rencana-ttd.ts) — tiga salinan yang disusun sendiri-sendiri
            adalah asal cacat "Administrator / Direktur". */}
        {pihakTandaTanganRencana(r).map((t) => (
          <Sign
            key={t.title}
            title={t.title.replace(/,$/, "")}
            role={t.role}
            name={t.name}
            sub={t.sub}
            {...gambarPihak(ttd, t.pihak)}
          />
        ))}
      </div>

      {jejak ? <p className="mt-3 text-[9px] text-slate-500">Rencana {jejak} dalam sistem.</p> : null}
    </div>
  );
}

/* ── Pengelompokan ────────────────────────────────────────────────────────── */

type Kelompok = { name: string; rows: BarisRencana[]; startNo: number };

/**
 * Kelompokkan baris per kategori DENGAN MEMPERTAHANKAN URUTAN kemunculan.
 * Nomor urut dokumen berjalan menerus lintas kelompok supaya bisa diacu di
 * rapat ("item nomor 7") tanpa ambigu.
 */
function groupByCategory(baris: BarisRencana[]): Kelompok[] {
  const out: Kelompok[] = [];
  let no = 1;
  for (const b of baris) {
    let g = out.find((x) => x.name === b.categoryName);
    if (!g) {
      g = { name: b.categoryName, rows: [], startNo: 0 };
      out.push(g);
    }
    g.rows.push(b);
  }
  for (const g of out) {
    g.startNo = no;
    no += g.rows.length;
  }
  return out;
}

function CategoryBlock({
  name,
  rows,
  startNo,
}: {
  name: string;
  rows: BarisRencana[];
  startNo: number;
}) {
  const subtotalBobot = rows.reduce((s, r) => s + r.bobotTarget, 0);
  const subtotalNilai = rows.reduce((s, r) => s + r.nilaiTarget, 0);
  return (
    <>
      <tr className="bg-slate-50 font-semibold">
        <Td colSpan={7}>{name}</Td>
        <Td align="right">{p2(subtotalBobot)}</Td>
        <Td align="right">{rupiahFmt.format(subtotalNilai)}</Td>
        <Td />
      </tr>
      {rows.map((b, i) => (
        <tr key={`${b.code}-${i}`} className="border-b border-slate-100">
          <Td align="right">{startNo + i}</Td>
          <Td>
            <span className="text-slate-500">{b.code}</span>
            <span className="text-slate-400"> · </span>
            {b.name}
            {b.note?.trim() ? (
              <span className="block text-[8.5px] text-slate-500">Catatan: {b.note}</span>
            ) : null}
          </Td>
          <Td align="center">{b.unit ?? "—"}</Td>
          <Td align="right">{volFmt.format(b.volumeKontrak)}</Td>
          <Td align="right">{b.realisasi > 0 ? volFmt.format(b.realisasi) : "–"}</Td>
          <Td align="right">{volFmt.format(b.sisa)}</Td>
          <Td align="right" bold>
            {volFmt.format(b.target)}
          </Td>
          <Td align="right">{bobot(b.bobotTarget)}</Td>
          <Td align="right">{rupiahFmt.format(b.nilaiTarget)}</Td>
          <Td>{b.picName ?? "—"}</Td>
        </tr>
      ))}
    </>
  );
}

/* ── Primitif tampilan ───────────────────────────────────────────────────── */

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 mb-1 border-b border-slate-400 pb-0.5 text-[11px] font-bold uppercase">
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-[10.5px]">
      <span className="w-40 shrink-0 text-slate-500">{k}</span>
      <span className="font-medium">: {v}</span>
    </div>
  );
}

/**
 * Kotak angka ringkas. `emphasis` menebalkan bingkai — TIDAK memakai warna
 * sebagai satu-satunya penanda; keterangannya selalu ada di `note`.
 */
function Metric({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`border p-1.5 ${emphasis ? "border-2 border-slate-800" : "border-slate-400"}`}>
      <div className="text-[8.5px] leading-tight text-slate-500 uppercase">{label}</div>
      <div className="text-[15px] leading-tight font-bold tabular-nums">{value}</div>
      {note ? <div className="text-[8.5px] leading-tight text-slate-600">{note}</div> : null}
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
      className={`border border-slate-400 px-1 py-0.5 font-semibold ${align === "right" ? "text-right" : align === "left" ? "text-left" : "text-center"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  colSpan,
  bold,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  colSpan?: number;
  bold?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`border border-slate-200 px-1 py-0.5 ${align === "right" ? "text-right tabular-nums" : align === "center" ? "text-center" : "text-left"} ${bold ? "font-semibold" : ""}`}
    >
      {children}
    </td>
  );
}

function Sign({
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
      <div className="text-slate-600">{title},</div>
      <div className="font-medium">{role}</div>
      {/* 56px = `h-14` yang dulu dipakai — tata letak tidak bergeser saat
          gambar tanda tangan belum ada. */}
      <RuangTtd tinggi={56} ttd={ttd} stempel={stempel} />
      <div className="border-t border-slate-400 pt-0.5 font-semibold">{name ?? "(………………………)"}</div>
      {sub ? <div className="text-[9px] text-slate-500">{sub}</div> : null}
    </div>
  );
}
