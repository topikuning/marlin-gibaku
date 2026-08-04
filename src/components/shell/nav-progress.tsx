"use client";

import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ICONS, type NavItem } from "./nav-config";

/*
 * UMPAN BALIK NAVIGASI — jawaban atas keluhan "diklik, sistem seperti stuck".
 *
 * Pengukuran 2026-08-04 (build produksi, 84 lokasi): server MENJAWAB CEPAT,
 * TTFB 17-54 ms. Yang memakan waktu adalah memindahkan payload RSC lewat
 * jaringan seluler — /progress 38 KB terkompresi ≈ 765 ms pada 400 kbps,
 * ditambah RTT seluler. Jadi ada 0,5-3 detik antara ketukan dan pergantian
 * halaman.
 *
 * App Router MEMBLOKIR di halaman lama selama rentang itu: tanpa batas
 * Suspense (`loading.tsx`) dan tanpa indikator, TIDAK ADA SATU PIKSEL PUN yang
 * berubah. Yang rusak bukan kecepatannya — melainkan diamnya. Pengguna
 * lapangan menyimpulkan aplikasinya hang, lalu mengetuk berulang kali.
 *
 * `useLinkStatus` HANYA sah di dalam <Link>, jadi status per-tautan
 * dikumpulkan ke penyimpanan modul kecil ini supaya bar di pucuk layar —
 * yang letaknya jauh di luar <Link> mana pun — bisa ikut membacanya.
 */

let tertunda = 0;
const pendengar = new Set<() => void>();

function siarkan() {
  for (const l of pendengar) l();
}

function langgan(l: () => void) {
  pendengar.add(l);
  return () => {
    pendengar.delete(l);
  };
}

const potret = () => tertunda > 0;
// Server selalu "tidak ada navigasi" — kalau tidak, HTML server dan hidrasi
// klien berbeda dan React membuang seluruh pohonnya.
const potretServer = () => false;

/** Apakah ADA navigasi yang sedang berjalan (tautan mana pun). */
export function useNavigasiTertunda(): boolean {
  return useSyncExternalStore(langgan, potret, potretServer);
}

/** Daftarkan status satu tautan ke penghitung global selama masih tertunda. */
function useDaftarTertunda(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    tertunda += 1;
    siarkan();
    return () => {
      tertunda -= 1;
      siarkan();
    };
  }, [pending]);
}

/**
 * Ikon menu yang berubah jadi pemintal selama tautannya dimuat.
 *
 * WAJIB dirender DI DALAM <Link>. Ini umpan balik UTAMA: menjawab "yang mana
 * yang saya ketuk" sekaligus "sedang diproses", dan hanya butuh swap elemen —
 * jalan di WebView Android lama sekalipun.
 */
export function NavIcon({
  icon,
  className,
}: {
  icon: NavItem["icon"];
  className?: string;
}) {
  const { pending } = useLinkStatus();
  useDaftarTertunda(pending);
  const Icon = pending ? Loader2 : ICONS[icon];
  return <Icon aria-hidden className={cn(className, pending && "animate-spin text-primary")} />;
}

/**
 * Perekam status untuk tautan yang ikonnya tidak diganti (mis. pintasan nav
 * bawah yang ikonnya sudah jadi penanda halaman aktif). Tidak merender apa pun;
 * kehadirannya cuma menyumbang ke bar global.
 */
export function NavPendingProbe() {
  const { pending } = useLinkStatus();
  useDaftarTertunda(pending);
  return null;
}

/**
 * Bar tipis di pucuk layar selama navigasi berjalan.
 *
 * Jaring pengaman untuk navigasi yang BUKAN dari menu — tombol, tautan dalam
 * tabel, breadcrumb — dan satu-satunya petunjuk yang tetap terlihat setelah
 * laci menu tertutup. Sengaja tanpa jeda tampil: menunda demi "menghindari
 * kedip" justru mengembalikan diam yang jadi keluhan aslinya.
 */
/** Sesudah sekian lama, diam kembali jadi membingungkan — katakan sebabnya. */
const AMBANG_LAMBAT_MS = 6000;

/**
 * Jaring pengaman: barnya padam sendiri kalau ketukan ternyata tidak berujung
 * navigasi (mis. tautan yang dibatalkan JS). Tanpa ini, satu kasus tepi
 * menyisakan bar menyala selamanya — dan indikator yang berbohong lebih buruk
 * daripada tidak ada indikator.
 */
const BATAS_AMAN_MS = 20_000;

/**
 * Deteksi navigasi dari KETUKAN TAUTAN, bukan dari `useLinkStatus`.
 *
 * `useLinkStatus` hanya hidup di dalam `<Link>` yang memang kita sisipi probe —
 * praktis cuma item menu. Padahal sebagian besar perpindahan di MARLIN lewat
 * tautan lain: kartu lokasi, baris tabel, butir Activity Centre, breadcrumb,
 * `ButtonLink`. Menyisipkan probe satu per satu ke semuanya mustahil dijaga.
 *
 * Satu pendengar di tingkat dokumen menangkap semuanya sekaligus, dan padam
 * saat `pathname` benar-benar berganti.
 */
function useNavigasiDiketuk(): boolean {
  const pathname = usePathname();
  const [aktif, setAktif] = useState(false);
  /** Alamat yang sedang dituju + elemen yang diketuk (untuk dilepas tandanya). */
  const tujuan = useRef<{ href: string; el: HTMLAnchorElement } | null>(null);

  const lepas = useCallback(() => {
    tujuan.current?.el.removeAttribute("data-navigating");
    tujuan.current = null;
  }, []);

  // Halaman sudah berganti → tugasnya selesai (disetel saat render, bukan effect).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    if (aktif) setAktif(false);
  }

  useEffect(() => {
    if (!aktif) lepas();
  }, [aktif, lepas]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Klik yang membuka tab baru bukan navigasi di halaman ini.
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.target && a.target !== "_self") return;
      // Unduhan tidak pernah mengganti halaman — lihat ui/button.tsx.
      if (a.hasAttribute("download") || a.hasAttribute("data-unduhan")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Jangkar dalam-halaman & URL yang sama persis: tidak ada perjalanan jaringan.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      const href = url.pathname + url.search;
      /*
       * KETUKAN ULANG KE ALAMAT YANG SAMA DIHENTIKAN DI SINI.
       *
       * Diukur di peramban dengan jaringan 400 kbps: tiga ketukan pada satu
       * lokasi menghasilkan TIGA permintaan halaman penuh (plus prefetch tab
       * yang ikut berlipat) — sembilan permintaan berebut pipa yang sama.
       * Tiap duplikat mencuri jatah dari permintaan yang sebetulnya sudah
       * hampir selesai, jadi makin sering diketuk makin lambat. Itulah
       * lingkaran yang dilaporkan dari lapangan.
       *
       * Disetop di fase capture supaya Next tidak sempat memulai navigasi
       * kedua. Aman dari "terkunci selamanya" karena tanda ini dilepas begitu
       * pathname berganti, atau oleh BATAS_AMAN_MS.
       */
      if (tujuan.current?.href === href) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Tandai elemen yang diketuk supaya BISA DILIHAT bereaksi. Bar setipis
      // 2px di pucuk layar terlalu jauh dari jempol dan mudah luput di bawah
      // matahari; yang paling meyakinkan adalah barisnya sendiri berubah.
      tujuan.current?.el.removeAttribute("data-navigating");
      a.setAttribute("data-navigating", "");
      tujuan.current = { href, el: a };
      setAktif(true);
    }
    /*
     * FASE CAPTURE, bukan bubble — dan ini bukan detail gaya.
     *
     * `<Link>` Next memanggil `preventDefault()` di handler-nya sendiri pada
     * elemennya. Handler elemen jalan LEBIH DULU daripada handler dokumen di
     * fase bubble, jadi pendengar bubble melihat `defaultPrevented === true`
     * untuk PERSIS tautan yang ingin ditangkap, lalu mengabaikan semuanya —
     * gagal diam-diam, tanpa galat, dan barnya sekadar tidak pernah muncul
     * (ini sempat terjadi dan tertangkap uji).
     *
     * Konsekuensinya: klik yang nanti dibatalkan komponen lain tetap
     * menyalakan bar. Itu yang dijaga BATAS_AMAN_MS.
     */
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!aktif) return;
    const t = setTimeout(() => setAktif(false), BATAS_AMAN_MS);
    return () => clearTimeout(t);
  }, [aktif]);

  return aktif;
}

export function NavProgressBar() {
  // Dua sumber yang saling menutupi: `useLinkStatus` tahu PERSIS kapan Next
  // selesai (tapi hanya untuk tautan menu), sedangkan pendengar ketukan
  // menjangkau seluruh tautan (tapi baru padam saat pathname berganti).
  const tertundaLink = useNavigasiTertunda();
  const diketuk = useNavigasiDiketuk();
  const pending = tertundaLink || diketuk;
  const [lambat, setLambat] = useState(false);

  // Reset saat navigasi selesai — disetel SAAT RENDER, bukan di dalam effect
  // (pola yang sama dipakai bottom-nav): menyetel state langsung di badan
  // effect memicu render kaskade, dan lint repo ini memang melarangnya.
  const [prevPending, setPrevPending] = useState(pending);
  if (prevPending !== pending) {
    setPrevPending(pending);
    if (!pending && lambat) setLambat(false);
  }

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setLambat(true), AMBANG_LAMBAT_MS);
    return () => clearTimeout(t);
  }, [pending]);

  if (!pending) return null;
  return (
    <>
      <div
        role="progressbar"
        aria-label="Memuat halaman"
        // Tanpa aria-valuenow: kemajuannya memang tidak diketahui, dan mengarang
        // angka persen di sini sama saja berbohong ke pembaca layar.
        className="no-print pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary-100"
      >
        <div className="marlin-nav-progress h-full w-full bg-primary" />
      </div>
      {lambat ? (
        /*
         * Sinyal lemah di lokasi lapangan bisa menahan satu navigasi jauh lebih
         * lama daripada yang sabar ditunggu orang. Bar tipis saja tidak cukup
         * di titik itu: pengguna sudah menunggu enam detik dan kembali ke
         * pertanyaan yang persis dikeluhkan — "ini rusak, atau jaringannya?".
         *
         * Kalimatnya menjawab itu dan berhenti di situ. TIDAK diklaim "gagal"
         * (permintaannya masih berjalan dan sering tetap berhasil) dan TIDAK
         * ditawarkan tombol "coba lagi" — mengulang saat yang pertama belum
         * selesai justru menambah antrean di jaringan yang sudah sesak.
         */
        <div
          role="status"
          className="no-print fixed inset-x-0 top-2 z-50 mx-auto w-fit max-w-[92vw] rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted shadow-lg"
        >
          Masih memuat — jaringan sepertinya lambat.
        </div>
      ) : null}
    </>
  );
}
