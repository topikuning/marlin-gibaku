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
  FIELD_ACTIVITY_TYPE_LABEL,
} from "@/lib/field-activity/labels";
import { requireLocationPage } from "../get-location";
import { CreateActivityForm, DraftActions } from "./kegiatan-forms";

export const metadata: Metadata = { title: "Kegiatan & Dokumentasi Lapangan" };
export const dynamic = "force-dynamic";

export default async function KegiatanLapanganPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "location.view");
  const canManage = can(user.role, "field_activity.manage");
  const activities = await listFieldActivities(location.id);
  const todayKey = jakartaDateKey(jakartaToday());

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Kegiatan & Dokumentasi Lapangan"
          subtitle="Catatan kegiatan NON-pekerjaan beserta foto — mis. rapat persiapan (PCM), pengukuran/uitzet, MC-0, sosialisasi, mobilisasi, dokumentasi kondisi 0%. Terpisah dari laporan progres harian."
        />
        {canManage ? (
          <CardBody>
            <CreateActivityForm locationId={location.id} todayKey={todayKey} />
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
                        {FIELD_ACTIVITY_TYPE_LABEL[a.type]}
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

                {a.photos.length > 0 ? (
                  <div className="mt-3">
                    <PhotoGallery photos={a.photos} thumbClass="h-20 w-20" />
                  </div>
                ) : (
                  <p className="mt-3 text-[12px] text-ink-faint">Belum ada foto.</p>
                )}

                {canManage && a.status === "draft" ? <DraftActions activityId={a.id} /> : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
