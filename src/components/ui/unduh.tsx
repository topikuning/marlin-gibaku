"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * MENJEMPUT BERKAS DENGAN PENANDA SIBUK YANG BENAR (DECISIONS 401).
 *
 * Permintaan user 2026-08-21: *"ya semua yang diklik berpotensi butuh waktu
 * (tidak instant) gunakan penanda sibuk! common sense kan!"*
 *
 * Satu tempat, dipakai `ButtonLink unduhan`, `MenuBerkas`, dan `TautanUnduh`.
 * Disatukan dengan sengaja: keluhan yang sama sudah datang dua kali (DECISIONS
 * 360 lalu 400), dua-duanya karena penandanya dipasang PER LAYAR. Yang dipasang
 * per layar akan terlewat di layar berikutnya — dan yang terlewat tidak
 * bersuara, ia cuma diam seperti aplikasi yang rusak.
 *
 * Kenapa `fetch` + blob, bukan `<a href>` biasa:
 *
 * 1. Jangkar biasa menyerahkan segalanya ke peramban. Selama server membangun
 *    PDF — diukur 4,1 detik untuk laporan mingguan — halaman tempat orang
 *    menekan tidak tahu apa-apa dan tidak bisa mengatakan apa pun.
 * 2. Galat 403/500 mendarat sebagai JSON mentah di tab baru yang terbuka di
 *    belakang. Dari kursi pemakai itu sama saja dengan "tidak terjadi apa-apa".
 *
 * Yang DIKORBANKAN, disebut apa adanya: berkasnya tidak lagi mengalir langsung
 * ke disk melainkan ditampung di memori dulu, dan peramban baru menampilkan
 * unduhan saat byte terakhir tiba. Untuk berkas laporan (ratusan KB sampai
 * belasan MB) itu setara; untuk arsip raksasa suatu saat nanti, pakai jangkar
 * biasa dan katakan alasannya di situ.
 */

/** Nama berkas dari `Content-Disposition`, kalau servernya menyebutkan. */
export function namaDariHeader(cd: string | null): string | null {
  if (!cd) return null;
  /*
   * Tanda kutip ditulis `\x22`/`\x27`, bukan harfiah, DENGAN SENGAJA: penjaga
   * en-dash memindai dengan tokenizer yang tidak mengenal literal regex, dan
   * satu regex ber-kutip ganjil membalik parity-nya (OPEN_ISSUES UI-05).
   */
  const bintang = /filename\*=UTF-8\x27\x27([^;]+)/i.exec(cd);
  if (bintang) {
    try {
      return decodeURIComponent(bintang[1].trim());
    } catch {
      /* jatuh ke bentuk polos di bawah */
    }
  }
  const polos = /filename=\x22?([^\x22;]+)\x22?/i.exec(cd);
  return polos ? polos[1].trim() : null;
}

/** Kalimat galat dari jawaban yang gagal – dibawa kembali ke layar penekannya. */
export async function galatDariJawaban(r: Response): Promise<string> {
  try {
    const j = (await r.clone().json()) as { error?: unknown };
    if (typeof j.error === "string" && j.error) return j.error;
  } catch {
    /* bukan JSON */
  }
  if (r.status === 401) return "Sesi berakhir – masuk lagi lalu ulangi.";
  if (r.status === 403) return "Tidak punya izin untuk berkas ini.";
  return `Gagal menyiapkan berkas (${r.status}). Coba lagi sebentar.`;
}

/**
 * Klik yang TIDAK boleh diambil alih: klik-tengah, Ctrl/Cmd/Shift-klik.
 *
 * Orang yang menahan Ctrl sedang minta tab baru, bukan minta kita menjemputkan
 * berkasnya. Mengambil alih klik itu berarti membajak kebiasaan yang benar.
 */
export function klikBiasa(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}): boolean {
  return !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0;
}

export type UnduhBerkas = {
  /** Sedang menjemput berkas? */
  sibuk: boolean;
  /** Kalimat galat terakhir, atau null. */
  galat: string | null;
  bersihkanGalat: () => void;
  /** Jemput `href` lalu serahkan ke peramban sebagai unduhan. */
  unduh: (href: string, namaCadangan?: string) => Promise<void>;
};

export function useUnduhBerkas(): UnduhBerkas {
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  // Komponen yang sudah dilepas tidak boleh disentuh state-nya.
  const hidup = useRef(true);
  useEffect(() => {
    hidup.current = true;
    return () => {
      hidup.current = false;
    };
  }, []);

  const unduh = useCallback(async (href: string, namaCadangan?: string) => {
    setSibuk(true);
    setGalat(null);
    try {
      const r = await fetch(href, { credentials: "same-origin" });
      if (!r.ok) throw new Error(await galatDariJawaban(r));
      const blob = await r.blob();
      const nama = namaDariHeader(r.headers.get("content-disposition")) ?? namaCadangan ?? "berkas";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nama;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Jeda sebelum dilepas: peramban masih membaca blob-nya saat unduhan mulai.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      if (hidup.current) {
        setGalat(
          e instanceof Error && e.message
            ? e.message
            : "Berkas gagal disiapkan – periksa jaringan lalu coba lagi.",
        );
      }
    } finally {
      if (hidup.current) setSibuk(false);
    }
  }, []);

  return { sibuk, galat, bersihkanGalat: () => setGalat(null), unduh };
}

/**
 * Tautan TEKS yang mengunduh berkas – untuk tempat yang bentuknya memang
 * tautan, bukan tombol (mis. baris "Unduh Excel →" di panel artefak AI).
 *
 * Bentuknya boleh berbeda; yang tidak boleh berbeda adalah ia mengaku sedang
 * bekerja. Itu sebabnya `labelSibuk` wajib, bukan opsional.
 */
export function TautanUnduh({
  href,
  labelSibuk,
  className,
  children,
  namaBerkas,
}: {
  href: string;
  labelSibuk: string;
  className?: string;
  children: React.ReactNode;
  namaBerkas?: string;
}) {
  const { sibuk, galat, bersihkanGalat, unduh } = useUnduhBerkas();
  return (
    <span className="relative inline-flex items-center">
      {galat ? <GalatUnduh galat={galat} onTutup={bersihkanGalat} /> : null}
      <a
        href={href}
        data-unduhan=""
        aria-busy={sibuk || undefined}
        role={sibuk ? "status" : undefined}
        className={className}
        onClick={(e) => {
          if (!klikBiasa(e)) return;
          e.preventDefault();
          if (!sibuk) void unduh(href, namaBerkas);
        }}
      >
        {sibuk ? labelSibuk : children}
      </a>
    </span>
  );
}

/**
 * Kalimat galat unduhan yang menempel pada tombolnya.
 *
 * Dipasang `absolute` supaya munculnya tidak menggeser tata letak — pesan galat
 * yang mendorong isi halaman membuat orang kehilangan tempat ia menekan.
 */
export function GalatUnduh({ galat, onTutup }: { galat: string; onTutup: () => void }) {
  return (
    <span
      role="alert"
      className="absolute top-full left-0 z-30 mt-1 max-w-[min(22rem,calc(100vw-1.5rem))] rounded-md border border-danger bg-surface px-2.5 py-1.5 text-[12px] text-danger shadow-lg"
    >
      {galat}{" "}
      <button type="button" onClick={onTutup} className="font-medium underline underline-offset-2">
        tutup
      </button>
    </span>
  );
}
