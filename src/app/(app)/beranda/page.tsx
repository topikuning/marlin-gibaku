import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super Admin",
  program_director: "Program Director",
  regional_manager: "Regional Manager",
  project_manager: "Project Manager",
  site_manager: "Site Manager",
  field_supervisor: "Mandor (Field Supervisor)",
  exec_viewer: "Exec Viewer (KKP)",
};

export default async function BerandaPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");

  const { id, name, role } = session.user;

  const assignments = await db.userLocationAssignment.findMany({
    where: { userId: id, unassignedAt: null },
    include: { location: { select: { name: true, province: true } } },
    orderBy: { assignedAt: "asc" },
  });

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
        MARLIN · Beranda
      </div>
      <h1 className="mb-1 font-[Fraunces] text-4xl font-semibold text-[#1f2b38]">
        Halo, {name}.
      </h1>
      <p className="mb-8 text-[#3A4E63]">
        Anda masuk sebagai{" "}
        <span className="font-semibold">{ROLE_LABEL[role]}</span>.
      </p>

      <section className="mb-8 rounded-lg border border-[#EAE2D2] bg-[#FDFBF6] p-5">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
          Lokasi yang ditugaskan ({assignments.length})
        </div>
        {assignments.length === 0 ? (
          <p className="text-sm text-[#8a9199]">
            Tidak ada lokasi yang ditugaskan ke akun ini (role lintas-lokasi).
          </p>
        ) : (
          <ul className="space-y-1.5">
            {assignments.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="font-medium text-[#1f2b38]">
                  {a.location.name}
                </span>
                <span className="text-xs text-[#8a9199]">
                  {a.location.province}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/masuk" });
        }}
      >
        <button
          type="submit"
          className="rounded-md border border-[#EAE2D2] bg-white px-4 py-2 text-sm font-semibold text-[#3A4E63] transition hover:bg-[#f4efe4]"
        >
          Keluar
        </button>
      </form>
    </main>
  );
}
