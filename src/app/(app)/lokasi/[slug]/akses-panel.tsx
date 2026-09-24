"use client";

import { Badge, Banner, Button, Combobox, Label } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import {
  beriAksesLokasiAction,
  cabutAksesLokasiAction,
  type AksesActionState,
} from "./actions";

/**
 * SIAPA YANG PUNYA AKSES KE LOKASI INI — dan lewat jalan mana.
 *
 * Permintaan user 2026-09-13. Dua jalan akses dibedakan terang-terangan:
 * yang DITUGASKAN ke lokasi ini, dan yang bisa membukanya karena PERANNYA
 * lintas-lokasi. Menyamakan keduanya membuat orang mengira Program Director
 * "belum punya akses" lalu menugaskannya — menambah baris yang tidak menambah
 * hak apa pun.
 *
 * Tombol cabut hanya muncul pada yang lewat penugasan: peran lintas-lokasi
 * tidak bisa dicabut dari sini, dan menampilkan tombol yang pasti gagal lebih
 * buruk daripada tidak menampilkannya.
 */
export type BarisAksesUi = {
  userId: string;
  nama: string;
  peran: string;
  jalan: "penugasan" | "peran";
  aktif: boolean;
  waNumber: string | null;
  waTerverifikasi: boolean;
};

export function AksesPanel({
  locationId,
  slug,
  baris,
  calon,
  bolehKelola,
  eksekutifDisembunyikan,
}: {
  locationId: string;
  slug: string;
  baris: BarisAksesUi[];
  calon: { id: string; nama: string; peran: string }[];
  bolehKelola: boolean;
  /** Baris berperan Executive View disaring di server untuk peran ini. */
  eksekutifDisembunyikan: boolean;
}) {
  const [beriState, beri, beriPending] = useAksi<AksesActionState>(beriAksesLokasiAction, undefined);
  const [cabutState, cabut, cabutPending] = useAksi<AksesActionState>(cabutAksesLokasiAction, undefined);
  const state = beriState ?? cabutState;

  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      {/*
        CATATAN TETAP, TIDAK MENGHITUNG (ketetapan user 2026-09-24).

        Daftar yang memotong sesuatu tanpa berkata apa-apa akan terbaca
        LENGKAP — bahaya yang disebut doc `akses-lokasi.ts` sendiri. Tapi
        menyebut JUMLAH yang disembunyikan membocorkan justru yang
        disembunyikan: ada atau tidak ada akun eksekutif di lokasi ini. Karena
        itu kalimatnya tetap, ditulis baik ada maupun tidak ada akunnya.
      */}
      {eksekutifDisembunyikan ? (
        <p className="text-xs text-ink-muted">
          Akun Executive View tidak ditampilkan di daftar ini.
        </p>
      ) : null}

      {baris.length === 0 ? (
        <p className="text-sm text-ink-muted">Belum ada yang bisa membuka lokasi ini.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {baris.map((b) => (
            <li key={b.userId} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-ink">
                  {b.nama}
                  {!b.aktif ? <span className="ml-1.5 text-xs text-ink-faint">(nonaktif)</span> : null}
                </p>
                <p className="text-xs text-ink-muted">
                  {b.peran}
                  {b.jalan === "peran" ? " · lintas-lokasi" : ""}
                  {b.waNumber ? ` · ${b.waNumber}${b.waTerverifikasi ? " ✓" : " (belum diverifikasi)"}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  tone={b.jalan === "penugasan" ? "info" : "neutral"}
                  label={b.jalan === "penugasan" ? "Ditugaskan" : "Karena peran"}
                />
                {bolehKelola && b.jalan === "penugasan" ? (
                  <form action={cabut}>
                    <input type="hidden" name="locationId" value={locationId} />
                    <input type="hidden" name="userId" value={b.userId} />
                    <input type="hidden" name="slug" value={slug} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      loading={cabutPending}
                      disabled={beriPending}
                    >
                      Cabut
                    </Button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {bolehKelola ? (
        <form action={beri} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="slug" value={slug} />
          <div className="min-w-56 flex-1">
            <Label htmlFor="tambah-akses">Tambah pengguna ke lokasi ini</Label>
            <Combobox
              id="tambah-akses"
              name="userId"
              placeholder={calon.length ? "Cari nama…" : "Semua pengguna sudah punya akses"}
              disabled={calon.length === 0}
              options={calon.map((c) => ({ value: c.id, label: `${c.nama} – ${c.peran}` }))}
            />
          </div>
          <Button type="submit" size="sm" loading={beriPending} disabled={cabutPending || calon.length === 0}>
            Tambahkan
          </Button>
        </form>
      ) : null}
    </div>
  );
}
