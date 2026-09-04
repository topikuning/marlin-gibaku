"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Banner, Button } from "@/components/ui";
import {
  tandaiMassalBukanBahanKerjaAction,
  type LampiranState,
} from "@/lib/surat/lampiran-actions";

/**
 * Pembungkus daftar lampiran yang membuat penandaan MASSAL mungkin.
 *
 * Keluhan user 2026-08-29: menandai satu per satu terlalu lambat, jadi daftarnya
 * menumpuk dan berhenti dibaca. Yang massal SENGAJA hanya satu arah — "bukan
 * bahan kerja". Menjadikan sesuatu surat resmi tetap satu per satu: itu
 * keputusan yang menuntut membaca berkasnya.
 *
 * Kotak centang hidup di dalam borang ini, jadi tiap baris cukup menyediakan
 * kotaknya sendiri (`name="attachmentId"`) tanpa perlu tahu apa pun soal aksi.
 */
export function PembersihMassal({ children, jumlah }: { children: ReactNode; jumlah: number }) {
  const [state, aksi] = useAksi<LampiranState>(
    tandaiMassalBukanBahanKerjaAction,
    undefined,
  );
  const [terpilih, setTerpilih] = useState(0);

  return (
    <form
      action={aksi}
      onChange={(e) => {
        // Menghitung dari borangnya sendiri, bukan dari state per baris: baris
        // bisa hilang setelah aksi, dan hitungan yang disimpan terpisah akan
        // menyebut angka yang sudah tidak ada isinya.
        const f = e.currentTarget;
        setTerpilih(f.querySelectorAll<HTMLInputElement>('input[name="attachmentId"]:checked').length);
      }}
      className="space-y-3"
    >
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      {children}

      {jumlah > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
          <p className="text-[13px] text-ink-muted">
            {terpilih > 0
              ? `${terpilih} berkas dipilih.`
              : "Centang berkas yang tidak perlu ditindaklanjuti, lalu bersihkan sekaligus."}
          </p>
          <TombolBersihkan terpilih={terpilih} />
        </div>
      ) : null}
    </form>
  );
}

function TombolBersihkan({ terpilih }: { terpilih: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" loading={pending} disabled={terpilih === 0}>
      Tandai bukan bahan kerja{terpilih > 0 ? ` (${terpilih})` : ""}
    </Button>
  );
}
