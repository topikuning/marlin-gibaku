import type { Metadata } from "next";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui";
import { requireCapability } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { UserForm, UsersTable } from "./pengguna-client";

export const metadata: Metadata = { title: "Pengguna" };
export const dynamic = "force-dynamic";

export default async function PenggunaPage() {
  await requireCapability("user.manage");
  const [users, locations] = await Promise.all([
    db.user.findMany({
      orderBy: [{ role: "asc" }, { fullName: "asc" }],
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
        assignments: {
          where: { unassignedAt: null },
          select: { locationId: true, location: { select: { name: true } } },
        },
      },
    }),
    db.location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengguna"
        description="Akun, peran, dan penugasan lokasi. Password baru selalu wajib diganti saat login pertama."
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Daftar pengguna" subtitle={`${users.length} akun`} />
          <CardBody>
            <UsersTable
              users={users.map((u) => ({
                id: u.id,
                username: u.username ?? "—",
                fullName: u.fullName,
                email: u.email,
                role: u.role,
                isActive: u.isActive,
                mustChangePassword: u.mustChangePassword,
                lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
                assignments: u.assignments.map((a) => ({ id: a.locationId, name: a.location.name })),
              }))}
              locations={locations}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Pengguna baru" />
          <CardBody>
            <UserForm locations={locations} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
