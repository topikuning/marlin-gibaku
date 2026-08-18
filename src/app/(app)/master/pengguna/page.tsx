import type { Metadata } from "next";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can, creatableRoles, ROLE_LABEL } from "@/lib/authz";
import { db } from "@/lib/db";
import { adalahAkar, parseAkar } from "@/lib/akar";
import { env } from "@/lib/env";
import { PenggunaManager } from "./pengguna-client";

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
        waLid: true,
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

  // Siapa yang jadi AKAR ditetapkan di env (DECISIONS 315). Ditandai di daftar
  // supaya aturannya terlihat: tanpa penanda, "kenapa akun ini tidak bisa
  // dinonaktifkan" jadi misteri yang cuma terbaca di kode.
  const daftarAkar = parseAkar(env.SUPER_ADMIN_UTAMA);

  // Pembuat terbatas hanya melihat akun buatannya sendiri — dikatakan, supaya
  // "kok pengguna lain tidak muncul" tidak terbaca sebagai data hilang.
  const description = fullManage
    ? null
    : `Daftar ini hanya memuat akun yang Anda buat. Anda dapat membuat peran: ${allowedRoles
        .map((r) => ROLE_LABEL[r])
        .join(", ")}.`;

  return (
    <div className="space-y-3">
      {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
      <PenggunaManager
        canManage={fullManage}
        actorRole={user.role}
        users={users.map((u) => ({
          id: u.id,
          username: u.username ?? "—",
          fullName: u.fullName,
          email: u.email,
          waNumber: u.waNumber,
          waLid: u.waLid,
          role: u.role,
          isActive: u.isActive,
          mustChangePassword: u.mustChangePassword,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdByName: u.creator?.fullName ?? null,
          akar: adalahAkar(u, daftarAkar),
          assignments: u.assignments.map((a) => ({ id: a.locationId, name: a.location.name })),
        }))}
        locations={locationOptions}
      />
    </div>
  );
}
