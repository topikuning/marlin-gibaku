import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canViewDashboard, canManageUsers, isCrossLocation } from "@/lib/roles";
import { formatRupiahShort } from "@/lib/format";
import { getFinanceRows, financeRollup } from "@/lib/finance";
import { PageHeader } from "@/components/knmp/page-header";
import { KeuanganGrid } from "./keuangan-grid";

const short = (b: bigint) => formatRupiahShort(b);

export default async function KeuanganPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  if (!canViewDashboard(role)) notFound();

  const sel = {
    id: true,
    slug: true,
    name: true,
    invoicedValue: true,
    paidValue: true,
    spentValue: true,
    budgetCap: true,
    contract: { select: { startDate: true, contractValue: true } },
  };
  const locations = isCrossLocation(role)
    ? await db.location.findMany({ orderBy: [{ province: "asc" }, { name: "asc" }], select: sel })
    : (
        await db.userLocationAssignment.findMany({
          where: { userId, unassignedAt: null },
          include: { location: { select: sel } },
          orderBy: { assignedAt: "asc" },
        })
      ).map((a) => a.location);

  const rows = await getFinanceRows(locations);
  const r = financeRollup(rows);
  const canEdit = canManageUsers(role);
  const overBudget = rows.filter((x) => x.budgetCap > 0n && x.spent > x.budgetCap).length;

  return (
    <>
      <PageHeader
        eyebrow="Keuangan"
        title="Keuangan"
        subtitle="Serapan, penagihan, pengeluaran vs budget, dan kebutuhan dana."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Nilai Kontrak" value={short(r.contract)} />
        <Kpi label="Nilai Terpasang" value={short(r.terpasang)} />
        <Kpi label="Serapan (dibayar)" value={`${r.serapanPct.toFixed(1)}%`} sub={short(r.paid)} accent />
        <Kpi label="Selesai Blm Ditagih" value={short(r.belumDitagih)} />
        <Kpi label="Pengeluaran" value={short(r.spent)} sub={`vs pagu ${short(r.budgetCap)}`} status={overBudget > 0 ? "warn" : undefined} />
        <Kpi label="Kebutuhan 30 Hari" value={short(r.need30d)} />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Per Lokasi</div>
        {canEdit && <div className="text-[11px] text-slate-400">Kolom Ditagih/Dibayar/Pengeluaran/Pagu bisa diedit (klik → ketik → keluar sel)</div>}
      </div>
      <KeuanganGrid
        canEdit={canEdit}
        rows={rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          contract: Number(row.contract),
          terpasang: Number(row.terpasang),
          invoiced: Number(row.invoiced),
          paid: Number(row.paid),
          belumDitagih: Number(row.belumDitagih),
          spent: Number(row.spent),
          budgetCap: Number(row.budgetCap),
          need30d: Number(row.need30d),
        }))}
      />
      <p className="mt-2 text-xs text-slate-400">
        Terpasang, Belum Ditagih & Keb. 30hr dihitung otomatis. Ditagih/Dibayar/Pengeluaran/Pagu input manual.
      </p>
    </>
  );
}

function Kpi({ label, value, sub, accent, status }: { label: string; value: string; sub?: string; accent?: boolean; status?: "warn" }) {
  const c = status === "warn" ? "text-[#DC2626]" : accent ? "text-[#0F766E]" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1.5 text-lg font-bold tabular-nums ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">{sub}</div>}
    </div>
  );
}
