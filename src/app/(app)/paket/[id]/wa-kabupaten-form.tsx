"use client";

import { useState, useTransition } from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import { listWaGroupsAction, type GrupDaftar } from "@/lib/waha/actions";
import { kataKunciKabupaten } from "@/lib/waha/cari-grup";
import { setWaGrupKabupatenAction, type WaKabupatenState } from "@/lib/waha/kabupaten-actions";
import { PemilihGrupWa } from "./pemilih-grup-wa";

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
 *
 * Sejak DECISIONS 747 grupnya juga bisa DIPILIH dari daftar yang bisa dicari –
 * dulu form ini hanya menerima ID yang diketik/ditempel. Kotak carinya terisi
 * nama kabupaten lebih dulu, karena itulah yang biasanya tertulis di nama grup.
 * Daftar dimuat SEKALI untuk semua baris.
 *
 * Kalimat "mengikuti grup paket" hanya dipakai kalau grup paketnya ADA. Kalau
 * tidak, lokasi tanpa grup kabupaten tidak mengikuti apa pun – dan menyebutnya
 * "mengikuti grup paket" menyembunyikan bahwa kirimannya tidak punya tujuan.
 */
export function WaKabupatenForm({
  packageId,
  baris,
  adaGrupPaket,
  wahaConfigured,
}: {
  packageId: string;
  baris: BarisKabupaten[];
  adaGrupPaket: boolean;
  wahaConfigured: boolean;
}) {
  const [state, action, pending] = useAksi<WaKabupatenState>(setWaGrupKabupatenAction, undefined);
  const [terbuka, setTerbuka] = useState<string | null>(null);
  const [isianId, setIsianId] = useState("");
  const [isianNama, setIsianNama] = useState("");

  const [groups, setGroups] = useState<GrupDaftar[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();

  const muatGrup = () => {
    setLoadErr(null);
    startLoad(async () => {
      const res = await listWaGroupsAction();
      if (res.ok) setGroups(res.groups);
      else setLoadErr(res.error);
    });
  };

  const bukaBaris = (b: BarisKabupaten) => {
    if (terbuka === b.regency) {
      setTerbuka(null);
      return;
    }
    setTerbuka(b.regency);
    setIsianId(b.chatId ?? "");
    setIsianNama(b.namaGrup ?? "");
  };

  const ikutPaket = adaGrupPaket
    ? "masih mengikuti grup paket"
    : "jadi belum punya tujuan kiriman karena paket belum punya grup paket";

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
        paket lain butuh grup tersendiri di paket itu. Satu grup WhatsApp tidak boleh dipakai untuk
        dua paket.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={muatGrup} loading={loading} disabled={!wahaConfigured}>
          <RefreshCw aria-hidden className="size-3.5" />
          {groups ? "Muat ulang daftar grup" : "Muat daftar grup dari WhatsApp"}
        </Button>
        {!wahaConfigured ? (
          <span className="text-[12px] text-ink-muted">Server WhatsApp belum diatur – isi ID grup manual.</span>
        ) : null}
      </div>
      {loadErr ? (
        <Banner
          tone="warning"
          title="Belum bisa memuat daftar grup"
          description={`${loadErr} – sementara itu, isi ID grup manual.`}
        />
      ) : null}

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
                          <span className="text-warning">
                            {" "}
                            · {b.belumIkut} lokasi belum ikut, {ikutPaket}
                          </span>
                        ) : null}
                      </>
                    ) : adaGrupPaket ? (
                      "Belum punya grup sendiri, jadi semua lokasinya mengikuti grup paket."
                    ) : (
                      <span className="text-warning">
                        Belum punya grup, dan paket belum punya grup paket – lokasinya belum punya tujuan kiriman.
                      </span>
                    )}
                  </p>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => bukaBaris(b)}>
                  {buka ? "Tutup" : b.chatId ? "Ubah" : "Pasang grup"}
                </Button>
              </div>

              {buka ? (
                <form action={action} className="mt-2 space-y-2 rounded-md bg-surface-muted p-2.5">
                  <input type="hidden" name="packageId" value={packageId} />
                  <input type="hidden" name="regency" value={b.regency} />
                  <input type="hidden" name="waGroupName" value={isianNama} />

                  {groups ? (
                    groups.length === 0 ? (
                      <p className="text-[12px] text-ink-muted">
                        Tidak ada grup pada akun WhatsApp ini. Pastikan nomor pengirim sudah menjadi anggota
                        grup, atau isi ID grup manual di bawah.
                      </p>
                    ) : (
                      <PemilihGrupWa
                        groups={groups}
                        terpilih={isianId}
                        onPilih={(g) => {
                          setIsianId(g.id);
                          setIsianNama(g.name);
                        }}
                        kataAwal={kataKunciKabupaten(b.regency)}
                        idCari={`wa-cari-${b.regency}`}
                      />
                    )
                  ) : null}

                  <div>
                    <Label htmlFor={`wa-${b.regency}`}>ID grup WhatsApp</Label>
                    <Input
                      id={`wa-${b.regency}`}
                      name="waGroupId"
                      value={isianId}
                      onChange={(e) => {
                        setIsianId(e.target.value);
                        setIsianNama("");
                      }}
                      placeholder="1203630…@g.us"
                      className="h-9"
                    />
                    <p className="mt-1 text-[11px] text-ink-muted">
                      Untuk MELEPAS grup kabupaten ini, kosongkan isian lalu simpan.{" "}
                      {adaGrupPaket
                        ? "Lokasinya akan kembali mengikuti grup paket."
                        : "Sesudah itu lokasinya tidak punya tujuan kiriman, karena paket belum punya grup paket."}
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
