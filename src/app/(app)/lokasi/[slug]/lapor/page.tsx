import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canReport, REPORT_STATE_LABEL, REPORT_STATE_CLASS } from "@/lib/report";
import { hasLocationAccess } from "@/lib/access";
import { getReportableItems } from "@/lib/rab";
import { buildPhotoViews, type PhotoView } from "@/lib/photos";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import { LaporForm } from "./lapor-form";

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

export default async function LaporPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  const { slug } = await params;

  const location = await db.location.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!location) notFound();
  if (!canReport(role)) notFound();
  if (!(await hasLocationAccess(userId, role, location.id))) notFound();

  const items = await getReportableItems(location.id);

  // Draft yang pernah dibuat user ini untuk item-item di lokasi ini.
  const itemIds = items.map((i) => i.id);
  const myDrafts = await db.dailyReportItem.findMany({
    where: { suggestedByUserId: userId, rabItemId: { in: itemIds } },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: {
      rabItem: { select: { code: true, name: true, unit: true } },
      photos: {
        select: { id: true, r2Key: true, thumbnailKey: true, exifTakenAt: true, exifGpsLat: true, exifGpsLng: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const allViews = await buildPhotoViews(myDrafts.flatMap((d) => d.photos));
  const viewById = new Map(allViews.map((v) => [v.id, v]));

  return (
    <>
      <Link href={`/lokasi/${slug}`} className="mb-3 inline-block text-sm text-[#1e3a8a] hover:underline">
        ← {location.name}
      </Link>
      <h1 className="mb-1 text-2xl font-bold text-[#0F172A] sm:text-3xl">Lapor Harian</h1>
      <p className="mb-6 text-sm text-[#1e3a8a]">
        Isi volume + foto pekerjaan yang selesai. Menunggu persetujuan Site Manager.
      </p>

      <section className="mb-8 rounded-2xl border border-[#E2E8F0] bg-white p-4 sm:p-5">
        <LaporForm locationId={location.id} slug={slug} items={items} />
      </section>

      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
        Laporan Anda ({myDrafts.length})
      </div>
      <p className="mb-3 text-xs text-[#64748B]">
        Semua laporan yang Anda kirim tampil di sini beserta fotonya. Site Manager
        menyetujuinya di menu <span className="font-semibold">Laporan</span>.
      </p>
      {myDrafts.length === 0 ? (
        <p className="text-sm text-[#64748B]">Belum ada laporan.</p>
      ) : (
        <div className="space-y-2.5">
          {myDrafts.map((d) => (
            <div key={d.id} className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#0F172A]">{d.rabItem.name}</div>
                  <div className="mt-0.5 text-xs text-[#64748B]">
                    {d.rabItem.code} ·{" "}
                    <span className="font-semibold text-[#0F172A]">
                      {volFmt.format(d.volumeDone.toNumber())} {d.rabItem.unit ?? ""}
                    </span>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${REPORT_STATE_CLASS[d.state]}`}>
                  {REPORT_STATE_LABEL[d.state]}
                </span>
              </div>
              {d.rejectedReason && (
                <div className="mt-1.5 text-xs text-[#DC2626]">Ditolak: {d.rejectedReason}</div>
              )}
              {d.photos.length > 0 &&
                (() => {
                  const views = d.photos
                    .map((p) => viewById.get(p.id))
                    .filter(Boolean) as PhotoView[];
                  return views.some((v) => v.thumbUrl) ? (
                    <div className="mt-2.5">
                      <PhotoGallery photos={views} thumbClass="h-14 w-14" />
                    </div>
                  ) : (
                    <div className="mt-2.5 text-[10px] text-[#94A3B8]">
                      📷 {d.photos.length} foto tersimpan (R2 belum aktif)
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
