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
  const restoreRef = useRef<HTMLElement | null>(null);

  const buka = useCallback(() => {
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const tutup = useCallback(() => {
    setOpen(false);
    restoreRef.current?.focus();
  }, []);

  return (
    <>
      <Button type="button" size={triggerSize} variant={triggerVariant} onClick={buka}>
        {trigger}
      </Button>
      <PanelGeser terbuka={open} onTutup={tutup} title={title} subtitle={subtitle} className={className}>
        {children}
      </PanelGeser>
    </>
  );
}

/**
 * Cangkang panel geser TERKENDALI — buka/tutupnya ditentukan pemanggil
 * (DECISIONS 414).
 *
 * Dipisah dari {@link Drawer} karena ada pemakaian yang pemicunya BUKAN tombol:
 * di kalender harian, yang membuka panel adalah petak tanggal yang diketuk, dan
 * keadaannya dibawa URL (`?panel=1`) supaya tetap benar sesudah navigasi server.
 * Menyalin jebakan fokus, Escape, dan kunci gulir ke sana berarti dua salinan
 * aturan aksesibilitas yang lambat laun berbeda.
 *
 * Tidak merender apa pun saat tertutup — termasuk TIDAK mengunci gulir. Itu
 * penting: pemanggil yang menyembunyikannya lewat CSS (`lg:hidden`) tetap akan
 * menjalankan efeknya, jadi pemanggil WAJIB tidak merender komponen ini sama
 * sekali pada lebar yang panelnya memang tidak dipakai.
 */
export function PanelGeser({
  terbuka,
  onTutup,
  title,
  subtitle,
  children,
  className,
}: {
  terbuka: boolean;
  onTutup: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!terbuka) return;
    const panel = panelRef.current;
    if (!panel) return;

    /*
     * Dari mana fokus datang — supaya bisa dikembalikan ke sana saat panel
     * ditutup.
     *
     * {@link Drawer} mengurus ini sendiri karena pemicunya memang satu tombol
     * yang ia render. Pemakaian TERKENDALI tidak punya tombol itu: yang
     * membuka panel bisa berupa baris grid atau petak tanggal, dan pemanggil
     * tidak punya tempat wajar untuk mengingatnya. Tanpa pengembalian ini,
     * menutup panel menjatuhkan fokus ke <body> dan pengguna papan tik harus
     * menelusuri ulang halaman dari atas hanya untuk kembali ke baris yang
     * baru saja ia buka.
     */
    const asal = document.activeElement instanceof HTMLElement ? document.activeElement : null;

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
        onTutup();
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
      /*
       * Hanya dikembalikan bila elemennya MASIH ada di dokumen. Panel yang
       * keadaannya dibawa URL menutup setelah navigasi server, dan saat itu
       * simpul asalnya sudah diganti — memaksa fokus ke simpul yatim justru
       * melemparkannya ke <body>, hasil yang sama buruknya dengan tidak
       * mengembalikan sama sekali.
       */
      if (asal && document.contains(asal)) asal.focus();
    };
  }, [terbuka, onTutup]);

  if (!terbuka) return null;

  return (
    <div className="fixed inset-0 z-[1200]">
      {/*
        Latar gelap SENGAJA di luar pohon aksesibilitas.

        Versi pertama membuatnya `<button aria-label="Tutup panel">` – nama yang
        sama persis dengan tombol ✕ di dalam panel. Akibatnya dua elemen berbagi
        satu nama, dan di ponsel (panel selebar layar penuh) latar itu justru
        MENUTUPI tombol tutup yang sesungguhnya. Ketahuan dari uji Playwright
        yang merah di proyek mobile, bukan dari pemeriksaan mata.

        Menutup lewat klik latar tetap ada untuk tetikus; jalur papan tik sudah
        dijamin Escape dan tombol ✕.
      */}
      <div aria-hidden className="absolute inset-0 bg-ink/40" onClick={onTutup} />
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
            {subtitle ? <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onTutup}
            aria-label="Tutup panel"
            className="-mt-1 -mr-1 rounded-md p-1.5 text-ink-muted hover:bg-surface-inset hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>
  );
}
