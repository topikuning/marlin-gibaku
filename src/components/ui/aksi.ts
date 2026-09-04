"use client";

import { useAksi, type AksiState } from "@/lib/aksi-klien";

import { useCallback, useTransition } from "react";

/**
 * SERVER ACTION YANG DIJALANKAN DARI KLIK — DENGAN `pending` YANG BENAR-BENAR
 * MENYALA (DECISIONS 401).
 *
 * ### Cacatnya, dan kenapa ia tidak kelihatan dari membaca kode
 *
 * Laporan user 2026-08-21: *"AKU KLIK UPLOAD KE DRIVE, TETAP TIDAK ADA PENANDA
 * SEDANG PROSES, DAN TETAP AKU BISA KLIK BERKALI-KALI!"* — keluhan yang SAMA
 * untuk ketiga kalinya (DECISIONS 360, 400, lalu ini).
 *
 * Kodenya tampak benar. `useActionState` dipakai, `loading: drivePending`
 * diteruskan, `MenuBerkas` mengganti seluruh kendali dengan kepingan sibuk, dan
 * uji unitnya hijau. Yang tidak terlihat dari mana pun: **`pending`-nya tidak
 * pernah menyala.**
 *
 * `isPending` dari `useActionState` bukan "aksi sedang berjalan" melainkan "ada
 * Transition yang tertunda". React memasang Transition itu sendiri ketika aksi
 * diserahkan sebagai `<form action={aksi}>` atau `formAction`. Kalau dispatch-nya
 * DIPANGGIL LANGSUNG dari `onClick`, tidak ada Transition — aksinya tetap
 * berjalan sampai selesai, tapi `isPending` tetap `false` selamanya.
 *
 * Diukur di peramban terhadap build produksi, dengan nilai `pending` ditulis ke
 * atribut DOM lalu direkam `MutationObserver`:
 *
 * | Cara memanggil | `pending` |
 * |---|---|
 * | `onClick={() => kirimDrive(fd)}` | `false` sepanjang ~5 detik – **nol perubahan atribut** |
 * | `onClick={() => mulai(() => kirimDrive(fd))}` | `true` pada 39 ms, `false` lagi pada 3779 ms |
 *
 * Pelajarannya: uji yang merender `loading: true` lalu memeriksa markup
 * membuktikan BENTUK penandanya, bukan bahwa ia pernah menyala. Tiga kali
 * keluhan yang sama lahir dari jarak antara dua hal itu.
 *
 * ### Karena itu: satu pintu
 *
 * Pakai hook ini untuk aksi yang dijalankan dari klik. Yang diserahkan sebagai
 * `<form action={…}>` tetap dijalankan lewat `useAksi` — di situ React yang
 * memasang Transition-nya, dan `pending`-nya memang menyala.
 *
 * `pending` yang dikembalikan diambil dari `useTransition`, bukan dari
 * `useAksi`: itu yang terbukti menyala pada pengukuran di atas.
 */
export function useAksiKlik<S extends AksiState>(
  aksi: (sebelumnya: S, muatan: FormData) => Promise<S>,
  awal: S,
): [S, (muatan: FormData) => void, boolean];
/** Keadaan berbentuk lain: sebutkan sendiri cara menyatakan gagal kirim. */
export function useAksiKlik<S>(
  aksi: (sebelumnya: S, muatan: FormData) => Promise<S>,
  awal: S,
  saatGagal: (pesan: string) => S,
): [S, (muatan: FormData) => void, boolean];
export function useAksiKlik<S>(
  aksi: (sebelumnya: S, muatan: FormData) => Promise<S>,
  awal: S,
  saatGagal?: (pesan: string) => S,
): [S, (muatan: FormData) => void, boolean] {
  const [hasil, kirim] = useAksi<S>(
    aksi,
    awal,
    saatGagal ?? ((pesan: string) => ({ error: pesan }) as S),
  );
  const [sibuk, mulai] = useTransition();

  const jalankan = useCallback(
    (muatan: FormData) => {
      // Klik kedua selagi yang pertama berjalan DIABAIKAN, bukan diantrekan.
      // Mengantrekannya berarti pesan WhatsApp yang sama terkirim dua kali —
      // kejadian nyata 2026-08-18.
      if (sibuk) return;
      mulai(() => kirim(muatan));
    },
    [kirim, sibuk],
  );

  return [hasil, jalankan, sibuk];
}
