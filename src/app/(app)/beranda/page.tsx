import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation, ROLE_LABEL } from "@/lib/roles";

export default async function BerandaPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");

  const { id, name, role } = session.user;
  const crossLocation = isCrossLocation(role);

  const totalLocations = crossLocation ? await db.location.count() : 0;
  const assignments = crossLocation
    ? []
    : await db.userLocationAssignment.findMany({
        where: { userId: id, unassignedAt: null },
        include: { location: { select: { slug: true, name: true, province: true } } },
        orderBy: { assignedAt: "asc" },
      });

  return (
    <>
      <h1 className="mb-1 text-4xl font-semibold text-[#0F172A]">
        Halo, {name}.
      </h1>
      <p className="mb-8 text-[#0F766E]">
        Anda masuk sebagai{" "}
        <span className="font-semibold">{ROLE_LABEL[role]}</span>.
      </p>

      {crossLocation ? (
        <section className="mb-6 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
            Cakupan akses
          </div>
          <p className="text-[#0F172A]">
            Akses <span className="font-semibold">semua lokasi</span> —{" "}
            {totalLocations.toLocaleString("id-ID")} lokasi di sistem.
          </p>
          <Link
            href="/lokasi"
            className="mt-3 inline-block rounded-md bg-[#0F766E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#115E59]"
          >
            Lihat daftar lokasi →
          </Link>
        </section>
      ) : (
        <section className="mb-6 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
            Lokasi yang ditugaskan ({assignments.length})
          </div>
          {assignments.length === 0 ? (
            <p className="text-sm text-[#64748B]">
              Belum ada lokasi yang ditugaskan. Hubungi admin untuk penugasan.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {assignments.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/lokasi/${a.location.slug}`}
                    className="flex items-center justify-between rounded px-2 py-1.5 text-sm transition hover:bg-[#F1F5F9]"
                  >
                    <span className="font-medium text-[#0F172A]">
                      {a.location.name}
                    </span>
                    <span className="text-xs text-[#64748B]">
                      {a.location.province}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
