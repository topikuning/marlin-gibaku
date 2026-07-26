import { notFound } from "next/navigation";
import { z } from "zod";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { KegiatanReport } from "@/components/knmp/kegiatan-report";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isR2Configured, r2PresignGet } from "@/lib/r2";
import { getBranding } from "@/lib/branding";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import { FIELD_ACTIVITY_STATUS_LABEL } from "@/lib/field-activity/labels";

export const dynamic = "force-dynamic";

/** Cetak Laporan Kegiatan Lapangan — A4, tanpa shell (browser print → PDF). DECISIONS 123. */
export default async function CetakKegiatanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const user = await requireUser();

  const activity = await db.fieldActivity.findUnique({
    where: { id },
    select: {
      type: true,
      title: true,
      activityDate: true,
      notes: true,
      participants: true,
      kendala: true,
      solusi: true,
      status: true,
      createdById: true,
      location: { select: { id: true, slug: true, name: true, province: true, package: { select: { name: true } } } },
      photos: {
        select: { id: true, r2Key: true, exifTakenAt: true, exifGpsLat: true, exifGpsLng: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!activity) notFound();
  await requireLocationAccess(user, activity.location.id);

  const [branding, kindLabels, creator] = await Promise.all([
    getBranding(),
    getActivityKindLabelMap(),
    db.user.findUnique({ where: { id: activity.createdById }, select: { fullName: true } }),
  ]);

  const photos = isR2Configured()
    ? await Promise.all(
        activity.photos.map(async (p) => ({
          id: p.id,
          url: await r2PresignGet(p.r2Key, 600),
          takenAt: p.exifTakenAt,
          lat: p.exifGpsLat != null ? Number(p.exifGpsLat) : null,
          lng: p.exifGpsLng != null ? Number(p.exifGpsLng) : null,
        })),
      )
    : [];

  return (
    <>
      <PrintToolbar backHref={`/lokasi/${activity.location.slug}/kegiatan`} />
      <main className="mx-auto max-w-[860px] bg-white p-6 print:p-0">
        <KegiatanReport
          d={{
            brandingName: branding.appName,
            kindLabel: kindLabels.get(activity.type) ?? activity.type,
            title: activity.title,
            activityDate: new Date(activity.activityDate),
            statusLabel: FIELD_ACTIVITY_STATUS_LABEL[activity.status],
            notes: activity.notes,
            participants: activity.participants,
            kendala: activity.kendala,
            solusi: activity.solusi,
            locationName: activity.location.name,
            province: activity.location.province,
            packageName: activity.location.package.name,
            creatorName: creator?.fullName ?? null,
            photos,
            generatedAt: new Date(),
          }}
        />
      </main>
    </>
  );
}
