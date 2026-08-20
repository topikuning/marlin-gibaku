import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatTanggal } from "@/lib/format";
import { selHari, type SelHari } from "@/lib/daily-report/hari-ini-ringkas";
import type { RecentDay } from "@/lib/daily-report/queries";

/**
 * STRIP 7 HARI: tujuh hari terakhir satu lokasi dalam SATU baris (DECISIONS 336).
 *
 * Menggantikan daftar 7 baris vertikal. Untuk Site Manager dengan 12 lokasi,
 * bentuk lama berarti **84 baris untuk digulir** hanya demi melihat kelengkapan;
 * bentuk ini 12 strip. Itu perbedaan antara halaman yang dipakai dan halaman
 * yang dilewati.
 *
 * ### Status tidak pernah hanya warna
 *
 * Tiap sel membawa KATA ("Final", "Koreksi", "Belum"), bukan hanya warna.
 * Aturan yang sudah tertulis di `kkp-weekly-plan.tsx`, dan alasannya sama kuat
 * di layar: HP murah di bawah matahari, dan buta warna merah-hijau ada pada
 * ±8% laki-laki. Warna mempercepat, kata yang menentukan.
 *
 * Server component murni — tidak ada state, tiap sel hanyalah tautan.
 */

const NADA_SEL: Record<SelHari["nada"], string> = {
  success: "border-success/40 bg-success-soft text-success",
  info: "border-info/40 bg-info-soft text-info",
  warning: "border-warning/50 bg-warning-soft text-warning",
  danger: "border-danger/50 bg-danger-soft text-danger",
  neutral: "border-border bg-surface-muted text-ink-muted",
};

export function Strip7Hari({
  slug,
  hari,
  todayKey,
}: {
  slug: string;
  hari: RecentDay[];
  todayKey: string;
}) {
  return (
    <ul className="grid grid-cols-7 gap-1">
      {hari.map((d) => {
        const tanggal = new Date(`${d.dateKey}T00:00:00Z`);
        const sel = selHari(d.dateKey, d.status, formatTanggal(tanggal, "EEEE, d MMM"));
        const iniHariIni = d.dateKey === todayKey;
        return (
          <li key={d.dateKey}>
            <Link
              href={`/lokasi/${slug}/harian/${d.dateKey}`}
              title={sel.judul}
              aria-label={sel.judul}
              className={cn(
                "flex min-h-[58px] flex-col items-center justify-center gap-0.5 rounded-md border px-0.5 py-1.5 transition-colors hover:border-border-strong",
                NADA_SEL[sel.nada],
                // Hari ini ditandai cincin, BUKAN warna lain: warnanya sudah
                // dipakai menyatakan status, dan satu saluran tidak boleh
                // membawa dua arti.
                iniHariIni && "ring-2 ring-primary ring-offset-1",
              )}
            >
              <span className="text-[10px] leading-none font-semibold opacity-70">
                {formatTanggal(tanggal, "EEE")}
              </span>
              <span className="tabular text-[13px] leading-none font-bold">
                {formatTanggal(tanggal, "d")}
              </span>
              <span className="text-[9px] leading-tight font-medium">{sel.kata}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Keterangan kata & warna. Wajib ada di mana pun strip dipakai: warna
 * mempercepat, kata yang menentukan (lihat catatan di kepala berkas).
 */
export function KeteranganStatus() {
  const contoh: { kata: string; huruf: string; nada: SelHari["nada"] }[] = [
    { kata: "Final", huruf: "F", nada: "success" },
    { kata: "Disetujui", huruf: "S", nada: "success" },
    { kata: "Dikirim", huruf: "K", nada: "info" },
    { kata: "Draft", huruf: "D", nada: "warning" },
    { kata: "Perlu koreksi", huruf: "!", nada: "danger" },
    { kata: "Belum ada", huruf: "\u2013", nada: "neutral" },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-muted">
      {contoh.map((c) => (
        <li key={c.kata} className="flex items-center gap-1.5">
          <span
            className={cn(
              "grid size-5 place-items-center rounded border text-[10px] font-bold",
              NADA_SEL[c.nada],
            )}
          >
            {c.huruf}
          </span>
          {c.kata}
        </li>
      ))}
    </ul>
  );
}
