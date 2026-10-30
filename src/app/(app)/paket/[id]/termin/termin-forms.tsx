"use client";

import { useState } from "react";
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
  type SuratPenyediaState,
} from "@/lib/surat-penyedia/actions";

/** Surat berkop penyedia – formulir halaman Termin & Surat (DECISIONS 716). */

function Hasil({ state }: { state: SuratPenyediaState }) {
  if (state?.error) return <Banner tone="error" title={state.error} />;
  if (state?.success) return <Banner tone="success" title={state.success} />;
  return null;
}

export type BarisTermin = { terminKe: number; ambangPct: number | null; bayarPct: number | null; nilai: string | null };

export function JadwalTerminForm({ contractId, baris }: { contractId: string; baris: BarisTermin[] }) {
  const [state, action, pending] = useAksi<SuratPenyediaState>(simpanJadwalTerminAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <Hasil state={state} />
      <input type="hidden" name="contractId" value={contractId} />
      <div className="overflow-x-auto">
        <div className="grid min-w-[30rem] grid-cols-[5rem_1fr_1fr_1.4fr] items-center gap-x-3 gap-y-2 text-sm">
          <div className="text-[12px] font-medium text-ink-muted">Termin</div>
          <div className="text-[12px] font-medium text-ink-muted">Ditagih saat progres (%)</div>
          <div className="text-[12px] font-medium text-ink-muted">Dibayar (% nilai kontrak)</div>
          <div className="text-[12px] font-medium text-ink-muted">Nilai tagihan</div>
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
                aria-label={`Persen bayar termin ${b.terminKe}`}
                className="h-8"
              />
              <div className="tabular-nums text-ink">{b.nilai ?? <span className="text-ink-muted">–</span>}</div>
            </div>
          ))}
        </div>
      </div>
      <HelpText>
        Sesuai Syarat-Syarat Khusus Kontrak. Contoh: termin 1 ditagih saat progres 25% dan dibayar 20% nilai kontrak.
        Kosongkan baris termin yang tidak ada. Nilai tagihan dihitung dari nilai kontrak sesudah adendum.
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
      <div className="grid gap-3 sm:grid-cols-3">
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
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
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
}: {
  contractId: string;
  jenis: OpsiJenis[];
  termin: number[];
  /** Lampiran bawaan per `${jenis}:${termin}`. */
  lampiranBawaan: Record<string, string[]>;
  kepadaBawaan: string[];
  kotaBawaan: string;
  usulanNomor: string | null;
  hariIni: string;
}) {
  const [state, action, pending] = useAksi<SuratPenyediaState>(buatSuratAction, undefined);
  const [jenisDipilih, setJenis] = useState(jenis[0]?.value ?? "");
  const [terminDipilih, setTermin] = useState(String(termin[0] ?? ""));
  const lampiran = lampiranBawaan[`${jenisDipilih}:${terminDipilih}`] ?? [];
  return (
    <form action={action} className="space-y-3">
      <Hasil state={state} />
      <input type="hidden" name="contractId" value={contractId} />
      <div className="grid gap-3 sm:grid-cols-2">
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
          <Label htmlFor="tanggal">Tanggal surat</Label>
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
      <div className="grid gap-3 sm:grid-cols-2">
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
