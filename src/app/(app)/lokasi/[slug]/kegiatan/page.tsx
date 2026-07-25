import type { Metadata } from "next";
import { Card, CardBody, CardHeader, StatusPill } from "@/components/ui";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { jakartaDateKey, jakartaToday, formatTanggal } from "@/lib/format";
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
} from "./kegiatan-forms";

export const metadata: Metadata = { title: "Kegiatan & Dokumentasi Lapangan" };
export const dynamic = "force-dynamic";

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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Kegiatan & Dokumentasi Lapangan"
          subtitle="Catatan kegiatan NON-pekerjaan beserta foto & dokumen pendukung (notulen, undangan, berita acara, dsb.) — mis. rapat persiapan (PCM), pengukuran/uitzet, MC-0, sosialisasi, mobilisasi, dokumentasi kondisi 0%. Terpisah dari laporan progres harian."
        />
        {canManage ? (
          <CardBody>
            <CreateActivityForm locationId={location.id} todayKey={todayKey} kinds={kindOptions} />
          </CardBody>
        ) : null}
      </Card>

      {activities.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-muted">
              Belum ada kegiatan tercatat.{canManage ? " Gunakan formulir di atas untuk menambah." : ""}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {activities.map((a) => (
            <Card key={a.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-surface-inset px-2 py-0.5 text-[12px] font-semibold text-ink-muted">
                        {kindLabels.get(a.type) ?? a.type}
                      </span>
                      <StatusPill
                        tone={FIELD_ACTIVITY_STATUS_TONE[a.status]}
                        label={FIELD_ACTIVITY_STATUS_LABEL[a.status]}
                      />
                      <span className="text-[13px] text-ink-muted">{formatTanggal(new Date(a.activityDate))}</span>
                    </div>
                    <h3 className="mt-1.5 text-sm font-semibold text-ink">{a.title}</h3>
                  </div>
                  <span className="text-[12px] text-ink-faint">
                    {a.createdByName ? `oleh ${a.createdByName}` : null}
                  </span>
                </div>

                {a.notes ? <p className="mt-2 text-[13px] whitespace-pre-line text-ink">{a.notes}</p> : null}
                {a.participants ? (
                  <p className="mt-1.5 text-[12px] text-ink-muted">
                    <span className="font-medium">Hadir:</span> {a.participants}
                  </p>
                ) : null}
                {a.kendala ? (
                  <p className="mt-1.5 text-[13px] whitespace-pre-line text-ink">
                    <span className="font-medium text-warning">Kendala:</span> {a.kendala}
                  </p>
                ) : null}
                {a.solusi ? (
                  <p className="mt-1.5 text-[13px] whitespace-pre-line text-ink">
                    <span className="font-medium text-success">Solusi / tindak lanjut:</span> {a.solusi}
                  </p>
                ) : null}

                {a.photos.length > 0 ? (
                  <div className="mt-3">
                    <PhotoGallery
                      photos={a.photos}
                      thumbClass="h-20 w-20"
                      canDelete={canManage && a.status === "draft"}
                      deleteAction={removeActivityPhotoAction}
                    />
                  </div>
                ) : (
                  <p className="mt-3 text-[12px] text-ink-faint">Belum ada foto.</p>
                )}

                {a.attachments.length > 0 ? (
                  <ActivityAttachments
                    attachments={a.attachments}
                    canDelete={canManage && a.status === "draft"}
                  />
                ) : null}

                {canManage && a.status === "draft" ? (
                  <DraftActions
                    kinds={kindOptions}
                    activity={{
                      id: a.id,
                      type: a.type,
                      activityDate: a.activityDate,
                      title: a.title,
                      notes: a.notes,
                      participants: a.participants,
                      kendala: a.kendala,
                      solusi: a.solusi,
                    }}
                  />
                ) : null}
                {canManage && a.status === "final" ? <ReopenActivityButton activityId={a.id} /> : null}
                {canManage && wahaConfigured ? (
                  <SendToWaButton
                    activityId={a.id}
                    wahaConfigured={wahaConfigured}
                    hasGroup={hasGroup}
                    groupName={groupName}
                    sentAt={a.waSentAt}
                  />
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
