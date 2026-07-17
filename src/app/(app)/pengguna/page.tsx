import type { Metadata } from "next";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can, creatableRoles, ROLE_LABEL } from "@/lib/authz";
import { db } from "@/lib/db";
import { UserForm, UsersTable } from "./pengguna-client";

export const metadata: Metadata = { title: "Pengguna" };
export const dynamic = "force-dynamic";

export default async function PenggunaPage() {
  const user = await requireUser();
  // user.create dimiliki peran manajemen penuh + PM + Site Manager (berjenjang).
  requireCapabilityPage(user.role, "user.create");
  const fullManage = can(user.role, "user.manage");
  const allowedRoles = creatableRoles(user.role);
  // Pembuat terbatas hanya melihat lokasi yang dia akses (null = semua).
  const accessibleLocs = fullManage ? null : await accessibleLocationIds(user);

  const [users, locations] = await Promise.all([
    db.user.findMany({
      // Manajemen penuh → semua akun; pembuat terbatas → hanya akun yang IA buat.
      where: fullManage ? undefined : { createdById: user.id },
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
        creator: { select: { fullName: true } },
        assignments: {
          where: { unassignedAt: null },
          select: { locationId: true, location: { select: { name: true } } },
        },
      },
    }),
    db.location.findMany({
      where: accessibleLocs ? { id: { in: accessibleLocs } } : undefined,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const listTitle = fullManage ? "Daftar pengguna" : "Pengguna yang saya buat";
  const description = fullManage
    ? "Akun, peran, dan penugasan lokasi. Password baru selalu wajib diganti saat login pertama."
    : `Anda dapat membuat akun peran: ${allowedRoles.map((r) => ROLE_LABEL[r]).join(", ")}. Setiap akun mencatat pembuatnya.`;

  return (
    <div className="space-y-6">
      <PageHeader title="Pengguna" description={description} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title={listTitle} subtitle={`${users.length} akun`} />
          <CardBody>
            <UsersTable
              canManage={fullManage}
              users={users.map((u) => ({
                id: u.id,
                username: u.username ?? "—",
                fullName: u.fullName,
                email: u.email,
                role: u.role,
                isActive: u.isActive,
                mustChangePassword: u.mustChangePassword,
                lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
                createdByName: u.creator?.fullName ?? null,
                assignments: u.assignments.map((a) => ({ id: a.locationId, name: a.location.name })),
              }))}
              locations={locations}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Pengguna baru" />
          <CardBody>
            {allowedRoles.length === 0 ? (
              <p className="text-sm text-ink-muted">Anda tidak berwenang membuat pengguna.</p>
            ) : (
              <UserForm locations={locations} roles={allowedRoles} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
