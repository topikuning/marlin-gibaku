"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import { PhotoSourceInput } from "@/components/knmp/photo-source-input";
import { catatLuarRabAction, hapusLuarRabAction, type DailyActionState } from "@/lib/daily-report/actions";
import type { CatatanLuarRabLaporan } from "@/lib/daily-report/queries";
import { formatNumber, formatTanggal } from "@/lib/format";
import { useAksi } from "@/lib/aksi-klien";

/**
 * PEKERJAAN DI LUAR RAB (DECISIONS 738) di laporan harian.
 *
 * Untuk pekerjaan yang sudah dikerjakan tetapi itemnya belum ada di RAB maupun
 * di draft adendum. Dicatat apa adanya – uraian, volume, satuan, foto – TANPA
 * harga, dan tidak masuk progres. Site Manager yang memadankannya ke draft
 * adendum; di sini pelapor hanya melihat keadaannya.
 */
export function PekerjaanLuarRab({
  locationId,
  dateKey,
  reportId,
  catatan,
  bisaCatat,
  photoEnabled,
}: {
  locationId: string;
  dateKey: string;
  reportId: string | null;
  catatan: CatatanLuarRabLaporan[];
  /** Laporan masih Draft / Perlu Koreksi, pengguna boleh mengisi, dan hari ini tidak dinyatakan nihil. */
  bisaCatat: boolean;
  photoEnabled: boolean;
}) {
  const [buka, setBuka] = useState(false);
  if (!bisaCatat && catatan.length === 0) return null;
  return (
    /*
     * SENGAJA TIDAK SERUPA isian RAB (permintaan user 2026-11-05: *"kasih warna
     * highlight tertentu untuk memberikan kesadaran itu di luar rab. jangan
     * samakan persis dengan tampilan inputan rab"*). Ungu `luar-rab` di seluruh
     * bagian: latar, garis tepi kiri tebal, label DI LUAR RAB, dan tombol
     * simpannya. Isian RAB tetap putih-biru. DECISIONS 739.
     */
    <section
      className="space-y-3 rounded-lg border-2 border-l-8 border-luar-rab-border border-l-luar-rab bg-luar-rab-soft p-4"
      aria-labelledby="luar-rab-judul"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="inline-block rounded bg-luar-rab px-2 py-0.5 text-[11px] font-bold tracking-wide text-white uppercase">
            Di luar RAB
          </span>
          <h2 id="luar-rab-judul" className="mt-1.5 text-sm font-semibold text-luar-rab">
            Pekerjaan di luar RAB{catatan.length > 0 ? ` (${catatan.length})` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-ink">
            Untuk pekerjaan yang sudah dikerjakan tapi itemnya <strong>belum ada di RAB</strong> maupun draft adendum.
            Catat apa adanya dengan fotonya. Catatan ini <strong>tidak masuk progres</strong> – Site Manager yang
            memasukkannya ke draft adendum.
          </p>
        </div>
        {bisaCatat && !buka ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="border-luar-rab-border text-luar-rab"
            onClick={() => setBuka(true)}
          >
            Catat pekerjaan di luar RAB
          </Button>
        ) : null}
      </div>

      {bisaCatat && buka ? (
        photoEnabled ? (
          <FormCatat locationId={locationId} dateKey={dateKey} onTutup={() => setBuka(false)} />
        ) : (
          <p className="rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-sm text-ink">
            Catatan ini wajib berfoto, tetapi penyimpanan foto belum diaktifkan. Minta admin mengaktifkannya dulu.
          </p>
        )
      ) : null}

      {catatan.length > 0 ? (
        <ul className="divide-y divide-luar-rab-border overflow-hidden rounded-md border border-luar-rab-border bg-surface">
          {catatan.map((c) => (
            <BarisCatatan key={c.id} c={c} reportId={reportId} bisaHapus={bisaCatat} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function FormCatat({ locationId, dateKey, onTutup }: { locationId: string; dateKey: string; onTutup: () => void }) {
  const [state, formAction, pending] = useAksi<DailyActionState>(catatLuarRabAction, undefined);
  const [kunciFoto, setKunciFoto] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.success) return;
    const t = window.setTimeout(() => {
      formRef.current?.reset();
      setKunciFoto((k) => k + 1);
    }, 0);
    return () => window.clearTimeout(t);
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-md border border-luar-rab-border bg-surface p-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {state?.warning ? <Banner tone="warning" title="Sebagian foto tidak tersimpan" description={state.warning} /> : null}
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="dateKey" value={dateKey} />

      <div>
        <Label htmlFor="lr-uraian" required>
          Uraian pekerjaan
        </Label>
        <Input
          id="lr-uraian"
          name="uraian"
          required
          minLength={3}
          maxLength={300}
          placeholder="mis. Pasangan batu kali talud sisi timur"
          className="h-11 text-base sm:text-sm"
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <div>
          <Label htmlFor="lr-volume" required>
            Volume
          </Label>
          <Input
            id="lr-volume"
            name="volume"
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0.001"
            required
            placeholder="mis. 3,5"
            className="h-11 text-lg font-semibold tabular-nums"
          />
        </div>
        <div>
          <Label htmlFor="lr-satuan" required>
            Satuan
          </Label>
          <Input id="lr-satuan" name="satuan" required maxLength={20} placeholder="m3" className="h-11 text-base sm:text-sm" />
        </div>
      </div>

      <div>
        <Label required>Foto pekerjaan</Label>
        <PhotoSourceInput key={kunciFoto} latName="photoLat" lngName="photoLng" />
        <p className="mt-1 text-[11px] text-ink-muted">Wajib minimal satu foto – catatan tanpa foto tidak disimpan.</p>
      </div>

      <div>
        <label htmlFor="lr-catatan" className="text-[12px] text-ink-muted">
          Keterangan (opsional)
        </label>
        <Input
          id="lr-catatan"
          name="catatan"
          maxLength={500}
          placeholder="mis. diminta pengawas karena tanah longsor"
          className="mt-1 h-10 text-base sm:text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Ungu, bukan biru "Simpan Progres": yang ditekan di sini BUKAN progres. */}
        <Button
          type="submit"
          loading={pending}
          className="h-11 bg-luar-rab hover:bg-luar-rab/90 active:bg-luar-rab disabled:bg-luar-rab/60"
        >
          Simpan catatan di luar RAB
        </Button>
        <Button type="button" variant="ghost" onClick={onTutup} disabled={pending}>
          Tutup
        </Button>
      </div>
    </form>
  );
}

const fmtWaktu = (iso: string) => formatTanggal(new Date(iso), "d MMM yyyy");

function BarisCatatan({ c, reportId, bisaHapus }: { c: CatatanLuarRabLaporan; reportId: string | null; bisaHapus: boolean }) {
  const [state, formAction, pending] = useAksi<DailyActionState>(hapusLuarRabAction, undefined);
  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{c.uraian}</div>
          <div className="mt-0.5 text-xs text-ink-muted tabular-nums">
            {formatNumber(c.volume)} {c.satuan}
            {c.dicatatOleh ? ` · dicatat ${c.dicatatOleh}` : ""}
          </div>
          {c.catatan ? <div className="mt-0.5 text-xs text-ink-faint">“{c.catatan}”</div> : null}
          <StatusCatatan c={c} />
        </div>
        {bisaHapus && reportId && c.status === "tercatat" ? (
          <form
            action={formAction}
            onSubmit={(e) => {
              if (!window.confirm(`Hapus catatan "${c.uraian}"? Fotonya tetap di laporan ini.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="reportId" value={reportId} />
            <input type="hidden" name="catatanId" value={c.id} />
            <Button type="submit" variant="ghost" size="sm" loading={pending} aria-label={`Hapus catatan ${c.uraian}`}>
              <Trash2 aria-hidden className="size-4 text-danger" />
            </Button>
          </form>
        ) : null}
      </div>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {c.photos.length > 0 ? <PhotoGallery photos={c.photos} thumbClass="h-14 w-14" /> : null}
    </li>
  );
}

function StatusCatatan({ c }: { c: CatatanLuarRabLaporan }) {
  if (c.status === "dibatalkan" && c.batal) {
    return (
      <p className="mt-1 rounded bg-surface-inset px-2 py-1 text-[12px] text-ink-muted">
        Dibatalkan{c.batal.oleh ? ` oleh ${c.batal.oleh}` : ""} ({fmtWaktu(c.batal.pada)}): {c.batal.alasan}
      </p>
    );
  }
  if (c.status === "dipadankan" && c.padanan) {
    return (
      <p className="mt-1 inline-block rounded bg-success-soft px-2 py-0.5 text-[12px] font-medium text-ink">
        {c.padanan.resmi ? "Sudah resmi" : "Masuk draft adendum"}: {c.padanan.item}
        {c.padanan.oleh ? ` – oleh ${c.padanan.oleh}` : ""}
      </p>
    );
  }
  return (
    <p className="mt-1 inline-block rounded bg-warning-soft px-2 py-0.5 text-[12px] font-medium text-ink">
      Menunggu dipadankan
    </p>
  );
}
