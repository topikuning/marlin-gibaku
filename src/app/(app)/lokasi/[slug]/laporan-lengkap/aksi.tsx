"use client";

import { useState } from "react";
import { Download, FileText, Send } from "lucide-react";
import { Banner, Button, Combobox, TautanUnduh } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import { PILIHAN_TEMA_DECK, TEMA_DECK_DEFAULT } from "@/lib/paparan/tema";
import {
  kirimLaporanLokasiWaAction,
  type WaLaporanLokasiState,
} from "@/lib/lokasi-lengkap/actions";

/**
 * BARIS AKSI LAPORAN LENGKAP LOKASI — unduh PDF, pilih tema + unduh deck, kirim
 * ke grup WhatsApp.
 *
 * Ketiganya dijadikan SATU komponen, dan itu bukan kerapian semu. Bentuk
 * pertamanya (2026-09-19) memecahnya jadi tiga potong yang masing-masing
 * membawa pembungkus flex sendiri: satu kontrol berlabel melayang sementara
 * tetangganya tidak, keterangan tema jadi paragraf `w-full` di TENGAH baris
 * sehingga tombol sesudahnya terlempar ke baris baru, dan ketiga aksi berdiri
 * pada tiga perataan berbeda. Tata letak seperti itu tidak bisa diperbaiki dari
 * dalam potongannya — yang menentukan perataan adalah barisnya, jadi barisnya
 * yang harus punya satu pemilik.
 *
 * Aturannya sekarang: SATU baris, semua kontrol setinggi 36px dan rata tengah;
 * seluruh teks penjelas turun ke baris keterangan di bawahnya; umpan balik
 * (galat/berhasil) muncul sebagai banner di atas baris, bukan menyelip di
 * antara tombol.
 */
export function AksiLaporanLengkap({
  slug,
  locationId,
  wahaOn,
  hasGroup,
  groupName,
}: {
  slug: string;
  locationId: string;
  wahaOn: boolean;
  hasGroup: boolean;
  groupName: string | null;
}) {
  const [tema, setTema] = useState<string>(TEMA_DECK_DEFAULT);
  const [state, action, pending] = useAksi<WaLaporanLokasiState>(
    kirimLaporanLokasiWaAction,
    undefined,
  );
  const temaAktif = PILIHAN_TEMA_DECK.find((t) => t.value === tema);

  const keterangan = [
    temaAktif ? `Tema deck: ${temaAktif.deskripsi}` : null,
    wahaOn
      ? hasGroup
        ? `Kirim WhatsApp menuju ${groupName ? `grup ${groupName}` : "grup WhatsApp paket"}.`
        : "Paket ini belum ditautkan ke grup WhatsApp, jadi tombol kirim nonaktif."
      : null,
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <TautanUnduh
          href={`/api/lokasi/${slug}/laporan-lengkap?bentuk=laporan`}
          labelSibuk="Menyiapkan PDF…"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-800"
        >
          <Download aria-hidden className="size-4" />
          Unduh PDF laporan
        </TautanUnduh>

        <label htmlFor="deck-tema" className="sr-only">
          Tema deck
        </label>
        <Combobox id="deck-tema" value={tema} onChange={setTema} className="h-9 w-52">
          {PILIHAN_TEMA_DECK.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Combobox>

        <TautanUnduh
          href={`/api/lokasi/${slug}/laporan-lengkap?bentuk=deck&tema=${tema}`}
          labelSibuk="Menyiapkan deck…"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-ink hover:border-border-strong hover:bg-surface-muted"
        >
          <FileText aria-hidden className="size-4" />
          Unduh deck 16:9
        </TautanUnduh>

        {wahaOn ? (
          <form action={action} className="contents">
            <input type="hidden" name="locationId" value={locationId} />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="h-9"
              loading={pending}
              disabled={!hasGroup}
            >
              <Send aria-hidden className="size-4" />
              Kirim ke grup WhatsApp
            </Button>
          </form>
        ) : null}
      </div>

      {keterangan.length > 0 ? (
        <p className="text-[12px] leading-relaxed text-ink-muted">{keterangan.join(" ")}</p>
      ) : null}
    </div>
  );
}
