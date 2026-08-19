"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

/**
 * Panel geser dari kanan untuk pekerjaan SESEKALI (DECISIONS 386).
 *
 * Masalah yang diselesaikannya: halaman Ringkasan Paket menumpuk form
 * pengaturan yang jarang disentuh – grup WhatsApp, folder Drive, kirim laporan
 * mingguan – di antara angka yang dibaca setiap hari. Akibatnya yang dicari
 * orang (progress, rekonsiliasi, lokasi) terdorong jauh ke bawah oleh formulir
 * yang mungkin dibuka sekali seumur paket.
 *
 * Drawer memindahkan pekerjaan sesekali itu ke belakang satu klik TANPA
 * membuangnya: pemicunya tetap terlihat, lengkap dengan status ("Terpasang" /
 * "Belum"), jadi orang masih bisa tahu keadaannya tanpa membuka apa pun.
 *
 * ### Isinya dirender di server
 *
 * `children` diteruskan apa adanya, jadi form Server Component / Server Action
 * yang sudah ada bisa dimasukkan tanpa diubah jadi komponen klien. Yang jadi
 * klien hanya cangkangnya.
 *
 * ### Aksesibilitas
 *
 * Mengikuti pola APG dialog, sama dengan `ConfirmSubmit`: fokus pindah ke
 * dalam saat buka, Tab terkurung, Escape menutup, dan fokus kembali ke tombol
 * pemicu saat tutup. Gulir latar dikunci selama panel terbuka – tanpa itu,
 * menggulir di dalam panel akan menggulir halaman di belakangnya begitu isi
 * panel habis.
 */
export function Drawer({
  trigger,
  triggerVariant = "secondary",
  triggerSize = "sm",
  title,
  subtitle,
  children,
  className,
}: {
  /** Teks tombol pemicu. */
  trigger: string;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const buka = useCallback(() => {
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const tutup = useCallback(() => {
    setOpen(false);
    restoreRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const fokusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    fokusable()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        tutup();
        return;
      }
      if (e.key !== "Tab") return;
      const items = fokusable();
      if (items.length === 0) return;
      const pertama = items[0];
      const terakhir = items[items.length - 1];
      if (e.shiftKey && document.activeElement === pertama) {
        e.preventDefault();
        terakhir.focus();
      } else if (!e.shiftKey && document.activeElement === terakhir) {
        e.preventDefault();
        pertama.focus();
      }
    };
    panel.addEventListener("keydown", onKeyDown);

    // Kunci gulir latar; dipulihkan persis ke nilai semula, bukan ke "".
    const semula = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      panel.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = semula;
    };
  }, [open, tutup]);

  return (
    <>
      <Button type="button" size={triggerSize} variant={triggerVariant} onClick={buka}>
        {trigger}
      </Button>
      {open ? (
        <div className="fixed inset-0 z-[1200]">
          <button
            type="button"
            aria-label="Tutup panel"
            tabIndex={-1}
            className="absolute inset-0 bg-ink/40"
            onClick={tutup}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cn(
              "absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-border bg-surface shadow-lg",
              className,
            )}
          >
            <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h2 id={titleId} className="text-sm font-semibold text-ink">
                  {title}
                </h2>
                {subtitle ? (
                  <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={tutup}
                aria-label="Tutup panel"
                className="-mt-1 -mr-1 rounded-md p-1.5 text-ink-muted hover:bg-surface-inset hover:text-ink"
              >
                <X aria-hidden className="size-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
