import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers, ROLE_LABEL, ALL_ROLES } from "@/lib/roles";
import { UserForm } from "./user-form";
import { setUserActive } from "./actions";

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
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        MARLIN · Pengguna
      </div>
      <h1 className="mb-1 text-3xl font-semibold text-[#0F172A]">
        Kelola Pengguna
      </h1>
      <p className="mb-8 text-sm text-[#0F766E]">
        {users.length} user terdaftar. Buat akun untuk SM, mandor, PM, dll.
      </p>

      <section className="mb-10 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
        <div className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
          Tambah user baru
        </div>
        <UserForm roles={ALL_ROLES} locations={locations} />
      </section>

      <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#FFFFFF] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
              <th className="px-4 py-2.5 font-semibold">Username</th>
              <th className="px-4 py-2.5 font-semibold">Nama</th>
              <th className="px-4 py-2.5 font-semibold">Role</th>
              <th className="px-4 py-2.5 text-center font-semibold">Lokasi</th>
              <th className="px-4 py-2.5 text-center font-semibold">Status</th>
              <th className="px-4 py-2.5 text-right font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === session.user.id;
              return (
                <tr key={u.id} className="border-b border-[#EEF2F6] last:border-0">
                  <td className="px-4 py-3 font-mono text-[13px] text-[#0F172A]">{u.username}</td>
                  <td className="px-4 py-3 text-[#0F172A]">{u.fullName}</td>
                  <td className="px-4 py-3 text-[#0F766E]">{ROLE_LABEL[u.role]}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-[#0F172A]">
                    {u._count.locationAssignments}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        u.isActive
                          ? "bg-[#DCFCE7] text-[#16A34A]"
                          : "bg-[#FEE2E2] text-[#DC2626]"
                      }`}
                    >
                      {u.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isSelf ? (
                      <span className="text-xs text-[#94A3B8]">(Anda)</span>
                    ) : (
                      <form action={setUserActive.bind(null, u.id, !u.isActive)}>
                        <button
                          type="submit"
                          className="rounded border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#0F766E] transition hover:bg-[#f1f5f9]"
                        >
                          {u.isActive ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
