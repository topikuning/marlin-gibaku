import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * SEL NAMA — inisial + nama + keterangan + lencana, dalam satu kolom
 * (DECISIONS 359).
 *
 * Diadopsi dari rancangan user 2026-08-18. Gunanya bukan hiasan: daftar master
 * data sebelumnya menyebar "nama", "kelengkapan", dan "status" ke kolom-kolom
 * terpisah, sehingga di layar sempit kolom yang menjelaskan barisnya justru
 * yang pertama tergeser keluar. Menyatukannya membuat satu baris tetap bisa
 * dibaca utuh sebagai satu hal.
 *
 * Keterangan di bawah nama menjawab *"kenapa baris ini butuh perhatian"* — jadi
 * ia diisi masalahnya ("PIC belum diisi · NPWP kosong"), bukan mengulang data
 * yang sudah ada di kolom lain.
 */
export function SelNama({
  nama,
  keterangan,
  lencana,
  inisialDari,
}: {
  nama: string;
  keterangan?: string | null;
  lencana?: ReactNode;
  /**
   * Teks sumber inisial bila berbeda dari nama — mis. "CV. Alkomber Karya"
   * sebaiknya berinisial "CV", bukan "CA".
   */
  inisialDari?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-inset text-[11px] font-bold text-ink-muted"
      >
        {inisial(inisialDari ?? nama)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-ink">{nama}</p>
        {keterangan ? (
          <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{keterangan}</p>
        ) : null}
        {lencana ? <div className="mt-1 flex flex-wrap gap-1">{lencana}</div> : null}
      </div>
    </div>
  );
}

/**
 * Dua huruf pertama yang BERARTI.
 *
 * "CV. Alkomber Karya" → "CV", "PT Nusantara" → "PT", "Dewi Anggraini" → "DA".
 * Bentuk badan usaha memang yang paling membedakan satu perusahaan dari yang
 * lain saat dipindai cepat, jadi ia tidak dibuang.
 */
export function inisial(teks: string): string {
  const bersih = teks.trim();
  if (!bersih) return "?";
  const kata = bersih.replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  const pertama = kata[0] ?? "";
  if (/^(cv|pt|ud|pd|koperasi)$/i.test(pertama)) return pertama.slice(0, 2).toUpperCase();
  if (kata.length === 1) return pertama.slice(0, 2).toUpperCase();
  return (pertama[0] + (kata[1]?.[0] ?? "")).toUpperCase();
}

/** Bungkus kartu untuk layar sempit — pengganti baris tabel. */
export function KartuBaris({
  children,
  aksi,
  className,
}: {
  children: ReactNode;
  aksi?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-3", className)}>
      {children}
      {aksi ? <div className="mt-2.5 flex flex-wrap gap-1.5">{aksi}</div> : null}
    </div>
  );
}
