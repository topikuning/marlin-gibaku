import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canViewDashboard } from "@/lib/roles";
import { formatRupiah } from "@/lib/format";
import { canManageProspek } from "@/lib/prospek";
import { KKP_ADMIN_FLOW, FLOW_TOTAL, type FlowItem } from "@/lib/kkp-admin-flow";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_CLASS } from "@/lib/roles";
import { PageHeader } from "@/components/knmp/page-header";
import { AdendumForm } from "./adendum-form";

const dFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });

export default async function PaketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  if (!canViewDashboard(session.user.role)) notFound();
  const { id } = await params;

  const contract = await db.contract.findUnique({
    where: { id },
    include: {
      contractor: { select: { name: true } },
      amendments: { orderBy: { effectiveDate: "asc" } },
      locations: {
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true, regency: true, province: true, status: true },
      },
    },
  });
  if (!contract) notFound();

  const canEdit = canManageProspek(session.user.role);

  // Nilai berjalan setelah adendum
  const totalDelta = contract.amendments.reduce((s, a) => s + a.valueDelta, 0n);
  const nilaiBerjalan = contract.contractValue + totalDelta;
  const dayDelta = contract.amendments.reduce((s, a) => s + a.endDateDelta, 0);
  const endBerjalan = new Date(contract.endDate.getTime() + dayDelta * 86_400_000);
  const hps = contract.hpsValue ?? null;

  // Kelengkapan administrasi paket: dokumen di level kontrak ATAU salah satu lokasi.
  const locIds = contract.locations.map((l) => l.id);
  const docs = await db.document.findMany({
    where: {
      OR: [{ contractId: contract.id }, locIds.length ? { locationId: { in: locIds } } : { id: "" }],
    },
    select: { type: true },
  });
  const presentTypes = new Set(docs.map((d) => d.type));
  const isDone = (it: FlowItem) => !!it.docType && presentTypes.has(it.docType);
  const doneTotal = KKP_ADMIN_FLOW.reduce((n, p) => n + p.items.filter(isDone).length, 0);
  const adminPct = Math.round((doneTotal / FLOW_TOTAL) * 100);

  return (
    <>
      <Link href="/paket" className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline">
        ← Paket
      </Link>
      <PageHeader
        eyebrow="Paket Pekerjaan"
        title={contract.contractNumber}
        subtitle={`${contract.contractor.name} · ${contract.locations.length} lokasi`}
      />

      {/* Nilai */}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card label="Nilai HPS">{hps != null ? formatRupiah(hps) : "—"}</Card>
        <Card label="Nilai Kontrak">{formatRupiah(contract.contractValue)}</Card>
        <Card label="Nilai Berjalan (+adendum)" hi>
          {formatRupiah(nilaiBerjalan)}
        </Card>
        <Card label="Selesai (rencana)">{dFmt.format(endBerjalan)}</Card>
      </div>

      {/* Adendum timeline */}
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 text-sm font-semibold text-slate-900">Riwayat Adendum / CCO</div>
        <ol className="relative space-y-3 border-l border-slate-200 pl-5">
          <li className="relative">
            <span className="absolute -left-[23px] top-1 h-3 w-3 rounded-full bg-[#1e3a8a]" />
            <div className="text-sm text-slate-800">
              <b>Kontrak awal</b> — {formatRupiah(contract.contractValue)}
            </div>
            <div className="text-xs text-slate-500">
              {dFmt.format(contract.signedDate)} · selesai {dFmt.format(contract.endDate)}
            </div>
          </li>
          {contract.amendments.map((a) => {
            const naik = a.valueDelta >= 0n;
            return (
              <li key={a.id} className="relative">
                <span className="absolute -left-[23px] top-1 h-3 w-3 rounded-full bg-amber-500" />
                <div className="text-sm text-slate-800">
                  <b>{a.ccoNumber}</b> — {a.reason}
                </div>
                <div className="text-xs text-slate-600">
                  <span className={naik ? "text-[#15803D]" : "text-[#DC2626]"}>
                    {naik ? "+" : "−"}
                    {formatRupiah(a.valueDelta < 0n ? -a.valueDelta : a.valueDelta)}
                  </span>
                  {a.endDateDelta !== 0 && (
                    <>
                      {" · waktu "}
                      {a.endDateDelta > 0 ? "+" : ""}
                      {a.endDateDelta} hari
                    </>
                  )}
                  {" · berlaku "}
                  {dFmt.format(a.effectiveDate)}
                </div>
              </li>
            );
          })}
          {contract.amendments.length === 0 && (
            <li className="text-sm text-slate-400">Belum ada adendum.</li>
          )}
        </ol>

        {canEdit && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Tambah Adendum (CCO)</div>
            <AdendumForm contractId={contract.id} />
          </div>
        )}
      </section>

      {/* Administrasi */}
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-semibold text-slate-900">Kelengkapan administrasi (paket)</div>
          <div className="text-sm tabular-nums text-slate-500">{doneTotal}/{FLOW_TOTAL} · {adminPct}%</div>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-[#1e3a8a]" style={{ width: `${adminPct}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Terdeteksi dari Arsip Dokumen di level paket & lokasi. Detail per lokasi di
          tiap Alur Administrasi lokasi di bawah.
        </p>
      </section>

      {/* Lokasi */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 text-sm font-semibold text-slate-900">
          Lokasi dalam paket ({contract.locations.length})
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {contract.locations.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <Link href={`/lokasi/${l.slug}`} className="font-medium text-[#1e3a8a] hover:underline">
                  {l.name}
                </Link>
                <span className="ml-2 text-xs text-slate-400">
                  {[l.regency, l.province].filter(Boolean).join(", ")}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${LOCATION_STATUS_CLASS[l.status]}`}>
                  {LOCATION_STATUS_LABEL[l.status]}
                </span>
                <Link href={`/lokasi/${l.slug}/administrasi`} className="text-xs text-[#1e3a8a] hover:underline">
                  Alur admin →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Card({ label, children, hi }: { label: string; children: React.ReactNode; hi?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${hi ? "border-[#1e3a8a]/30 bg-[#eff6ff]" : "border-slate-200 bg-white"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums text-slate-900">{children}</div>
    </div>
  );
}
