"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Banner, Button } from "@/components/ui";
import {
  tandaiMassalBukanBahanKerjaAction,
  type LampiranState,
} from "@/lib/surat/lampiran-actions";

/**
 * Id borang massal. Kotak centang tiap baris mengikat diri ke sini lewat
 * atribut `form`, dari mana pun letaknya di halaman.
 */
export const ID_BORANG_PEMBERSIH = "pembersih-lampiran";

/**
 * Penandaan MASSAL lampiran "bukan bahan kerja".
 *
 * Keluhan user 2026-08-29: menandai satu per satu terlalu lambat, jadi daftarnya
 * menumpuk dan berhenti dibaca. Yang massal SENGAJA hanya satu arah — "bukan
 * bahan kerja". Menjadikan sesuatu surat resmi tetap satu per satu: itu
 * keputusan yang menuntut membaca berkasnya.
 *
 * ### Kenapa daftarnya TIDAK lagi dibungkus borang ini
 *
 * Laporan user 2026-09-21: *"klik minta usul ai tidak muncul apapun, diklik
 * simpan sebagai dokumen juga tidak muncul apa pun."* Sebabnya bentuk lama
 * membungkus SELURUH daftar dengan `<form>`, sementara tiap baris membawa
 * borang aksinya sendiri. React menyebutkannya sendiri di konsol:
 *
 *     <form> cannot contain a nested <form>.
 *     This will cause a hydration error.
 *
 * Hidrasi gagal di subtree itu, jadi `action` borang-borang di dalamnya tidak
 * pernah terpasang: tombolnya tetap tampil, tetap bisa ditekan, dan tidak
 * terjadi apa pun. Tanpa galat di layar dan tanpa jejak — jenis kerusakan yang
 * paling lama hidup (DECISIONS 598).
 *
 * Sekarang borangnya BERSEBELAHAN dengan daftar, bukan membungkusnya. Kotak
 * centang tetap terkirim karena HTML memang menyediakan caranya: atribut
 * `form="<id>"` mengikat sebuah input ke borang mana pun di halaman, di mana
 * pun ia berada. `HTMLFormElement.elements` dan `new FormData(form)` ikut
 * menghormati ikatan itu, jadi aksinya tidak perlu tahu apa-apa.
 */
export function PembersihMassal({ children, jumlah }: { children: ReactNode; jumlah: number }) {
  const [state, aksi] = useAksi<LampiranState>(tandaiMassalBukanBahanKerjaAction, undefined);
  const [terpilih, setTerpilih] = useState(0);
  const wadah = useRef<HTMLDivElement>(null);

  /*
   * Dihitung dari DOM, bukan dari state per baris: baris bisa hilang setelah
   * aksi, dan hitungan yang disimpan terpisah akan menyebut angka yang sudah
   * tidak ada isinya. Dihitung di WADAH karena centangnya kini berada di luar
   * borang — peristiwa `change`-nya tidak lagi melewati borang itu.
   */
  const hitung = () =>
    setTerpilih(
      wadah.current?.querySelectorAll<HTMLInputElement>('input[name="attachmentId"]:checked')
        .length ?? 0,
    );

  return (
    <div ref={wadah} onChange={hitung} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      {children}

      {jumlah > 0 ? (
        <form
          id={ID_BORANG_PEMBERSIH}
          action={aksi}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2"
        >
          <p className="text-[13px] text-ink-muted">
            {terpilih > 0
              ? `${terpilih} berkas dipilih.`
              : "Centang berkas yang tidak perlu ditindaklanjuti, lalu bersihkan sekaligus."}
          </p>
          <TombolBersihkan terpilih={terpilih} />
        </form>
      ) : null}
    </div>
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
