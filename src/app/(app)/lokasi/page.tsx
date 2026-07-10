import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation, LOCATION_STATUS_LABEL, LOCATION_STATUS_CLASS } from "@/lib/roles";
import { formatRupiahShort } from "@/lib/format";

export default async function LokasiPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");

  const { id, role } = session.user;

  // Scoping: lintas-lokasi lihat semua; scoped hanya yang ditugaskan.
  const where: Prisma.LocationWhereInput = isCrossLocation(role)
    ? {}
    : { assignments: { some: { userId: id, unassignedAt: null } } };

  const locations = await db.location.findMany({
    where,
    include: { contract: { include: { contractor: true } } },
    orderBy: [{ province: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
        MARLIN · Lokasi
      </div>
      <h1 className="mb-1 font-[Fraunces] text-3xl font-semibold text-[#1f2b38]">
        Daftar Lokasi
      </h1>
      <p className="mb-8 text-sm text-[#3A4E63]">
        {locations.length} lokasi{" "}
        {isCrossLocation(role) ? "di sistem" : "ditugaskan ke Anda"}.
      </p>

      {locations.length === 0 ? (
        <p className="text-sm text-[#8a9199]">Belum ada lokasi.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#EAE2D2]">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[#EAE2D2] bg-[#FDFBF6] text-left text-[11px] uppercase tracking-wide text-[#8a9199]">
                <th className="px-4 py-2.5 font-semibold">Lokasi</th>
                <th className="px-4 py-2.5 font-semibold">Provinsi</th>
                <th className="px-4 py-2.5 font-semibold">Kontraktor</th>
                <th className="px-4 py-2.5 text-right font-semibold">Nilai Kontrak</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => (
                <tr
                  key={loc.id}
                  className="border-b border-[#F0EADD] last:border-0 hover:bg-[#FDFBF6]"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/lokasi/${loc.slug}`}
                      className="font-semibold text-[#3A4E63] hover:underline"
                    >
                      {loc.name}
                    </Link>
                    <div className="text-xs text-[#8a9199]">{loc.regency}</div>
                  </td>
                  <td className="px-4 py-3 text-[#1f2b38]">{loc.province}</td>
                  <td className="px-4 py-3 text-[#1f2b38]">
                    {loc.contract.contractor.name}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#1f2b38]">
                    {formatRupiahShort(loc.contract.contractValue)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${LOCATION_STATUS_CLASS[loc.status]}`}
                    >
                      {LOCATION_STATUS_LABEL[loc.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
