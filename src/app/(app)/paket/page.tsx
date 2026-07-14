import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canViewDashboard, isCrossLocation } from "@/lib/roles";
import { formatRupiahShort } from "@/lib/format";
import { getProcRows, rollup } from "@/lib/procurement";
import {
  canManageProspek,
  PROSPEK_STAGE_LABEL,
  PROSPEK_STAGE_CLASS,
} from "@/lib/prospek";
import { PageHeader } from "@/components/knmp/page-header";
import { PengadaanGrid } from "./paket-grid";

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
    contractId: true,
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
  const canProspek = canManageProspek(role);

  // Prospek (tender) yang belum jadi kontrak — bagian dari alur pengadaan.
  const prospekList = canProspek
    ? await db.prospek.findMany({
        where: { stage: { notIn: ["jadi_kontrak", "batal"] } },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          province: true,
          hpsValue: true,
          stage: true,
          _count: { select: { lokasi: true } },
        },
      })
    : [];

  // Paket/kontrak berjalan (sudah tanda tangan).
  const contracts = await db.contract.findMany({
    orderBy: { signedDate: "desc" },
    select: {
      id: true,
      contractNumber: true,
      contractValue: true,
      hpsValue: true,
      contractor: { select: { name: true } },
      amendments: { select: { valueDelta: true } },
      _count: { select: { locations: true } },
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Paket"
        title="Paket Pekerjaan"
        subtitle="Daur hidup tiap paket: prospek/tender → kontrak → pelaksanaan → serah terima. Tahap per lokasi & ringkasan eksekutif di bawah."
      />

      {/* Prospek / tender berjalan */}
      {canProspek && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
              Prospek / tender berjalan ({prospekList.length})
            </div>
            <div className="flex items-center gap-3">
              <Link href="/kontrak" className="text-sm font-medium text-[#1e3a8a] hover:underline">
                Master kontraktor & kontrak
              </Link>
              <Link
                href="/paket/prospek/baru"
                className="rounded-md bg-[#1e3a8a] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#172554]"
              >
                + Prospek baru
              </Link>
            </div>
          </div>
          {prospekList.length === 0 ? (
            <p className="text-sm text-[#64748B]">
              Belum ada prospek berjalan. Mulai lacak paket sejak tahap tender dengan “Prospek baru”.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {prospekList.map((p) => (
                <Link
                  key={p.id}
                  href={`/paket/prospek/${p.id}`}
                  className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-[#1e3a8a]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${PROSPEK_STAGE_CLASS[p.stage]}`}>
                      {PROSPEK_STAGE_LABEL[p.stage]}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {p.province ?? "—"} · {p._count.lokasi} lokasi · HPS {formatRupiahShort(p.hpsValue)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Paket / kontrak berjalan */}
      {contracts.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
            Paket / kontrak berjalan ({contracts.length})
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {contracts.map((c) => {
              const delta = c.amendments.reduce((s, a) => s + a.valueDelta, 0n);
              const berjalan = c.contractValue + delta;
              return (
                <Link
                  key={c.id}
                  href={`/paket/${c.id}`}
                  className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-[#1e3a8a]"
                >
                  <div className="text-sm font-semibold text-slate-900">{c.contractNumber}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{c.contractor.name}</div>
                  <div className="mt-2 text-xs text-slate-500">
                    {c._count.locations} lokasi · nilai {formatRupiahShort(berjalan)}
                    {delta !== 0n && <span className="text-amber-600"> (+adendum)</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

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
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
        Progres per tahap
      </div>
      <p className="mb-3 text-xs text-[#64748B]">
        Tahap dibaca otomatis dari dokumen terunggah (SPMK, MC-0, BAST, dst.) — bukan dipilih manual.
      </p>
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
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">{label}</div>
      <div className={`mt-1 text-xl font-bold ${hi ? "text-[#16A34A]" : "text-[#0F172A]"}`}>{value}</div>
      {sub && <div className="text-xs text-[#64748B]">{sub}</div>}
    </div>
  );
}
