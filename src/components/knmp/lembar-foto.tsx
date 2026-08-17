"use client";

import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, X } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { PhotoSourceInput } from "@/components/knmp/photo-source-input";
import { addSupplyPhotosAction, type DailyActionState } from "@/lib/daily-report/actions";
import { tahanGagalKirim } from "@/lib/aksi-klien";

/**
 * LEMBAR FOTO untuk satu baris material / alat (DECISIONS 341).
 *
 * ### Masalah yang diperbaiki
 *
 * Keluhan user 2026-08-17: *"punyamu saat ini terlalu scroll ke bawah bahkan
 * user tidak tahu kalau itu bisa diberi foto untuk alat dan material,
 * menyesatkan."*
 *
 * Benar, dan sebabnya struktural. Foto material/alat dulu hidup di kartu
 * TERPISAH di bawah form pelengkap (DECISIONS 304) — barisnya diketik di satu
 * tempat, fotonya ditambahkan ±600px di bawahnya, di kartu yang judulnya baru
 * terbaca kalau seseorang menggulir sampai sana. Di ponsel, orang yang tidak
 * pernah menggulir sejauh itu akan menyimpulkan fitur ini tidak ada.
 *
 * ### Kenapa LEMBAR, bukan panel di dalam barisnya
 *
 * Kartu terpisah itu bukan kemalasan: baris material hidup DI DALAM satu
 * `<form>` pelengkap, dan `<form>` di dalam `<form>` bukan HTML yang sah —
 * peramban membuang yang di dalam dan tombolnya jadi diam saja saat ditekan.
 *
 * Lembar ini dirender lewat `createPortal` ke `document.body`, jadi secara DOM
 * ia BERADA DI LUAR form pelengkap meski pemicunya ada di dalam baris. Form-nya
 * sah, dan pemicunya tetap menempel pada barisnya sendiri — tidak ada lagi
 * jarak antara "saya mengetik Semen 40 zak" dan "beri fotonya".
 *
 * ### Baris yang belum tersimpan: SISTEM yang menyimpan, bukan orangnya
 *
 * Tantangan user 2026-08-17: *"atau apa polamu ini, kenapa data pendukung harus
 * disimpan dulu baru bisa beri foto."* Betul. Foto memang menempel pada id
 * baris di basis data, dan id itu baru ada sesudah tersimpan — tapi itu urusan
 * BUKU BESAR kami, bukan syarat yang pantas ditagihkan ke orang di lapangan.
 *
 * Versi pertama pemicu ini menampilkan tombol MATI bertuliskan "Simpan dulu".
 * Itu memang jujur, dan tetap salah: ia memindahkan pekerjaan pembukuan ke
 * penggunanya. Sekarang tombolnya HIDUP dan berbunyi "Simpan & foto" — sekali
 * ketuk ia menyimpan pelengkapnya sendiri, lalu lembar fotonya terbuka untuk
 * baris itu begitu id-nya ada.
 */
const kirimFoto = tahanGagalKirim(addSupplyPhotosAction);

export type PemicuFotoProps = {
  reportId: string;
  jenis: "material" | "alat";
  /** id baris di basis data; "" = baris belum tersimpan. */
  barisId: string;
  /** Nama baris, untuk judul lembar. */
  label: string;
  jumlahFoto: number;
  /** false = laporan tidak lagi bisa diubah / R2 mati. */
  aktif: boolean;
  /**
   * Buka lembarnya begitu komponen tampil — dipakai sesudah baris yang tadi
   * belum tersimpan selesai disimpan, supaya "Simpan & foto" benar-benar
   * berakhir di lembar foto, bukan sekadar menyimpan lalu diam.
   */
  bukaAwal?: boolean;
  /** Dipanggil sekali sesudah `bukaAwal` dipakai, supaya tidak terbuka lagi. */
  onSudahDibuka?: () => void;
  /**
   * Baris ini belum tersimpan dan orangnya menekan "Simpan & foto".
   *
   * Yang diserahkan ELEMEN barisnya (`[data-baris]` terdekat), bukan sebuah
   * nilai: hanya pemanggil yang tahu nama medan mana yang berisi nama baris,
   * dan hanya DOM yang tahu apa yang SEDANG diketik di kolom tak-terkendali.
   */
  onMintaSimpan?: (baris: HTMLElement | null) => void;
};

export function PemicuFotoBaris({
  reportId,
  jenis,
  barisId,
  label,
  jumlahFoto,
  aktif,
  bukaAwal = false,
  onSudahDibuka,
  onMintaSimpan,
}: PemicuFotoProps) {
  const belumTersimpan = !barisId;
  const [buka, setBuka] = useState(bukaAwal && !belumTersimpan);

  // Permintaan buka-otomatis dilepas sesudah dipakai; kalau tidak, menutup
  // lembarnya lalu menyimpan hal lain akan membukanya lagi tanpa diminta.
  useEffect(() => {
    if (!bukaAwal || belumTersimpan || !onSudahDibuka) return;
    const t = window.setTimeout(() => onSudahDibuka(), 0);
    return () => window.clearTimeout(t);
  }, [bukaAwal, belumTersimpan, onSudahDibuka]);

  if (!aktif) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          if (!belumTersimpan) return setBuka(true);
          // Simpan dulu — TAPI sistem yang melakukannya, bukan orangnya.
          // `requestSubmit()` memakai tombol submit bawaan form, yaitu
          // "Simpan Pelengkap" (lihat DECISIONS 342 soal tombol cuaca).
          onMintaSimpan?.(e.currentTarget.closest<HTMLElement>("[data-baris]"));
          e.currentTarget.form?.requestSubmit();
        }}
        aria-label={`Foto untuk ${label}`}
        title={
          belumTersimpan
            ? "Simpan pelengkap lalu tambahkan fotonya"
            : `Foto ${label}`
        }
        className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-medium ${
          jumlahFoto > 0 && !belumTersimpan
            ? "border-success-border bg-success-soft text-success hover:bg-success-soft/70"
            : "border-warning-border bg-warning-soft text-warning hover:bg-warning-soft/70"
        }`}
      >
        <Camera aria-hidden className="size-3.5" />
        {/* Jumlahnya DISEBUT, termasuk nol. "0 foto" keterangan yang berguna:
            ia memberi tahu bahwa foto memang bisa ditambahkan di sini. */}
        {belumTersimpan ? "Simpan & foto" : `${jumlahFoto} foto`}
      </button>
      {buka && !belumTersimpan ? (
        <LembarFoto
          reportId={reportId}
          jenis={jenis}
          barisId={barisId}
          label={label}
          onTutup={() => setBuka(false)}
        />
      ) : null}
    </>
  );
}

function LembarFoto({
  reportId,
  jenis,
  barisId,
  label,
  onTutup,
}: {
  reportId: string;
  jenis: "material" | "alat";
  barisId: string;
  label: string;
  onTutup: () => void;
}) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    kirimFoto,
    undefined,
  );
  // `document` baru ada sesudah hidrasi — portal dipasang di effect supaya
  // render server dan render klien pertama sama persis.
  const [siap, setSiap] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSiap(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  // Escape menutup: di laptop ini refleks, dan lembar tanpa jalan keluar
  // keyboard adalah jebakan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onTutup();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTutup]);

  if (!siap) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Foto ${label}`}
    >
      <button
        type="button"
        aria-label="Tutup"
        className="absolute inset-0 bg-ink/50"
        onClick={onTutup}
        tabIndex={-1}
      />
      {/*
        Di ponsel lembar menempel di DASAR layar — di sanalah ibu jari berada,
        dan di sana pula ia tidak tertutup papan ketik. Di laptop ia jadi dialog
        tengah dengan lebar terbatas: lembar selebar layar 1440px terbaca
        seperti halaman baru, bukan seperti satu tugas kecil.
      */}
      <div className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-xl border border-border bg-surface p-4 shadow-lg sm:max-w-md sm:rounded-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">Foto {label}</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {jenis === "material" ? "Bukti material masuk" : "Bukti peralatan dipakai"} — dicetak
              di halaman tersendiri pada laporan KKP.
            </p>
          </div>
          <button
            type="button"
            onClick={onTutup}
            aria-label="Tutup"
            className="grid size-8 shrink-0 place-items-center rounded-md border border-border text-ink-muted hover:bg-surface-muted"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        {state?.error ? <Banner tone="error" title={state.error} /> : null}
        {state?.success ? <Banner tone="success" title={state.success} /> : null}
        {state?.warning ? (
          <Banner tone="warning" title="Sebagian foto gagal" description={state.warning} />
        ) : null}

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="reportId" value={reportId} />
          <input type="hidden" name="jenis" value={jenis} />
          <input type="hidden" name="barisId" value={barisId} />
          <PhotoSourceInput latName="photoLat" lngName="photoLng" />
          <div className="flex gap-2">
            <Button type="submit" loading={pending} className="flex-1">
              Simpan foto
            </Button>
            <Button type="button" variant="secondary" onClick={onTutup}>
              Tutup
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
