"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "./button";

/**
 * TOMBOL KIRIM YANG MENGAKU SEDANG BEKERJA (DECISIONS 401).
 *
 * Dua bentuk, karena ada dua cara formulir memanggil server dan penandanya
 * datang dari tempat yang berbeda:
 *
 * 1. `<form action={aksi}>` — React sendiri yang memasang Transition-nya, jadi
 *    `useFormStatus().pending` memang menyala. Pakai {@link TombolKirim}.
 * 2. `<form method="GET">` penyaring — ini perpindahan halaman, bukan aksi.
 *    `useFormStatus` tidak tahu apa-apa tentangnya. Pakai {@link FormSaring},
 *    yang memindahkan halaman lewat `router.push` di dalam Transition sehingga
 *    ada yang bisa ditandai.
 *
 * Keduanya ada supaya penulis layar berikutnya tidak perlu tahu perbedaan itu:
 * ia memilih berdasarkan bentuk formulirnya, bukan berdasarkan pengetahuan
 * tentang isi perut React. Tiga kali keluhan yang sama datang justru karena
 * perbedaan itu tidak kelihatan dari kode yang tampak benar.
 */

/** Tombol submit di dalam `<form action={…}>`. Penandanya dari `useFormStatus`. */
export function TombolKirim({
  children,
  labelSibuk,
  ...rest
}: Omit<ButtonProps, "type" | "loading"> & {
  /** Kata KERJA selagi berjalan. Kalau kosong, labelnya tetap + spinner. */
  labelSibuk?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...rest}>
      {pending && labelSibuk ? labelSibuk : children}
    </Button>
  );
}

const KonteksSaring = createContext(false);

/**
 * Formulir penyaring (`method="GET"`) yang perpindahannya bisa ditandai.
 *
 * `method="GET"` DIPERTAHANKAN sebagai jaring: kalau JS belum termuat,
 * tombolnya tetap bekerja seperti formulir biasa.
 */
export function FormSaring({
  children,
  className,
  onInvalid,
}: {
  children: ReactNode;
  className?: string;
  onInvalid?: () => void;
}) {
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  return (
    <form
      method="GET"
      className={className}
      onSubmit={(e) => {
        const f = e.currentTarget;
        if (!f.checkValidity()) {
          onInvalid?.();
          return; // biarkan penanganan `onInvalid` medan yang bicara
        }
        e.preventDefault();
        const q = new URLSearchParams(new FormData(f) as unknown as Record<string, string>);
        mulai(() => router.push(`?${q.toString()}`, { scroll: false }));
      }}
    >
      <KonteksSaring.Provider value={sibuk}>{children}</KonteksSaring.Provider>
    </form>
  );
}

/** Tombol submit di dalam {@link FormSaring}. */
export function TombolSaring({
  children,
  labelSibuk = "Menyaring…",
  ...rest
}: Omit<ButtonProps, "type" | "loading"> & { labelSibuk?: string }) {
  const sibuk = useContext(KonteksSaring);
  return (
    <Button type="submit" loading={sibuk} {...rest}>
      {sibuk ? labelSibuk : children}
    </Button>
  );
}
