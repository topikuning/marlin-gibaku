"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Save } from "lucide-react";
import { useAksi } from "@/lib/aksi-klien";
import {
  Banner,
  Button,
  buttonClass,
  Combobox,
  ConfirmSubmit,
  HelpText,
  Input,
  Label,
  Textarea,
  TautanUnduh,
} from "@/components/ui";
import {
  buatSuratAction,
  hapusSuratAction,
  simpanDataSuratAction,
  simpanJadwalTerminAction,
  simpanProgresKonsultanAction,
  type SuratPenyediaState,
} from "@/lib/surat-penyedia/actions";

/** Surat berkop penyedia – formulir halaman Termin & Surat (DECISIONS 716/717). */

/** Daftar yang belum lengkap, masing-masing langsung menuju tempat mengisinya. */
export function DaftarKekurangan({ kurang }: { kurang: { teks: string; tempat: string; href: string }[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {kurang.map((k) => (
        <li key={`${k.teks}|${k.href}`}>
          {k.teks} –{" "}
          <Link href={k.href} className="font-medium text-primary underline underline-offset-2 hover:no-underline">
            isi di {k.tempat}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Hasil({ state }: { state: SuratPenyediaState }) {
  if (state?.error && state.kurang?.length)
    return <Banner tone="error" title={state.judul ?? state.error} description={<DaftarKekurangan kurang={state.kurang} />} />;
  if (state?.error) return <Banner tone="error" title={state.error} />;
  if (state?.success) return <Banner tone="success" title={state.success} />;
  return null;
}

export type BarisTermin = {
  terminKe: number;
  ambangPct: number | null;
  bayarPct: number | null;
  retensiPct: number | null;
  /** Teks nilai yang sudah dirakit server (rupiah dibayar + retensi). */
  nilai: string | null;
};

export function JadwalTerminForm({ contractId, baris }: { contractId: string; baris: BarisTermin[] }) {
  const [state, action, pending] = useAksi<SuratPenyediaState>(simpanJadwalTerminAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <Hasil state={state} />
      <input type="hidden" name="contractId" value={contractId} />
      <div className="overflow-x-auto">
        <div className="grid min-w-[36rem] grid-cols-[4.5rem_1fr_1fr_1fr_1.6fr] items-center gap-x-3 gap-y-2 text-sm">
          <div className="text-[12px] font-medium text-ink-muted">Termin</div>
          <div className="text-[12px] font-medium text-ink-muted">Ditagih saat progres (%)</div>
          <div className="text-[12px] font-medium text-ink-muted">Nilai termin (% kontrak)</div>
          <div className="text-[12px] font-medium text-ink-muted">Retensi ditahan (% kontrak)</div>
          <div className="text-[12px] font-medium text-ink-muted">Dibayar</div>
          {baris.map((b) => (
            <div key={b.terminKe} className="contents">
              <div className="font-medium text-ink">Termin {b.terminKe}</div>
              <Input
                name={`ambang${b.terminKe}`}
                inputMode="decimal"
                defaultValue={b.ambangPct ?? ""}
                aria-label={`Ambang progres termin ${b.terminKe}`}
                className="h-8"
              />
              <Input
                name={`bayar${b.terminKe}`}
                inputMode="decimal"
                defaultValue={b.bayarPct ?? ""}
                aria-label={`Persen nilai termin ${b.terminKe}`}
                className="h-8"
              />
              <Input
                name={`retensi${b.terminKe}`}
                inputMode="decimal"
                defaultValue={b.retensiPct ? b.retensiPct : ""}
                placeholder="0"
                aria-label={`Retensi termin ${b.terminKe}`}
                className="h-8"
              />
              <div className="tabular-nums text-ink">{b.nilai ?? <span className="text-ink-muted">–</span>}</div>
            </div>
          ))}
        </div>
      </div>
      <HelpText>
        Sesuai Syarat-Syarat Khusus Kontrak. Retensi dipotong dari termin itu dan bisa dicairkan dengan jaminan
        pemeliharaan. Kosongkan baris termin yang tidak ada. Kosongkan semua baris lalu simpan untuk kembali ke jadwal
        bawaan KKP.
      </HelpText>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        {pending ? null : <Save aria-hidden className="size-4" />}
        Simpan jadwal termin
      </Button>
    </form>
  );
}

export function DataSuratForm({
  contractId,
  awal,
}: {
  contractId: string;
  awal: { bankNama: string; bankRekening: string; bankAtasNama: string; polaNomorSurat: string; kotaSurat: string };
}) {
  const [state, action, pending] = useAksi<SuratPenyediaState>(simpanDataSuratAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <Hasil state={state} />
      <input type="hidden" name="contractId" value={contractId} />
      <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <div>
          <Label htmlFor="bankNama">Nama bank</Label>
          <Input id="bankNama" name="bankNama" defaultValue={awal.bankNama} placeholder="Bank BJB KC Bogor" />
        </div>
        <div>
          <Label htmlFor="bankRekening">Nomor rekening</Label>
          <Input id="bankRekening" name="bankRekening" defaultValue={awal.bankRekening} inputMode="numeric" />
        </div>
        <div>
          <Label htmlFor="bankAtasNama">Atas nama</Label>
          <Input id="bankAtasNama" name="bankAtasNama" defaultValue={awal.bankAtasNama} />
        </div>
      </div>
      <HelpText>Rekening penerima pembayaran termin paket ini. Dipakai di invoice dan kwitansi.</HelpText>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr] [&>*]:min-w-0">
        <div>
          <Label htmlFor="polaNomorSurat">Pola nomor surat perusahaan</Label>
          <Input
            id="polaNomorSurat"
            name="polaNomorSurat"
            defaultValue={awal.polaNomorSurat}
            placeholder="324.{urut}/SP/PF-KNMP-ATMP/{bulan}/{tahun}"
          />
          <HelpText>
            {"{urut}"} nomor urut surat tahun itu, {"{bulan}"} bulan Romawi, {"{tahun}"} tahun. Berlaku untuk semua paket
            perusahaan ini.
          </HelpText>
        </div>
        <div>
          <Label htmlFor="kotaSurat">Kota penulisan surat</Label>
          <Input id="kotaSurat" name="kotaSurat" defaultValue={awal.kotaSurat} placeholder="Bogor" />
        </div>
      </div>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        {pending ? null : <Save aria-hidden className="size-4" />}
        Simpan data surat
      </Button>
    </form>
  );
}

/* ── Progres dari laporan konsultan ─────────────────────────────────────── */

/** Satu minggu kontrak yang sudah berjalan, dengan realisasi kurva-S MARLIN-nya. */
export type PilihanMingguKlien = { mingguKe: number; rentang: string; pctTeks: string };

export type ProgresTerminKlien = {
  terminKe: number;
  ambangPct: number;
  /** Minggu pertama kurva-S MARLIN mencapai ambang termin ini; null = belum. */
  mingguTercapai: number | null;
  /** "26,6%" dst. sudah dirakit server. */
  ambangTeks: string;
  progresPct: number | null;
  mingguKe: number | null;
  diubah: string | null;
  tertimbangTeks: string | null;
  lokasi: {
    locationId: string;
    nama: string;
    nomor: string;
    tanggal: string | null;
    mingguKe: number | null;
    persen: number | null;
    marlinTeks: string;
    /** Pembanding Kawal (DECISIONS 724); null = lokasi tidak berpasangan / tanpa izin lihat Kawal. */
    kawal: { teks: string; beda: boolean } | null;
  }[];
};

/**
 * Pilihan minggu prestasi (DECISIONS 722): tiap minggu menyebut tanggalnya dan
 * realisasi kurva-S MARLIN; minggu pertama yang mencapai ambang ditandai dan
 * dipilih lebih dulu bila belum pernah diisi. Yang disimpan tetap pilihan orang.
 */
function PilihMingguPrestasi({ t, pilihan }: { t: ProgresTerminKlien; pilihan: PilihanMingguKlien[] }) {
  const [minggu, setMinggu] = useState(String(t.mingguKe ?? t.mingguTercapai ?? ""));
  return (
    <Combobox
      id="mingguKe"
      name="mingguKe"
      value={minggu}
      onChange={setMinggu}
      placeholder="Pilih minggu"
      options={pilihan.map((m) => ({
        value: String(m.mingguKe),
        label: `Minggu ke-${m.mingguKe} · ${m.rentang} · MARLIN ${m.pctTeks}${m.mingguKe === t.mingguTercapai ? ` · tercapai ${t.ambangTeks}` : ""}`,
      }))}
    />
  );
}

export function ProgresKonsultanForm({
  contractId,
  termin,
  hariIni,
  terminAwal,
  pilihanMinggu = [],
}: {
  contractId: string;
  termin: ProgresTerminKlien[];
  hariIni: string;
  /** Termin yang diminta tautan "isi di …" (`?termin=`); kosong = pilihan bawaan. */
  terminAwal?: number;
  /** Minggu yang sudah berjalan; kosong (belum SPMK/baseline) = kolom angka biasa. */
  pilihanMinggu?: PilihanMingguKlien[];
}) {
  const [state, action, pending] = useAksi<SuratPenyediaState>(simpanProgresKonsultanAction, undefined);
  // Termin dari tautan lebih dulu; selain itu termin pertama yang belum diisi, atau termin terakhir.
  const awal =
    termin.find((t) => t.terminKe === terminAwal) ??
    termin.find((t) => t.progresPct === null) ??
    termin[termin.length - 1];
  const [dipilih, setDipilih] = useState(String(awal?.terminKe ?? ""));
  const t = termin.find((x) => String(x.terminKe) === dipilih);
  if (!t) return null;
  const diBawahAmbang = t.progresPct !== null && t.progresPct < t.ambangPct;
  return (
    <form action={action} className="space-y-3">
      <Hasil state={state} />
      <input type="hidden" name="contractId" value={contractId} />
      <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <div>
          <Label htmlFor="terminProgres">Termin</Label>
          <Combobox
            id="terminProgres"
            name="terminKe"
            value={dipilih}
            onChange={setDipilih}
            options={termin.map((x) => ({
              value: String(x.terminKe),
              label: `Termin ${x.terminKe} (${x.ambangTeks})${x.progresPct === null ? " – belum diisi" : ""}`,
            }))}
            searchThreshold={99}
          />
        </div>
        <div key={`p${t.terminKe}`}>
          <Label htmlFor="progresPct">Progres keseluruhan (%)</Label>
          <Input id="progresPct" name="progresPct" inputMode="decimal" defaultValue={t.progresPct ?? ""} placeholder="mis. 26,6" />
        </div>
        <div key={`m${t.terminKe}`}>
          <Label htmlFor="mingguKe">Minggu prestasi tercapai</Label>
          {pilihanMinggu.length > 0 ? (
            <PilihMingguPrestasi t={t} pilihan={pilihanMinggu} />
          ) : (
            <Input id="mingguKe" name="mingguKe" inputMode="numeric" defaultValue={t.mingguKe ?? ""} placeholder="mis. 7" />
          )}
        </div>
      </div>
      {pilihanMinggu.length > 0 ? (
        <p className="text-[12px] text-ink-muted">
          {t.mingguTercapai
            ? `Menurut kurva-S MARLIN, ambang ${t.ambangTeks} tercapai di minggu ke-${t.mingguTercapai}. Pilih minggu lain bila laporan konsultan berbeda.`
            : `Kurva-S MARLIN belum mencapai ${t.ambangTeks} (terakhir ${pilihanMinggu[pilihanMinggu.length - 1].pctTeks} di minggu ke-${pilihanMinggu.length}).`}{" "}
          Minggu ini juga menjadi batas laporan dan Kurva S di berkas termin.
        </p>
      ) : null}
      {diBawahAmbang ? (
        <Banner
          tone="warning"
          title={`Progres ini belum mencapai ambang termin ${t.terminKe} (${t.ambangTeks})`}
          description="Surat permohonan pemeriksaan dan BA pembahasan kemajuan termin ini belum bisa dibuat."
        />
      ) : null}
      <div key={`l${t.terminKe}`} className="space-y-2">
        {t.lokasi.map((l) => (
          <div key={l.locationId} className="rounded-md border border-border p-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
              <div className="text-sm font-medium text-ink">{l.nama}</div>
              <div className="text-right text-[12px] text-ink-muted">
                <div>MARLIN: {l.marlinTeks}</div>
                {l.kawal ? (
                  <div className={l.kawal.beda ? "text-warning" : undefined}>Kawal (pengawas): {l.kawal.teks}</div>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1.2fr_0.8fr_0.8fr] [&>*]:min-w-0">
              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor={`nomor_${l.locationId}`}>Nomor laporan</Label>
                <Input id={`nomor_${l.locationId}`} name={`nomor_${l.locationId}`} defaultValue={l.nomor} placeholder="Boleh kosong" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor={`tanggal_${l.locationId}`}>Tanggal laporan</Label>
                <Input
                  id={`tanggal_${l.locationId}`}
                  name={`tanggal_${l.locationId}`}
                  type="date"
                  max={hariIni}
                  defaultValue={l.tanggal ?? ""}
                />
              </div>
              <div>
                <Label htmlFor={`minggu_${l.locationId}`}>Minggu ke-</Label>
                <Input
                  id={`minggu_${l.locationId}`}
                  name={`minggu_${l.locationId}`}
                  inputMode="numeric"
                  defaultValue={l.mingguKe ?? ""}
                  placeholder="Sama"
                />
              </div>
              <div>
                <Label htmlFor={`persen_${l.locationId}`}>Progres (%)</Label>
                <Input id={`persen_${l.locationId}`} name={`persen_${l.locationId}`} inputMode="decimal" defaultValue={l.persen ?? ""} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <HelpText>
        Diketik dari Laporan Kemajuan Pekerjaan konsultan pengawas dan dipakai apa adanya di surat. Angka MARLIN dihitung
        dari laporan harian yang dikirim sampai tanggal laporan konsultan itu.
        {t.tertimbangTeks ? ` Rata-rata tertimbang angka per lokasi di atas (bobot RAB MARLIN): ${t.tertimbangTeks}.` : ""}
        {t.diubah ? ` Terakhir diubah ${t.diubah}.` : ""}
      </HelpText>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        {pending ? null : <Save aria-hidden className="size-4" />}
        Simpan progres termin {t.terminKe}
      </Button>
    </form>
  );
}

/* ── Buat surat ─────────────────────────────────────────────────────────── */

export type OpsiJenis = { value: string; label: string };

export function BuatSuratForm({
  contractId,
  jenis,
  termin,
  lampiranBawaan,
  kepadaBawaan,
  kotaBawaan,
  usulanNomor,
  hariIni,
  rapatBawaan,
  jenisAwal,
  terminAwal,
}: {
  /** Pilihan awal dari tautan "Buat surat" halaman Penagihan. */
  jenisAwal?: string;
  terminAwal?: number;
  contractId: string;
  jenis: OpsiJenis[];
  termin: number[];
  /** Lampiran bawaan per `${jenis}:${termin}`. */
  lampiranBawaan: Record<string, string[]>;
  kepadaBawaan: string[];
  kotaBawaan: string;
  usulanNomor: string | null;
  hariIni: string;
  rapatBawaan: { pimpinan: string; peserta: string[]; cara: string };
}) {
  const [state, action, pending] = useAksi<SuratPenyediaState>(buatSuratAction, undefined);
  const [jenisDipilih, setJenis] = useState(jenis.find((j) => j.value === jenisAwal)?.value ?? jenis[0]?.value ?? "");
  const [terminDipilih, setTermin] = useState(String(termin.find((t) => t === terminAwal) ?? termin[0] ?? ""));
  const lampiran = lampiranBawaan[`${jenisDipilih}:${terminDipilih}`] ?? [];
  const ba = jenisDipilih === "ba_pembahasan_kemajuan";
  return (
    <form action={action} className="space-y-3">
      <Hasil state={state} />
      <input type="hidden" name="contractId" value={contractId} />
      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <div>
          <Label htmlFor="jenis">Jenis surat</Label>
          <Combobox id="jenis" name="jenis" value={jenisDipilih} onChange={setJenis} options={jenis} searchThreshold={99} />
        </div>
        <div>
          <Label htmlFor="terminKe">Termin</Label>
          <Combobox
            id="terminKe"
            name="terminKe"
            value={terminDipilih}
            onChange={setTermin}
            options={termin.map((t) => ({ value: String(t), label: `Termin ${t}` }))}
            searchThreshold={99}
          />
        </div>
        <div>
          <Label htmlFor="tanggal">{ba ? "Tanggal rapat" : "Tanggal surat"}</Label>
          <Input id="tanggal" name="tanggal" type="date" defaultValue={hariIni} />
        </div>
        <div>
          <Label htmlFor="kota">Kota</Label>
          <Input id="kota" name="kota" defaultValue={kotaBawaan} />
        </div>
      </div>
      <div>
        <Label htmlFor="nomor">Nomor surat</Label>
        <Input
          id="nomor"
          name="nomor"
          placeholder={usulanNomor ? `Kosongkan untuk nomor otomatis, mis. ${usulanNomor}` : "Ketik nomor surat"}
        />
        <HelpText>
          {usulanNomor
            ? "Kosong = nomor urut berikutnya dari pola nomor perusahaan. Diketik = dipakai apa adanya."
            : "Pola nomor perusahaan belum diatur, jadi nomornya diketik."}
        </HelpText>
      </div>
      {ba ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <div>
              <Label htmlFor="pimpinan">Rapat dipimpin oleh</Label>
              <Input id="pimpinan" name="pimpinan" defaultValue={rapatBawaan.pimpinan} />
            </div>
            <div>
              <Label htmlFor="cara">Cara rapat</Label>
              <Input id="cara" name="cara" defaultValue={rapatBawaan.cara} />
              <HelpText>Mis. &quot;di kantor PPK&quot; atau &quot;secara daring melalui zoom meeting&quot;.</HelpText>
            </div>
          </div>
          <div>
            <Label htmlFor="peserta">Peserta rapat</Label>
            <Textarea id="peserta" name="peserta" rows={5} defaultValue={rapatBawaan.peserta.join("\n")} />
            <HelpText>Satu baris satu peserta.</HelpText>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <div>
            <Label htmlFor="kepada">Kepada Yth</Label>
            <Textarea id="kepada" name="kepada" rows={4} defaultValue={kepadaBawaan.join("\n")} />
            <HelpText>Satu baris satu jabatan/instansi. &quot;di – Tempat&quot; ditambahkan otomatis.</HelpText>
          </div>
          <div>
            <Label htmlFor="lampiran">Lampiran</Label>
            <Textarea
              id="lampiran"
              name="lampiran"
              rows={4}
              key={`${jenisDipilih}:${terminDipilih}`}
              defaultValue={lampiran.join("\n")}
            />
            <HelpText>Satu baris satu lampiran. Kosongkan bila tidak ada.</HelpText>
          </div>
        </div>
      )}
      <Button type="submit" size="sm" loading={pending} disabled={!jenisDipilih || !terminDipilih}>
        {pending ? null : <FileText aria-hidden className="size-4" />}
        Buat surat
      </Button>
    </form>
  );
}

export function BarisSurat({
  id,
  judul,
  keterangan,
  bolehHapus,
}: {
  id: string;
  judul: string;
  keterangan: string;
  bolehHapus: boolean;
}) {
  const [state, action, pending] = useAksi<SuratPenyediaState>(hapusSuratAction, undefined);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{judul}</div>
        <div className="text-[12px] text-ink-muted">{keterangan}</div>
        {state?.error ? <div className="mt-1 text-[12px] text-danger">{state.error}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Satu baris aksi = satu gaya tombol (DECISIONS 592/603). */}
        <TautanUnduh href={`/api/surat-penyedia/${id}/pdf`} labelSibuk="Menyusun PDF…" className={buttonClass("secondary", "sm")}>
          Unduh PDF
        </TautanUnduh>
        <TautanUnduh href={`/api/surat-penyedia/${id}/docx`} labelSibuk="Menyusun Word…" className={buttonClass("secondary", "sm")}>
          Unduh Word
        </TautanUnduh>
        {bolehHapus ? (
          <form action={action}>
            <input type="hidden" name="suratId" value={id} />
            <ConfirmSubmit
              label="Hapus"
              title="Hapus surat ini?"
              description="Isian surat dihapus dari MARLIN. Berkas yang sudah diunduh tidak terpengaruh. Kalau ini surat bernomor otomatis yang terakhir tahun itu, nomornya dipakai lagi oleh surat berikutnya."
              variant="secondary"
              confirmVariant="danger"
              loading={pending}
            />
          </form>
        ) : null}
      </div>
    </li>
  );
}
