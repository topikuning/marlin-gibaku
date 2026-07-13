import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canViewDashboard, isCrossLocation } from "@/lib/roles";
import { formatRupiahShort } from "@/lib/format";
import { getProcRows, rollup, canSetStage } from "@/lib/procurement";
import { PageHeader } from "@/components/knmp/page-header";
import { PengadaanGrid } from "./pengadaan-grid";

export default async function PengadaanPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  if (!canViewDashboard(role)) notFound();

  const sel = {
    id: true,
    slug: true,
    name: true,
    regency: true,
    province: true,
    procurementStage: true,
    contract: { select: { contractValue: true, contractor: { select: { name: true } } } },
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

  const rows = await getProcRows(locations);
  const r = rollup(rows);
  const canEdit = canSetStage(role);

  return (
    <>
      <PageHeader
        eyebrow="Pengadaan"
        title="Pengadaan (PBJ)"
        subtitle="Tahap pengadaan di-set per lokasi; ringkasan di bawah untuk pandangan eksekutif."
      />

      {/* KPI */}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Kpi label="Total lokasi" value={r.count.toLocaleString("id-ID")} />
        <Kpi label="Total HPS" value={formatRupiahShort(r.totalHps)} />
        <Kpi label="Total kontrak" value={formatRupiahShort(r.totalKontrak)} />
        <Kpi
          label="Selisih (HPS − Kontrak)"
          value={formatRupiahShort(r.selisih)}
          sub={r.totalHps > 0n ? `${((Number(r.selisih) / Number(r.totalHps)) * 100).toFixed(1)}% dari HPS` : undefined}
          hi
        />
      </div>

      {/* Funnel */}
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        Progres per tahap
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {r.byStage.map((s) => (
          <span
            key={s.stage}
            className="inline-flex items-center gap-2 rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-xs"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label} <b className="font-bold text-[#0F172A]">{s.count}</b>
          </span>
        ))}
      </div>

      {/* Per lokasi */}
      <PengadaanGrid
        canEdit={canEdit}
        rows={rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          regency: row.regency,
          province: row.province,
          contractor: row.contractor,
          hpsNum: Number(row.hps),
          kontrakNum: Number(row.kontrak),
          stage: row.stage,
        }))}
      />
    </>
  );
}

function Kpi({ label, value, sub, hi }: { label: string; value: string; sub?: string; hi?: boolean }) {
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">{label}</div>
      <div className={`mt-1 text-xl font-bold ${hi ? "text-[#16A34A]" : "text-[#0F172A]"}`}>{value}</div>
      {sub && <div className="text-xs text-[#64748B]">{sub}</div>}
    </div>
  );
}
