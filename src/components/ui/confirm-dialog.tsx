"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

/**
 * Tombol submit ber-KONFIRMASI — primitif dialog pertama di repo
 * (audit UI 2026-07-27, P0-1: aksi finansial/destruktif satu-klik tanpa
 * konfirmasi karena tidak ada primitif Modal).
 *
 * Dipakai DI DALAM `<form action={…}>`: tombol pemicu bertipe `button`
 * (tidak men-submit), dialognya memuat tombol `type="submit"` yang men-submit
 * form pembungkus. Aksesibilitas mengikuti pola APG dialog:
 * focus pindah ke dialog saat buka, Tab terkurung di dalam dialog, Escape
 * menutup, fokus kembali ke tombol pemicu saat tutup.
 */
export function ConfirmSubmit({
  label,
  title,
  description,
  confirmLabel,
  variant = "primary",
  confirmVariant,
  size = "sm",
  loading = false,
}: {
  /** Teks tombol pemicu. */
  label: string;
  /** Judul dialog — kalimat tanya yang jelas. */
  title: string;
  /** Penjelasan dampak (mis. nominal + sifat ireversibel). */
  description: string;
  /** Teks tombol konfirmasi (default = label). */
  confirmLabel?: string;
  variant?: ButtonVariant;
  /** Varian tombol konfirmasi (default mengikuti `variant`). */
  confirmVariant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** Elemen yang fokus sebelum dialog dibuka — dipulihkan saat tutup (APG). */
  const restoreRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const openDialog = useCallback(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    restoreRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Fokus awal ke tombol batal — pilihan aman duluan.
    const focusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled])"));
    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      // Focus trap: Tab berputar di dalam dialog.
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => dialog.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return (
    <>
      <Button type="button" size={size} variant={variant} loading={loading} onClick={openDialog}>
        {label}
      </Button>
      {open ? (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Tutup dialog"
            className="absolute inset-0 bg-ink/40"
            onClick={close}
            tabIndex={-1}
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-desc"
            className="relative w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-lg"
          >
            <p id="confirm-title" className="text-sm font-semibold text-ink">
              {title}
            </p>
            <p id="confirm-desc" className="mt-1 text-sm text-ink-muted">
              {description}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={close}>
                Batal
              </Button>
              {/* type=submit → men-submit form pembungkus ConfirmSubmit. */}
              <Button type="submit" size="sm" variant={confirmVariant ?? variant} onClick={() => setOpen(false)}>
                {confirmLabel ?? label}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
