import "server-only";
import type { FindingCategory, FindingStatus, IssueSeverity } from "@/generated/prisma/enums";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { locationRelScopeWhere } from "@/lib/auth/scope";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";
import { OPEN_FINDING_STATUSES } from "@/lib/lifecycle";

/**
 * Pembaca papan & detail temuan. Tidak ada otorisasi di sini selain SCOPE
 * lokasi (pola `kendala/queries.ts`) — halaman menjaga capability-nya.
 */

export type SaringTemuan = {
  status?: string;
  severity?: string;
  kategori?: string;
  lokasi?: string;
  cari?: string;
};

export type BarisTemuan = {
  id: string;
  title: string;
  status: FindingStatus;
  severity: IssueSeverity;
  category: FindingCategory;
  locationId: string;
  locationName: string;
  locationSlug: string;
  findingDate: Date;
  dueDate: Date | null;
  lewatTenggat: boolean;
  reopenCount: number;
  assignedName: string | null;
  buktiCount: number;
  raisedByName: string;
};

export type RingkasTemuan = {
  terbuka: number;
  kritisTerbuka: number;
  lewatTenggat: number;
  menungguVerifikasi: number;
  dibukaKembali: number;
};

const OPEN = [...OPEN_FINDING_STATUSES];

export async function papanTemuan(
  user: SessionUser,
  saring: SaringTemuan,
): Promise<{ baris: BarisTemuan[]; ringkas: RingkasTemuan }> {
  const locIds = await accessibleLocationIds(user);
  const semua = await db.finding.findMany({
    where: locationRelScopeWhere(user, locIds),
    orderBy: [{ createdAt: "desc" }],
    take: 500,
    select: {
      id: true,
      title: true,
      status: true,
      severity: true,
      category: true,
      findingDate: true,
      dueDate: true,
      reopenCount: true,
      assignedName: true,
      assignedToId: true,
      location: { select: { id: true, name: true, slug: true } },
      _count: { select: { evidences: true } },
      raisedById: true,
    },
  });

  // Nama orang (pengangkat + PIC) diambil sekali, bukan N+1.
  const userIds = new Set<string>();
  for (const f of semua) {
    userIds.add(f.raisedById);
    if (f.assignedToId) userIds.add(f.assignedToId);
  }
  const users = userIds.size
    ? await db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, fullName: true } })
    : [];
  const nama = new Map(users.map((u) => [u.id, u.fullName]));

  const today = jakartaToday();
  const isOpen = (s: FindingStatus) => (OPEN as string[]).includes(s);
  const lewat = (f: (typeof semua)[number]) => isOpen(f.status) && f.dueDate != null && f.dueDate < today;

  const ringkas: RingkasTemuan = {
    terbuka: semua.filter((f) => isOpen(f.status)).length,
    kritisTerbuka: semua.filter((f) => isOpen(f.status) && f.severity === "kritis").length,
    lewatTenggat: semua.filter(lewat).length,
    menungguVerifikasi: semua.filter((f) => f.status === "menunggu_verifikasi").length,
    dibukaKembali: semua.filter((f) => f.status === "dibuka_kembali").length,
  };

  const cari = saring.cari?.trim().toLowerCase();
  const baris = semua
    .filter((f) => {
      if (saring.status === "terbuka") { if (!isOpen(f.status)) return false; }
      else if (saring.status === "lewat_tenggat") { if (!lewat(f)) return false; }
      else if (saring.status && f.status !== saring.status) return false;
      if (saring.severity && f.severity !== saring.severity) return false;
      if (saring.kategori && f.category !== saring.kategori) return false;
      if (saring.lokasi && f.location.slug !== saring.lokasi) return false;
      if (cari && !f.title.toLowerCase().includes(cari)) return false;
      return true;
    })
    .map((f) => ({
      id: f.id,
      title: f.title,
      status: f.status,
      severity: f.severity,
      category: f.category,
      locationId: f.location.id,
      locationName: f.location.name,
      locationSlug: f.location.slug,
      findingDate: f.findingDate,
      dueDate: f.dueDate,
      lewatTenggat: lewat(f),
      reopenCount: f.reopenCount,
      assignedName: f.assignedToId ? (nama.get(f.assignedToId) ?? null) : f.assignedName,
      buktiCount: f._count.evidences,
      raisedByName: nama.get(f.raisedById) ?? "(tidak dikenal)",
    }));

  // Urutan papan: lewat tenggat dulu, lalu keparahan, lalu terbaru.
  const rankSev: Record<IssueSeverity, number> = { kritis: 0, tinggi: 1, sedang: 2, rendah: 3 };
  baris.sort((a, b) => {
    if (a.lewatTenggat !== b.lewatTenggat) return a.lewatTenggat ? -1 : 1;
    const s = rankSev[a.severity] - rankSev[b.severity];
    if (s !== 0) return s;
    return b.findingDate.getTime() - a.findingDate.getTime();
  });

  return { baris, ringkas };
}

export type DetailTemuan = NonNullable<Awaited<ReturnType<typeof detailTemuan>>>;

export async function detailTemuan(id: string) {
  const f = await db.finding.findUnique({
    where: { id },
    include: {
      location: { select: { id: true, name: true, slug: true, package: { select: { id: true, name: true } } } },
      inspection: { select: { id: true, title: true, inspectionDate: true } },
      report: { select: { id: true, reportDate: true, location: { select: { slug: true } } } },
      statusHistory: { orderBy: { changedAt: "asc" } },
      clarifications: { orderBy: { askedAt: "asc" }, include: { evidences: true } },
      notes: { orderBy: { createdAt: "asc" } },
      evidences: {
        orderBy: { createdAt: "asc" },
        include: {
          photo: { select: { id: true, thumbnailKey: true, r2Key: true, stampPhotoId: true } },
          document: {
            select: { id: true, type: true, title: true, fileName: true, docNumber: true, docDate: true, locationId: true, packageId: true, uploadedAt: true },
          },
        },
      },
    },
  });
  if (!f) return null;

  const userIds = new Set<string>([f.raisedById]);
  if (f.assignedToId) userIds.add(f.assignedToId);
  if (f.closedById) userIds.add(f.closedById);
  for (const h of f.statusHistory) userIds.add(h.changedById);
  for (const c of f.clarifications) {
    userIds.add(c.askedById);
    if (c.respondedById) userIds.add(c.respondedById);
  }
  for (const n of f.notes) userIds.add(n.createdById);
  for (const e of f.evidences) {
    userIds.add(e.addedById);
    if (e.verifiedById) userIds.add(e.verifiedById);
  }
  const users = await db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, fullName: true } });
  const nama = new Map(users.map((u) => [u.id, u.fullName]));

  return { ...f, nama };
}

/** Kandidat PIC tindak lanjut: pemegang penugasan lokasi ini (SM/pelaksana dst.). */
export async function kandidatPic(locationId: string) {
  const rows = await db.locationAssignment.findMany({
    where: { locationId, unassignedAt: null, user: { isActive: true } },
    select: { user: { select: { id: true, fullName: true, role: true } } },
  });
  return rows.map((r) => r.user);
}
