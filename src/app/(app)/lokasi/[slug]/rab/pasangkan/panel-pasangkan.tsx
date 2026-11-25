"use client";

import { useState } from "react";
import { useAksi } from "@/lib/aksi-klien";
import { Badge, Banner, Button, Combobox, ConfirmSubmit, Input, Label, Textarea } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { kunciSatuan } from "@/lib/rab/padanan-draft-aturan";
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
 *
 * DECISIONS 781: pilihan tujuannya SEMUA item pekerjaan RAB aktif, tanpa
 * saring satuan atau kategori; volume yang masuk diisi dalam satuan item
 * tujuan, paling banyak sebesar sisanya. Ketetapan user 2026-11-25: *"intinya
 * kasih saja semua list pekerjaan di RAB aktif, untuk dipadankan, satuan dsb
 * mengikuti rab aktif, hanya volume saja disesuaikan atau bisa diinput sesuai
 * sisa."*
 */

/** Item pekerjaan RAB aktif – dikirim sekali untuk seluruh halaman (781). */
export type CalonView = {
  value: string;
  label: string;
  name: string;
  unit: string | null;
  /** Kode kategori (akar kunci). */
  akar: string;
  sisa: number;
};

export type BelumView = {
  lineageKey: string;
  name: string;
  unit: string | null;
  akar: string;
  jalur: string;
  kategori: string;
  jenis: "hilang" | "dinolkan";
  volume: number;
  jumlahLaporan: number;
  rentang: string | null;
  keterangan: string;
  saran: string[];
  pilihan: string | null;
  terhalang: string | null;
};

/** Kelompok catatan pekerjaan di luar RAB yang menunggu (DECISIONS 780). */
export type LuarRabView = {
  kunci: string;
  uraian: string;
  satuan: string;
  catatanIds: string[];
  volume: number;
  jumlahLaporan: number;
  rentang: string | null;
  tertahan: string | null;
  asalDraft: boolean;
  saran: string[];
  pilihan: string | null;
};

export type UsulanView = {
  id: string;
  jenis: "hilang" | "dinolkan" | "luar_rab";
  namaLama: string;
  namaBaru: string;
  jalurBaru: string;
  unit: string | null;
  volume: number;
  volumeAsal: number;
  unitAsal: string | null;
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
const bulat3 = (v: number) => Math.round(v * 1000) / 1000;

/** Satuan dianggap sama bila bentuk bakunya sama, atau salah satunya tidak diketahui (sama dengan layanannya). */
function satuanSama(a: string | null, b: string | null): boolean {
  const ka = kunciSatuan(a);
  const kb = kunciSatuan(b);
  return ka == null || kb == null || ka === kb;
}

function Kabar({ state }: { state: PasangkanState }) {
  if (state?.error) return <Banner tone="error" title={state.error} />;
  if (state?.success) return <Banner tone="success" title={state.success} />;
  return null;
}

/**
 * Formulir tujuan bersama: pilih item RAB aktif (semua), isi volume yang
 * masuk, tulis alasan. Bawaan volume = volume asal bila satuannya sama,
 * dibatasi sisa; beda satuan dibiarkan kosong supaya diisi orang.
 */
function FormTujuan({
  id,
  calon,
  saran,
  pilihan,
  kecuali,
  asal,
  tersembunyi,
  aksi,
}: {
  id: string;
  calon: readonly CalonView[];
  saran: readonly string[];
  pilihan: string | null;
  kecuali: string | null;
  asal: { volume: number; unit: string | null; akar: string | null };
  tersembunyi: Record<string, string>;
  aksi: (prev: PasangkanState, fd: FormData) => Promise<PasangkanState>;
}) {
  const bawaan = (v: string) => {
    const c = calon.find((x) => x.value === v);
    if (!c || !satuanSama(asal.unit, c.unit)) return "";
    return String(bulat3(Math.min(asal.volume, c.sisa)));
  };
  const [pilih, setPilih] = useState(pilihan ?? "");
  const [volume, setVolume] = useState(() => bawaan(pilihan ?? ""));
  const [alasan, setAlasan] = useState("");
  const [state, action, pending] = useAksi<PasangkanState>(aksi, undefined);

  const disarankan = new Set(saran);
  const semua = calon.filter((c) => c.value !== kecuali);
  const opsi = [
    ...saran.map((v) => semua.find((c) => c.value === v)).filter((c): c is CalonView => !!c),
    ...semua.filter((c) => !disarankan.has(c.value)),
  ].map((c) => ({ value: c.value, label: disarankan.has(c.value) ? `${c.label} (disarankan)` : c.label }));
  const t = semua.find((c) => c.value === pilih);
  const angka = volume.trim() === "" ? null : Number(volume.replace(",", "."));
  const sama = t ? satuanSama(asal.unit, t.unit) : true;
  const melebihi = t != null && angka != null && angka > t.sisa + 0.0005;
  const sah = !!t && angka != null && Number.isFinite(angka) && angka >= 0 && !melebihi;

  return (
    <form action={action} className="space-y-2">
      {Object.entries(tersembunyi).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="lineageBaru" value={pilih} />
      <div className="space-y-1">
        <Label htmlFor={`tujuan-${id}`}>Pasangkan ke item RAB aktif</Label>
        <Combobox
          id={`tujuan-${id}`}
          value={pilih}
          onChange={(v) => {
            setPilih(v);
            setVolume(bawaan(v));
          }}
          options={opsi}
          placeholder="Pilih item tujuan…"
          disabled={pending}
        />
      </div>
      {t ? (
        <div className="space-y-1">
          <Label htmlFor={`volume-${id}`}>Volume yang masuk{t.unit ? ` (${t.unit})` : ""}</Label>
          <Input
            id={`volume-${id}`}
            name="volume"
            type="number"
            inputMode="decimal"
            min={0}
            max={t.sisa}
            step="0.001"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            invalid={melebihi}
            disabled={pending}
          />
          <p className="text-xs text-ink-muted">
            Sisa item ini {formatNumber(t.sisa)}
            {sat(t.unit)}. Dicatat {formatNumber(asal.volume)}
            {sat(asal.unit)}.
          </p>
          {melebihi ? (
            <p className="text-xs text-danger">
              Melebihi sisa. Paling banyak {formatNumber(t.sisa)}
              {sat(t.unit)}.
            </p>
          ) : null}
          {!sama ? (
            <p className="text-xs text-warning">
              Satuannya beda: dicatat dalam {asal.unit}, item ini dalam {t.unit}. Isi volumenya dalam {t.unit}.
            </p>
          ) : angka != null && !melebihi && angka < asal.volume - 0.0005 ? (
            <p className="text-xs text-warning">
              {formatNumber(bulat3(asal.volume - angka))}
              {sat(t.unit)} tidak ikut masuk. Angka aslinya kembali bila pasangan dilepas.
            </p>
          ) : null}
          {t.sisa <= 0.0005 ? (
            <p className="text-xs text-warning">
              Sisa item ini 0. Laporannya hanya dipetakan ke item ini; volumenya 0 dan progres tidak bertambah.
            </p>
          ) : null}
          {asal.akar != null && t.akar !== asal.akar ? (
            <p className="text-xs text-ink-muted">Beda kategori: realisasinya pindah ke kategori item ini di blanko KKP.</p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor={`alasan-${id}`}>Alasan</Label>
        <Textarea
          id={`alasan-${id}`}
          name="alasan"
          rows={2}
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="Mis. pekerjaan ini masuk item itu di adendum."
          disabled={pending}
        />
      </div>
      <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={!sah || alasan.trim().length < 10}>
        Ajukan pemasangan
      </Button>
      <Kabar state={state} />
    </form>
  );
}

/* ── Belum dipasangkan ─────────────────────────────────────────────────── */

export function BarisBelum({
  slug,
  b,
  calon,
  bolehAjukan,
}: {
  slug: string;
  b: BelumView;
  calon: readonly CalonView[];
  bolehAjukan: boolean;
}) {
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
      ) : bolehAjukan ? (
        <FormTujuan
          id={b.lineageKey}
          calon={calon}
          saran={b.saran}
          pilihan={b.pilihan}
          kecuali={b.lineageKey}
          asal={{ volume: b.volume, unit: b.unit, akar: b.akar }}
          tersembunyi={{ slug, lineageLama: b.lineageKey }}
          aksi={ajukanPadananAktifAction}
        />
      ) : null}
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
  calon: readonly CalonView[];
  bolehAjukan: boolean;
}) {
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
      {bolehAjukan && k.catatanIds.length > 0 ? (
        <FormTujuan
          id={`luar-${k.kunci}`}
          calon={calon}
          saran={k.saran}
          pilihan={k.pilihan}
          kecuali={null}
          asal={{ volume: k.volume, unit: k.satuan, akar: null }}
          tersembunyi={{ slug, luarRabIds: k.catatanIds.join(",") }}
          aksi={ajukanPadananLuarRabAction}
        />
      ) : null}
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
        {sat(u.unit)} masuk
        {u.jenis === "luar_rab"
          ? ` dari ${u.catatan} catatan di luar RAB, di ${u.baris} laporan`
          : ` dari ${u.baris} laporan`}
        {` (dicatat ${formatNumber(u.volumeAsal)}${sat(u.unitAsal)}${u.jenis === "dinolkan" ? " sebelum dinolkan" : ""})`}.
        {u.dipotong > 0 ? ` ${formatNumber(u.dipotong)}${sat(u.unit)} tidak ikut masuk.` : ""}
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
              (u.dipotong > 0 ? `${formatNumber(u.dipotong)}${sat(u.unit)} tidak ikut masuk. ` : "") +
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
                : `Laporan di ${u.baris} tanggal kembali ke "${u.namaLama}"` +
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
