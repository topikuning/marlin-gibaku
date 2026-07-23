"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Trash2, Plus } from "lucide-react";
import { Banner, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { FIELD_ACTIVITY_TYPES, FIELD_ACTIVITY_TYPE_LABEL } from "@/lib/field-activity/labels";
import {
  addActivityPhotosAction,
  createActivityAction,
  deleteActivityAction,
  finalizeActivityAction,
  type FieldActivityState,
} from "@/lib/field-activity/actions";

type Geo = { lat: number; lng: number } | null;

/** Rekam waktu ambil + koordinat GPS saat foto dipilih (dibakar ke gambar di server). */
function usePhotoCapture() {
  const [geo, setGeo] = useState<Geo>(null);
  const [takenAt, setTakenAt] = useState<string>("");
  const [previews, setPreviews] = useState<string[]>([]);
  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) {
      setPreviews([]);
      return;
    }
    const urls: string[] = [];
    for (let i = 0; i < Math.min(files.length, 6); i++) urls.push(URL.createObjectURL(files[i]));
    setPreviews(urls);
    setTakenAt(new Date().toISOString());
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setGeo(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
      );
    }
  }
  return { geo, takenAt, previews, setPreviews, onFiles };
}

/** Form buat kegiatan lapangan baru (draft) + foto awal. */
export function CreateActivityForm({ locationId, todayKey }: { locationId: string; todayKey: string }) {
  const [state, action, pending] = useActionState<FieldActivityState, FormData>(createActivityAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const { geo, takenAt, previews, setPreviews, onFiles } = usePhotoCapture();

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      setPreviews([]);
    }
  }, [state?.success, setPreviews]);

  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-ink">Catat kegiatan lapangan</h2>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {state?.warning ? <Banner tone="warning" title="Sebagian foto gagal" description={state.warning} /> : null}

      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="gpsLat" value={geo?.lat ?? ""} />
      <input type="hidden" name="gpsLng" value={geo?.lng ?? ""} />
      <input type="hidden" name="photoTakenAt" value={takenAt} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="fa-type" required>Jenis kegiatan</Label>
          <Select id="fa-type" name="type" defaultValue="rapat_pcm" required>
            {FIELD_ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>{FIELD_ACTIVITY_TYPE_LABEL[t]}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="fa-date" required>Tanggal</Label>
          <Input id="fa-date" type="date" name="activityDate" defaultValue={todayKey} required />
        </div>
      </div>

      <div>
        <Label htmlFor="fa-title" required>Judul / uraian singkat</Label>
        <Input id="fa-title" name="title" placeholder="mis. Rapat PCM & pengukuran awal" required maxLength={160} />
      </div>

      <div>
        <Label htmlFor="fa-notes">Catatan (opsional)</Label>
        <Textarea id="fa-notes" name="notes" rows={2} placeholder="Hasil/keputusan penting, kondisi lapangan…" maxLength={2000} />
      </div>

      <div>
        <Label htmlFor="fa-participants">Peserta / hadir (opsional)</Label>
        <Input id="fa-participants" name="participants" placeholder="mis. PPK, Konsultan Pengawas, Penyedia, Kades" maxLength={500} />
      </div>

      <div>
        <Label htmlFor="fa-photos">Foto dokumentasi</Label>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted hover:border-border-strong">
          <Camera aria-hidden className="size-4" />
          Ambil / pilih foto (maks 6)
          <input id="fa-photos" type="file" name="photos" accept="image/*" capture="environment" multiple className="sr-only" onChange={onFiles} />
        </label>
        {previews.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {previews.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- preview lokal (objectURL) sebelum unggah
              <img key={i} src={src} alt="" className="h-16 w-16 rounded-md border border-border object-cover" />
            ))}
          </div>
        ) : null}
      </div>

      <Button type="submit" loading={pending}>Simpan kegiatan</Button>
    </form>
  );
}

/** Tombol aksi untuk kegiatan draft: tambah foto · finalkan · hapus. */
export function DraftActions({ activityId }: { activityId: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <AddPhotoForm activityId={activityId} />
      <FinalizeButton activityId={activityId} />
      <DeleteButton activityId={activityId} />
    </div>
  );
}

function AddPhotoForm({ activityId }: { activityId: string }) {
  const [state, action, pending] = useActionState<FieldActivityState, FormData>(addActivityPhotosAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const { takenAt, onFiles } = usePhotoCapture();
  return (
    <form ref={formRef} action={action} className="inline-flex items-center gap-1">
      <input type="hidden" name="activityId" value={activityId} />
      <input type="hidden" name="photoTakenAt" value={takenAt} />
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-muted">
        <Plus aria-hidden className="size-3.5" />
        {pending ? "Mengunggah…" : "Tambah foto"}
        <input
          type="file"
          name="photos"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          onChange={(e) => {
            onFiles(e);
            if (e.target.files && e.target.files.length) formRef.current?.requestSubmit();
          }}
        />
      </label>
      {state?.error ? <span className="text-[12px] text-danger">{state.error}</span> : null}
      {state?.warning ? <span className="text-[12px] text-warning">{state.warning}</span> : null}
    </form>
  );
}

function FinalizeButton({ activityId }: { activityId: string }) {
  const [state, action, pending] = useActionState<FieldActivityState, FormData>(finalizeActivityAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="activityId" value={activityId} />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        <CheckCircle2 aria-hidden className="size-3.5" />
        Finalkan
      </Button>
      {state?.error ? <span className="ml-1 text-[12px] text-danger">{state.error}</span> : null}
    </form>
  );
}

function DeleteButton({ activityId }: { activityId: string }) {
  const [state, action, pending] = useActionState<FieldActivityState, FormData>(deleteActivityAction, undefined);
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(true)}>
        <Trash2 aria-hidden className="size-3.5" />
        Hapus
      </Button>
    );
  }
  return (
    <form action={action} className="inline-flex items-center gap-1">
      <input type="hidden" name="activityId" value={activityId} />
      <Button type="submit" size="sm" variant="danger" loading={pending}>Yakin hapus?</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>Batal</Button>
      {state?.error ? <span className="text-[12px] text-danger">{state.error}</span> : null}
    </form>
  );
}
