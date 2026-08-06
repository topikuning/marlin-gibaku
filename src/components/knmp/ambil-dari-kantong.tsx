"use client";

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Images, MapPin, MapPinOff } from "lucide-react";
import { Banner, Button, HelpText } from "@/components/ui";
import {
  muatKantongLokasiAction,
  pakaiFotoAction,
  type FotoCepatState,
} from "@/lib/foto-cepat/actions";
import type { FotoKantong } from "@/lib/foto-cepat/queries";

/**
 * AMBIL FOTO DARI KANTONG FOTO CEPAT — dari layar yang sedang diisi.
 *
 * Keluhan user 2026-08-06: *"di sisi inputan laporan harian maupun kegiatan
 * lapangan pun, perlu untuk bisa mengambil dari hasil foto cepat ini, kalau
 * tidak, akan percuma fitur ini."*
 *
 * Sebelumnya foto di kantong hanya bisa dipakai dari halaman /foto-cepat. Arah
 * itu benar untuk orang yang baru pulang dari lapangan dengan sekantong foto,
 * tapi salah untuk orang yang sedang MENGISI laporan: dia harus meninggalkan
 * formulir yang belum tersimpan, mencari fotonya, memilih ulang tanggal + item
 * yang sedang terbuka di layar sebelumnya, lalu kembali dan mencari lagi sampai
 * mana tadi. Yang benar-benar terjadi bukan itu — melainkan memotret ulang dari
 * layar laporan, dengan koordinat seadanya, sementara foto yang koordinatnya
 * justru benar menumpuk tak terpakai di kantong.
 *
 * Komponen ini memakai `pakaiFotoAction` yang SAMA dengan halaman /foto-cepat —
 * bukan jalur penautan kedua. Semua pagarnya (lokasi harus cocok, laporan harus
 * masih bisa disunting, kegiatan harus draft, cap dilengkapi otomatis) berlaku
 * apa adanya, karena memang satu-satunya tempat aturan itu ditulis.
 */

type Tujuan =
  | { tujuan: "laporan"; reportItemId: string }
  | { tujuan: "kegiatan"; kegiatanId: string };

const KOSONG: FotoCepatState = {};

/**
 * Pemicunya DIPISAH dari panelnya, dan sengaja.
 *
 * Panel ini berisi petak-petak foto: ia butuh lebar penuh. Tombolnya sebaliknya
 * — tempatnya sebaris dengan aksi foto lain, supaya "ambil yang sudah dijepret"
 * dan "potret baru" terbaca sebagai dua pilihan setara, bukan dua lapis menu.
 * Kalau keduanya satu komponen, panelnya ikut jadi anak baris flex dan petaknya
 * terjepit di sisa lebar satu baris tombol.
 */
export function TombolAmbilDariKantong({
  onClick,
  aktif,
}: {
  onClick: () => void;
  /** Panelnya sedang terbuka — tombolnya ditandai, bukan disembunyikan. */
  aktif?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={aktif ? "secondary" : "ghost"}
      size="sm"
      className="px-2"
      onClick={onClick}
      aria-expanded={aktif ?? false}
    >
      <Images aria-hidden className="size-4" />
      Foto Cepat
    </Button>
  );
}

export function AmbilDariKantong({
  locationId,
  target,
  onTutup,
}: {
  locationId: string;
  target: Tujuan;
  onTutup: () => void;
}) {
  const router = useRouter();
  const [fotos, setFotos] = useState<FotoKantong[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [memuat, mulaiMuat] = useTransition();
  const [state, action, pending] = useActionState(pakaiFotoAction, KOSONG);

  const muat = useCallback(() => {
    mulaiMuat(async () => {
      const hasil = await muatKantongLokasiAction(locationId);
      if ("error" in hasil) {
        setGalat(hasil.error);
        setFotos([]);
      } else {
        setGalat(null);
        setFotos(hasil.fotos);
      }
    });
  }, [locationId]);

  useEffect(() => {
    if (fotos == null && !memuat) muat();
  }, [fotos, memuat, muat]);

  /**
   * Foto yang berpindah HILANG dari kantong. Daftar di sini adalah salinan yang
   * dimuat sebelum penautan, jadi ia harus dimuat ulang — kalau tidak, foto yang
   * sudah dipakai tetap terlihat tersedia dan dicoba lagi sampai ditolak server.
   * `router.refresh()` mengurus galeri item di halaman ini; `pakaiFotoAction`
   * sendiri hanya merevalidasi /foto-cepat dan /foto.
   */
  useEffect(() => {
    if (!state.ok && !state.warning) return;
    // Lewat timeout, bukan sinkron di badan effect: lint repo ini melarang
    // setState sinkron di effect karena memicu render kaskade.
    const t = window.setTimeout(() => {
      setTerpilih(new Set());
      setFotos(null);
      router.refresh();
    }, 0);
    return () => window.clearTimeout(t);
  }, [state.ok, state.warning, router]);

  const toggle = (id: string) =>
    setTerpilih((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const jumlah = fotos?.length ?? 0;
  const ids = useMemo(() => [...terpilih], [terpilih]);

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">Foto di kantong lokasi ini</span>
        <button
          type="button"
          onClick={onTutup}
          className="text-[12px] font-medium text-ink-muted hover:underline"
        >
          Tutup
        </button>
      </div>

      {galat ? <Banner tone="error" title={galat} /> : null}
      {state.error ? <Banner tone="error" title={state.error} /> : null}
      {state.warning ? <Banner tone="warning" title={state.warning} /> : null}
      {state.ok ? <Banner tone="success" title={state.ok} /> : null}

      {memuat && fotos == null ? (
        <p className="text-sm text-ink-muted">Memuat kantong…</p>
      ) : jumlah === 0 ? (
        <HelpText>
          Belum ada foto kantong untuk lokasi ini. Foto yang lokasinya belum ketahuan tidak
          ditawarkan di sini — tetapkan lokasinya dulu di menu Foto Cepat.
        </HelpText>
      ) : (
        <form action={action} className="space-y-2">
          {ids.map((id) => (
            <input key={id} type="hidden" name="photoIds" value={id} />
          ))}
          <input type="hidden" name="tujuan" value={target.tujuan} />
          {target.tujuan === "laporan" ? (
            <input type="hidden" name="reportItemId" value={target.reportItemId} />
          ) : (
            <input type="hidden" name="kegiatanId" value={target.kegiatanId} />
          )}

          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {fotos!.map((f) => {
              const dipilih = terpilih.has(f.id);
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => toggle(f.id)}
                    aria-pressed={dipilih}
                    aria-label={`${dipilih ? "Batal pilih" : "Pilih"} foto ${f.waktuLabel}`}
                    className={`relative block w-full overflow-hidden rounded-md border text-left transition ${
                      dipilih ? "border-primary ring-2 ring-primary" : "border-border"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`absolute left-1 top-1 z-10 grid size-5 place-items-center rounded-full border shadow ${
                        dipilih
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-surface/90 text-transparent"
                      }`}
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <span className="block aspect-square bg-surface-inset">
                      {f.thumbUrl ? (
                        // Foto R2 ber-presigned URL berumur pendek — next/image
                        // tidak dipakai di seluruh aplikasi ini karena hostnya
                        // berganti tiap deploy.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={f.thumbUrl}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : null}
                    </span>
                    <span className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-ink-muted">
                      {f.gpsAsli ? (
                        <MapPin aria-hidden className="size-3 shrink-0 text-success" />
                      ) : (
                        <MapPinOff aria-hidden className="size-3 shrink-0 text-warning" />
                      )}
                      <span className="truncate">{f.waktuLabel}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <Button type="submit" size="sm" loading={pending} disabled={ids.length === 0}>
            {ids.length === 0 ? "Pilih foto dulu" : `Pakai ${ids.length} foto`}
          </Button>
          <HelpText>
            Waktu & koordinat foto TIDAK berubah — yang ditambahkan hanya nama lokasi, perusahaan,
            bangunan, dan item pekerjaannya ke capnya.
          </HelpText>
        </form>
      )}
    </div>
  );
}
