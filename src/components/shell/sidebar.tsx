"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { BrandMark, BrandWordmark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/cn";
import {
  ATRIBUT_NAV,
  KUNCI_RINGKAS,
  NILAI_RINGKAS,
  keSimpanan,
} from "@/lib/shell/sidebar-ringkas";
import { NavIcon } from "./nav-progress";
import { type NavItem } from "./nav-config";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Sidebar desktop (≥lg). Nav sudah difilter capability oleh caller.
 *
 * ### Bisa diringkas (DECISIONS 413)
 *
 * Permintaan user 2026-08-22: *"sidebar yang bisa di collapsible, jadi bisa
 * memperlebar pandangan di desktop"*, lalu *"tidak perlu ramping, collapsible
 * saja"*. Lebar terbentangnya karena itu TIDAK diubah — yang ditambah cuma
 * kemampuan melipatnya.
 *
 * Keadaannya disimpan sebagai atribut `data-nav` di `<html>`, bukan state React
 * yang diturunkan lewat context. Dua benda harus ikut menyempit — sidebar ini
 * dan bantalan kiri konten di `AppShell` — dan keduanya di cabang pohon yang
 * berbeda. Lewat atribut di akar, keduanya membaca sumber yang sama dan
 * mustahil berselisih.
 *
 * `localStorage` dipakai untuk MENGINGAT pilihannya. Ini satu-satunya jenis
 * benda yang pantas disimpan di sana: kenyamanan per orang per peramban, bukan
 * data yang harus bisa dibaca ulang oleh server. Tanpa diingat, tombolnya jadi
 * mainan — setiap muat ulang sidebarnya mengembang lagi.
 */
export function Sidebar({ nav, brand }: { nav: NavItem[]; brand: Branding }) {
  const pathname = usePathname();
  /*
   * Nilai awal `false` DAN TIDAK dibaca dari `localStorage` saat render: server
   * tidak punya `localStorage`, dan menebaknya di render pertama klien akan
   * berbeda dari yang dirender server (hydration mismatch). Yang menjaga
   * tampilannya benar sejak lukisan pertama adalah skrip pra-lukis di root
   * layout — ia memasang atribut `data-nav` sebelum apa pun tergambar. State di
   * sini hanya menyusul supaya ikon tombolnya menghadap arah yang benar.
   */
  const [ringkas, setRingkas] = useState(false);

  useEffect(() => {
    /*
     * Dibaca dari ATRIBUT `<html>`, bukan langsung dari `localStorage`: skrip
     * pra-lukis sudah menormalkan nilainya di sana, jadi ini menyusul keadaan
     * yang SEDANG BERLAKU di layar — bukan menafsirkan ulang penyimpanan dan
     * berisiko berbeda darinya.
     *
     * Ditunda satu putaran (`setTimeout 0`): `setState` serentak di dalam efek
     * memicu render berantai dan ditolak lint React Compiler. Penundaannya
     * tidak terlihat — yang menentukan tampilan sejak lukisan pertama adalah
     * atributnya, bukan state ini.
     */
    const t = window.setTimeout(() => {
      setRingkas(document.documentElement.getAttribute(ATRIBUT_NAV) === NILAI_RINGKAS);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const ubah = () => {
    const baru = !ringkas;
    setRingkas(baru);
    const akar = document.documentElement;
    if (baru) akar.setAttribute(ATRIBUT_NAV, NILAI_RINGKAS);
    else akar.removeAttribute(ATRIBUT_NAV);
    try {
      window.localStorage.setItem(KUNCI_RINGKAS, keSimpanan(baru));
    } catch {
      /* penyimpanan diblokir – pilihannya berlaku sekarang, tidak diingat */
    }
  };

  return (
    <aside className="marlin-sidebar no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
      <div className="border-b border-border px-4 py-3.5">
        {/* Wordmark resmi menggantikan rakitan "ikon + teks" (DECISIONS 227):
            hurufnya vektor, jadi bentuknya tidak lagi bergantung font UI.
            Saat diringkas, yang tersisa MARKAH-nya saja — wordmark selebar
            15rem tidak mungkin muat di 4rem, dan memaksanya masuk hanya
            menghasilkan huruf yang tidak terbaca. */}
        <span className="marlin-nav-teks">
          <BrandWordmark tinggi={26} />
        </span>
        <span className="hidden justify-center [[data-nav='ringkas']_&]:flex">
          <BrandMark size={26} />
        </span>
        {/* Konteks proyek boleh KOSONG (DECISIONS 228) — jangan sisakan
            paragraf kosong yang menambah jarak tanpa isi. */}
        {brand.projectContext ? (
          <p className="marlin-nav-teks mt-1.5 line-clamp-2 text-[11px] leading-tight text-ink-muted">
            {brand.projectContext}
          </p>
        ) : null}
      </div>
      <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  /*
                   * `aria-label` + `title` SELALU ada, bukan hanya saat
                   * diringkas: begitu labelnya disembunyikan CSS, nama menunya
                   * hilang dari pembaca layar juga. Menaruhnya hanya pada
                   * keadaan ringkas berarti nama itu bergantung pada CSS yang
                   * sedang berlaku — dan itu cara paling mudah membuat menu
                   * jadi "tautan tanpa nama" tanpa ada yang sadar.
                   */
                  aria-label={item.label}
                  title={item.label}
                  className={cn(
                    "marlin-nav-tautan flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary-50 text-primary"
                      : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                  )}
                >
                  <NavIcon icon={item.icon} className="size-4 shrink-0" />
                  <span className="marlin-nav-teks">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {/*
        Tombolnya di DASAR sidebar, bukan menempel di judul: ia bukan bagian
        dari navigasi dan tidak boleh ikut terbaca sebagai menu. Di dasar ia
        juga tetap di tempat yang sama entah menunya lima atau lima belas.
      */}
      {/* Barisnya sengaja LEBIH PENDEK daripada butir menu (permintaan user
          2026-08-22: *"ringkas menumu terlalu tinggi"*). Ia kendali, bukan
          tujuan — memberinya tinggi yang sama dengan menu membuatnya terbaca
          sebagai menu ke-sekian, dan memakan ruang di dasar layar yang justru
          paling sering terpotong. */}
      <div className="border-t border-border px-2 py-1">
        <button
          type="button"
          onClick={ubah}
          aria-expanded={!ringkas}
          aria-label={ringkas ? "Bentangkan menu samping" : "Ringkas menu samping"}
          title={ringkas ? "Bentangkan menu samping" : "Ringkas menu samping"}
          className="marlin-nav-tautan flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          {ringkas ? (
            <PanelLeftOpen aria-hidden className="size-3.5 shrink-0" />
          ) : (
            <PanelLeftClose aria-hidden className="size-3.5 shrink-0" />
          )}
          <span className="marlin-nav-teks">Ringkas menu</span>
        </button>
      </div>
    </aside>
  );
}
