import type { Metadata } from "next";
import { Card, CardHeader, CardBody } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can, creatableRoles, ROLE_LABEL } from "@/lib/authz";
import { db } from "@/lib/db";
import { UserForm, UsersTable } from "./pengguna-client";
import { KebijakanAkun, MatriksPeran } from "./matriks-peran";

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
      // Manajemen penuh → semua akun DI ORGANISASI INI; pembuat terbatas →
      // hanya akun yang IA buat. `undefined` dulu berarti seluruh database
      // (audit Codex 2026-07-28, AUTH-03) — halaman ini yang membocorkan UUID
      // akun tenant lain ke tombol reset/nonaktifkan.
      where: fullManage ? { orgId: user.orgId } : { createdById: user.id, orgId: user.orgId },
      orderBy: [{ role: "asc" }, { fullName: "asc" }],
      select: {
        id: true,
        username: true,
        email: true,
        waNumber: true,
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
      where: locationScopeWhere(user, accessibleLocs),
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        package: {
          select: {
            organization: { select: { name: true } },
            contract: { select: { vendor: { select: { name: true } } } },
          },
        },
      },
    }),
  ]);

  const locationOptions = locations.map((l) => ({
    id: l.id,
    name: l.name,
    company: l.package?.contract?.vendor?.name ?? l.package?.organization?.name ?? null,
  }));

  const listTitle = fullManage ? "Daftar pengguna" : "Pengguna yang saya buat";
  const description = fullManage
    ? "Akun, peran, dan penugasan lokasi. Password baru selalu wajib diganti saat login pertama."
    : `Anda dapat membuat akun peran: ${allowedRoles.map((r) => ROLE_LABEL[r]).join(", ")}. Setiap akun mencatat pembuatnya.`;

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">{description}</p>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title={listTitle} subtitle={`${users.length} akun`} />
          <CardBody>
            <UsersTable
              canManage={fullManage}
              actorRole={user.role}
              users={users.map((u) => ({
                id: u.id,
                username: u.username ?? "—",
                fullName: u.fullName,
                email: u.email,
                waNumber: u.waNumber,
                role: u.role,
                isActive: u.isActive,
                mustChangePassword: u.mustChangePassword,
                lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
                createdByName: u.creator?.fullName ?? null,
                assignments: u.assignments.map((a) => ({ id: a.locationId, name: a.location.name })),
              }))}
              locations={locationOptions}
            />
          </CardBody>
        </Card>
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Pengguna baru" />
            <CardBody>
              {allowedRoles.length === 0 ? (
                <p className="text-sm text-ink-muted">Anda tidak berwenang membuat pengguna.</p>
              ) : (
                <UserForm locations={locationOptions} roles={allowedRoles} />
              )}
            </CardBody>
          </Card>
          {/* Aturannya dibaca di sebelah formulirnya, bukan di halaman bantuan
              terpisah yang tidak akan pernah dibuka. */}
          <KebijakanAkun actorRole={user.role} />
        </div>
      </div>
      {/*
       * Matriks peran ditaruh SESUDAH daftar & formulir: ia menjawab pertanyaan
       * yang muncul saat memilih peran ("kalau saya beri peran ini, dia bisa
       * apa?"), jadi tempatnya di jalur baca yang sama — bukan di halaman lain.
       * Baris peran yang boleh dibuat akun ini disorot supaya pilihan di
       * formulir dan barisnya di tabel terbaca sebagai satu hal.
       */}
      <MatriksPeran highlight={allowedRoles} />
    </div>
  );
}
