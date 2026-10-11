"use client";

import { ArrowLeft, ExternalLink, FileText, Printer, Share } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { galatDariJawaban, namaDariHeader } from "@/components/ui/unduh";
import { useAplikasiTerpasang, useBisaBagikanBerkas, useIos } from "@/components/pwa/mode-tampilan";
import { cn } from "@/lib/cn";
import { denganCetakOtomatis, modeCetak, type AksiCetak } from "@/lib/cetak/mode-cetak";
import { AutoPrint } from "./auto-print";

const IKON: Record<AksiCetak, typeof Printer> = {
  "cetak-layar": Printer,
  "buka-pdf": FileText,
  "bagikan-pdf": Share,
  "buka-peramban": ExternalLink,
};

/**
 * Toolbar halaman cetak (disembunyikan saat print via `no-print`).
 *
 * TIDAK memicu window.print() otomatis kecuali diminta lewat `?cetak=1` –
 * dulu auto-print membuat pengguna "terjebak" di halaman cetak & harus menekan
 * Back browser. Kini ada tombol Kembali + Cetak eksplisit.
 *
 * Di APLIKASI TERPASANG (PWA) `window.print()` sering tidak memunculkan
 * apa-apa (laporan user 2026-10-11). Di sana tombol utamanya menyerahkan
 * dokumen ke tempat yang bisa mencetak – PDF resmi, lembar Bagikan iPhone, atau
 * jendela peramban – dan cetak dari layar turun jadi tombol kedua. Aturannya di
 * `lib/cetak/mode-cetak.ts`; di peramban biasa tampilannya tidak berubah.
 */
export function PrintToolbar({
  backHref,
  pdfHref = null,
  cetakOtomatis = false,
}: {
  backHref?: string;
  /**
   * PDF resmi dokumen ini. Isi HANYA bila pembacanya berhak mengekspor
   * (`report.export`) – tombol yang berakhir di "Tidak punya izin" lebih buruk
   * daripada tidak ada tombol.
   */
  pdfHref?: string | null;
  /** `?cetak=1`: buka dialog cetak sekali saat halaman siap. */
  cetakOtomatis?: boolean;
}) {
  const router = useRouter();
  const standalone = useAplikasiTerpasang();
  const ios = useIos();
  const bisaBagikanBerkas = useBisaBagikanBerkas();
  const mode = modeCetak({ standalone, pdfHref, ios, bisaBagikanBerkas });

  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  /** PDF sudah dijemput tapi lembar Bagikan butuh ketukan baru. */
  const [siapDibagikan, setSiapDibagikan] = useState(false);
  // Berkas yang sudah dijemput dipakai ulang: ketukan berikutnya langsung
  // membuka lembar Bagikan tanpa membangun PDF-nya lagi di server.
  const berkas = useRef<File | null>(null);

  const bukaJendela = (href: string, bolehDiTempat: boolean) => {
    const w = window.open(href, "_blank");
    if (w) {
      w.opener = null;
      return;
    }
    // Jendela baru ditolak. Di Android/komputer membuka di tempat masih
    // berguna (ada tombol kembali sistem). Di iPhone TIDAK: aplikasi terpasang
    // tidak punya tombol kembali, jadi PDF yang terbuka di tempat menjebak.
    if (bolehDiTempat) window.location.assign(href);
  };

  const bagikanPdf = async (href: string) => {
    if (!berkas.current) {
      setSibuk(true);
      try {
        const r = await fetch(href, { credentials: "same-origin" });
        if (!r.ok) throw new Error(await galatDariJawaban(r));
        const blob = await r.blob();
        const nama = namaDariHeader(r.headers.get("content-disposition")) ?? "dokumen.pdf";
        berkas.current = new File([blob], nama, { type: "application/pdf" });
      } catch (e) {
        setGalat(
          e instanceof Error && e.message ? e.message : "PDF gagal disiapkan – periksa jaringan lalu coba lagi.",
        );
        return;
      } finally {
        setSibuk(false);
      }
    }
    try {
      await navigator.share({ files: [berkas.current], title: berkas.current.name });
      setSiapDibagikan(false);
    } catch (e) {
      const nama = e instanceof DOMException ? e.name : "";
      // Lembar Bagikan ditutup pemakai sendiri – bukan galat.
      if (nama === "AbortError") return;
      // Ketukan "kedaluwarsa" selama PDF dibangun (peramban hanya mengizinkan
      // Bagikan beberapa detik sesudah ketukan). Berkasnya sudah di tangan;
      // satu ketukan lagi cukup.
      if (nama === "NotAllowedError") {
        setSiapDibagikan(true);
        return;
      }
      setGalat("Lembar Bagikan tidak bisa dibuka di perangkat ini. Coba Cetak halaman ini.");
    }
  };

  const jalankan = (aksi: AksiCetak) => {
    setGalat(null);
    switch (aksi) {
      case "cetak-layar":
        window.print();
        return;
      case "buka-pdf":
        if (pdfHref) bukaJendela(pdfHref, !ios);
        return;
      case "bagikan-pdf":
        if (pdfHref) void bagikanPdf(pdfHref);
        return;
      case "buka-peramban":
        bukaJendela(
          denganCetakOtomatis(`${window.location.pathname}${window.location.search}${window.location.hash}`),
          false,
        );
        return;
    }
  };

  const IkonUtama = IKON[mode.utama.aksi];
  const IkonCadangan = mode.cadangan ? IKON[mode.cadangan.aksi] : null;
  const petunjuk = siapDibagikan
    ? `PDF sudah siap. Ketuk ${mode.utama.label} sekali lagi.`
    : mode.petunjuk;

  return (
    <>
      {cetakOtomatis ? <AutoPrint /> : null}
      {/* Bantalan atas ikut `safe-area-inset-top`: dengan `viewport-fit=cover`
          bilah lengket ini tidak boleh masuk ke bawah poni/status bar. */}
      <div
        className={cn(
          "no-print sticky top-0 z-10 border-b border-border bg-surface px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5",
          !petunjuk && "mb-4",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="secondary"
            onClick={() => (backHref ? router.push(backHref) : router.back())}
          >
            <ArrowLeft aria-hidden className="size-4" />
            Kembali
          </Button>
          {/* Dua tombol cetak di HP: satu baris sendiri, sama lebar – bukan
              bertumpuk rata kanan dengan lebar berbeda. */}
          <div
            className={cn(
              "flex items-center justify-end gap-2",
              mode.cadangan &&
                "w-full sm:w-auto [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-3 sm:[&>button]:flex-none sm:[&>button]:px-4",
            )}
          >
            {mode.cadangan && IkonCadangan ? (
              <Button variant="secondary" onClick={() => jalankan(mode.cadangan!.aksi)}>
                <IkonCadangan aria-hidden className="size-4" />
                {mode.cadangan.label}
              </Button>
            ) : null}
            <Button variant="primary" loading={sibuk} onClick={() => jalankan(mode.utama.aksi)}>
              {sibuk ? (
                "Menyiapkan PDF…"
              ) : (
                <>
                  <IkonUtama aria-hidden className="size-4" />
                  {mode.utama.label}
                </>
              )}
            </Button>
          </div>
        </div>
        {galat ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {galat}
          </p>
        ) : null}
      </div>
      {/* Petunjuk di LUAR bilah lengket: dibaca sekali di atas, lalu ikut
          tergulir – bilah yang menempel tetap ringkas di layar HP. */}
      {petunjuk ? <p className="no-print px-4 pt-2 pb-3 text-xs text-ink-muted">{petunjuk}</p> : null}
    </>
  );
}
