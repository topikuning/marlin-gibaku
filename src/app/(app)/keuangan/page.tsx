import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canViewDashboard, canManageUsers, isCrossLocation } from "@/lib/roles";
import { formatRupiahShort } from "@/lib/format";
import { getFinanceRows, financeRollup } from "@/lib/finance";
import { MoneyCell } from "./money-cell";

const grp = new Intl.NumberFormat("id-ID");
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
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Keuangan</h1>
        <p className="text-sm text-slate-500">Serapan, penagihan, pengeluaran vs budget, dan kebutuhan dana.</p>
      </div>

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
        {canEdit && <div className="text-[11px] text-slate-400">Sel kuning bisa diedit (klik → ketik → keluar sel)</div>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2.5 font-medium">Lokasi</th>
              <th className="px-3 py-2.5 text-right font-medium">Kontrak</th>
              <th className="px-3 py-2.5 text-right font-medium">Terpasang</th>
              <th className="px-3 py-2.5 text-right font-medium">Ditagih</th>
              <th className="px-3 py-2.5 text-right font-medium">Dibayar</th>
              <th className="px-3 py-2.5 text-right font-medium">Belum Ditagih</th>
              <th className="px-3 py-2.5 text-right font-medium">Pengeluaran</th>
              <th className="px-3 py-2.5 text-right font-medium">Pagu</th>
              <th className="px-3 py-2.5 text-right font-medium">Keb. 30hr</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const over = row.budgetCap > 0n && row.spent > row.budgetCap;
              return (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/lokasi/${row.slug}`} className="font-medium text-slate-900 hover:text-[#0F766E]">{row.name}</Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{grp.format(Number(row.contract))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-900">{grp.format(Number(row.terpasang))}</td>
                  <td className="px-3 py-2">{canEdit ? <MoneyCell locationId={row.id} field="invoicedValue" value={Number(row.invoiced)} /> : <div className="text-right tabular-nums">{grp.format(Number(row.invoiced))}</div>}</td>
                  <td className="px-3 py-2">{canEdit ? <MoneyCell locationId={row.id} field="paidValue" value={Number(row.paid)} /> : <div className="text-right tabular-nums">{grp.format(Number(row.paid))}</div>}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">{grp.format(Number(row.belumDitagih))}</td>
                  <td className="px-3 py-2">{canEdit ? <MoneyCell locationId={row.id} field="spentValue" value={Number(row.spent)} /> : <div className="text-right tabular-nums">{grp.format(Number(row.spent))}</div>}</td>
                  <td className={`px-3 py-2 ${over ? "bg-[#FEF2F2]" : ""}`}>{canEdit ? <MoneyCell locationId={row.id} field="budgetCap" value={Number(row.budgetCap)} /> : <div className="text-right tabular-nums">{grp.format(Number(row.budgetCap))}</div>}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{grp.format(Number(row.need30d))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
