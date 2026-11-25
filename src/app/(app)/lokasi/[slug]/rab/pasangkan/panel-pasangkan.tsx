"use client";

import { useState } from "react";
import { useAksi } from "@/lib/aksi-klien";
import { Badge, Banner, Button, Combobox, ConfirmSubmit, Label, Textarea } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import {
  ajukanPadananAktifAction,
  lepasPadananAktifAction,
  setujuiPadananAktifAction,
  tutupPadananAktifAction,
  type PasangkanState,
} from "./actions";

/**
 * MENU "PASANGKAN REALISASI" (DECISIONS 777) – bagian yang bisa ditekan.
 *
 * Tiap baris punya formulir dan status prosesnya sendiri: menekan satu tombol
 * tidak boleh membuat seluruh daftar berputar (DECISIONS 751).
 */

export type BelumView = {
  lineageKey: string;
  name: string;
  unit: string | null;
  jalur: string;
  kategori: string;
  jenis: "hilang" | "dinolkan";
  volume: number;
  jumlahLaporan: number;
  rentang: string | null;
  keterangan: string;
  calon: { value: string; label: string }[];
  calonSisaKurang: number;
  terhalang: string | null;
};

export type UsulanView = {
  id: string;
  jenis: "hilang" | "dinolkan";
  namaLama: string;
  namaBaru: string;
  jalurBaru: string;
  unit: string | null;
  volume: number;
  baris: number;
  alasan: string;
  diajukan: string;
  suara: string[];
  kurang: string[];
  revisiBerganti: boolean;
  /** Untuk riwayat: "Berlaku 3 Nov 2026", "Ditolak: …", "Dilepas: …". */
  keterangan: string | null;
  sudahSaya: boolean;
};

const sat = (u: string | null) => (u ? ` ${u}` : "");

function Kabar({ state }: { state: PasangkanState }) {
  if (state?.error) return <Banner tone="error" title={state.error} />;
  if (state?.success) return <Banner tone="success" title={state.success} />;
  return null;
}

/* ── Belum dipasangkan ─────────────────────────────────────────────────── */

export function BarisBelum({ slug, b, bolehAjukan }: { slug: string; b: BelumView; bolehAjukan: boolean }) {
  const [pilih, setPilih] = useState("");
  const [alasan, setAlasan] = useState("");
  const [state, action, pending] = useAksi<PasangkanState>(ajukanPadananAktifAction, undefined);
  return (
    <li className="space-y-2 px-3 py-3 text-[13px]">
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={b.jenis === "dinolkan" ? "warning" : "neutral"}>{b.jenis === "dinolkan" ? "Dinolkan" : "Hilang"}</Badge>
          {b.jalur ? <span className="text-xs text-ink-muted">{b.jalur}</span> : null}
        </div>
        <p className="font-medium text-ink">{b.name}</p>
        <p className="text-ink-muted">
          {formatNumber(b.volume)}
          {sat(b.unit)} di {b.jumlahLaporan} laporan{b.rentang ? ` (${b.rentang})` : ""}. {b.keterangan}.
        </p>
      </div>
      {b.terhalang ? (
        <p className="text-xs text-warning">{b.terhalang}</p>
      ) : !bolehAjukan ? null : b.calon.length > 0 ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="lineageLama" value={b.lineageKey} />
          <input type="hidden" name="lineageBaru" value={pilih} />
          <div className="space-y-1">
            <Label htmlFor={`tujuan-${b.lineageKey}`}>Pasangkan ke item RAB aktif</Label>
            <Combobox
              id={`tujuan-${b.lineageKey}`}
              value={pilih}
              onChange={setPilih}
              options={b.calon}
              placeholder="Pilih item tujuan…"
              disabled={pending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`alasan-${b.lineageKey}`}>Alasan</Label>
            <Textarea
              id={`alasan-${b.lineageKey}`}
              name="alasan"
              rows={2}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder="Mis. pekerjaannya sama, namanya berubah di adendum."
              disabled={pending}
            />
          </div>
          <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={!pilih || alasan.trim().length < 10}>
            Ajukan pemasangan
          </Button>
        </form>
      ) : (
        <p className="text-xs text-warning">
          Belum ada item di RAB aktif yang bisa menampungnya: kategori dan satuannya harus sama, dan sisa volumenya cukup.
          {b.calonSisaKurang > 0 ? ` ${b.calonSisaKurang} item cocok tetapi sisa volumenya kurang.` : ""}
        </p>
      )}
      {b.calon.length > 0 && b.calonSisaKurang > 0 && !b.terhalang && bolehAjukan ? (
        <p className="text-xs text-ink-muted">{b.calonSisaKurang} item lain cocok tetapi sisa volumenya kurang, jadi tidak ditawarkan.</p>
      ) : null}
      <Kabar state={state} />
    </li>
  );
}

/* ── Menunggu persetujuan ──────────────────────────────────────────────── */

function Ringkas({ u }: { u: UsulanView }) {
  return (
    <div className="space-y-0.5">
      <p className="font-medium text-ink">
        {u.namaLama} → {u.namaBaru}
      </p>
      <p className="text-ink-muted">
        {u.jalurBaru ? `${u.jalurBaru} · ` : ""}
        {formatNumber(u.volume)}
        {sat(u.unit)} dari {u.baris} baris laporan
        {u.jenis === "dinolkan" ? ", volumenya dipulihkan dari angka sebelum aktivasi" : ""}.
      </p>
      <p className="text-ink-muted">
        Alasan: {u.alasan} <span className="text-xs">({u.diajukan})</span>
      </p>
    </div>
  );
}

export function KartuMenunggu({
  u,
  bolehSetujui,
  bolehKelola,
}: {
  u: UsulanView;
  bolehSetujui: boolean;
  bolehKelola: boolean;
}) {
  const [setuju, aksiSetuju, sibukSetuju] = useAksi<PasangkanState>(setujuiPadananAktifAction, undefined);
  const [tutup, aksiTutup, sibukTutup] = useAksi<PasangkanState>(tutupPadananAktifAction, undefined);
  const [alasan, setAlasan] = useState("");
  const bisaTutup = bolehSetujui || bolehKelola;
  return (
    <li className="space-y-2 px-3 py-3 text-[13px]">
      <Ringkas u={u} />
      <p className="text-xs text-ink-muted">
        {u.suara.length > 0 ? `Sudah disetujui: ${u.suara.join(", ")}. ` : ""}
        {u.kurang.length > 0 ? `Menunggu ${u.kurang.join(" dan ")}.` : ""}
      </p>
      {u.revisiBerganti ? (
        <p className="text-xs text-warning">RAB aktif sudah berganti sejak usulan ini diajukan. Batalkan, lalu ajukan ulang.</p>
      ) : null}
      {bolehSetujui && !u.sudahSaya && !u.revisiBerganti ? (
        <form action={aksiSetuju}>
          <input type="hidden" name="padananId" value={u.id} />
          <ConfirmSubmit
            label="Setujui"
            title="Setujui pemasangan ini?"
            description={
              `${formatNumber(u.volume)}${sat(u.unit)} dari "${u.namaLama}" masuk ke "${u.namaBaru}". ` +
              `Kalau persetujuan Anda melengkapi dua kursi, pemasangan langsung berlaku dan progres berubah. ` +
              `Semua syarat diperiksa ulang saat itu.`
            }
            variant="primary"
            loading={sibukSetuju}
          />
        </form>
      ) : bolehSetujui && u.sudahSaya ? (
        <p className="text-xs text-ink-muted">Anda sudah menyetujui usulan ini.</p>
      ) : null}
      <Kabar state={setuju} />
      {bisaTutup ? (
        <form action={aksiTutup} className="space-y-2">
          <input type="hidden" name="padananId" value={u.id} />
          <div className="space-y-1">
            <Label htmlFor={`tutup-${u.id}`}>Alasan menolak atau membatalkan</Label>
            <Textarea
              id={`tutup-${u.id}`}
              name="alasan"
              rows={2}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              disabled={sibukTutup}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {bolehSetujui ? (
              <Button type="submit" name="cara" value="tolak" size="sm" variant="secondary" loading={sibukTutup} disabled={alasan.trim().length < 10}>
                Tolak
              </Button>
            ) : null}
            {bolehKelola ? (
              <Button type="submit" name="cara" value="batal" size="sm" variant="secondary" loading={sibukTutup} disabled={alasan.trim().length < 10}>
                Batalkan usulan
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
      <Kabar state={tutup} />
    </li>
  );
}

/* ── Sudah berlaku ─────────────────────────────────────────────────────── */

export function KartuBerlaku({ u, bolehKelola }: { u: UsulanView; bolehKelola: boolean }) {
  const [state, action, pending] = useAksi<PasangkanState>(lepasPadananAktifAction, undefined);
  const [alasan, setAlasan] = useState("");
  return (
    <li className="space-y-2 px-3 py-3 text-[13px]">
      <Ringkas u={u} />
      <p className="text-xs text-ink-muted">
        {u.keterangan}
        {u.suara.length > 0 ? ` · disetujui ${u.suara.join(", ")}` : ""}
      </p>
      {u.revisiBerganti ? (
        <p className="text-xs text-ink-muted">RAB aktif sudah berganti, jadi pasangan ini sudah jadi dasarnya dan tidak bisa dilepas.</p>
      ) : bolehKelola ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="padananId" value={u.id} />
          <div className="space-y-1">
            <Label htmlFor={`lepas-${u.id}`}>Alasan melepas</Label>
            <Textarea
              id={`lepas-${u.id}`}
              name="alasan"
              rows={2}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              disabled={pending}
            />
          </div>
          <ConfirmSubmit
            label="Lepas"
            title="Lepas pasangan ini?"
            description={
              `${u.baris} baris laporan kembali ke "${u.namaLama}"` +
              (u.jenis === "dinolkan" ? " dengan volume 0 seperti sesudah aktivasi" : " dan tidak terhitung lagi di progres") +
              `. Baris yang sudah diubah orang sesudah dipasangkan membuat pelepasan dibatalkan.`
            }
            variant="secondary"
            loading={pending}
          />
        </form>
      ) : null}
      <Kabar state={state} />
    </li>
  );
}
