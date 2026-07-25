import "server-only";
import { db } from "@/lib/db";
import { REPORT_STATUS_LABEL } from "@/lib/lifecycle";
import { FIELD_ACTIVITY_TYPE_LABEL } from "@/lib/field-activity/labels";
import { formatTanggal } from "@/lib/format";
import type { BadgeTone } from "@/components/ui";
import type { BaselineSource, DailyReportStatus } from "@/generated/prisma/enums";

/**
 * Denyut aktivitas lintas lokasi untuk dashboard eksekutif — supaya manajemen
 * tahu apa yang bergerak di sistem TANPA membuka tiap lokasi satu per satu.
 * Sumber = tabel domain yang punya locationId (bukan AuditLog, yang tak selalu
 * menyimpan lokasi): status laporan harian, kegiatan lapangan, perubahan jadwal
 * (baseline), dan kendala. Semua dibatasi ke lokasi yang boleh dilihat user.
 */

export type ActivityKind = "laporan" | "kegiatan" | "jadwal" | "kendala";

export type ActivityEvent = {
  id: string;
  at: Date;
  kind: ActivityKind;
  locationName: string;
  locationSlug: string;
  actor: string;
  summary: string;
  tone: BadgeTone;
  href: string;
};

export const KIND_LABEL: Record<ActivityKind, string> = {
  laporan: "Laporan",
  kegiatan: "Kegiatan",
  jadwal: "Jadwal",
  kendala: "Kendala",
};

const KIND_TONE: Record<ActivityKind, BadgeTone> = {
  laporan: "info",
  kegiatan: "neutral",
  jadwal: "warning",
  kendala: "danger",
};

const BASELINE_SOURCE_VERB: Record<BaselineSource, string> = {
  auto: "Hitung ulang",
  adendum: "Adendum",
  manual: "Ubah",
};

/** Peta id→nama lengkap aktor (relasi user tak dideklarasikan di tabel histori). */
async function resolveActors(ids: Iterable<string>): Promise<Map<string, string>> {
  const uniq = [...new Set([...ids])].filter(Boolean);
  if (uniq.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: uniq } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/**
 * Feed aktivitas terbaru lintas lokasi (default 40). `locIds === null` = semua
 * lokasi (peran cross-location); selain itu dibatasi ke daftar lokasi user.
 */
export async function getActivityFeed(locIds: string[] | null, limit = 40): Promise<ActivityEvent[]> {
  const byLoc = locIds === null ? undefined : { in: locIds };
  const take = limit;

  const [reports, activities, baselines, issues] = await Promise.all([
    db.dailyReportStatusHistory.findMany({
      where: byLoc ? { report: { locationId: byLoc } } : {},
      select: {
        id: true,
        toStatus: true,
        changedById: true,
        changedAt: true,
        report: { select: { reportDate: true, location: { select: { name: true, slug: true } } } },
      },
      orderBy: { changedAt: "desc" },
      take,
    }),
    db.fieldActivity.findMany({
      where: byLoc ? { locationId: byLoc } : {},
      select: {
        id: true,
        title: true,
        type: true,
        createdById: true,
        createdAt: true,
        finalizedById: true,
        finalizedAt: true,
        location: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
    db.baseline.findMany({
      where: byLoc ? { locationId: byLoc } : {},
      select: {
        id: true,
        baselineNo: true,
        source: true,
        createdById: true,
        createdAt: true,
        location: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
    db.issue.findMany({
      where: byLoc ? { locationId: byLoc } : {},
      select: {
        id: true,
        title: true,
        severity: true,
        raisedById: true,
        createdAt: true,
        location: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
  ]);

  const actorIds: string[] = [];
  for (const r of reports) actorIds.push(r.changedById);
  for (const a of activities) {
    actorIds.push(a.createdById);
    if (a.finalizedById) actorIds.push(a.finalizedById);
  }
  for (const b of baselines) if (b.createdById) actorIds.push(b.createdById);
  for (const i of issues) if (i.raisedById) actorIds.push(i.raisedById);
  const actors = await resolveActors(actorIds);
  const nameOf = (id: string | null | undefined) => (id && actors.get(id)) || "Sistem";

  const events: ActivityEvent[] = [];

  for (const r of reports) {
    const loc = r.report.location;
    const tgl = formatTanggal(r.report.reportDate);
    const summary =
      r.toStatus === "draft"
        ? `Membuat laporan harian ${tgl}`
        : `Laporan harian ${tgl} → ${REPORT_STATUS_LABEL[r.toStatus]}`;
    events.push({
      id: `lap:${r.id}`,
      at: r.changedAt,
      kind: "laporan",
      locationName: loc.name,
      locationSlug: loc.slug,
      actor: nameOf(r.changedById),
      summary,
      tone: KIND_TONE.laporan,
      href: `/lokasi/${loc.slug}`,
    });
  }

  for (const a of activities) {
    events.push({
      id: `keg:${a.id}`,
      at: a.createdAt,
      kind: "kegiatan",
      locationName: a.location.name,
      locationSlug: a.location.slug,
      actor: nameOf(a.createdById),
      summary: `Kegiatan lapangan: ${a.title} (${FIELD_ACTIVITY_TYPE_LABEL[a.type]})`,
      tone: KIND_TONE.kegiatan,
      href: `/lokasi/${a.location.slug}`,
    });
    if (a.finalizedAt) {
      events.push({
        id: `keg-final:${a.id}`,
        at: a.finalizedAt,
        kind: "kegiatan",
        locationName: a.location.name,
        locationSlug: a.location.slug,
        actor: nameOf(a.finalizedById),
        summary: `Finalkan kegiatan: ${a.title}`,
        tone: KIND_TONE.kegiatan,
        href: `/lokasi/${a.location.slug}`,
      });
    }
  }

  for (const b of baselines) {
    events.push({
      id: `jad:${b.id}`,
      at: b.createdAt,
      kind: "jadwal",
      locationName: b.location.name,
      locationSlug: b.location.slug,
      actor: nameOf(b.createdById),
      summary: `${BASELINE_SOURCE_VERB[b.source]} jadwal/kurva-S (baseline #${b.baselineNo})`,
      tone: KIND_TONE.jadwal,
      href: `/lokasi/${b.location.slug}/progress`,
    });
  }

  for (const i of issues) {
    events.push({
      id: `ken:${i.id}`,
      at: i.createdAt,
      kind: "kendala",
      locationName: i.location.name,
      locationSlug: i.location.slug,
      actor: nameOf(i.raisedById),
      summary: `Kendala: ${i.title} (${i.severity})`,
      tone: KIND_TONE.kendala,
      href: `/lokasi/${i.location.slug}`,
    });
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events.slice(0, limit);
}

export type LocationActivity = {
  lastReportDate: Date | null;
  lastReportStatus: DailyReportStatus | null;
  lastReportBy: string | null;
  lastActivityAt: Date | null;
};

/**
 * Ringkasan denyut per lokasi (untuk tabel): laporan harian terakhir (tanggal,
 * status, oleh siapa) + kapan aktivitas terakhir (laporan/kegiatan). Batched:
 * satu query "terbaru per lokasi" (distinct) untuk laporan & kegiatan.
 */
export async function getLocationActivity(locIds: string[] | null): Promise<Map<string, LocationActivity>> {
  const byLoc = locIds === null ? undefined : { in: locIds };
  const where = byLoc ? { locationId: byLoc } : {};

  const [latestReports, latestActivities] = await Promise.all([
    db.dailyReport.findMany({
      where,
      distinct: ["locationId"],
      orderBy: [{ locationId: "asc" }, { reportDate: "desc" }, { updatedAt: "desc" }],
      select: {
        locationId: true,
        reportDate: true,
        status: true,
        updatedAt: true,
        submittedById: true,
        createdById: true,
      },
    }),
    db.fieldActivity.findMany({
      where,
      distinct: ["locationId"],
      orderBy: [{ locationId: "asc" }, { createdAt: "desc" }],
      select: { locationId: true, createdAt: true },
    }),
  ]);

  const actors = await resolveActors(latestReports.map((r) => r.submittedById ?? r.createdById));
  const actByLoc = new Map(latestActivities.map((a) => [a.locationId, a.createdAt]));

  const out = new Map<string, LocationActivity>();
  for (const r of latestReports) {
    const byId = r.submittedById ?? r.createdById;
    out.set(r.locationId, {
      lastReportDate: r.reportDate,
      lastReportStatus: r.status,
      lastReportBy: (byId && actors.get(byId)) || null,
      lastActivityAt: r.updatedAt,
    });
  }
  for (const [locId, at] of actByLoc) {
    const cur = out.get(locId);
    if (!cur) {
      out.set(locId, { lastReportDate: null, lastReportStatus: null, lastReportBy: null, lastActivityAt: at });
    } else if (!cur.lastActivityAt || at > cur.lastActivityAt) {
      cur.lastActivityAt = at;
    }
  }
  return out;
}
