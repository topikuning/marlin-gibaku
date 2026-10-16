"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ButtonLink, Card, Combobox, ProgressBar } from "@/components/ui";
import { formatPct, formatTanggal } from "@/lib/format";
import { ringkasPerMinggu } from "@/lib/dokumentasi-sarpras/murni";

export type SlideItem = {
  id: string;
  tanggal: string;
  minggu: number | null;
  progres: number;
  lineageKey: string;
  pekerjaan: string;
  full: string | null;
  thumb: string | null;
};

const tgl = (t: string) => formatTanggal(new Date(`${t}T00:00:00Z`));

/**
 * Slide foto satu sarana (DECISIONS 683). Urutannya sudah dari server (tanggal
 * laporan, lalu urutan unggah); di sini hanya disaring – per pekerjaan, dan
 * "satu foto per minggu" supaya ratusan foto tetap bisa dibaca sebagai alur.
 */
export function SlideFoto({
  slug,
  judul,
  progresKini,
  slides,
  pekerjaan,
}: {
  slug: string;
  judul: string;
  progresKini: number;
  slides: SlideItem[];
  pekerjaan: { lineageKey: string; label: string; jumlah: number }[];
}) {
  const [saring, setSaring] = useState("");
  const [ringkas, setRingkas] = useState(slides.length > 40);
  const [i, setI] = useState(0);

  const tampil = useMemo(() => {
    const dasar = saring ? slides.filter((x) => x.lineageKey === saring) : slides;
    // `dibuat` tidak dikirim ke klien; urutannya sudah benar, jadi indeks dipakai.
    const urut = dasar.map((x, n) => ({ ...x, dibuat: n }));
    return ringkas ? ringkasPerMinggu(urut) : urut;
  }, [slides, saring, ringkas]);

  const n = tampil.length;
  const aktif = tampil[Math.min(i, n - 1)];
  const geser = (d: number) => setI((x) => Math.min(n - 1, Math.max(0, Math.min(x, n - 1) + d)));

  useEffect(() => {
    const tombol = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      if (e.key === "ArrowRight") setI((x) => Math.min(n - 1, x + 1));
    };
    window.addEventListener("keydown", tombol);
    return () => window.removeEventListener("keydown", tombol);
  }, [n]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">{judul}</h2>
          <p className="text-[13px] text-ink-muted">Progres s/d hari ini {formatPct(progresKini, 2)}</p>
        </div>
        <ButtonLink href={`/lokasi/${slug}/foto-sarpras`} variant="ghost" size="sm">
          <ArrowLeft aria-hidden className="size-3.5" />
          Semua sarana
        </ButtonLink>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-80">
          <Combobox
            value={saring}
            onChange={(v) => {
              setSaring(v);
              setI(0);
            }}
            options={[
              { value: "", label: `Semua pekerjaan (${slides.length} foto)` },
              ...pekerjaan.map((p) => ({ value: p.lineageKey, label: `${p.label} (${p.jumlah} foto)` })),
            ]}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-pressed={ringkas}
          onClick={() => {
            setRingkas((x) => !x);
            setI(0);
          }}
        >
          {ringkas ? "Tampilkan semua foto" : "Satu foto per minggu"}
        </Button>
      </div>

      {aktif ? (
        <Card className="overflow-hidden">
          <div className="relative flex aspect-[4/3] max-h-[70vh] w-full items-center justify-center bg-black sm:aspect-video">
            {aktif.full ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={aktif.full} alt={`${aktif.pekerjaan} – ${tgl(aktif.tanggal)}`} className="max-h-full max-w-full object-contain" />
            ) : (
              <p className="text-sm text-white/70">Berkas foto tidak bisa dimuat.</p>
            )}
            <button
              type="button"
              aria-label="Foto sebelumnya"
              onClick={() => geser(-1)}
              disabled={i <= 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white disabled:opacity-30"
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              aria-label="Foto berikutnya"
              onClick={() => geser(1)}
              disabled={i >= n - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white disabled:opacity-30"
            >
              <ChevronRight className="size-6" />
            </button>
          </div>
          <div className="space-y-1.5 p-3">
            <p className="text-sm text-ink">
              <span className="font-semibold">{tgl(aktif.tanggal)}</span>
              {aktif.minggu != null ? ` · Minggu ke-${aktif.minggu}` : ""}
              <span className="text-ink-muted"> · Foto {Math.min(i, n - 1) + 1} dari {n}</span>
            </p>
            <div className="flex items-center gap-2 text-[13px] text-ink-muted">
              <span className="shrink-0">Progres sarana s/d tanggal ini</span>
              <ProgressBar value={aktif.progres} label="Progres sarana s/d tanggal foto" className="flex-1" />
              <span className="tabular shrink-0 font-semibold text-ink">{formatPct(aktif.progres, 2)}</span>
            </div>
            <p className="text-[13px] text-ink-muted">Pekerjaan: {aktif.pekerjaan}</p>
          </div>
        </Card>
      ) : (
        <p className="text-sm text-ink-muted">Tidak ada foto untuk pilihan ini.</p>
      )}

      {n > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {tampil.map((x, k) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setI(k)}
              aria-label={`Foto ${k + 1}: ${tgl(x.tanggal)}`}
              aria-current={k === Math.min(i, n - 1)}
              className={`relative h-16 w-20 shrink-0 overflow-hidden rounded-md bg-surface-inset ring-2 ${
                k === Math.min(i, n - 1) ? "ring-primary" : "ring-transparent"
              }`}
            >
              {x.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.thumb} alt="" loading="lazy" className="size-full object-cover" />
              ) : null}
              <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 text-[10px] text-white tabular">
                {formatPct(x.progres, 0)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
