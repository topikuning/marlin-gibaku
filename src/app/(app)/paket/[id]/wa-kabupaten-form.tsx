"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import { setWaGrupKabupatenAction, type WaKabupatenState } from "@/lib/waha/kabupaten-actions";

export type BarisKabupaten = {
  regency: string;
  /** Lokasi AKTIF paket ini di kabupaten tersebut. */
  jumlahLokasi: number;
  /** Grup kabupaten yang sedang terpasang, bila ada. */
  chatId: string | null;
  namaGrup: string | null;
  /** Lokasi yang BELUM ikut grup kabupatennya – masih mengikuti grup paket. */
  belumIkut: number;
};

/**
 * PEMASANG GRUP WA PER KABUPATEN (DECISIONS 596).
 *
 * Satu baris per kabupaten yang benar-benar ADA di paket ini — bukan daftar
 * kabupaten se-Indonesia. Menampilkan yang tersedia saja adalah aturan yang
 * sama dengan katalog lokasi: yang tidak muncul harus punya sebab yang bisa
 * dibaca, bukan sekadar tidak ada.
 *
 * Memasang grup langsung menerapkannya ke SELURUH lokasi aktif paket ini di
 * kabupaten itu. Itu memang maksudnya — PPK meminta satu kabupaten satu grup,
 * dan memasangnya satu-satu berarti mengetik ID yang sama berkali-kali, yang
 * satu ketikan melesetnya membuat satu lokasi melapor ke grup lain.
 */
export function WaKabupatenForm({
  packageId,
  baris,
}: {
  packageId: string;
  baris: BarisKabupaten[];
}) {
  const [state, action, pending] = useAksi<WaKabupatenState>(setWaGrupKabupatenAction, undefined);
  const [terbuka, setTerbuka] = useState<string | null>(null);

  if (baris.length === 0) {
    return (
      <p className="text-[12px] text-ink-muted">
        Paket ini belum punya lokasi aktif, jadi belum ada kabupaten yang bisa dipasangi grup.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {state?.warning ? <Banner tone="warning" title={state.warning} /> : null}

      <p className="text-[12px] text-ink-muted">
        Grup kabupaten hanya berlaku untuk lokasi paket INI. Kabupaten yang lokasinya juga ada di
        paket lain butuh grup tersendiri di paket itu – satu grup WhatsApp tidak boleh dipakai dua
        paket.
      </p>

      <ul className="divide-y divide-border rounded-md border border-border">
        {baris.map((b) => {
          const buka = terbuka === b.regency;
          return (
            <li key={b.regency} className="p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    <MapPin aria-hidden className="size-3.5 text-ink-muted" />
                    {b.regency}
                    <span className="font-normal text-ink-muted">· {b.jumlahLokasi} lokasi</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {b.chatId ? (
                      <>
                        {b.namaGrup ?? "Grup tertaut"}
                        {b.belumIkut > 0 ? (
                          <span className="text-warning-700">
                            {" "}
                            – {b.belumIkut} lokasi belum ikut, masih mengikuti grup paket
                          </span>
                        ) : null}
                      </>
                    ) : (
                      "Belum punya grup sendiri – seluruh lokasinya mengikuti grup paket."
                    )}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setTerbuka(buka ? null : b.regency)}
                >
                  {buka ? "Tutup" : b.chatId ? "Ubah" : "Pasang grup"}
                </Button>
              </div>

              {buka ? (
                <form action={action} className="mt-2 space-y-2 rounded-md bg-surface-muted p-2.5">
                  <input type="hidden" name="packageId" value={packageId} />
                  <input type="hidden" name="regency" value={b.regency} />
                  <div>
                    <Label htmlFor={`wa-${b.regency}`}>ID grup WhatsApp</Label>
                    <Input
                      id={`wa-${b.regency}`}
                      name="waGroupId"
                      defaultValue={b.chatId ?? ""}
                      placeholder="1203630…@g.us"
                      className="h-9"
                    />
                    <p className="mt-1 text-[11px] text-ink-muted">
                      Kosongkan lalu simpan untuk MELEPAS grup kabupaten ini – lokasinya kembali
                      mengikuti grup paket.
                    </p>
                  </div>
                  <Button type="submit" size="sm" loading={pending}>
                    Simpan untuk {b.jumlahLokasi} lokasi
                  </Button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
