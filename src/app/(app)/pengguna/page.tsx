import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers, ROLE_LABEL, ALL_ROLES } from "@/lib/roles";
import { PageHeader } from "@/components/knmp/page-header";
import { UserForm } from "./user-form";
import { UsersGrid } from "./users-grid";

export default async function PenggunaPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  // Authz server-side (bukan cuma sembunyi di nav).
  if (!canManageUsers(session.user.role)) notFound();

  const [users, locations] = await Promise.all([
    db.user.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        isActive: true,
        _count: { select: { locationAssignments: true } },
      },
    }),
    db.location.findMany({
      orderBy: [{ province: "asc" }, { name: "asc" }],
      select: { id: true, name: true, province: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Pengguna"
        title="Kelola Pengguna"
        subtitle={`${users.length} user terdaftar. Buat akun untuk SM, mandor, PM, dll.`}
      />

      <section className="mb-10 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
        <div className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
          Tambah user baru
        </div>
        <UserForm roles={ALL_ROLES} locations={locations} />
      </section>

      <UsersGrid
        rows={users.map((u) => ({
          id: u.id,
          username: u.username ?? "",
          fullName: u.fullName,
          roleLabel: ROLE_LABEL[u.role],
          locations: u._count.locationAssignments,
          isActive: u.isActive,
          isSelf: u.id === session.user.id,
        }))}
      />
    </>
  );
}
