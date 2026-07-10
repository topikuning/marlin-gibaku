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
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
        MARLIN · Pengguna
      </div>
      <h1 className="mb-1 font-[Fraunces] text-3xl font-semibold text-[#1f2b38]">
        Kelola Pengguna
      </h1>
      <p className="mb-8 text-sm text-[#3A4E63]">
        {users.length} user terdaftar. Buat akun untuk SM, mandor, PM, dll.
      </p>

      <section className="mb-10 rounded-lg border border-[#EAE2D2] bg-[#FDFBF6] p-5">
        <div className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
          Tambah user baru
        </div>
        <UserForm roles={ALL_ROLES} locations={locations} />
      </section>

      <div className="overflow-x-auto rounded-lg border border-[#EAE2D2]">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-[#EAE2D2] bg-[#FDFBF6] text-left text-[11px] uppercase tracking-wide text-[#8a9199]">
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
                <tr key={u.id} className="border-b border-[#F0EADD] last:border-0">
                  <td className="px-4 py-3 font-mono text-[13px] text-[#1f2b38]">{u.username}</td>
                  <td className="px-4 py-3 text-[#1f2b38]">{u.fullName}</td>
                  <td className="px-4 py-3 text-[#3A4E63]">{ROLE_LABEL[u.role]}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-[#1f2b38]">
                    {u._count.locationAssignments}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        u.isActive
                          ? "bg-[#E4F0E8] text-[#2E7D4F]"
                          : "bg-[#FCE8E4] text-[#C1442E]"
                      }`}
                    >
                      {u.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isSelf ? (
                      <span className="text-xs text-[#b3b0a6]">(Anda)</span>
                    ) : (
                      <form action={setUserActive.bind(null, u.id, !u.isActive)}>
                        <button
                          type="submit"
                          className="rounded border border-[#EAE2D2] bg-white px-2.5 py-1 text-xs font-semibold text-[#3A4E63] transition hover:bg-[#f4efe4]"
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
