import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { formatRupiah } from "@/lib/format";
import { ContractorForm, ContractForm } from "./kontrak-forms";

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
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        MARLIN · Kontrak
      </div>
      <h1 className="mb-1 text-3xl font-semibold text-[#0F172A]">
        Kontrak & Kontraktor
      </h1>
      <p className="mb-8 text-sm text-[#0F766E]">
        1 kontraktor bisa punya banyak kontrak; 1 kontrak bisa mencakup banyak
        lokasi (DECISIONS 016–017).
      </p>

      {/* ── Kontraktor ── */}
      <section className="mb-6 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
        <div className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
          Tambah kontraktor
        </div>
        <ContractorForm />
      </section>

      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        Kontraktor ({contractors.length})
      </div>
      <div className="mb-10 overflow-x-auto rounded-lg border border-[#E2E8F0]">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#FFFFFF] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
              <th className="px-4 py-2.5 font-semibold">Nama</th>
              <th className="px-4 py-2.5 font-semibold">NPWP</th>
              <th className="px-4 py-2.5 text-center font-semibold">Kontrak</th>
            </tr>
          </thead>
          <tbody>
            {contractors.map((c) => (
              <tr key={c.id} className="border-b border-[#EEF2F6] last:border-0">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{c.name}</td>
                <td className="px-4 py-2.5 text-[#64748B]">{c.npwp ?? "—"}</td>
                <td className="px-4 py-2.5 text-center tabular-nums text-[#0F172A]">{c._count.contracts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Kontrak ── */}
      <section className="mb-6 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
        <div className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
          Tambah kontrak
        </div>
        <ContractForm contractors={contractors.map((c) => ({ id: c.id, name: c.name }))} />
      </section>

      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        Kontrak ({contracts.length})
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#FFFFFF] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
              <th className="px-4 py-2.5 font-semibold">Nomor SPK</th>
              <th className="px-4 py-2.5 font-semibold">Kontraktor</th>
              <th className="px-4 py-2.5 text-right font-semibold">Nilai</th>
              <th className="px-4 py-2.5 font-semibold">Periode</th>
              <th className="px-4 py-2.5 text-center font-semibold">Lokasi</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((k) => (
              <tr key={k.id} className="border-b border-[#EEF2F6] last:border-0">
                <td className="px-4 py-2.5 font-mono text-[12px] text-[#0F172A]">{k.contractNumber}</td>
                <td className="px-4 py-2.5 text-[#0F172A]">{k.contractor.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#0F172A]">{formatRupiah(k.contractValue)}</td>
                <td className="px-4 py-2.5 text-xs text-[#64748B]">
                  {dateFmt.format(k.startDate)} – {dateFmt.format(k.endDate)}
                </td>
                <td className="px-4 py-2.5 text-center tabular-nums text-[#0F172A]">{k._count.locations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
