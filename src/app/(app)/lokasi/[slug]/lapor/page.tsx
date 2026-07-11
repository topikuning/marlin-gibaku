import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canReport, REPORT_STATE_LABEL, REPORT_STATE_CLASS } from "@/lib/report";
import { hasLocationAccess } from "@/lib/access";
import { getReportableItems } from "@/lib/rab";
import { presignKeys } from "@/lib/photos";
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
      photos: { select: { id: true, r2Key: true }, orderBy: { createdAt: "asc" } },
    },
  });

  const photoUrls = await presignKeys(
    myDrafts.flatMap((d) => d.photos.map((p) => p.r2Key))
  );

  return (
    <>
      <Link href={`/lokasi/${slug}`} className="mb-4 inline-block text-sm text-[#0F766E] hover:underline">
        ← Detail Lokasi
      </Link>
      <h1 className="mb-1 text-3xl font-semibold text-[#0F172A]">
        Lapor Harian — {location.name}
      </h1>
      <p className="mb-8 text-sm text-[#0F766E]">
        Input volume pekerjaan yang selesai. Draft menunggu persetujuan Site
        Manager sebelum masuk laporan resmi.
      </p>

      <section className="mb-10 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
        <div className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
          Input laporan
        </div>
        <LaporForm locationId={location.id} slug={slug} items={items} />
      </section>

      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        Draft & riwayat Anda ({myDrafts.length})
      </div>
      {myDrafts.length === 0 ? (
        <p className="text-sm text-[#64748B]">Belum ada laporan.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#FFFFFF] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-2.5 font-semibold">Item</th>
                <th className="px-4 py-2.5 text-right font-semibold">Volume</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {myDrafts.map((d) => (
                <tr key={d.id} className="border-b border-[#EEF2F6] last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-[#64748B]">{d.rabItem.code}</span>{" "}
                    <span className="text-[#0F172A]">{d.rabItem.name}</span>
                    {d.photos.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {d.photos.map((p) => {
                          const url = photoUrls.get(p.r2Key);
                          return url ? (
                            <a key={p.id} href={url} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt="Foto bukti"
                                className="h-12 w-12 rounded-md border border-[#E2E8F0] object-cover"
                              />
                            </a>
                          ) : (
                            <span
                              key={p.id}
                              className="flex h-12 w-12 items-center justify-center rounded-md border border-[#E2E8F0] bg-[#F1F5F9] text-[10px] text-[#64748B]"
                            >
                              foto
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#0F172A]">
                    {volFmt.format(d.volumeDone.toNumber())} {d.rabItem.unit ?? ""}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REPORT_STATE_CLASS[d.state]}`}>
                      {REPORT_STATE_LABEL[d.state]}
                    </span>
                    {d.rejectedReason && (
                      <span className="ml-2 text-xs text-[#DC2626]">{d.rejectedReason}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
