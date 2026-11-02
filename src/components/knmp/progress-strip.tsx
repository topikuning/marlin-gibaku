import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatPct, formatRupiah } from "@/lib/format";
import { deviationTone, type DeviationTone } from "@/components/ui/stat-delta";

/**
 * PROGRESS STRIP – pengganti kartu enam sel di header lokasi (DECISIONS 737,
 * desain "Progress Strip 2a" dari user 2026-11-02).
 *
 * Masalah versi lama: angka satu jalur (MARLIN atau Kawal) tersebar di tiga
 * sel – rencana, realisasi, deviasi – jadi orang harus menyusunnya sendiri.
 * Di sini angkanya dikelompokkan PER JALUR, dan rencana vs realisasi tampil
 * dalam SATU bar: isi = realisasi, garis = rencana, arsir = ketertinggalan.
 *
 * Komponen ini hanya memformat dan menggambar. Tidak ada rumus: deviasi,
 * nilai lokasi, porsi paket, dan lebar bar waktu datang dari calculation
 * layer (`progress.ts`, `withPpn`, `bobotPct`). Satu-satunya hitungan di sini
 * adalah lebar arsir = −deviasi, yaitu angka deviasi yang sama dibaca dari
 * sisi lain, bukan rumus baru.
 *
 * Komponen server: tanpa state, tanpa JavaScript di peramban.
 */

export type JalurStrip = {
  kunci: "marlin" | "kawal";
  label: string;
  /** Tautan dari label jalur (Progress untuk MARLIN, Kawal KNMP untuk Kawal). */
  href: string;
  realisasi: number | null;
  rencana: number | null;
  /** realisasi − rencana dari calculation layer; null = belum bisa dihitung. */
  deviasi: number | null;
  /** Progres menurut draft adendum (DECISIONS 732) – pantauan, bukan resmi. */
  draft?: { nomor: number; realisasi: number; href: string } | null;
};

export type NilaiStrip = {
  /** Judul sel, mis. "Nilai lokasi · Kedung Mutih" atau "Nilai kontrak paket". */
  judul: string;
  nilai: bigint;
  /** Konteks paket ("dari paket Rp … · 25,3%"); null = tidak ditampilkan. */
  paket: { nilai: bigint; porsiPct: number } | null;
};

export type WaktuStrip = {
  mingguKe: number;
  totalMinggu: number;
  /** Lebar bar waktu (0..100) – dari `bobotPct`, bukan dihitung di sini. */
  lebarPct: number;
  /** Negatif = sudah lewat akhir kontrak. null = belum ada tanggal akhir. */
  sisaHari: number | null;
  /** "8 Agt 2026 – 30 Jan 2027", atau keterangan bila SPMK belum ada. */
  periode: string;
};

const STATUS: Record<DeviationTone, string> = {
  success: "Sesuai jadwal",
  warning: "Terlambat",
  danger: "Kritis",
};

const PILL: Record<DeviationTone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

const pct = (v: number | null) => (v == null ? "–" : formatPct(v));
const batas = (v: number) => Math.max(0, Math.min(100, v));

function teksSisa(sisaHari: number | null): { teks: string; lewat: boolean } | null {
  if (sisaHari == null) return null;
  return sisaHari >= 0 ? { teks: `sisa ${sisaHari} hari`, lewat: false } : { teks: `lewat ${-sisaHari} hari`, lewat: true };
}

function PillDeviasi({ nilai, kecil = false }: { nilai: number; kecil?: boolean }) {
  const tone = deviationTone(nilai);
  return (
    <span
      title={STATUS[tone]}
      className={cn(
        "tabular ml-auto shrink-0 rounded-full font-bold whitespace-nowrap",
        kecil ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-xs",
        PILL[tone],
      )}
    >
      {nilai > 0 ? "+" : ""}
      {formatPct(nilai)}
      <span className="sr-only"> – {STATUS[tone]}</span>
    </span>
  );
}

/** Satu bar: isi = realisasi, arsir = ketertinggalan, garis = rencana, putus-putus = draft. */
function BarJalur({ j, className }: { j: JalurStrip; className?: string }) {
  const realisasi = j.realisasi == null ? 0 : batas(j.realisasi);
  const tertinggal = j.deviasi != null && j.deviasi < 0 ? Math.min(-j.deviasi, 100 - realisasi) : 0;
  const status = j.deviasi != null ? ` – ${STATUS[deviationTone(j.deviasi)]}` : "";
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={j.realisasi ?? undefined}
      aria-label={`Realisasi ${j.label} ${pct(j.realisasi)} dari rencana ${pct(j.rencana)}${status}`}
      className={cn("relative h-2 min-w-0 shrink-0 rounded-full bg-surface-inset", className)}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full",
          j.kunci === "marlin" ? "bg-primary" : "bg-primary-400",
        )}
        style={{ width: `${realisasi}%` }}
      />
      {tertinggal > 0 ? (
        <div
          aria-hidden
          className="absolute inset-y-0"
          style={{
            left: `${realisasi}%`,
            width: `${tertinggal}%`,
            background:
              "repeating-linear-gradient(135deg, var(--color-warning-border) 0 3px, var(--color-warning-soft) 3px 6px)",
          }}
        />
      ) : null}
      {j.draft ? (
        <div
          aria-hidden
          className="absolute -inset-y-1 border-l-2 border-dashed border-warning"
          style={{ left: `${batas(j.draft.realisasi)}%` }}
        />
      ) : null}
      {j.rencana != null ? (
        <div
          aria-hidden
          className="absolute -inset-y-1 -ml-px w-0.5 bg-ink"
          style={{ left: `${batas(j.rencana)}%` }}
        />
      ) : null}
    </div>
  );
}

function SelJalur({ j }: { j: JalurStrip }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-2 bg-surface px-4 py-3.5">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <Link href={j.href} className="shrink-0 text-xs font-bold tracking-wider text-ink hover:underline">
          {j.label}
        </Link>
        {/* text-lg di bawah 2xl: di 1280 px sel jalur hanya ±220 px isi. */}
        <span
          className={cn(
            "tabular text-lg leading-none font-extrabold 2xl:text-xl",
            j.kunci === "marlin" ? "text-primary" : "text-primary-500",
          )}
        >
          {pct(j.realisasi)}
        </span>
        {/* Kata "rencana" hanya di layar lebar: di 1366 px sel jalur tidak
            muat dan teksnya terpotong. Garis tegak di bar = rencana. */}
        <span title={`rencana ${pct(j.rencana)}`} className="shrink-0 text-xs whitespace-nowrap text-ink-muted">
          / {pct(j.rencana)}
          <span className="hidden 2xl:inline"> rencana</span>
        </span>
        {j.deviasi != null ? <PillDeviasi nilai={j.deviasi} /> : null}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {/* flex-1 hanya di baris ini – di wadah kolom (ponsel) ia membuat tinggi bar jadi 0. */}
        <BarJalur j={j} className="flex-1" />
        {j.draft ? (
          <Link
            href={j.draft.href}
            title={`Draft adendum #${j.draft.nomor} · Realisasi ${j.label} ${formatPct(j.draft.realisasi)} · Belum resmi`}
            className="tabular shrink-0 rounded-md border border-dashed border-warning-border bg-warning-soft px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-warning hover:underline"
          >
            Draft {formatPct(j.draft.realisasi)}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/*
 * Kolom kisi satu baris – string utuh supaya terbaca Tailwind. Mulai `xl`
 * (1280 px), bukan `lg` seperti desain: sidebar MARLIN memakan ±240 px, dan di
 * 1024 px sel jalur tinggal 121 px – isinya meluber (diukur 2026-11-02). Di
 * bawah 1280 px kisi 2 × 2.
 */
const KOLOM_XL: Record<string, string> = {
  "nilai-1": "xl:grid-cols-[270px_220px_minmax(0,1fr)]",
  "nilai-2": "xl:grid-cols-[270px_220px_minmax(0,1fr)_minmax(0,1fr)]",
  "tanpa-1": "xl:grid-cols-[220px_minmax(0,1fr)]",
  "tanpa-2": "xl:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]",
};

/** Kartu lebar (≥ 640 px): satu baris mulai 1280 px, kisi 2 × 2 di bawahnya. */
export function ProgressStrip({
  nilai,
  waktu,
  jalur,
}: {
  /** null = peran tanpa `money.view` (Pelaksana, DECISIONS 735) atau tanpa kontrak. */
  nilai: NilaiStrip | null;
  waktu: WaktuStrip;
  jalur: JalurStrip[];
}) {
  const sisa = teksSisa(waktu.sisaHari);
  const kunciKolom = `${nilai ? "nilai" : "tanpa"}-${Math.min(2, Math.max(1, jalur.length))}`;
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2",
        KOLOM_XL[kunciKolom],
      )}
    >
      {nilai ? (
        <div className="flex min-w-0 flex-col justify-center gap-0.5 bg-surface px-5 py-3.5">
          <span
            title={nilai.judul}
            className="truncate text-[11px] font-semibold tracking-wider text-ink-muted uppercase"
          >
            {nilai.judul}
          </span>
          <span className="tabular text-lg leading-tight font-bold text-ink">{formatRupiah(nilai.nilai)}</span>
          {nilai.paket ? (
            <span className="tabular truncate text-xs text-ink-muted">
              dari paket <strong className="font-semibold text-ink">{formatRupiah(nilai.paket.nilai)}</strong> ·{" "}
              {formatPct(nilai.paket.porsiPct)}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col justify-center gap-1.5 bg-surface px-5 py-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="tabular text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
            {waktu.totalMinggu > 0 ? `Minggu ${waktu.mingguKe} / ${waktu.totalMinggu}` : "Waktu kontrak"}
          </span>
          {sisa ? (
            <span className={cn("text-xs whitespace-nowrap", sisa.lewat ? "font-medium text-danger" : "text-ink-muted")}>
              {sisa.teks}
            </span>
          ) : null}
        </div>
        {waktu.totalMinggu > 0 ? (
          <div className="relative h-1.5 rounded-full bg-surface-inset" aria-hidden>
            <div
              className={cn("absolute inset-y-0 left-0 rounded-full", sisa?.lewat ? "bg-danger" : "bg-ink-faint")}
              style={{ width: `${batas(waktu.lebarPct)}%` }}
            />
          </div>
        ) : null}
        <span className="tabular truncate text-xs font-medium text-ink">{waktu.periode}</span>
      </div>
      {jalur.map((j) => (
        <SelJalur key={j.kunci} j={j} />
      ))}
    </div>
  );
}

/** Versi ponsel (< 640 px): satu kartu, blok bertumpuk – terbaca sekali lihat. */
export function ProgressStripPonsel({
  nilai,
  waktu,
  jalur,
}: {
  nilai: NilaiStrip | null;
  waktu: WaktuStrip;
  jalur: JalurStrip[];
}) {
  const sisa = teksSisa(waktu.sisaHari);
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        {nilai ? (
          <div className="flex min-w-0 flex-col gap-px">
            <span className="truncate text-[10px] font-semibold tracking-wider text-ink-muted uppercase">
              {nilai.judul}
            </span>
            <span className="tabular text-[15px] leading-tight font-bold text-ink">{formatRupiah(nilai.nilai)}</span>
            {nilai.paket ? (
              <span className="tabular truncate text-[11px] text-ink-muted">
                dari paket {formatRupiah(nilai.paket.nilai)} · {formatPct(nilai.paket.porsiPct)}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="min-w-0 truncate text-[11px] text-ink-muted">{waktu.periode}</span>
        )}
        <div className="flex shrink-0 flex-col items-end gap-px">
          <span className="tabular text-[15px] leading-tight font-bold text-ink">
            {waktu.totalMinggu > 0 ? `${waktu.mingguKe}/${waktu.totalMinggu} mg` : "–"}
          </span>
          {sisa ? (
            <span className={cn("text-[11px]", sisa.lewat ? "font-medium text-danger" : "text-ink-muted")}>{sisa.teks}</span>
          ) : null}
        </div>
      </div>
      {/* Seluruh blok jalur = satu sasaran ketuk (≥ 44 px, DECISIONS 731),
          bukan label kecil yang harus dibidik. */}
      {jalur.map((j) => (
        <Link key={j.kunci} href={j.href} className="flex flex-col gap-2 px-4 py-3 active:bg-surface-muted">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="w-14 shrink-0 text-xs font-bold tracking-wider text-ink">{j.label}</span>
            <span
              className={cn(
                "tabular text-lg leading-none font-extrabold",
                j.kunci === "marlin" ? "text-primary" : "text-primary-500",
              )}
            >
              {pct(j.realisasi)}
            </span>
            <span className="truncate text-xs text-ink-muted">/ {pct(j.rencana)}</span>
            {j.deviasi != null ? <PillDeviasi nilai={j.deviasi} kecil /> : null}
          </div>
          <BarJalur j={j} className="w-full" />
          {j.draft ? (
            <span className="text-[11px] font-semibold text-warning">
              Draft adendum #{j.draft.nomor} · <span className="tabular">{formatPct(j.draft.realisasi)}</span> · belum resmi
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
