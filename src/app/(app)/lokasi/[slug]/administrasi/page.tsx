import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";
import { hasLocationAccess } from "@/lib/access";
import { PageHeader } from "@/components/knmp/page-header";
import {
  KKP_ADMIN_FLOW,
  FLOW_TOTAL,
  PIC_LABEL,
  type FlowItem,
} from "@/lib/kkp-admin-flow";

export default async function AdministrasiPage({
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
  if (!isCrossLocation(role) && !(await hasLocationAccess(userId, role, location.id))) {
    notFound();
  }

  // Auto-deteksi status: tipe dokumen apa saja yang sudah terupload untuk lokasi ini.
  const docs = await db.document.findMany({
    where: { locationId: location.id },
    select: { type: true },
  });
  const presentTypes = new Set(docs.map((d) => d.type));

  const isDone = (it: FlowItem) => !!it.docType && presentTypes.has(it.docType);
  const doneTotal = KKP_ADMIN_FLOW.reduce(
    (n, p) => n + p.items.filter(isDone).length,
    0
  );
  const pct = Math.round((doneTotal / FLOW_TOTAL) * 100);

  return (
    <>
      <Link
        href={`/lokasi/${slug}`}
        className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline"
      >
        ← Detail Lokasi
      </Link>
      <PageHeader
        eyebrow="Administrasi KNMP"
        title={`Alur Administrasi — ${location.name}`}
        subtitle="Checklist 40 milestone dokumen resmi KKP/DJPT, dari RAB HPS sampai serah terima. Status ✓ terdeteksi otomatis dari Arsip Dokumen yang sudah diunggah."
      />

      {/* Ringkasan kepatuhan */}
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-semibold text-slate-900">
            Kelengkapan dokumen (terdeteksi)
          </div>
          <div className="text-sm tabular-nums text-slate-500">
            {doneTotal} / {FLOW_TOTAL} terdeteksi · {pct}%
          </div>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-[#1e3a8a]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Milestone tanpa penanda ✓ otomatis (mis. surat internal, pakta) tetap
          harus dilengkapi manual — unggah berkasnya di{" "}
          <Link href={`/lokasi/${slug}/dokumen`} className="text-[#1e3a8a] hover:underline">
            Arsip Dokumen
          </Link>
          .
        </p>
      </section>

      <div className="space-y-6">
        {KKP_ADMIN_FLOW.map((phase) => {
          const auto = phase.items.filter((it) => it.docType);
          const done = auto.filter(isDone).length;
          return (
            <section
              key={phase.key}
              className="rounded-xl border border-slate-200 bg-white"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  {phase.title}
                </h2>
                {auto.length > 0 && (
                  <span className="text-xs tabular-nums text-slate-400">
                    {done}/{auto.length} auto-deteksi
                  </span>
                )}
              </div>
              <ul className="divide-y divide-slate-100">
                {phase.items.map((it) => {
                  const done = isDone(it);
                  return (
                    <li
                      key={it.no}
                      className="flex items-center gap-3 px-5 py-2.5"
                    >
                      <StatusDot done={done} auto={!!it.docType} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-slate-800">
                          <span className="mr-1.5 tabular-nums text-slate-400">
                            {it.no}.
                          </span>
                          {it.label}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {PIC_LABEL[it.pic]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function StatusDot({ done, auto }: { done: boolean; auto: boolean }) {
  if (done) {
    return (
      <span
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#16A34A] text-white"
        title="Terdeteksi dari Arsip Dokumen"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-slate-300"
      title={auto ? "Belum terdeteksi — unggah dokumennya" : "Pantau manual"}
    />
  );
}
