"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Escape-untuk-tutup + pemulihan fokus untuk dialog/drawer ad-hoc
 * (audit UI 2026-07-27 — quick win keyboard/fokus; migrasi ke primitif
 * Modal/Drawer penuh dicatat sebagai defer di OPEN_ISSUES).
 *
 * Pakai: panggil `capture()` TEPAT sebelum membuka (menyimpan elemen yang
 * sedang fokus), pakai `close()` di semua jalur tutup (backdrop, tombol X) —
 * hook memasang listener Escape selama `open` dan mengembalikan fokus ke
 * elemen pemicu saat tutup (pola APG dialog).
 */
export function useDismissable(open: boolean, onClose: () => void) {
  const restoreRef = useRef<HTMLElement | null>(null);

  const capture = useCallback(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);

  const close = useCallback(() => {
    onClose();
    restoreRef.current?.focus();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return { capture, close };
}
