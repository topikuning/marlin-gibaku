import "server-only";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { locationScopeWhere, packageScopeWhere } from "@/lib/auth/scope";
import { can, ROLE_LABEL } from "@/lib/authz";
import { db } from "@/lib/db";
import { LOCATION_STATUS_LABEL, PACKAGE_STAGE_LABEL } from "@/lib/lifecycle";
import { KIND_ORDER, MIN_QUERY, type SearchHit } from "./types";

export type { SearchHit, SearchKind } from "./types";
export { KIND_LABEL, MIN_QUERY } from "./types";

/**
 * Pencarian global lintas objek (PRD MARLIN P0 "Global Search & Context
 * Switcher", FR-NAV-02). Sebelum ini pengguna harus tahu lebih dulu MODUL mana
 * yang memuat sesuatu sebelum bisa menemukannya — sidebar adalah satu-satunya
 * jalan masuk.
 *
 * PAGAR: hasil selalu disaring dua kali — capability (boleh melihat jenis ini?)
 * dan scope (boleh melihat baris ini?). Pencarian adalah pintu belakang klasik
 * menuju kebocoran data: nama paket yang tidak boleh dilihat pun sudah bocor
 * kalau muncul di daftar hasil.
 */

/** Batas per jenis; totalnya tetap muat di satu panel tanpa menggulir jauh. */
const PER_KIND = 5;

export async function searchGlobal(user: SessionUser, raw: string): Promise<SearchHit[]> {
  const q = raw.trim();
  if (q.length < MIN_QUERY) return [];

  const locIds = await accessibleLocationIds(user);
  const contains = { contains: q, mode: "insensitive" as const };

  const [paket, lokasi, dokumen, vendor, pengguna] = await Promise.all([
    can(user.role, "package.view")
      ? db.package.findMany({
          where: {
            ...packageScopeWhere(user, locIds),
            OR: [{ name: contains }, { packageNumber: contains }],
          },
          select: { id: true, name: true, packageNumber: true, stage: true },
          orderBy: { name: "asc" },
          take: PER_KIND,
        })
      : [],

    can(user.role, "location.view")
      ? db.location.findMany({
          where: {
            ...locationScopeWhere(user, locIds),
            OR: [
              { name: contains },
              { village: contains },
              { regency: contains },
              { province: contains },
            ],
          },
          select: {
            slug: true,
            name: true,
            regency: true,
            province: true,
            status: true,
            isActive: true,
            package: { select: { name: true } },
          },
          orderBy: { name: "asc" },
          take: PER_KIND,
        })
      : [],

    can(user.role, "document.view")
      ? db.document.findMany({
          where: {
            orgId: user.orgId,
            // Dokumen dibatalkan hilang dari daftar mana pun (DECISIONS 183) —
            // pencarian bukan pengecualian.
            status: "aktif",
            ...(locIds === null
              ? {}
              : {
                  OR: [
                    { locationId: { in: locIds } },
                    { package: { locations: { some: { id: { in: locIds } } } } },
                  ],
                }),
            AND: [{ OR: [{ title: contains }, { docNumber: contains }, { fileName: contains }] }],
          },
          select: {
            id: true,
            title: true,
            docNumber: true,
            location: { select: { name: true } },
            package: { select: { name: true } },
          },
          orderBy: { uploadedAt: "desc" },
          take: PER_KIND,
        })
      : [],

    can(user.role, "contract.manage")
      ? db.vendor.findMany({
          where: { orgId: user.orgId, OR: [{ name: contains }, { npwp: contains }] },
          select: { id: true, name: true, npwp: true },
          orderBy: { name: "asc" },
          take: PER_KIND,
        })
      : [],

    can(user.role, "user.create")
      ? db.user.findMany({
          where: {
            orgId: user.orgId,
            OR: [{ fullName: contains }, { username: contains }, { email: contains }],
          },
          select: { id: true, fullName: true, username: true, role: true, isActive: true },
          orderBy: { fullName: "asc" },
          take: PER_KIND,
        })
      : [],
  ]);

  const hits: SearchHit[] = [
    ...paket.map((p) => ({
      kind: "paket" as const,
      id: p.id,
      label: p.name,
      detail: [p.packageNumber, PACKAGE_STAGE_LABEL[p.stage]].filter(Boolean).join(" · "),
      href: `/paket/${p.id}`,
    })),
    ...lokasi.map((l) => ({
      kind: "lokasi" as const,
      id: l.slug,
      label: l.name,
      // Lokasi belum aktif TETAP muncul, ditandai — menyembunyikannya membuat
      // pencarian menjawab "tidak ada" untuk sesuatu yang sebenarnya ada.
      detail: [
        `${l.regency}, ${l.province}`,
        l.package.name,
        l.isActive ? LOCATION_STATUS_LABEL[l.status] : "belum aktif",
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/lokasi/${l.slug}`,
    })),
    ...dokumen.map((d) => ({
      kind: "dokumen" as const,
      id: d.id,
      label: d.title,
      detail: [d.docNumber, d.location?.name ?? d.package?.name].filter(Boolean).join(" · "),
      href: `/dokumen/${d.id}`,
    })),
    ...vendor.map((v) => ({
      kind: "vendor" as const,
      id: v.id,
      label: v.name,
      detail: v.npwp ? `NPWP ${v.npwp}` : "Tanpa NPWP",
      href: "/master/perusahaan",
    })),
    ...pengguna.map((u) => ({
      kind: "pengguna" as const,
      id: u.id,
      label: u.fullName,
      detail: [u.username, ROLE_LABEL[u.role], u.isActive ? null : "nonaktif"]
        .filter(Boolean)
        .join(" · "),
      href: "/master/pengguna",
    })),
  ];

  return hits.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
