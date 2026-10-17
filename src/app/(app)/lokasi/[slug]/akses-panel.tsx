"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Badge, Banner, Button, Combobox, Input, Label, PanelGeser } from "@/components/ui";
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

/**
 * Berapa orang yang tampil di kartu sebelum "Lihat semua" (DECISIONS 685).
 *
 * Keluhan user 2026-10-17: kartu ini memanjang ke bawah di kolom samping
 * Kurva-S, satu baris per akun. Lima = yang ditugaskan lebih dulu (urutan
 * `aksesLokasi`), sama dengan kartu Kendala terbuka di halaman yang sama.
 * Daftar lengkap, pencarian, nomor WA, dan formulir tambah ada di panel geser.
 */
const BATAS_KARTU = 5;

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

  const [terbuka, setTerbuka] = useState(false);
  const buka = useCallback(() => setTerbuka(true), []);
  // Stabil: PanelGeser memasang ulang jebakan fokusnya tiap `onTutup` berganti.
  const tutup = useCallback(() => setTerbuka(false), []);

  const jumlahDitugaskan = baris.filter((b) => b.jalan === "penugasan").length;
  const jumlahPeran = baris.length - jumlahDitugaskan;
  const ringkasan = [
    `${baris.length} orang`,
    jumlahDitugaskan ? `${jumlahDitugaskan} ditugaskan` : null,
    jumlahPeran ? `${jumlahPeran} karena peran` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const terpotong = baris.length > BATAS_KARTU;

  const pesan = (
    <>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
    </>
  );

  /*
    CATATAN TETAP, TIDAK MENGHITUNG (ketetapan user 2026-09-24).

    Daftar yang memotong sesuatu tanpa berkata apa-apa akan terbaca
    LENGKAP — bahaya yang disebut doc `akses-lokasi.ts` sendiri. Tapi
    menyebut JUMLAH yang disembunyikan membocorkan justru yang
    disembunyikan: ada atau tidak ada akun eksekutif di lokasi ini. Karena
    itu kalimatnya tetap, ditulis baik ada maupun tidak ada akunnya.
  */
  const catatanEksekutif = eksekutifDisembunyikan ? (
    <p className="text-xs text-ink-muted">Akun Executive View tidak ditampilkan di daftar ini.</p>
  ) : null;

  const tombolCabut = (b: BarisAksesUi) =>
    bolehKelola && b.jalan === "penugasan" ? (
      <form action={cabut}>
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="userId" value={b.userId} />
        <input type="hidden" name="slug" value={slug} />
        <Button type="submit" size="sm" variant="ghost" loading={cabutPending} disabled={beriPending}>
          Cabut
        </Button>
      </form>
    ) : null;

  return (
    <div className="space-y-3">
      {pesan}
      {catatanEksekutif}

      {baris.length === 0 ? (
        <p className="text-sm text-ink-muted">Belum ada yang bisa membuka lokasi ini.</p>
      ) : (
        <>
          {/* Jumlahnya selalu disebut, supaya kartu yang terpotong tidak terbaca lengkap. */}
          <p className="text-xs text-ink-muted">{ringkasan}</p>
          <ul className="divide-y divide-border text-sm">
            {baris.slice(0, BATAS_KARTU).map((b) => (
              <BarisOrang key={b.userId} b={b} rinci={false} aksi={tombolCabut(b)} />
            ))}
          </ul>
        </>
      )}

      {terpotong || bolehKelola ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {terpotong ? (
            <Button type="button" size="sm" variant="secondary" onClick={buka}>
              {`Lihat semua ${baris.length} orang`}
            </Button>
          ) : null}
          {bolehKelola ? (
            <Button type="button" size="sm" variant="secondary" onClick={buka}>
              Tambah pengguna
            </Button>
          ) : null}
        </div>
      ) : null}

      <PanelGeser
        terbuka={terbuka}
        onTutup={tutup}
        title="Akses pengguna"
        subtitle={baris.length > 0 ? ringkasan : undefined}
      >
        <div className="space-y-3">
          {pesan}
          {catatanEksekutif}

          {/* Di atas, supaya "Tambah pengguna" di kartu langsung berujung di sini. */}
          {bolehKelola ? (
            <form action={beri} className="flex flex-wrap items-end gap-2 border-b border-border pb-3">
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

          {baris.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada yang bisa membuka lokasi ini.</p>
          ) : (
            <DaftarLengkap baris={baris} bisaDicari={terpotong} tombolCabut={tombolCabut} />
          )}
        </div>
      </PanelGeser>
    </div>
  );
}

/**
 * Daftar lengkap di panel. Kata carinya hidup di sini, jadi ikut kosong lagi
 * setiap panel ditutup — panel yang dibuka ulang tidak menyambut dengan daftar
 * yang masih tersaring dari kunjungan sebelumnya.
 */
function DaftarLengkap({
  baris,
  bisaDicari,
  tombolCabut,
}: {
  baris: BarisAksesUi[];
  bisaDicari: boolean;
  tombolCabut: (b: BarisAksesUi) => ReactNode;
}) {
  const [q, setQ] = useState("");
  const kata = q.trim().toLowerCase();
  const cocok = useMemo(
    () =>
      kata
        ? baris.filter((b) => [b.nama, b.peran, b.waNumber ?? ""].some((s) => s.toLowerCase().includes(kata)))
        : baris,
    [baris, kata],
  );

  return (
    <div className="space-y-2">
      {bisaDicari ? (
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama, peran, atau nomor WA…"
            className="pl-8"
            aria-label="Cari pengguna"
          />
        </div>
      ) : null}
      {kata ? (
        <p className="text-xs text-ink-muted">{`${cocok.length} dari ${baris.length} orang`}</p>
      ) : null}
      {cocok.length === 0 ? (
        <p className="py-2 text-sm text-ink-muted">Tidak ada yang cocok.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {cocok.map((b) => (
            <BarisOrang key={b.userId} b={b} rinci aksi={tombolCabut(b)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Satu orang. Di kartu (`rinci = false`) nomor WA tidak ikut: di kolom sempit
 * ia membuat tiap baris tiga tingkat, dan itulah yang memanjangkan kartunya.
 * Nomor beserta status verifikasinya tetap ada di panel.
 */
function BarisOrang({ b, rinci, aksi }: { b: BarisAksesUi; rinci: boolean; aksi: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="truncate text-ink">
          {b.nama}
          {!b.aktif ? <span className="ml-1.5 text-xs text-ink-faint">(nonaktif)</span> : null}
        </p>
        <p className={rinci ? "text-xs text-ink-muted" : "truncate text-xs text-ink-muted"}>
          {b.peran}
          {b.jalan === "peran" ? " · lintas-lokasi" : ""}
          {rinci && b.waNumber ? ` · ${b.waNumber}${b.waTerverifikasi ? " ✓" : " (belum diverifikasi)"}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge
          tone={b.jalan === "penugasan" ? "info" : "neutral"}
          label={b.jalan === "penugasan" ? "Ditugaskan" : "Karena peran"}
        />
        {aksi}
      </div>
    </li>
  );
}
