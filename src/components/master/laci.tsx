"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * LACI (drawer) untuk tambah/edit master data (DECISIONS 359).
 *
 * Diadopsi dari rancangan user 2026-08-18. Alasannya bukan gaya: formulir yang
 * dibentangkan di dalam daftar mendorong barisnya turun, sehingga sesudah
 * menyimpan orang kehilangan tempatnya dan harus mencari lagi baris yang barusan
 * ia kerjakan. Laci membiarkan daftarnya diam di tempat.
 *
 * ### Yang WAJIB ada pada panel melayang, dan gampang terlupa
 *
 *  - **Esc menutup.** Satu-satunya jalan keluar yang selalu ada di keyboard.
 *  - **Klik di luar menutup**, karena itu yang dicoba orang lebih dulu.
 *  - **Fokus pindah ke dalam** saat dibuka, dan **kembali** ke pemicunya saat
 *    ditutup — tanpa itu, pemakai keyboard/pembaca layar ditinggal di tempat
 *    yang tidak terlihat.
 *  - **Latar tidak ikut menggulir**, supaya menggulir isi laci di ponsel tidak
 *    diam-diam menggeser daftar di belakangnya.
 */
export function Laci({
  buka,
  onTutup,
  judul,
  keterangan,
  children,
  kaki,
}: {
  buka: boolean;
  onTutup: () => void;
  judul: string;
  keterangan?: string;
  children: ReactNode;
  /** Tombol simpan/batal — menempel di bawah supaya tak perlu digulir dicari. */
  kaki?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pemicuRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!buka) return;
    pemicuRef.current = document.activeElement as HTMLElement | null;

    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onTutup();
    };
    document.addEventListener("keydown", esc);

    // Latar dikunci selama laci terbuka.
    const semula = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Fokus ke panel, bukan ke tombol tutup: pembaca layar membacakan judulnya
    // lebih dulu, jadi orang tahu ia berada di mana sebelum menekan apa pun.
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = semula;
      pemicuRef.current?.focus?.();
    };
  }, [buka, onTutup]);

  if (!buka) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Latar gelap sekaligus penutup. `aria-hidden` — isinya sudah diwakili
          panel di sebelahnya, dan tombol tutup yang sebenarnya ada di dalam. */}
      <div aria-hidden className="absolute inset-0 bg-ink/40" onClick={onTutup} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={judul}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-surface shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-[17px] font-bold text-ink">{judul}</h2>
            {keterangan ? <p className="mt-0.5 text-[11px] text-ink-muted">{keterangan}</p> : null}
          </div>
          <button
            type="button"
            onClick={onTutup}
            aria-label="Tutup"
            className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface text-ink-muted hover:bg-surface-muted"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {kaki ? (
          <div className="flex flex-wrap gap-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {kaki}
          </div>
        ) : null}
      </div>
    </div>
  );
}
