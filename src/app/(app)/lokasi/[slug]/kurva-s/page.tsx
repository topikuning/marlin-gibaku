import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { getActivePlan, getPlanHistory, getWeeklySuggestions } from "@/lib/scurve-plan";
import { getScurveSeries } from "@/lib/scurve-data";
import { ScurveChart } from "@/components/knmp/scurve-chart";
import { EditForm } from "./edit-form";

const dateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });

const SOURCE_LABEL: Record<string, string> = {
  auto: "Auto (rumus)",
  adendum: "Adendum",
  manual: "Manual (diedit)",
};
const STATUS_CLASS: Record<string, string> = {
  active: "bg-[#DCFCE7] text-[#16A34A]",
  superseded: "bg-slate-100 text-slate-400",
  draft: "bg-[#FEF3C7] text-[#B45309]",
};

export default async function KurvaSPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  if (!canManageUsers(session.user.role)) notFound();
  const { slug } = await params;

  const location = await db.location.findUnique({
    where: { slug },
    select: { id: true, name: true, contract: { select: { startDate: true } } },
  });
  if (!location) notFound();

  const [plan, history, series, suggestions] = await Promise.all([
    getActivePlan(location.id),
    getPlanHistory(location.id),
    getScurveSeries(location.id, location.contract.startDate),
    getWeeklySuggestions(location.id),
  ]);

  return (
    <>
      <Link href={`/lokasi/${slug}`} className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline">
        ← Detail Lokasi
      </Link>
      <h1 className="mb-1 text-3xl font-semibold text-[#0F172A]">Atur Kurva-S — {location.name}</h1>
      <p className="mb-6 text-sm text-[#1e3a8a]">
        Rencana di-generate otomatis dari RAB + durasi kontrak, dan bisa kamu edit.
        Saat adendum, kurva-S dibuat ulang dan versi lama diarsipkan.
      </p>

      <section className="mb-6 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-5">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
          Preview kurva-S aktif
        </div>
        <ScurveChart series={series} />
      </section>

      {plan ? (
        <section className="mb-8 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900">Plan #{plan.planNo}</span>
            <span className="rounded-full bg-[#EEF2F6] px-2 py-0.5 text-[11px] font-medium text-[#1e3a8a]">
              {SOURCE_LABEL[plan.source] ?? plan.source}
            </span>
            <span className="text-xs text-slate-500">
              {plan.contractDays} hari · {plan.milestones.length} minggu · {dateFmt.format(plan.createdAt)}
              {plan.createdBy ? ` · ${plan.createdBy.fullName}` : ""}
            </span>
          </div>
          <EditForm
            planId={plan.id}
            locationId={location.id}
            slug={slug}
            milestones={plan.milestones.map((m) => ({
              weekNumber: m.weekNumber,
              targetProgressPct: m.targetProgressPct.toNumber(),
            }))}
          />
        </section>
      ) : (
        <section className="mb-8 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-5">
          <p className="text-sm text-slate-500">
            Belum ada plan kurva-S untuk lokasi ini. Import RAB dulu, atau
            generate dari rumus setelah RAB aktif tersedia.
          </p>
        </section>
      )}

      <section className="mb-8 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-5">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
          Saran pekerjaan per minggu
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Dari pembobotan nilai tiap item + urutan dependensi konstruksi. Cakupan
          klasifikasi otomatis {suggestions.classifiedPct.toFixed(0)}% nilai.
        </p>
        {suggestions.weekly.length === 0 ? (
          <p className="text-sm text-slate-400">Belum bisa dihitung (RAB/aktif belum ada).</p>
        ) : (
          <div className="space-y-1.5">
            {suggestions.weekly.map((w) => (
              <div key={w.week} className="flex flex-wrap items-start gap-2 border-b border-slate-50 py-1.5 last:border-0">
                <span className="w-16 shrink-0 text-xs font-semibold text-slate-500">Minggu {w.week}</span>
                <div className="flex flex-wrap gap-1.5">
                  {w.trades.map((t) => (
                    <span key={t.key} className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-[11px] text-[#1e3a8a]">
                      {t.label} · {t.pct.toFixed(1)}%
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
        Riwayat plan ({history.length})
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {history.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-400">Belum ada plan.</p>
        ) : (
          history.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 last:border-0">
              <div>
                <span className="font-semibold text-slate-900">Plan #{h.planNo}</span>{" "}
                <span className="text-xs text-slate-500">
                  {SOURCE_LABEL[h.source] ?? h.source} · {h.contractDays} hari · {dateFmt.format(h.createdAt)}
                  {h.createdBy ? ` · ${h.createdBy.fullName}` : ""}
                </span>
                {h.note && <div className="text-xs text-slate-500">“{h.note}”</div>}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[h.status]}`}>
                {h.status}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
