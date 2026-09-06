"use client";

import { Banner, Button } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import { unduhPetaDasarAction, type PetaActionState } from "@/lib/peta/actions";

/**
 * TOMBOL UNDUH PETA DASAR — super admin, di layar Sistem.
 *
 * Teguran user 2026-09-06: *"R2 antara dev dan production berbeda… kenapa
 * tidak kamu simpan langsung saja di lokal, production punya volume
 * dedicated"*, dan sebelumnya *"tahu darimana aku kalau itu beneran sudah
 * beres atau belum"*.
 *
 * Jadi penyiapannya pindah dari CI ke SINI. Alasannya bukan kemalasan:
 * lingkungan yang berbeda punya volume yang berbeda, jadi yang tahu volume
 * mana yang perlu diisi adalah aplikasi yang sedang berjalan di atasnya —
 * bukan satu workflow di GitHub yang harus menebak lingkungan mana yang
 * dimaksud. Menekan tombol ini di dev mengisi volume dev; menekannya di
 * produksi mengisi volume produksi. Tidak ada kunci yang perlu disamakan.
 */
export function PetaPanel({ sudahAda, sedangUnduh }: { sudahAda: boolean; sedangUnduh: boolean }) {
  const [state, aksi, pending] = useAksi<PetaActionState>(unduhPetaDasarAction, undefined);

  return (
    <form action={aksi} className="mt-3 space-y-2 border-t border-border pt-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={sedangUnduh}>
          {sudahAda ? "Perbarui peta dasar" : "Unduh peta dasar"}
        </Button>
        <span className="text-[11px] text-ink-muted">
          {sedangUnduh
            ? "Sedang berjalan – muat ulang halaman ini beberapa menit lagi."
            : "Sekali saja per lingkungan. Berkasnya tinggal di volume, jadi deploy ulang tidak menghapusnya."}
        </span>
      </div>
    </form>
  );
}
