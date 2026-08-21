"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { tahanGagalKirim } from "@/lib/aksi-klien";
import { CheckCircle2, Download, FileText, MessageCircle, Paperclip, Pencil, RotateCcw, Trash2, Plus } from "lucide-react";
import { Banner, Button, Input, Label, Combobox, Textarea } from "@/components/ui";
import { PhotoSourceInput } from "@/components/knmp/photo-source-input";
import {
  AmbilDariKantong,
  PemilihKantong,
  TombolAmbilDariKantong,
} from "@/components/knmp/ambil-dari-kantong";
import { FinalizePanel } from "./finalize-panel";
import type { FieldActivityAttachmentView } from "@/lib/field-activity/queries";

/** Opsi jenis kegiatan (master data) yang dialirkan dari server ke form. */
export type ActivityKindOption = { key: string; label: string };
import {
  addActivityAttachmentsAction,
  addActivityPhotosAction,
  createActivityAction,
  deleteActivityAction,
  removeActivityAttachmentAction,
  reopenActivityAction,
  updateActivityAction,
  type FieldActivityState,
} from "@/lib/field-activity/actions";
import { sendActivityToWaAction, sendActivityPdfToWaAction, type WaActionState } from "@/lib/waha/actions";
import { formatTanggalWaktu } from "@/lib/format";
import { MAX_PHOTOS_PER_ACTIVITY } from "@/lib/photo-limits";

/**
 * Aksi dibungkus supaya POST yang gagal (unggahan foto/lampiran besar) jadi
 * PESAN di form, bukan halaman mati yang menghapus isian (DECISIONS 291).
 */
const buatKegiatan = tahanGagalKirim(createActivityAction);
const ubahKegiatan = tahanGagalKirim(updateActivityAction);
const tambahLampiran = tahanGagalKirim(addActivityAttachmentsAction);
const tambahFotoKegiatan = tahanGagalKirim(addActivityPhotosAction);
const hapusKegiatan = tahanGagalKirim(deleteActivityAction);
const bukaKegiatan = tahanGagalKirim(reopenActivityAction);
const kirimPdfWa = tahanGagalKirim(sendActivityPdfToWaAction);
const kirimKegiatanWa = tahanGagalKirim(sendActivityToWaAction);

/**
 * Tombol "Kirim PDF ke WhatsApp" — susun Laporan Kegiatan jadi dokumen PDF rapi
 * (teks + galeri foto) di server, lalu kirim ke grup WA paket (default) atau ke
 * nomor/ID tujuan bebas yang bisa dibuka. DECISIONS 124.
 */
export function SendPdfToWaButton({
  activityId,
  wahaConfigured,
  hasGroup,
  groupName,
}: {
  activityId: string;
  wahaConfigured: boolean;
  hasGroup: boolean;
  groupName: string | null;
}) {
  const [state, action, pending] = useActionState<WaActionState, FormData>(kirimPdfWa, undefined);
  const [customDest, setCustomDest] = useState(false);
  if (!wahaConfigured) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <form action={action} className="space-y-2">
        <input type="hidden" name="activityId" value={activityId} />
        {customDest ? (
          <div>
            <Label htmlFor={`pdf-dest-${activityId}`}>Tujuan lain (nomor WA atau ID grup)</Label>
            <Input
              id={`pdf-dest-${activityId}`}
              name="destChatId"
              placeholder="mis. 6281234567890 atau 12036...@g.us"
              maxLength={120}
            />
            <p className="mt-1 text-[12px] text-ink-muted">Kosongkan untuk kirim ke grup WA paket.</p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={!hasGroup && !customDest}>
            <FileText aria-hidden className="size-3.5" />
            Kirim PDF ke WhatsApp
          </Button>
          <button
            type="button"
            onClick={() => setCustomDest((v) => !v)}
            className="text-[12px] font-medium text-primary hover:underline"
          >
            {customDest ? "Kirim ke grup paket" : "Kirim ke tujuan lain…"}
          </button>
          {!customDest ? (
            hasGroup ? (
              groupName ? (
                <span className="text-[12px] text-ink-muted">Grup: {groupName}</span>
              ) : null
            ) : (
              <span className="text-[12px] text-ink-muted">Paket belum punya grup WA – pakai “tujuan lain”.</span>
            )
          ) : null}
        </div>
      </form>
    </div>
  );
}

/**
 * Tombol "Kirim ke WhatsApp" (1 klik) — kirim teks + semua foto + dokumen
 * kegiatan ke grup WA paket. Menampilkan status "sudah dikirim" bila pernah.
 */
export function SendToWaButton({
  activityId,
  wahaConfigured,
  hasGroup,
  groupName,
  sentAt,
}: {
  activityId: string;
  wahaConfigured: boolean;
  hasGroup: boolean;
  groupName: string | null;
  sentAt: string | null;
}) {
  const [state, action, pending] = useActionState<WaActionState, FormData>(kirimKegiatanWa, undefined);
  if (!wahaConfigured) return null;
  const disabled = !hasGroup;
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {state?.warning ? <Banner tone="warning" title="Sebagian lampiran gagal" description={state.warning} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <form action={action} className="inline">
          <input type="hidden" name="activityId" value={activityId} />
          <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={disabled}>
            <MessageCircle aria-hidden className="size-3.5" />
            {sentAt ? "Kirim ulang ke WhatsApp" : "Kirim ke WhatsApp"}
          </Button>
        </form>
        {sentAt ? (
          <span className="text-[12px] text-success">
            ✓ Terkirim {formatTanggalWaktu(new Date(sentAt))}
          </span>
        ) : null}
        {disabled ? (
          <span className="text-[12px] text-ink-muted">
            Paket belum punya grup WA – atur di halaman Paket.
          </span>
        ) : groupName ? (
          <span className="text-[12px] text-ink-muted">Grup: {groupName}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Data kegiatan yang bisa dikoreksi lewat form edit. */
export type EditableActivity = {
  id: string;
  /** Dipakai tombol "Rapikan dengan AI" (otorisasi per lokasi di server). */
  locationId: string;
  type: string;
  activityDate: string;
  title: string;
  notes: string | null;
  participants: string | null;
  kendala: string | null;
  solusi: string | null;
};


/** Label bagian kecil (uppercase) untuk mengelompokkan field form. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-bold tracking-wide text-ink-muted uppercase">{children}</p>
  );
}

/** Form buat kegiatan lapangan baru (draft) + foto awal. Info utama di atas,
 * kendala/tindak-lanjut opsional bisa dilipat, blok foto & dokumen terpisah. */
export function CreateActivityForm({
  locationId,
  todayKey,
  kinds,
}: {
  locationId: string;
  todayKey: string;
  kinds: ActivityKindOption[];
}) {
  const [state, action, pending] = useActionState<FieldActivityState, FormData>(buatKegiatan, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [photoKey, setPhotoKey] = useState(0);
  const [showOptional, setShowOptional] = useState(false);
  /** Foto kantong yang dipilih sebelum kegiatannya ada (DECISIONS 298). */
  const [kantong, setKantong] = useState<ReadonlySet<string>>(new Set());
  const [bukaKantong, setBukaKantong] = useState(false);

  useEffect(() => {
    if (!state?.success) return;
    // setState via timeout (bukan sinkron di effect) — patuh react-hooks/set-state-in-effect.
    const t = window.setTimeout(() => {
      formRef.current?.reset();
      setPhotoKey((k) => k + 1); // remount PhotoSourceInput → bersihkan pratinjau/pilihan
      // Kantong ikut dikosongkan: fotonya sudah TERPAKAI, memilihnya lagi
      // hanya akan gagal dan membuat pelapor mengira ada yang salah.
      setKantong(new Set());
      setBukaKantong(false);
    }, 0);
    return () => window.clearTimeout(t);
  }, [state?.success]);

  const resetForm = () => {
    formRef.current?.reset();
    setPhotoKey((k) => k + 1);
    setKantong(new Set());
    setBukaKantong(false);
  };

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {state?.warning ? <Banner tone="warning" title="Sebagian foto gagal" description={state.warning} /> : null}

      <input type="hidden" name="locationId" value={locationId} />

      <div>
        <SectionLabel>Informasi utama</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="fa-type" required>Jenis kegiatan</Label>
            <Combobox id="fa-type" name="type" defaultValue={kinds[0]?.key ?? ""} required>
              {kinds.map((k) => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </Combobox>
          </div>
          <div>
            <Label htmlFor="fa-date" required>Tanggal</Label>
            <Input id="fa-date" type="date" name="activityDate" defaultValue={todayKey} required />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="fa-title" required>Judul / uraian singkat</Label>
            <Input id="fa-title" name="title" placeholder="mis. Rapat PCM & pengukuran awal" required maxLength={160} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="fa-notes">Catatan / hasil penting</Label>
            <Textarea id="fa-notes" name="notes" rows={2} placeholder="Keputusan, kondisi lapangan, atau hasil kegiatan…" maxLength={2000} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="fa-participants">Peserta / hadir</Label>
            <Input id="fa-participants" name="participants" placeholder="mis. PPK, Konsultan Pengawas, Penyedia, Kades" maxLength={500} />
          </div>
        </div>
      </div>

      {/* Kendala & tindak lanjut — opsional, bisa dilipat. Field TETAP di DOM
          (disembunyikan via CSS) agar isian ikut terkirim walau terlipat. */}
      <div className="overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setShowOptional((v) => !v)}
          className="flex w-full items-center justify-between bg-surface-inset px-3 py-2.5 text-[13px] font-semibold text-ink-muted hover:bg-surface-muted"
          aria-expanded={showOptional}
        >
          <span>Kendala &amp; tindak lanjut</span>
          <span className="text-base leading-none">{showOptional ? "−" : "+"}</span>
        </button>
        <div className={`${showOptional ? "" : "hidden"} space-y-3 border-t border-border p-3`}>
          <div>
            <Label htmlFor="fa-kendala">Kendala</Label>
            <Textarea id="fa-kendala" name="kendala" rows={2} placeholder="Kosongkan bila tidak ada kendala" maxLength={2000} />
            {/* Orang berhak tahu tulisannya akan ditagih, bukan sekadar tersimpan. */}
            <p className="mt-1 text-xs text-ink-muted">
              Saat kegiatan difinalkan, isian ini otomatis masuk papan kendala dan akan ditagih
              sampai ditutup.
            </p>
          </div>
          <div>
            <Label htmlFor="fa-solusi">Solusi / tindak lanjut</Label>
            <Textarea id="fa-solusi" name="solusi" rows={2} placeholder="Kosongkan bila tidak ada tindak lanjut" maxLength={2000} />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface-inset/40 p-3">
        <Label>Foto dokumentasi (maks {MAX_PHOTOS_PER_ACTIVITY})</Label>
        <PhotoSourceInput key={photoKey} />
        {/* KANTONG FOTO CEPAT — sejajar dengan Kamera & Galeri.
            Pertanyaan user 2026-08-07 di form ini: *"mana foto cepatnya?"*.
            Jalannya dulu cuma ada setelah kegiatan tersimpan, karena penautan
            butuh id kegiatan. Padahal urutan kerja di lapangan justru terbalik:
            fotonya dijepret dulu lewat Foto Cepat, kegiatannya ditulis
            belakangan. Fotonya TIDAK bisa ditautkan sekarang, tapi bisa
            DIPILIH sekarang dan ditautkan tepat sesudah kegiatannya tersimpan —
            lihat `kantongPhotoIds` di createActivityAction. Dari sisi pelapor
            hasilnya sama. */}
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          {[...kantong].map((id) => (
            <input key={id} type="hidden" name="kantongPhotoIds" value={id} />
          ))}
          <div className="flex flex-wrap items-center gap-1.5">
            <TombolAmbilDariKantong
              onClick={() => setBukaKantong((v) => !v)}
              aktif={bukaKantong}
              jumlahTerpilih={kantong.size}
            />
            {kantong.size > 0 && !bukaKantong ? (
              <span className="text-[11px] text-ink-muted">ikut tersimpan bersama kegiatan ini</span>
            ) : null}
          </div>
          {bukaKantong ? (
            <div className="rounded-md border border-border bg-surface-muted p-3">
              <PemilihKantong
                locationId={locationId}
                terpilih={kantong}
                onUbah={setKantong}
                muatUlangKunci={photoKey}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={resetForm}>Reset</Button>
        <Button type="submit" loading={pending}>Simpan kegiatan</Button>
      </div>
    </form>
  );
}

/** Baris pengelolaan kegiatan draft — dua grup rapi: kiri (edit/tambah), kanan
 * (finalkan/hapus). Panel foto/edit muncul RAPI di bawah, tak berdesakan di baris. */
export function DraftActions({ activity, kinds }: { activity: EditableActivity; kinds: ActivityKindOption[] }) {
  const [editing, setEditing] = useState(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={editing ? "primary" : "secondary"}
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil aria-hidden className="size-3.5" />
            {editing ? "Tutup edit" : "Edit"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={addingPhoto ? "primary" : "secondary"}
            onClick={() => setAddingPhoto((v) => !v)}
          >
            <Plus aria-hidden className="size-3.5" />
            Tambah foto
          </Button>
          <AddAttachmentForm activityId={activity.id} />
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <FinalizePanel activityId={activity.id} />
          <DeleteButton activityId={activity.id} />
        </div>
      </div>
      {addingPhoto ? (
        <AddPhotoPanel
          activityId={activity.id}
          locationId={activity.locationId}
          onDone={() => setAddingPhoto(false)}
        />
      ) : null}
      {editing ? <EditActivityForm activity={activity} kinds={kinds} onDone={() => setEditing(false)} /> : null}
    </div>
  );
}

/** Form koreksi isi kegiatan draft (jenis/tanggal/judul/catatan/peserta). */
function EditActivityForm({
  activity,
  kinds,
  onDone,
}: {
  activity: EditableActivity;
  kinds: ActivityKindOption[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<FieldActivityState, FormData>(ubahKegiatan, undefined);
  useEffect(() => {
    if (state?.success) onDone();
  }, [state?.success, onDone]);
  return (
    <form action={action} className="mt-3 space-y-3 rounded-md border border-border bg-surface-muted p-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <input type="hidden" name="activityId" value={activity.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`ed-type-${activity.id}`} required>Jenis kegiatan</Label>
          <Combobox id={`ed-type-${activity.id}`} name="type" defaultValue={activity.type} required>
            {/* Sertakan jenis lama meski kini nonaktif, agar nilai tersimpan tetap tampil. */}
            {(kinds.some((k) => k.key === activity.type) ? kinds : [{ key: activity.type, label: activity.type }, ...kinds]).map((k) => (
              <option key={k.key} value={k.key}>{k.label}</option>
            ))}
          </Combobox>
        </div>
        <div>
          <Label htmlFor={`ed-date-${activity.id}`} required>Tanggal</Label>
          <Input id={`ed-date-${activity.id}`} type="date" name="activityDate" defaultValue={activity.activityDate} required />
        </div>
      </div>
      <div>
        <Label htmlFor={`ed-title-${activity.id}`} required>Judul / uraian singkat</Label>
        <Input id={`ed-title-${activity.id}`} name="title" defaultValue={activity.title} required maxLength={160} />
      </div>
      <div>
        <Label htmlFor={`ed-notes-${activity.id}`}>Catatan (opsional)</Label>
        <Textarea id={`ed-notes-${activity.id}`} name="notes" rows={2} defaultValue={activity.notes ?? ""} maxLength={2000} />
      </div>
      <div>
        <Label htmlFor={`ed-part-${activity.id}`}>Peserta / hadir (opsional)</Label>
        <Input id={`ed-part-${activity.id}`} name="participants" defaultValue={activity.participants ?? ""} maxLength={500} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`ed-kendala-${activity.id}`}>Kendala (opsional)</Label>
          <Textarea id={`ed-kendala-${activity.id}`} name="kendala" rows={2} defaultValue={activity.kendala ?? ""} placeholder="Kosongkan bila tidak ada" maxLength={2000} />
        </div>
        <div>
          <Label htmlFor={`ed-solusi-${activity.id}`}>Solusi / tindak lanjut (opsional)</Label>
          <Textarea id={`ed-solusi-${activity.id}`} name="solusi" rows={2} defaultValue={activity.solusi ?? ""} placeholder="Kosongkan bila tidak ada" maxLength={2000} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Batal</Button>
        <Button type="submit" size="sm" loading={pending}>Simpan perubahan</Button>
      </div>
    </form>
  );
}

const ATTACHMENT_ACCEPT =
  ".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*";

/** Unggah lampiran dokumen (PDF/Word/Excel/gambar) ke kegiatan draft. */
function AddAttachmentForm({ activityId }: { activityId: string }) {
  const [state, action, pending] = useActionState<FieldActivityState, FormData>(tambahLampiran, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} className="inline-flex items-center gap-1">
      <input type="hidden" name="activityId" value={activityId} />
      <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-muted">
        <Paperclip aria-hidden className="size-3.5" />
        {pending ? "Mengunggah…" : "Tambah dokumen"}
        <input
          type="file"
          name="attachments"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files && e.target.files.length) formRef.current?.requestSubmit();
          }}
        />
      </label>
      {state?.error ? <span className="text-[12px] text-danger">{state.error}</span> : null}
      {state?.warning ? <span className="text-[12px] text-warning">{state.warning}</span> : null}
    </form>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Daftar lampiran dokumen kegiatan (unduh) + hapus per item saat draft. */
export function ActivityAttachments({
  attachments,
  canDelete = false,
}: {
  attachments: FieldActivityAttachmentView[];
  canDelete?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  if (attachments.length === 0) return null;

  const del = (attachmentId: string) => {
    if (typeof window !== "undefined" && !window.confirm("Hapus lampiran ini? Tidak bisa dibatalkan.")) return;
    const fd = new FormData();
    fd.set("attachmentId", attachmentId);
    startTransition(async () => {
      await removeActivityAttachmentAction(undefined, fd);
    });
  };

  return (
    <ul className="mt-2 space-y-1.5">
      {attachments.map((a) => (
        <li
          key={a.id}
          className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px]"
        >
          <Paperclip aria-hidden className="size-3.5 shrink-0 text-ink-muted" />
          <a
            href={`/api/kegiatan/lampiran/${a.id}`}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-primary hover:underline"
            title={a.fileName}
          >
            {a.fileName}
          </a>
          <span className="shrink-0 text-[12px] text-ink-faint tabular">{formatBytes(a.bytes)}</span>
          <a
            href={`/api/kegiatan/lampiran/${a.id}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Unduh lampiran"
            title="Unduh"
            className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            <Download aria-hidden className="size-3.5" />
          </a>
          {canDelete ? (
            <button
              type="button"
              onClick={() => del(a.id)}
              disabled={pending}
              aria-label="Hapus lampiran"
              title="Hapus lampiran"
              className="shrink-0 rounded p-1 text-danger hover:bg-danger-soft disabled:opacity-50"
            >
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Panel tambah foto (muncul di bawah baris aksi) — Kamera/Galeri + opsi GPS
 * tertata rapi dalam kotak, auto-unggah saat foto dipilih, menutup bila sukses. */
function AddPhotoPanel({
  activityId,
  locationId,
  onDone,
}: {
  activityId: string;
  locationId: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<FieldActivityState, FormData>(tambahFotoKegiatan, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [ambil, setAmbil] = useState(false);
  useEffect(() => {
    if (state?.success) onDone();
  }, [state?.success, onDone]);
  return (
    // Dua jalur, satu kotak. `AmbilDariKantong` punya <form> sendiri, jadi ia
    // WAJIB bersaudara dengan form unggah — bukan bersarang di dalamnya.
    <div className="mt-3 space-y-3 rounded-md border border-border bg-surface-muted p-3">
      <form ref={formRef} action={action}>
        <input type="hidden" name="activityId" value={activityId} />
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-ink">Tambah foto{pending ? " – mengunggah…" : ""}</span>
          <button type="button" onClick={onDone} className="text-[12px] font-medium text-ink-muted hover:underline">
            Tutup
          </button>
        </div>
        <PhotoSourceInput onPicked={() => formRef.current?.requestSubmit()} />
        {state?.error ? <div className="mt-2"><Banner tone="error" title={state.error} /></div> : null}
        {state?.warning ? <div className="mt-2"><Banner tone="warning" title="Sebagian foto gagal" description={state.warning} /></div> : null}
      </form>
      {/* Foto lapangan yang sudah dijepret lewat Foto Cepat justru koordinatnya
          paling benar — jalan memakainya harus ada di sini, sejajar dengan
          memotret baru (keluhan user 2026-08-06). */}
      <div className="space-y-2 border-t border-border pt-3">
        <TombolAmbilDariKantong onClick={() => setAmbil(true)} aktif={ambil} />
        {ambil ? (
          <AmbilDariKantong
            locationId={locationId}
            target={{ tujuan: "kegiatan", kegiatanId: activityId }}
            onTutup={() => setAmbil(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

function DeleteButton({ activityId }: { activityId: string }) {
  const [state, action, pending] = useActionState<FieldActivityState, FormData>(hapusKegiatan, undefined);
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

/**
 * Buka kembali kegiatan yang sudah final → draft, agar bisa dikoreksi
 * (mis. hapus foto salah lalu unggah ulang dengan cap perusahaan yang benar).
 */
export function ReopenActivityButton({ activityId }: { activityId: string }) {
  const [state, action, pending] = useActionState<FieldActivityState, FormData>(bukaKegiatan, undefined);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <form action={action} className="inline-flex items-center gap-1">
        <input type="hidden" name="activityId" value={activityId} />
        <Button type="submit" size="sm" variant="ghost" loading={pending}>
          <RotateCcw aria-hidden className="size-3.5" />
          Buka kembali untuk koreksi
        </Button>
        {state?.error ? <span className="text-[12px] text-danger">{state.error}</span> : null}
      </form>
    </div>
  );
}
