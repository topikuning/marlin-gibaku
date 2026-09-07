"use client";

import { Banner, Button, Input, Label } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import {
  setKelompokPetaAction,
  unduhPetaDasarAction,
  type PetaActionState,
} from "@/lib/peta/actions";

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
export function PetaPanel({
  sudahAda,
  sedangUnduh,
  sumberBawaan,
  kelompokBawaan,
}: {
  sudahAda: boolean;
  sedangUnduh: boolean;
  /** Alamat yang dipakai bila kotak di bawah dikosongkan. */
  sumberBawaan: string;
  /** Penanda peta digabung jadi lingkaran berangka saat peta dibuka? */
  kelompokBawaan: boolean;
}) {
  const [state, aksi, pending] = useAksi<PetaActionState>(unduhPetaDasarAction, undefined);

  return (
    <>
      <KelompokPenanda aktif={kelompokBawaan} />
      <form action={aksi} className="mt-3 space-y-2 border-t border-border pt-3">
        {state?.error ? <Banner tone="error" title={state.error} /> : null}
        {state?.success ? <Banner tone="success" title={state.success} /> : null}
        {/*
          Alamat sumber bisa diketik supaya lingkungan ini tidak perlu menunggu
          apa pun mendarat di branch default lebih dulu (teguran user
          2026-09-06). Dikosongkan = pakai bawaan.
        */}
        <div>
          <Label htmlFor="peta-sumber">Alamat berkas .pmtiles (opsional)</Label>
          <Input
            id="peta-sumber"
            name="sumber"
            type="url"
            inputMode="url"
            placeholder={sumberBawaan}
            className="font-mono text-[12px]"
          />
          <p className="mt-1 text-[11px] text-ink-muted">
            Kosongkan untuk memakai bawaan. Boleh diisi cermin internal atau berkas hasil unduhan
            sendiri – yang penting bisa diambil server ini lewat https.
          </p>
        </div>
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
    </>
  );
}

/**
 * BAWAAN PENANDA PETA — berkelompok atau satu per satu.
 *
 * Permintaan user 2026-09-06: *"bagaimana supaya aku bisa atur default kelompok
 * atau per titik langsung"*. Tombol di peta sudah ada, tapi ia hanya berlaku
 * selama layar itu terbuka; yang diatur di sini apa yang dilihat SEMUA orang
 * saat peta pertama kali dibuka — termasuk mandor yang tidak akan pernah
 * menyentuh tombol itu.
 */
function KelompokPenanda({ aktif }: { aktif: boolean }) {
  const [state, aksi, pending] = useAksi<PetaActionState>(setKelompokPetaAction, undefined);

  return (
    <form action={aksi} className="mt-3 space-y-2 border-t border-border pt-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Penanda peta saat dibuka</p>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {aktif
              ? "Berkelompok – lokasi berdekatan digabung jadi lingkaran berangka. Cocok untuk sebaran nasional."
              : "Satu per satu – setiap lokasi digambar sendiri, meski bertumpuk di tampilan nasional."}{" "}
            Siapa pun tetap bisa menggantinya sementara lewat tombol di peta.
          </p>
        </div>
        {/* Nilai dikirim sebagai lawan dari keadaan sekarang: tombolnya
            memang berbunyi "ubah ke ...", bukan "simpan". */}
        <input type="hidden" name="kelompok" value={aktif ? "0" : "1"} />
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          {aktif ? "Ubah ke satu per satu" : "Ubah ke berkelompok"}
        </Button>
      </div>
    </form>
  );
}
