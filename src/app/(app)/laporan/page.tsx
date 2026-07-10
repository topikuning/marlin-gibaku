import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";
import {
  canApprove,
  canReport,
  PENDING_STATES,
  REPORT_STATE_LABEL,
  REPORT_STATE_CLASS,
} from "@/lib/report";
import { getReportableItems } from "@/lib/rab";
import { approveItem, rejectItem } from "./actions";

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

export default async function LaporanPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  if (!canReport(role) && !canApprove(role)) notFound();

  // Lokasi yang bisa diakses.
  const locations = isCrossLocation(role)
    ? await db.location.findMany({
        orderBy: [{ province: "asc" }, { name: "asc" }],
        select: { id: true, slug: true, name: true },
      })
    : (
        await db.userLocationAssignment.findMany({
          where: { userId, unassignedAt: null },
          include: { location: { select: { id: true, slug: true, name: true } } },
          orderBy: { assignedAt: "asc" },
        })
      ).map((a) => a.location);

  // Peta item → lokasi + kumpulan itemId untuk query pending.
  const itemLoc = new Map<string, { name: string; slug: string }>();
  const allItemIds: string[] = [];
  for (const loc of locations) {
    const items = await getReportableItems(loc.id);
    for (const it of items) {
      itemLoc.set(it.id, { name: loc.name, slug: loc.slug });
      allItemIds.push(it.id);
    }
  }

  const approver = canApprove(role);
  const pending = approver
    ? await db.dailyReportItem.findMany({
        where: { rabItemId: { in: allItemIds }, state: { in: PENDING_STATES } },
        orderBy: { createdAt: "asc" },
        include: {
          rabItem: { select: { code: true, name: true, unit: true } },
          suggestedBy: { select: { fullName: true } },
        },
      })
    : [];

  return (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
        MARLIN · Laporan
      </div>
      <h1 className="mb-1 font-[Fraunces] text-3xl font-semibold text-[#1f2b38]">
        Laporan Harian
      </h1>
      <p className="mb-8 text-sm text-[#3A4E63]">
        {approver
          ? "Setujui/tolak draft dari lapangan, lalu masuk laporan resmi."
          : "Pilih lokasi untuk input laporan volume harian."}
      </p>

      {canReport(role) && (
        <section className="mb-10">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
            Lapor untuk lokasi
          </div>
          <div className="flex flex-wrap gap-2">
            {locations.map((loc) => (
              <Link
                key={loc.id}
                href={`/lokasi/${loc.slug}/lapor`}
                className="rounded-md border border-[#EAE2D2] bg-white px-3 py-1.5 text-sm font-medium text-[#3A4E63] transition hover:bg-[#f4efe4]"
              >
                {loc.name} →
              </Link>
            ))}
          </div>
        </section>
      )}

      {approver && (
        <section>
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
            Menunggu persetujuan ({pending.length})
          </div>
          {pending.length === 0 ? (
            <p className="text-sm text-[#8a9199]">Tidak ada draft menunggu persetujuan.</p>
          ) : (
            <div className="space-y-2">
              {pending.map((p) => {
                const loc = itemLoc.get(p.rabItemId);
                return (
                  <div
                    key={p.id}
                    className="rounded-lg border border-[#EAE2D2] bg-[#FDFBF6] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm">
                          <span className="font-mono text-[11px] text-[#8a9199]">
                            {p.rabItem.code}
                          </span>{" "}
                          <span className="font-medium text-[#1f2b38]">
                            {p.rabItem.name}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-[#8a9199]">
                          {loc?.name} · oleh {p.suggestedBy?.fullName ?? "?"} ·{" "}
                          <span className={`rounded-full px-1.5 py-0.5 ${REPORT_STATE_CLASS[p.state]}`}>
                            {REPORT_STATE_LABEL[p.state]}
                          </span>
                        </div>
                        {p.notes && (
                          <div className="mt-1 text-xs text-[#3A4E63]">“{p.notes}”</div>
                        )}
                      </div>
                      <div className="text-right text-sm font-semibold tabular-nums text-[#1f2b38]">
                        {volFmt.format(p.volumeDone.toNumber())} {p.rabItem.unit ?? ""}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <form action={approveItem.bind(null, p.id)}>
                        <button
                          type="submit"
                          className="rounded-md bg-[#2E7D4F] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#276b44]"
                        >
                          Setujui
                        </button>
                      </form>
                      <form action={rejectItem.bind(null, p.id)} className="flex items-center gap-2">
                        <input
                          name="reason"
                          placeholder="alasan tolak…"
                          maxLength={200}
                          className="rounded-md border border-[#EAE2D2] bg-white px-2 py-1 text-xs outline-none focus:border-[#C1442E]"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-[#C1442E] px-3 py-1.5 text-xs font-semibold text-[#C1442E] transition hover:bg-[#FCE8E4]"
                        >
                          Tolak
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </>
  );
}
