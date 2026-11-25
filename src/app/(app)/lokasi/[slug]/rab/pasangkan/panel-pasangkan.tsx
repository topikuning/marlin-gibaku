"use client";

import { useState } from "react";
import { useAksi } from "@/lib/aksi-klien";
import { Badge, Banner, Button, Combobox, ConfirmSubmit, Label, Textarea } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import {
  ajukanPadananAktifAction,
  ajukanPadananLuarRabAction,
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
  /** `dipotong` = volume yang dipotong bila item ini dipilih (sisanya kurang). */
  calon: { value: string; label: string; dipotong: number }[];
  calonSisaKurang: number;
  terhalang: string | null;
};

/** Kelompok catatan pekerjaan di luar RAB yang menunggu (DECISIONS 780). */
export type LuarRabView = {
  kunci: string;
  uraian: string;
  satuan: string;
  satuanKunci: string | null;
  catatanIds: string[];
  volume: number;
  jumlahLaporan: number;
  rentang: string | null;
  tertahan: string | null;
  asalDraft: boolean;
  saran: string[];
  pilihan: string | null;
};

/** Item RAB aktif yang bisa menampung catatan – dikirim sekali, disaring per kelompok. */
export type CalonLuarView = { value: string; label: string; satuanKunci: string | null; sisa: number; unit: string | null };

export type UsulanView = {
  id: string;
  jenis: "hilang" | "dinolkan" | "luar_rab";
  namaLama: string;
  namaBaru: string;
  jalurBaru: string;
  unit: string | null;
  volume: number;
  dipotong: number;
  baris: number;
  catatan: number;
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

/** Peringatan pemotongan untuk item tujuan yang sisanya kurang (DECISIONS 780). */
function Dipotong({ dipotong, unit }: { dipotong: number; unit: string | null }) {
  if (dipotong <= 0) return null;
  return (
    <p className="text-xs text-warning">
      Sisa volume item ini kurang. {formatNumber(dipotong)}
      {sat(unit)} tidak ikut masuk: kelebihannya dipotong dibagi rata di laporan-laporannya, sama seperti saat adendum
      diaktifkan. Angka aslinya kembali bila pasangan dilepas.
    </p>
  );
}

export function BarisBelum({ slug, b, bolehAjukan }: { slug: string; b: BelumView; bolehAjukan: boolean }) {
  const [pilih, setPilih] = useState("");
  const [alasan, setAlasan] = useState("");
  const [state, action, pending] = useAksi<PasangkanState>(ajukanPadananAktifAction, undefined);
  const terpilih = b.calon.find((c) => c.value === pilih);
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
          {terpilih ? <Dipotong dipotong={terpilih.dipotong} unit={b.unit} /> : null}
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
          {b.calonSisaKurang > 0
            ? `${b.calonSisaKurang} item di kategori dan satuan yang sama sudah dilaporkan penuh, jadi tidak ada sisa untuk menampungnya. ` +
              `Naikkan volume item itu lewat adendum, lalu pasangkan.`
            : "Belum ada item di RAB aktif dengan kategori dan satuan yang sama."}
        </p>
      )}
      {b.calon.length > 0 && b.calonSisaKurang > 0 && !b.terhalang && bolehAjukan ? (
        <p className="text-xs text-ink-muted">{b.calonSisaKurang} item lain cocok tetapi sudah dilaporkan penuh, jadi tidak ditawarkan.</p>
      ) : null}
      <Kabar state={state} />
    </li>
  );
}

/* ── Catatan pekerjaan di luar RAB (DECISIONS 780) ─────────────────────── */

export function BarisLuarRab({
  slug,
  k,
  calon,
  bolehAjukan,
}: {
  slug: string;
  k: LuarRabView;
  calon: readonly CalonLuarView[];
  bolehAjukan: boolean;
}) {
  const [pilih, setPilih] = useState(k.pilihan ?? "");
  const [alasan, setAlasan] = useState("");
  const [state, action, pending] = useAksi<PasangkanState>(ajukanPadananLuarRabAction, undefined);
  // Satuan harus sama; satuan yang tidak diketahui cocok dengan apa pun.
  const cocok = calon.filter((c) => !k.satuanKunci || !c.satuanKunci || c.satuanKunci === k.satuanKunci);
  const disarankan = new Set(k.saran);
  const opsi = [
    ...k.saran.map((v) => cocok.find((c) => c.value === v)).filter((c): c is CalonLuarView => !!c),
    ...cocok.filter((c) => !disarankan.has(c.value)),
  ].map((c) => ({ value: c.value, label: disarankan.has(c.value) ? `${c.label} (disarankan)` : c.label }));
  const terpilih = cocok.find((c) => c.value === pilih);
  return (
    <li className="space-y-2 px-3 py-3 text-[13px]">
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="info">Di luar RAB</Badge>
          {k.asalDraft ? <span className="text-xs text-ink-muted">sebagian dari draft adendum yang diganti</span> : null}
        </div>
        <p className="font-medium text-ink">{k.uraian}</p>
        {k.catatanIds.length > 0 ? (
          <p className="text-ink-muted">
            {formatNumber(k.volume)}
            {sat(k.satuan)} dari {k.catatanIds.length} catatan di {k.jumlahLaporan} laporan
            {k.rentang ? ` (${k.rentang})` : ""}.
          </p>
        ) : null}
        {k.tertahan ? <p className="text-xs text-warning">{k.tertahan}</p> : null}
      </div>
      {!bolehAjukan || k.catatanIds.length === 0 ? null : opsi.length > 0 ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="luarRabIds" value={k.catatanIds.join(",")} />
          <input type="hidden" name="lineageBaru" value={pilih} />
          <div className="space-y-1">
            <Label htmlFor={`luar-${k.kunci}`}>Pasangkan ke item RAB aktif</Label>
            <Combobox
              id={`luar-${k.kunci}`}
              value={pilih}
              onChange={setPilih}
              options={opsi}
              placeholder="Pilih item tujuan…"
              disabled={pending}
            />
          </div>
          {terpilih ? <Dipotong dipotong={Math.max(0, Math.round((k.volume - terpilih.sisa) * 1000) / 1000)} unit={terpilih.unit ?? k.satuan} /> : null}
          <div className="space-y-1">
            <Label htmlFor={`alasan-luar-${k.kunci}`}>Alasan</Label>
            <Textarea
              id={`alasan-luar-${k.kunci}`}
              name="alasan"
              rows={2}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder="Mis. pekerjaan ini masuk item itu di adendum."
              disabled={pending}
            />
          </div>
          <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={!pilih || alasan.trim().length < 10}>
            Ajukan pemasangan
          </Button>
        </form>
      ) : (
        <p className="text-xs text-warning">
          Belum ada item di RAB aktif bersatuan {k.satuan} yang masih punya sisa volume. Naikkan volumenya lewat adendum, atau
          padankan catatan ini ke item draft adendum.
        </p>
      )}
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
        {sat(u.unit)}
        {u.jenis === "luar_rab"
          ? ` dari ${u.catatan} catatan di luar RAB, menjadi ${u.baris} baris laporan`
          : ` dari ${u.baris} baris laporan`}
        {u.jenis === "dinolkan" ? ", volumenya dipulihkan dari angka sebelum aktivasi" : ""}.
        {u.dipotong > 0 ? ` ${formatNumber(u.dipotong)}${sat(u.unit)} dipotong karena sisa volume item tujuan kurang.` : ""}
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
              (u.dipotong > 0 ? `${formatNumber(u.dipotong)}${sat(u.unit)} dipotong karena sisanya kurang. ` : "") +
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
              (u.jenis === "luar_rab"
                ? `Catatan "${u.namaLama}" kembali menunggu dipasangkan dan ${u.baris} baris laporannya dikembalikan seperti sebelum dipasangkan`
                : `${u.baris} baris laporan kembali ke "${u.namaLama}"` +
                  (u.jenis === "dinolkan" ? " dengan volume 0 seperti sesudah aktivasi" : " dan tidak terhitung lagi di progres")) +
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
