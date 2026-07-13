import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { PageHeader } from "@/components/knmp/page-header";
import { ContractorForm, ContractForm } from "./kontrak-forms";
import { ContractorsGrid, ContractsGrid } from "./kontrak-grids";

const dateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });

export default async function KontrakPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  if (!canManageUsers(session.user.role)) notFound();

  const [contractors, contracts] = await Promise.all([
    db.contractor.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, npwp: true, _count: { select: { contracts: true } } },
    }),
    db.contract.findMany({
      orderBy: { contractNumber: "asc" },
      include: {
        contractor: { select: { name: true } },
        _count: { select: { locations: true } },
      },
    }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Kontrak"
        title="Kontrak & Kontraktor"
        subtitle="1 kontraktor bisa punya banyak kontrak; 1 kontrak bisa mencakup banyak lokasi."
      />

      {/* ── Kontraktor ── */}
      <section className="mb-6 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
        <div className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
          Tambah kontraktor
        </div>
        <ContractorForm />
      </section>

      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
        Kontraktor ({contractors.length})
      </div>
      <div className="mb-10">
        <ContractorsGrid
          rows={contractors.map((c) => ({
            id: c.id,
            name: c.name,
            npwp: c.npwp ?? "",
            contracts: c._count.contracts,
          }))}
        />
      </div>

      {/* ── Kontrak ── */}
      <section className="mb-6 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
        <div className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
          Tambah kontrak
        </div>
        <ContractForm contractors={contractors.map((c) => ({ id: c.id, name: c.name }))} />
      </section>

      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
        Kontrak ({contracts.length})
      </div>
      <ContractsGrid
        rows={contracts.map((k) => ({
          id: k.id,
          contractNumber: k.contractNumber,
          contractor: k.contractor.name,
          valueNum: Number(k.contractValue),
          periodStr: `${dateFmt.format(k.startDate)} – ${dateFmt.format(k.endDate)}`,
          startMs: k.startDate.getTime(),
          locations: k._count.locations,
        }))}
      />
    </>
  );
}
