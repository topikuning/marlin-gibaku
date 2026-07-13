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
import { buildPhotoViews, type PhotoView } from "@/lib/photos";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import { PageHeader } from "@/components/knmp/page-header";
import { approveItem, rejectItem } from "./actions";

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const dtFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

type ItemMeta = { code: string; name: string; unit: string; planned: number | null; locName: string; slug: string };

function PhotoStrip({
  photos,
  viewById,
}: {
  photos: { id: string }[];
  viewById: Map<string, PhotoView>;
}) {
  if (photos.length === 0) return null;
  const views = photos.map((ph) => viewById.get(ph.id)).filter(Boolean) as PhotoView[];
  if (!views.some((v) => v.thumbUrl)) {
    return (
      <div className="mt-2.5 text-[11px] text-[#94A3B8]">📷 {photos.length} foto tersimpan (R2 belum aktif)</div>
    );
  }
  return (
    <div className="mt-2.5">
      <PhotoGallery photos={views} thumbClass="h-20 w-20" />
    </div>
  );
}

export default async function LaporanPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  if (!canReport(role) && !canApprove(role)) notFound();

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

  // Meta per item (nama, satuan, volume rencana, lokasi).
  const itemMeta = new Map<string, ItemMeta>();
  const allItemIds: string[] = [];
  for (const loc of locations) {
    const items = await getReportableItems(loc.id);
    for (const it of items) {
      itemMeta.set(it.id, {
        code: it.code,
        name: it.name,
        unit: it.unit,
        planned: it.volume,
        locName: loc.name,
        slug: loc.slug,
      });
      allItemIds.push(it.id);
    }
  }

  const approver = canApprove(role);

  // Realisasi 'sent' kumulatif per item (untuk hitung sisa saat approve).
  const sentAgg = allItemIds.length
    ? await db.dailyReportItem.groupBy({
        by: ["rabItemId"],
        where: { rabItemId: { in: allItemIds }, state: "sent" },
        _sum: { volumeDone: true },
      })
    : [];
  const sentByItem = new Map<string, number>();
  for (const s of sentAgg) sentByItem.set(s.rabItemId, s._sum.volumeDone?.toNumber() ?? 0);

  const pending = approver
    ? await db.dailyReportItem.findMany({
        where: { rabItemId: { in: allItemIds }, state: { in: PENDING_STATES } },
        orderBy: { createdAt: "asc" },
        include: {
          rabItem: { select: { code: true, name: true, unit: true } },
          suggestedBy: { select: { fullName: true } },
          photos: {
            select: { id: true, r2Key: true, thumbnailKey: true, exifTakenAt: true, exifGpsLat: true, exifGpsLng: true },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : [];

  // Sudah disetujui / terkirim (yang selama ini tidak kelihatan).
  const approved = allItemIds.length
    ? await db.dailyReportItem.findMany({
        where: { rabItemId: { in: allItemIds }, state: "sent" },
        orderBy: { approvedAt: "desc" },
        take: 30,
        include: {
          rabItem: { select: { code: true, name: true, unit: true } },
          suggestedBy: { select: { fullName: true } },
          approvedBy: { select: { fullName: true } },
          photos: {
            select: { id: true, r2Key: true, thumbnailKey: true, exifTakenAt: true, exifGpsLat: true, exifGpsLng: true },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : [];

  const allViews = await buildPhotoViews([
    ...pending.flatMap((p) => p.photos),
    ...approved.flatMap((p) => p.photos),
  ]);
  const viewById = new Map(allViews.map((v) => [v.id, v]));

  return (
    <>
      <PageHeader
        eyebrow="Laporan"
        title="Laporan Harian"
        subtitle={
          approver
            ? "Periksa detail tiap laporan, setujui/tolak, dan lihat yang sudah disetujui."
            : "Pilih lokasi untuk input laporan volume harian."
        }
      />

      {canReport(role) && (
        <section className="mb-10">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
            Lapor untuk lokasi
          </div>
          <div className="flex flex-wrap gap-2">
            {locations.map((loc) => (
              <Link
                key={loc.id}
                href={`/lokasi/${loc.slug}/lapor`}
                className="rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm font-medium text-[#1e3a8a] transition hover:bg-[#f1f5f9]"
              >
                {loc.name} →
              </Link>
            ))}
          </div>
        </section>
      )}

      {approver && (
        <section className="mb-10">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
            Laporan Harian KKP — lengkapi format resmi
          </div>
          <p className="mb-3 text-sm text-[#64748B]">
            Isi tenaga per keahlian, material, peralatan, cuaca (format resmi KKP),
            lalu cetak/PDF. Klik lokasi untuk buka hari ini.
          </p>
          <div className="flex flex-wrap gap-2">
            {locations.map((loc) => (
              <Link
                key={loc.id}
                href={`/lokasi/${loc.slug}/harian`}
                className="rounded-md border border-[#1e3a8a] bg-[#eff6ff] px-3 py-1.5 text-sm font-semibold text-[#1e3a8a] transition hover:bg-[#dbeafe]"
              >
                📋 {loc.name} →
              </Link>
            ))}
          </div>
        </section>
      )}

      {approver && (
        <section className="mb-10">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
            Menunggu persetujuan ({pending.length})
          </div>
          {pending.length === 0 ? (
            <p className="text-sm text-[#64748B]">Tidak ada draft menunggu persetujuan.</p>
          ) : (
            <div className="space-y-3">
              {pending.map((p) => {
                const meta = itemMeta.get(p.rabItemId);
                const unit = meta?.unit ?? p.rabItem.unit ?? "";
                const done = p.volumeDone.toNumber();
                const prior = sentByItem.get(p.rabItemId) ?? 0;
                const cumulative = prior + done;
                const planned = meta?.planned ?? null;
                const remaining = planned != null ? planned - cumulative : null;
                const pct = planned && planned > 0 ? (cumulative / planned) * 100 : null;
                return (
                  <div key={p.id} className="rounded-xl border border-[#E2E8F0] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#1e3a8a]">{meta?.locName ?? ""}</div>
                        <Link href={`/laporan/${p.id}`} className="text-sm font-semibold text-[#0F172A] hover:text-[#1e3a8a] hover:underline">
                          {p.rabItem.name}
                        </Link>
                        <div className="mt-0.5 text-xs text-[#64748B]">
                          <span className="font-mono">{p.rabItem.code}</span> · oleh{" "}
                          {p.suggestedBy?.fullName ?? "?"} · {dtFmt.format(p.createdAt)}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${REPORT_STATE_CLASS[p.state]}`}>
                        {REPORT_STATE_LABEL[p.state]}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-[#F8FAFC] p-3 text-center">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-[#94A3B8]">Dilaporkan</div>
                        <div className="text-sm font-bold text-[#0F172A]">{volFmt.format(done)} {unit}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-[#94A3B8]">Kumulatif</div>
                        <div className="text-sm font-bold text-[#0F172A]">
                          {volFmt.format(cumulative)}{planned != null ? ` / ${volFmt.format(planned)}` : ""} {unit}
                        </div>
                        {pct != null && <div className="text-[11px] text-[#64748B]">{pct.toFixed(0)}%</div>}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-[#94A3B8]">Sisa</div>
                        <div className={`text-sm font-bold ${remaining != null && remaining < 0 ? "text-[#DC2626]" : "text-[#0F172A]"}`}>
                          {remaining != null ? `${volFmt.format(remaining)} ${unit}` : "—"}
                        </div>
                      </div>
                    </div>

                    {p.notes && <div className="mt-2 text-xs text-[#1e3a8a]">Catatan: “{p.notes}”</div>}
                    <PhotoStrip photos={p.photos} viewById={viewById} />

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#F1F5F9] pt-3">
                      <form action={approveItem.bind(null, p.id)}>
                        <button
                          type="submit"
                          className="rounded-md bg-[#16A34A] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[#15803D]"
                        >
                          Setujui
                        </button>
                      </form>
                      <form action={rejectItem.bind(null, p.id)} className="flex flex-1 items-center gap-2">
                        <input
                          name="reason"
                          placeholder="alasan tolak…"
                          maxLength={200}
                          className="min-w-0 flex-1 rounded-md border border-[#E2E8F0] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#DC2626]"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-[#DC2626] px-3 py-1.5 text-xs font-semibold text-[#DC2626] transition hover:bg-[#FEE2E2]"
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

      {/* Sudah disetujui — sebelumnya tidak ada */}
      <section>
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
          Sudah disetujui ({approved.length})
        </div>
        {approved.length === 0 ? (
          <p className="text-sm text-[#64748B]">Belum ada laporan yang disetujui.</p>
        ) : (
          <div className="space-y-2.5">
            {approved.map((a) => {
              const meta = itemMeta.get(a.rabItemId);
              const unit = meta?.unit ?? a.rabItem.unit ?? "";
              return (
                <div key={a.id} className="rounded-xl border border-[#E2E8F0] bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#1e3a8a]">{meta?.locName ?? ""}</div>
                      <Link href={`/laporan/${a.id}`} className="text-sm font-semibold text-[#0F172A] hover:text-[#1e3a8a] hover:underline">
                        {a.rabItem.name}
                      </Link>
                      <div className="mt-0.5 text-xs text-[#64748B]">
                        <span className="font-mono">{a.rabItem.code}</span> · lapor:{" "}
                        {a.suggestedBy?.fullName ?? "?"}
                        {a.approvedBy ? ` · setuju: ${a.approvedBy.fullName}` : ""}
                        {a.approvedAt ? ` · ${dtFmt.format(a.approvedAt)}` : ""}
                      </div>
                      <Link href={`/laporan/${a.id}`} className="mt-1 inline-block text-xs font-semibold text-[#1e3a8a] hover:underline">
                        Lihat detail →
                      </Link>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold tabular-nums text-[#0F172A]">
                        {volFmt.format(a.volumeDone.toNumber())} {unit}
                      </div>
                      <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11px] font-medium text-[#16A34A]">
                        Disetujui
                      </span>
                    </div>
                  </div>
                  {a.notes && <div className="mt-1.5 text-xs text-[#1e3a8a]">Catatan: “{a.notes}”</div>}
                  <PhotoStrip photos={a.photos} viewById={viewById} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
