import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canApprove, PENDING_STATES, REPORT_STATE_LABEL, REPORT_STATE_CLASS } from "@/lib/report";
import { hasLocationAccess } from "@/lib/access";
import { getRabItemLocationId } from "@/lib/rab";
import { presignKeys } from "@/lib/photos";
import { approveItem, rejectItem } from "../actions";

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const dtFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short" });

export default async function LaporanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  const { id } = await params;

  const item = await db.dailyReportItem.findUnique({
    where: { id },
    include: {
      rabItem: { select: { code: true, name: true, unit: true, volume: true } },
      suggestedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      photos: { select: { id: true, r2Key: true }, orderBy: { createdAt: "asc" } },
      report: { select: { reportDate: true } },
    },
  });
  if (!item) notFound();

  const locationId = await getRabItemLocationId(item.rabItemId);
  const location = locationId
    ? await db.location.findUnique({ where: { id: locationId }, select: { name: true, slug: true, regency: true, province: true } })
    : null;

  // Akses: approver dengan akses lokasi, ATAU pelapor item ini.
  const isReporter = item.suggestedByUserId === userId;
  const approverAccess =
    canApprove(role) && locationId != null && (await hasLocationAccess(userId, role, locationId));
  if (!isReporter && !approverAccess) notFound();

  const photoUrls = await presignKeys(item.photos.map((p) => p.r2Key));

  const unit = item.rabItem.unit ?? "";
  const done = item.volumeDone.toNumber();
  const cumulative = item.volumeCumulative.toNumber();
  const planned = item.rabItem.volume != null ? item.rabItem.volume.toNumber() : null;
  const remaining = planned != null ? planned - cumulative : null;
  const pct = planned && planned > 0 ? (cumulative / planned) * 100 : null;
  const isPending = PENDING_STATES.includes(item.state);
  const canDecide = approverAccess && isPending;

  return (
    <>
      <Link href="/laporan" className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline">
        ← Laporan
      </Link>

      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#1e3a8a]">
          {location ? `${location.name} · ${location.regency}, ${location.province}` : ""}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${REPORT_STATE_CLASS[item.state]}`}>
          {REPORT_STATE_LABEL[item.state]}
        </span>
      </div>
      <h1 className="mb-1 text-2xl font-bold text-[#0F172A]">{item.rabItem.name}</h1>
      <p className="mb-6 text-sm text-[#64748B]">
        <span className="font-mono">{item.rabItem.code}</span> · satuan {unit || "—"}
      </p>

      {/* Angka utama */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Dilaporkan" value={`${volFmt.format(done)} ${unit}`} big />
        <Stat label="Kumulatif" value={`${volFmt.format(cumulative)} ${unit}`} sub={pct != null ? `${pct.toFixed(0)}% dari rencana` : undefined} />
        <Stat label="Rencana" value={planned != null ? `${volFmt.format(planned)} ${unit}` : "—"} />
        <Stat label="Sisa" value={remaining != null ? `${volFmt.format(remaining)} ${unit}` : "—"} tone={remaining != null && remaining < 0 ? "bad" : undefined} />
      </div>

      {/* Meta */}
      <section className="mb-6 rounded-xl border border-[#E2E8F0] bg-white p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Dilaporkan oleh" value={item.suggestedBy?.fullName ?? "—"} />
          <Row label="Waktu lapor" value={dtFmt.format(item.createdAt)} />
          <Row label="Disetujui oleh" value={item.approvedBy?.fullName ?? (isPending ? "— (menunggu)" : "—")} />
          <Row label="Waktu setuju" value={item.approvedAt ? dtFmt.format(item.approvedAt) : "—"} />
          {item.workerCount != null && <Row label="Jumlah pekerja" value={`${item.workerCount} orang`} />}
          {item.report?.reportDate && (
            <Row label="Masuk laporan tanggal" value={new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(item.report.reportDate)} />
          )}
          {item.rejectedReason && <Row label="Alasan ditolak" value={item.rejectedReason} />}
        </dl>
        {item.notes && (
          <div className="mt-4 rounded-lg bg-[#F8FAFC] px-4 py-3 text-sm text-[#0F172A]">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">Catatan lapangan</span>
            <div className="mt-1">“{item.notes}”</div>
          </div>
        )}
        {item.constraintNote && (
          <div className="mt-3 rounded-lg border-l-4 border-[#B45309] bg-[#FEF3C7] px-4 py-3 text-sm text-[#B45309]">
            <span className="text-xs font-semibold uppercase tracking-wide">Kendala</span>
            <div className="mt-1">{item.constraintNote}</div>
          </div>
        )}
      </section>

      {/* Foto */}
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
        Foto bukti ({item.photos.length})
      </div>
      {item.photos.length === 0 ? (
        <p className="mb-6 text-sm text-[#64748B]">Tidak ada foto pada laporan ini.</p>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {item.photos.map((p) => {
            const url = photoUrls.get(p.r2Key);
            return url ? (
              <a key={p.id} href={url} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="Foto bukti" className="h-48 w-full rounded-xl border border-[#E2E8F0] object-cover" />
              </a>
            ) : (
              <div key={p.id} className="flex h-48 w-full items-center justify-center rounded-xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#94A3B8]">
                📷 tersimpan (R2 belum aktif)
              </div>
            );
          })}
        </div>
      )}

      {/* Aksi (kalau masih pending & user approver) */}
      {canDecide && (
        <section className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <div className="mb-3 text-sm font-semibold text-[#0F172A]">Keputusan</div>
          <div className="flex flex-wrap items-center gap-2">
            <form action={approveItem.bind(null, item.id)}>
              <button type="submit" className="rounded-md bg-[#16A34A] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#15803D]">
                Setujui
              </button>
            </form>
            <form action={rejectItem.bind(null, item.id)} className="flex flex-1 items-center gap-2">
              <input name="reason" placeholder="alasan tolak…" maxLength={200} className="min-w-0 flex-1 rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm outline-none focus:border-[#DC2626]" />
              <button type="submit" className="rounded-md border border-[#DC2626] px-4 py-2 text-sm font-semibold text-[#DC2626] transition hover:bg-[#FEE2E2]">
                Tolak
              </button>
            </form>
          </div>
        </section>
      )}
    </>
  );
}

function Stat({ label, value, sub, big, tone }: { label: string; value: string; sub?: string; big?: boolean; tone?: "bad" }) {
  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#94A3B8]">{label}</div>
      <div className={`mt-1 font-bold ${big ? "text-2xl" : "text-lg"} ${tone === "bad" ? "text-[#DC2626]" : "text-[#0F172A]"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[#64748B]">{sub}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#F1F5F9] pb-2 last:border-0 sm:last:border-b">
      <dt className="text-[#64748B]">{label}</dt>
      <dd className="text-right font-medium text-[#0F172A]">{value}</dd>
    </div>
  );
}
