import type { Metadata } from "next";
import { StatusPill } from "@/components/ui";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import { putarFotoAction } from "@/lib/photo-restamp/actions";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { jakartaDateKey, jakartaToday, formatTanggal, formatTanggalWaktu } from "@/lib/format";
import { listFieldActivities } from "@/lib/field-activity/queries";
import {
  FIELD_ACTIVITY_STATUS_LABEL,
  FIELD_ACTIVITY_STATUS_TONE,
} from "@/lib/field-activity/labels";
import { getActivityKinds, getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import { removeActivityPhotoAction } from "@/lib/field-activity/actions";
import { isWahaConfigured } from "@/lib/waha/client";
import { db } from "@/lib/db";
import { requireLocationPage } from "../get-location";
import {
  ActivityAttachments,
  CreateActivityForm,
  DraftActions,
  ReopenActivityButton,
  SendToWaButton,
  SendPdfToWaButton,
} from "./kegiatan-forms";
import { KegiatanList, type ActivityCardItem } from "./kegiatan-list";
import { UploadActivityToDrive } from "@/components/knmp/drive-upload-button";
import { getGDriveConfigDisplay } from "@/lib/gdrive/config";

export const metadata: Metadata = { title: "Kegiatan & Dokumentasi Lapangan" };
export const dynamic = "force-dynamic";

function Chip({ label, value, tone }: { label: string; value: number; tone?: "warning" | "success" }) {
  const color = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-ink";
  return (
    <div className="min-w-[84px] rounded-lg border border-border bg-surface px-3 py-2 text-center sm:text-left">
      <div className="text-[10px] font-bold tracking-wide text-ink-muted uppercase">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

function SummaryBox({ label, value, tone }: { label: string; value: string; tone?: "issue" | "solution" }) {
  const box =
    tone === "issue"
      ? "border-warning-border bg-warning-soft"
      : tone === "solution"
        ? "border-success-border bg-success-soft"
        : "border-border bg-surface-inset";
  const labelColor = tone === "issue" ? "text-warning" : tone === "solution" ? "text-success" : "text-ink-muted";
  return (
    <div className={`rounded-lg border p-2.5 ${box}`}>
      <div className={`text-[10px] font-bold tracking-wide uppercase ${labelColor}`}>{label}</div>
      <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-line text-ink">{value}</p>
    </div>
  );
}

const linkBtn =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium text-ink hover:border-border-strong hover:bg-surface-muted";

export default async function KegiatanLapanganPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "location.view");
  const canManage = can(user.role, "field_activity.manage");
  const [activities, kinds, kindLabels] = await Promise.all([
    listFieldActivities(location.id),
    getActivityKinds({ activeOnly: true }),
    getActivityKindLabelMap(),
  ]);
  const kindOptions = kinds.map((k) => ({ key: k.key, label: k.label }));
  const todayKey = jakartaDateKey(jakartaToday());

  // Grup WA paket (tujuan kiriman kegiatan). Sama untuk semua kegiatan lokasi ini.
  const wahaConfigured = await isWahaConfigured();
  const pkgGroup =
    canManage && wahaConfigured
      ? await db.location.findUnique({
          where: { id: location.id },
          select: { package: { select: { waGroupId: true, waGroupName: true } } },
        })
      : null;
  const hasGroup = !!pkgGroup?.package?.waGroupId;
  const groupName = pkgGroup?.package?.waGroupName ?? null;

  // Kesiapan Drive KKP (folder "6. DOKUMENTASI") + jejak upload per kegiatan.
  const driveOn = canManage && (await getGDriveConfigDisplay()).connected;
  const drivePkg = driveOn
    ? await db.location.findUnique({
        where: { id: location.id },
        select: { package: { select: { driveFolderId: true } } },
      })
    : null;
  const hasDriveFolder = !!drivePkg?.package?.driveFolderId;
  const driveLogs = driveOn
    ? await db.gDriveUpload.findMany({
        where: { locationId: location.id, kind: "kegiatan", status: "sukses" },
        orderBy: { createdAt: "desc" },
        select: { refKey: true, createdAt: true },
        take: 500,
      })
    : [];
  const driveUploadedAt = new Map<string, string>();
  for (const l of driveLogs) {
    if (!driveUploadedAt.has(l.refKey)) driveUploadedAt.set(l.refKey, formatTanggalWaktu(l.createdAt));
  }

  const draftCount = activities.filter((a) => a.status === "draft").length;
  const finalCount = activities.length - draftCount;

  const kindLabelOf = (t: string) => kindLabels.get(t) ?? t;
  const items: ActivityCardItem[] = activities.map((a) => {
    const typeLabel = kindLabelOf(a.type);
    const statusLabel = FIELD_ACTIVITY_STATUS_LABEL[a.status];
    const text = [
      a.title,
      a.notes,
      a.participants,
      a.kendala,
      a.solusi,
      typeLabel,
      ...a.attachments.map((x) => x.fileName),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const node = (
      /* `id` + `scroll-mt` = sasaran tautan dalam dari Activity Centre
         (/aktivitas). `target:` menyalakan sorotan sesaat supaya yang diklik
         benar-benar ketemu — di daftar panjang, melompat tanpa penanda sama
         saja dengan tidak melompat. DECISIONS 238. */
      <article
        id={`keg-${a.id}`}
        className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs scroll-mt-24 target:ring-2 target:ring-primary target:ring-offset-2"
      >
        {/* Header: meta + judul + catatan · penulis + cetak/PDF */}
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-border bg-surface-inset px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                {typeLabel}
              </span>
              <StatusPill tone={FIELD_ACTIVITY_STATUS_TONE[a.status]} label={statusLabel} />
              <span className="rounded-full border border-border bg-surface-inset px-2 py-0.5 text-[11px] text-ink-muted">
                {formatTanggal(new Date(a.activityDate))}
              </span>
            </div>
            <h3 className="mt-2 text-[15px] font-semibold text-ink">{a.title}</h3>
            {a.notes ? (
              <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-line text-ink-muted">{a.notes}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {a.createdByName ? (
              <span className="text-[12px] text-ink-faint">
                oleh <span className="font-medium text-ink-muted">{a.createdByName}</span>
              </span>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {/* Satu sumber: PDF server (isi sama dgn yang dikirim WA). Terbuka di
                  browser → bisa langsung dicetak (Ctrl/Cmd+P) atau disimpan. */}
              <a href={`/api/kegiatan/${a.id}/pdf`} target="_blank" rel="noopener" className={linkBtn}>
                Cetak / PDF
              </a>
              {canManage && driveOn && a.status === "final" ? (
                <UploadActivityToDrive
                  activityId={a.id}
                  hasDrive={hasDriveFolder}
                  uploadedAt={driveUploadedAt.get(a.id) ?? null}
                />
              ) : null}
            </div>
          </div>
        </div>

        {/* Ringkasan: Peserta / Kendala / Solusi */}
        {a.participants || a.kendala || a.solusi ? (
          <div className="grid gap-2 px-4 pb-4 sm:grid-cols-3">
            {a.participants ? <SummaryBox label="Peserta" value={a.participants} /> : null}
            {a.kendala ? <SummaryBox label="Kendala" value={a.kendala} tone="issue" /> : null}
            {a.solusi ? <SummaryBox label="Solusi / tindak lanjut" value={a.solusi} tone="solution" /> : null}
          </div>
        ) : null}

        {/* Bukti & lampiran */}
        <div className="border-t border-border bg-surface-muted/40 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold tracking-wide text-ink-muted uppercase">Bukti &amp; lampiran</span>
            <span className="text-[11px] text-ink-faint">
              {a.photos.length} foto · {a.attachments.length} dokumen
            </span>
          </div>
          {a.photos.length > 0 ? (
            <PhotoGallery
              photos={a.photos}
              thumbClass="h-20 w-20"
              canDelete={canManage && a.status === "draft"}
              deleteAction={removeActivityPhotoAction}
              rotateAction={canManage ? putarFotoAction : undefined}
            />
          ) : (
            <p className="text-[12px] text-ink-faint">Belum ada foto.</p>
          )}
          {a.attachments.length > 0 ? (
            <ActivityAttachments attachments={a.attachments} canDelete={canManage && a.status === "draft"} />
          ) : null}
        </div>

        {/* Pengelolaan + distribusi (komponen membawa pemisah sendiri) */}
        {canManage ? (
          <div className="px-4 pb-4">
            {a.status === "draft" ? (
              <DraftActions
                kinds={kindOptions}
                activity={{
                  id: a.id,
                  locationId: location.id,
                  type: a.type,
                  activityDate: a.activityDate,
                  title: a.title,
                  notes: a.notes,
                  participants: a.participants,
                  kendala: a.kendala,
                  solusi: a.solusi,
                }}
              />
            ) : (
              <ReopenActivityButton activityId={a.id} />
            )}
            {wahaConfigured ? (
              <>
                <SendToWaButton
                  activityId={a.id}
                  wahaConfigured={wahaConfigured}
                  hasGroup={hasGroup}
                  groupName={groupName}
                  sentAt={a.waSentAt}
                />
                <SendPdfToWaButton
                  activityId={a.id}
                  wahaConfigured={wahaConfigured}
                  hasGroup={hasGroup}
                  groupName={groupName}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </article>
    );

    return { id: a.id, typeLabel, statusLabel, text, node };
  });

  const typeOptions = [...new Set(items.map((i) => i.typeLabel))].sort((x, y) => x.localeCompare(y, "id"));
  const statusOptions = [...new Set(items.map((i) => i.statusLabel))];

  return (
    <div className="space-y-4">
      {/* Intro + ringkasan */}
      <section className="rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-ink">Kegiatan &amp; Dokumentasi Lapangan</h1>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-ink-muted">
              Catat kegiatan NON-progres seperti PCM, pengukuran/uitzet, MC-0, sosialisasi, mobilisasi, dan dokumentasi
              kondisi 0%. Foto, dokumen pendukung, finalisasi, serta distribusi WhatsApp dalam satu alur. Terpisah dari
              laporan progres harian.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Chip label="Total" value={activities.length} />
            <Chip label="Draft" value={draftCount} tone="warning" />
            <Chip label="Final" value={finalCount} tone="success" />
          </div>
        </div>
      </section>

      {/* Workspace: form (kiri) + daftar (kanan) */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* Kolom form dipaku (sticky) supaya tetap terlihat saat riwayat
            digulir. Tanpa batas tinggi, form yang lebih tinggi dari layar jadi
            TIDAK BISA DIGULIR sama sekali: bagian atasnya terpaku dan tombol
            "Simpan kegiatan" di bawah menggantung di luar layar (keluhan user
            2026-09-03). Batas tinggi + gulir sendiri mengembalikan seluruh isi
            form ke jangkauan. */}
        {canManage ? (
          <aside className="rounded-xl border border-border bg-surface shadow-xs lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:overscroll-contain">
            <div className="border-b border-border p-4">
              <h2 className="text-sm font-semibold text-ink">Catat kegiatan lapangan</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                Informasi wajib di atas. Detail opsional bisa dibuka bila diperlukan.
              </p>
            </div>
            <div className="p-4">
              <CreateActivityForm locationId={location.id} todayKey={todayKey} kinds={kindOptions} />
            </div>
          </aside>
        ) : null}

        <section className="rounded-xl border border-border bg-surface shadow-xs">
          <div className="border-b border-border p-4">
            <h2 className="text-sm font-semibold text-ink">Riwayat kegiatan</h2>
            <p className="mt-1 text-[11px] text-ink-muted">
              Konten, bukti, tindakan, dan distribusi dipisahkan agar mudah dipindai.
            </p>
          </div>
          <KegiatanList items={items} typeOptions={typeOptions} statusOptions={statusOptions} />
        </section>
      </div>
    </div>
  );
}
