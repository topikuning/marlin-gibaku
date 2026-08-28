import "server-only";
import { db } from "@/lib/db";
import { accessibleLocationIds, ForbiddenError, type SessionUser } from "@/lib/auth/session";
import {
  COUNTED_REPORT_STATUSES,
  getLocationsProgress,
  volumeDalamRentangByLineage,
} from "@/lib/progress";
import { jakartaDateKey, jakartaToday, parseDateKey } from "@/lib/format";
import { computeReadiness } from "./readiness";
import { computeRisks, exceptionFirst } from "./risk";
import { haversineMeters, type QualityDetailFacts } from "./quality-rules";
import type { LocationFacts, PortfolioPulse, PulseRow, PulseTotals, RiskItem, SourceRef } from "./types";

/**
 * Source builder AI Hub — SEMUA data deterministik, batched (bukan N+1),
 * dibatasi scope izin user. AI tidak pernah query DB; AI hanya menerima
 * hasil builder ini. DECISIONS 133.
 */

const DAY_MS = 24 * 3600 * 1000;

/**
 * Resolve scope lokasi yang DIMINTA klien terhadap yang DIIZINKAN:
 * intersect accessibleLocationIds (null = semua di org). Query string /
 * pilihan klien TIDAK pernah dipercaya langsung.
 */

/**
 * Watermark kesegaran data (audit 2026-07-27, B19): kapan data sumber TERAKHIR
 * berubah — bukan kapan payload dirender. "Data per <waktu render>" membuat
 * laporan yang datanya basi 20 hari tampak segar.
 */
async function dataWatermark(locIds: string[]): Promise<string | null> {
  if (locIds.length === 0) return null;
  const [lastReport, lastActivity, lastIssue, lastRecovery, lastMilestone, lastPhoto] = await Promise.all([
    db.dailyReport.findFirst({
      where: { locationId: { in: locIds } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.fieldActivity.findFirst({
      where: { locationId: { in: locIds } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.issue.findFirst({
      where: { locationId: { in: locIds }, mergedIntoId: null },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.recoveryAction.findFirst({
      where: { issue: { locationId: { in: locIds } } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.adminMilestone.findFirst({
      where: { locationId: { in: locIds } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.photo.findFirst({
      where: { locationId: { in: locIds } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const times = [
    lastReport?.updatedAt,
    lastActivity?.updatedAt,
    lastIssue?.updatedAt,
    lastRecovery?.updatedAt,
    lastMilestone?.updatedAt,
    lastPhoto?.createdAt,
  ].filter((t): t is Date => t != null);
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((t) => t.getTime()))).toISOString();
}

export async function resolveAiScope(
  user: SessionUser,
  requestedIds: string[],
): Promise<{ ids: string[]; all: boolean }> {
  const allowed = await accessibleLocationIds(user); // null = cross-location (org)
  const orgLocations = await db.location.findMany({
    where: {
      package: { orgId: user.orgId },
      ...(allowed ? { id: { in: allowed } } : {}),
    },
    select: { id: true },
  });
  const allowedSet = new Set(orgLocations.map((l) => l.id));
  const requested = requestedIds.filter((id) => allowedSet.has(id));
  if (requestedIds.length > 0 && requested.length === 0) {
    throw new ForbiddenError("Tidak ada lokasi dalam scope yang boleh Anda akses.");
  }
  const ids = requested.length > 0 ? requested : [...allowedSet];
  return { ids, all: requested.length === 0 };
}

function dateKeyOf(d: Date): string {
  return jakartaDateKey(d);
}

/** Fakta portofolio per lokasi (batched) + readiness + risiko + source refs. */
export async function buildPortfolioPulse(
  user: SessionUser,
  locIds: string[],
  startKey: string,
  endKey: string,
): Promise<PortfolioPulse> {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end) throw new Error("Periode tidak valid.");
  const today = jakartaToday();

  /*
   * Titik waktu SATU-SATUNYA untuk seluruh snapshot ini (DECISIONS 369).
   *
   * Sebelumnya `buildPortfolioPulse` menerima periode, memakainya untuk
   * menghitung laporan & kegiatan dalam rentang itu, lalu mengambil progress
   * TANPA `asOf` — yaitu posisi hari ini. Satu run "bulan lalu" karenanya
   * memuat jumlah laporan bulan lalu berdampingan dengan realisasi hari ini,
   * dan tak ada di layar maupun di `sourceRefs` yang menyebutkan bahwa dua
   * angka itu berasal dari dua waktu berbeda.
   *
   * Dijepit ke hari ini: periode yang ujungnya di masa depan ("bulan ini")
   * tidak boleh membuat rencana kurva-S melompat ke minggu yang belum terjadi,
   * karena deviasinya lalu mengukur keterlambatan terhadap masa depan.
   * Penjepitan yang sama sudah dipakai `endMs` untuk laporan yang diharapkan.
   */
  const asOf = new Date(Math.min(end.getTime(), today.getTime()));
  const asOfExclusive = new Date(asOf.getTime() + DAY_MS);
  const historical = jakartaDateKey(asOf) < jakartaDateKey(today);
  const limitations: string[] = [];
  if (historical) {
    limitations.push(
      "Status recovery pada periode lampau direkonstruksi dari data saat ini karena riwayat perubahan status belum tersimpan lengkap.",
      "Status milestone administrasi lampau tidak direkonstruksi; indikator milestone historis dikosongkan agar tidak mencampur kondisi saat ini.",
      "Riwayat perubahan tingkat dan penggabungan kendala belum berversi; atribut tersebut memakai keadaan yang tersimpan saat analisis dijalankan.",
    );
  }

  if (locIds.length === 0) {
    return {
      periodStart: startKey,
      periodEnd: endKey,
      dataAsOf: null,
      totals: {
        locations: 0,
        reportsExpected: 0,
        reportsFinal: 0,
        negativeDeviationLocations: 0,
        openIssues: 0,
        overdueRecoveries: 0,
        lowReadinessLocations: 0,
      },
      rows: [],
      risks: [],
      sourceRefs: [],
      limitations,
    };
  }

  const [locations, progress, reportGroups, latestReports, actGroups, photoRows, issueRows, overdueRecoveries, milestoneGroups] =
    await Promise.all([
      db.location.findMany({
        where: { id: { in: locIds }, package: { orgId: user.orgId } },
        select: {
          id: true,
          name: true,
          slug: true,
          province: true,
          status: true,
          gpsLat: true,
          gpsLng: true,
          package: { select: { name: true, contract: { select: { startDate: true } } } },
        },
        orderBy: { name: "asc" },
      }),
      getLocationsProgress(locIds, { asOf }),
      db.dailyReport.groupBy({
        by: ["locationId", "status"],
        where: { locationId: { in: locIds }, reportDate: { gte: start, lte: asOf } },
        _count: { _all: true },
      }),
      db.dailyReport.findMany({
        where: {
          locationId: { in: locIds },
          status: { in: [...COUNTED_REPORT_STATUSES] },
          reportDate: { lte: asOf },
        },
        distinct: ["locationId"],
        orderBy: [{ locationId: "asc" }, { reportDate: "desc" }],
        select: { locationId: true, reportDate: true },
      }),
      db.fieldActivity.groupBy({
        by: ["locationId"],
        where: { locationId: { in: locIds }, activityDate: { gte: start, lte: asOf } },
        _count: { _all: true },
      }),
      db.$queryRaw<
        { loc: string; total: bigint; no_gps: bigint; server_time: bigint }[]
      >`
        SELECT COALESCE(dr.location_id, fa.location_id) AS loc,
               COUNT(*)::bigint AS total,
               -- "tanpa GPS" = tidak ada koordinat ASLI foto. Koordinat cadangan
               -- titik proyek (gps_source='project') BUKAN bukti GPS, meskipun
               -- kolom exif_gps_lat-nya terisi (DECISIONS 197).
               COUNT(*) FILTER (WHERE p.gps_source NOT IN ('exif', 'device'))::bigint AS no_gps,
               COUNT(*) FILTER (WHERE p.metadata_source = 'server')::bigint AS server_time
        FROM photos p
        LEFT JOIN daily_reports dr ON dr.id = p.report_id
        LEFT JOIN field_activities fa ON fa.id = p.activity_id
        WHERE p.created_at >= ${start} AND p.created_at < ${asOfExclusive}
          AND (dr.location_id = ANY(${locIds}::uuid[]) OR fa.location_id = ANY(${locIds}::uuid[]))
        GROUP BY 1
      `,
      db.$queryRaw<
        { location_id: string; open: bigint; critical: bigint; no_recovery: bigint }[]
      >`
        SELECT i.location_id,
               COUNT(*)::bigint AS open,
               COUNT(*) FILTER (WHERE i.severity = 'kritis')::bigint AS critical,
               COUNT(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM recovery_actions ra
                 WHERE ra.issue_id = i.id
                   AND ra.created_at < ${asOfExclusive}
                   AND ra.status IN ('direncanakan','berjalan','selesai')
               ))::bigint AS no_recovery
        FROM issues i
        WHERE i.location_id = ANY(${locIds}::uuid[])
          AND i.created_at < ${asOfExclusive}
          AND i.merged_into_id IS NULL
          AND (i.closed_at IS NULL OR i.closed_at >= ${asOfExclusive})
        GROUP BY 1
      `,
      db.recoveryAction.findMany({
        where: {
          status: { in: ["direncanakan", "berjalan"] },
          createdAt: { lt: asOfExclusive },
          dueDate: { lt: asOf },
          issue: { locationId: { in: locIds } },
        },
        select: { issue: { select: { locationId: true } } },
      }),
      historical
        ? Promise.resolve([])
        : db.adminMilestone.groupBy({
            by: ["locationId"],
            where: { locationId: { in: locIds }, status: "perlu_perbaikan" },
            _count: { _all: true },
          }),
    ]);

  const reportsByLoc = new Map<string, Record<string, number>>();
  for (const g of reportGroups) {
    const rec = reportsByLoc.get(g.locationId) ?? {};
    rec[g.status] = g._count._all;
    reportsByLoc.set(g.locationId, rec);
  }
  const lastReportByLoc = new Map(latestReports.map((r) => [r.locationId, r.reportDate]));
  const actsByLoc = new Map(actGroups.map((a) => [a.locationId, a._count._all]));
  const photosByLoc = new Map(photoRows.map((p) => [p.loc, p]));
  const issuesByLoc = new Map(issueRows.map((i) => [i.location_id, i]));
  const overdueByLoc = new Map<string, number>();
  for (const r of overdueRecoveries) {
    const id = r.issue.locationId;
    overdueByLoc.set(id, (overdueByLoc.get(id) ?? 0) + 1);
  }
  const milestonesByLoc = new Map(milestoneGroups.map((m) => [m.locationId, m._count._all]));

  /*
   * RENCANA KERJA pekan berjalan & komitmen pekan lalu (DECISIONS 458).
   *
   * Diambil SESUDAH `progress`, dan itu wajib: pekan berjalan tiap lokasi
   * berasal dari `weekNumber` di sana — kontraknya mulai pada tanggal yang
   * berbeda-beda, jadi tidak ada satu "minggu ke-n" yang berlaku untuk semua.
   *
   * Satu query untuk kedua pekan sekaligus. Menariknya per lokasi akan menjadi
   * 166 query untuk 83 lokasi, di jalur yang dipanggil tiap kali orang bertanya.
   */
  const pekanBerjalan = new Map<string, number>();
  for (const id of locIds) {
    const w = progress.get(id)?.weekNumber ?? 0;
    if (w > 0) pekanBerjalan.set(id, w);
  }
  const rencanaPekan = pekanBerjalan.size
    ? await db.weeklyPlan.findMany({
        where: {
          OR: [...pekanBerjalan].flatMap(([locationId, w]) => [
            { locationId, weekNumber: w },
            { locationId, weekNumber: w - 1 },
          ]),
        },
        select: {
          locationId: true,
          weekNumber: true,
          weekStart: true,
          weekEnd: true,
          items: {
            orderBy: [{ priority: "asc" }, { id: "asc" }],
            select: { targetVolume: true, rabNode: { select: { name: true, lineageKey: true } } },
          },
        },
      })
    : [];
  const rencanaIni = new Map<string, (typeof rencanaPekan)[number]>();
  const rencanaLalu = new Map<string, (typeof rencanaPekan)[number]>();
  for (const r of rencanaPekan) {
    const w = pekanBerjalan.get(r.locationId);
    if (w == null) continue;
    if (r.weekNumber === w) rencanaIni.set(r.locationId, r);
    else if (r.weekNumber === w - 1) rencanaLalu.set(r.locationId, r);
  }
  /*
   * Realisasi SELAMA pekan lalu — bukan kumulatif (perbaikan review 2026-08-28).
   *
   * Versi pertama membandingkan target MINGGUAN dengan kumulatif sepanjang
   * proyek. Lokasi yang sudah mengerjakan 25 m³ jauh sebelum pekan lalu
   * karenanya dinyatakan MEMENUHI target 20 m³ pekan lalu, padahal pekan lalu
   * ia tidak mengerjakan apa pun — angkanya tidak sekadar meleset, ia membalik
   * kesimpulannya, tepat di metrik yang dipakai menjawab "apa yang perlu
   * dikerjakan untuk mengejar".
   *
   * Rentangnya diambil dari `weekStart`/`weekEnd` rencana itu sendiri, jadi
   * benar untuk tiap paket yang mulainya berbeda tanggal. Cara yang sama sudah
   * lama dipakai PPC di `lib/plan/rencana-mingguan.ts`.
   */
  const realisasiPekanLalu = rencanaLalu.size
    ? await volumeDalamRentangByLineage(
        [...rencanaLalu.values()].map((r) => ({
          locationId: r.locationId,
          sejak: r.weekStart,
          // Tidak pernah melewati batas snapshot: pekan yang masih berjalan
          // hanya dihitung sampai `asOf`.
          sampai: r.weekEnd < asOf ? r.weekEnd : asOf,
        })),
      )
    : new Map<string, Map<string, number>>();

  /** Fakta rencana satu lokasi — `null` bila pekannya memang belum bernomor. */
  const rencanaFakta = (locId: string) => {
    if (!pekanBerjalan.has(locId)) {
      return { plannedItemsThisWeek: null, plannedItemNames: [], unfinishedLastWeek: null };
    }
    const ini = rencanaIni.get(locId);
    const lalu = rencanaLalu.get(locId);
    const realisasi = realisasiPekanLalu.get(locId);
    const belumTuntas = (lalu?.items ?? []).filter(
      (it) => (realisasi?.get(it.rabNode.lineageKey) ?? 0) < Number(it.targetVolume),
    ).length;
    return {
      // 0 = pekannya bernomor tapi rencananya BELUM disusun; null di atas =
      // pekannya sendiri belum ada. Dua kabar yang berbeda.
      plannedItemsThisWeek: ini?.items.length ?? 0,
      plannedItemNames: (ini?.items ?? []).slice(0, 6).map((it) => it.rabNode.name),
      unfinishedLastWeek: lalu ? belumTuntas : null,
    };
  };

  const endMs = asOf.getTime();
  const rows: PulseRow[] = [];
  const risks: RiskItem[] = [];
  const sourceRefs: SourceRef[] = [];

  for (const l of locations) {
    const p = progress.get(l.id);
    const rep = reportsByLoc.get(l.id) ?? {};
    const startDate = l.package.contract?.startDate ?? null;
    // Laporan diharapkan = hari periode yang ≥ SPMK (dan ≤ hari ini).
    let expected = 0;
    if (startDate) {
      const from = Math.max(start.getTime(), startDate.getTime());
      if (endMs >= from) expected = Math.floor((endMs - from) / DAY_MS) + 1;
    }
    const lastReport = lastReportByLoc.get(l.id) ?? null;
    const photos = photosByLoc.get(l.id);
    const iss = issuesByLoc.get(l.id);

    const facts: LocationFacts = {
      locationId: l.id,
      name: l.name,
      slug: l.slug,
      packageName: l.package.name,
      province: l.province,
      status: l.status,
      startDateKey: startDate ? dateKeyOf(startDate) : null,
      hasActiveRab: !!p?.activeRevisionId,
      hasActiveBaseline: !!p?.activeBaselineId,
      totalWeeks: p?.totalWeeks ?? 0,
      currentWeek: p?.weekNumber ?? 1,
      planPct: p?.planPct ?? 0,
      actualPct: p?.realizedPct ?? 0,
      deviationPp: p?.deviationPct ?? 0,
      expectedReports: expected,
      finalReports: rep.final ?? 0,
      sentReports: (rep.dikirim ?? 0) + (rep.disetujui ?? 0),
      draftReports: rep.draft ?? 0,
      needFixReports: rep.perlu_koreksi ?? 0,
      daysSinceLastReport: lastReport
        ? Math.max(0, Math.floor((asOf.getTime() - lastReport.getTime()) / DAY_MS))
        : null,
      activityCount: actsByLoc.get(l.id) ?? 0,
      photoCount: Number(photos?.total ?? 0n),
      photosNoGps: Number(photos?.no_gps ?? 0n),
      photosServerTime: Number(photos?.server_time ?? 0n),
      openIssues: Number(iss?.open ?? 0n),
      criticalIssues: Number(iss?.critical ?? 0n),
      issuesWithoutRecovery: Number(iss?.no_recovery ?? 0n),
      overdueRecoveries: overdueByLoc.get(l.id) ?? 0,
      milestonesNeedFix: milestonesByLoc.get(l.id) ?? 0,
      ...rencanaFakta(l.id),
    };

    const readiness = computeReadiness(facts);
    const locRisks = computeRisks(facts, readiness);
    risks.push(...locRisks);
    rows.push({
      ...facts,
      readiness,
      riskScore: locRisks[0]?.ruleScore ?? 0,
      riskSeverity: locRisks[0]?.severity ?? null,
    });

    // Source refs untuk drawer (angka resmi + link drill-down).
    sourceRefs.push(
      {
        id: `${l.slug}:progress`,
        entityType: "location",
        entityId: l.id,
        /*
         * Tanggal `asOf` IKUT DI LABEL. Angka progress di sini bukan "sekarang"
         * melainkan posisi pada akhir periode run; sitasi yang tidak menyebut
         * kapan membuat angka lampau terbaca sebagai angka terkini.
         */
        label: `${l.name} – progress per ${jakartaDateKey(asOf)}`,
        value: `rencana ${facts.planPct.toFixed(1)}% · realisasi ${facts.actualPct.toFixed(1)}% · deviasi ${facts.deviationPp.toFixed(1)} pp (mgg ${facts.currentWeek}/${facts.totalWeeks})`,
        href: `/lokasi/${l.slug}/progress`,
      },
      {
        id: `${l.slug}:laporan`,
        entityType: "daily_report",
        entityId: l.id,
        label: `${l.name} – laporan harian`,
        value: `${facts.finalReports}/${facts.expectedReports} final · ${facts.sentReports} proses · ${facts.draftReports} draft`,
        href: `/lokasi/${l.slug}/laporan`,
      },
      {
        id: `${l.slug}:kendala`,
        entityType: "issue",
        entityId: l.id,
        label: `${l.name} – kendala & recovery`,
        value: `${facts.openIssues} terbuka (${facts.criticalIssues} kritis) · ${facts.overdueRecoveries} recovery overdue`,
        href: `/lokasi/${l.slug}/kendala`,
      },
      {
        id: `${l.slug}:foto`,
        entityType: "photo",
        entityId: l.id,
        label: `${l.name} – dokumentasi`,
        value: `${facts.photoCount} foto · ${facts.activityCount} kegiatan dlm periode`,
        href: `/lokasi/${l.slug}/kegiatan`,
      },
    );
    /*
     * Sitasi RENCANA — dipasang selama pekannya bernomor, TERMASUK ketika
     * rencananya belum disusun (DECISIONS 458).
     *
     * Justru keadaan "belum disusun" yang paling perlu punya sitasi: itulah
     * jawaban atas *"pekerjaan apa yang perlu dilakukan untuk mengejar
     * progress?"* di lokasi yang memang belum merencanakan apa pun, dan tanpa
     * sumber, model yang dipagari hanya bisa menolak menjawab — persis balasan
     * "Saya tidak punya angka bersumber untuk menjawab itu" yang dikeluhkan.
     */
    if (facts.plannedItemsThisWeek != null) {
      const belum =
        facts.unfinishedLastWeek != null
          ? ` · ${facts.unfinishedLastWeek} komitmen pekan lalu belum tuntas`
          : "";
      sourceRefs.push({
        id: `${l.slug}:rencana`,
        entityType: "location",
        entityId: l.id,
        label: `${l.name} – rencana kerja minggu ${facts.currentWeek}`,
        value:
          facts.plannedItemsThisWeek > 0
            ? `${facts.plannedItemsThisWeek} item direncanakan${belum}`
            : `belum disusun${belum}`,
        href: `/lokasi/${l.slug}/rab`,
      });
    }
    if (facts.milestonesNeedFix > 0) {
      sourceRefs.push({
        id: `${l.slug}:milestone`,
        entityType: "milestone",
        entityId: l.id,
        label: `${l.name} – milestone administrasi`,
        value: `${facts.milestonesNeedFix} perlu perbaikan`,
        href: `/lokasi/${l.slug}/administrasi`,
      });
    }
  }

  const ordered = exceptionFirst(rows);
  const totals: PulseTotals = {
    locations: rows.length,
    reportsExpected: rows.reduce((s, r) => s + r.expectedReports, 0),
    reportsFinal: rows.reduce((s, r) => s + r.finalReports, 0),
    negativeDeviationLocations: rows.filter((r) => r.deviationPp < -0.05).length,
    openIssues: rows.reduce((s, r) => s + r.openIssues, 0),
    overdueRecoveries: rows.reduce((s, r) => s + r.overdueRecoveries, 0),
    lowReadinessLocations: rows.filter((r) => r.readiness.grade === "poor" || r.readiness.grade === "limited")
      .length,
  };

  return {
    periodStart: startKey,
    periodEnd: endKey,
    dataAsOf: await dataWatermark(locIds),
    totals,
    rows: ordered,
    risks: risks.sort((a, b) => b.ruleScore - a.ruleScore),
    sourceRefs,
    limitations,
  };
}

const GPS_RADIUS_M = 1_000;

/**
 * Fakta DETAIL kualitas data per lokasi — query lebih dalam, hanya utk scope
 * run audit (dibatasi guard maxLocationsPerRun). Tetap batched per aspek.
 */
export async function buildQualityDetails(
  user: SessionUser,
  locIds: string[],
  startKey: string,
  endKey: string,
): Promise<Map<string, QualityDetailFacts>> {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end) throw new Error("Periode tidak valid.");

  const locations = await db.location.findMany({
    where: { id: { in: locIds }, package: { orgId: user.orgId } },
    select: { id: true, name: true, gpsLat: true, gpsLng: true },
  });

  const [overruns, photoChecks, finalNoPhoto, invoiceOver] = await Promise.all([
    // Kumulatif volume per item vs volume RAB (revisi aktif, laporan counted).
    db.$queryRaw<
      { location_id: string; item_name: string; rab_volume: number; cum_volume: number }[]
    >`
      SELECT dr.location_id, rn.name AS item_name,
             rn.volume::float AS rab_volume, SUM(dri.volume_done)::float AS cum_volume
      FROM daily_report_items dri
      JOIN daily_reports dr ON dr.id = dri.report_id
      JOIN rab_revisions rr ON rr.location_id = dr.location_id AND rr.status = 'aktif'
      JOIN rab_nodes rn ON rn.revision_id = rr.id AND rn.lineage_key = dri.lineage_key AND rn.kind = 'item'
      WHERE dr.location_id = ANY(${locIds}::uuid[])
        AND dr.status::text = ANY(${[...COUNTED_REPORT_STATUSES]}::text[])
        AND rn.volume IS NOT NULL
        -- Pembandingnya volume RAB AKTIF, jadi yang dijumlahkan pun harus
        -- basis aktif saja (DECISIONS 211). Mencampur basis draft ke sini
        -- memunculkan "volume melebihi RAB" untuk pekerjaan yang justru
        -- sedang diajukan adendumnya – temuan palsu.
        AND dri.basis = 'aktif'
      GROUP BY 1, 2, rn.volume
      HAVING SUM(dri.volume_done) > rn.volume::float * 1.001
    `,
    // Foto laporan dlm periode: EXIF date mismatch + koordinat.
    db.photo.findMany({
      where: {
        report: { locationId: { in: locIds }, reportDate: { gte: start, lte: end } },
      },
      select: {
        exifTakenAt: true,
        exifGpsLat: true,
        exifGpsLng: true,
        gpsSource: true,
        report: { select: { locationId: true, reportDate: true } },
      },
    }),
    db.$queryRaw<{ location_id: string; cnt: bigint }[]>`
      SELECT dr.location_id, COUNT(*)::bigint AS cnt
      FROM daily_reports dr
      WHERE dr.location_id = ANY(${locIds}::uuid[])
        AND dr.report_date >= ${start} AND dr.report_date <= ${end}
        AND dr.status = 'final'
        AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.report_id = dr.id)
      GROUP BY 1
    `,
    db.$queryRaw<
      { location_id: string; number: string; invoice_amount: bigint; commitment_amount: bigint }[]
    >`
      SELECT i.location_id, i.number, i.amount AS invoice_amount, c.amount AS commitment_amount
      FROM invoices i
      JOIN commitments c ON c.id = i.commitment_id
      WHERE i.location_id = ANY(${locIds}::uuid[]) AND i.amount > c.amount
    `,
  ]);

  const out = new Map<string, QualityDetailFacts>();
  for (const l of locations) {
    out.set(l.id, {
      locationId: l.id,
      locationName: l.name,
      volumeOverruns: [],
      exifDateMismatch: 0,
      gpsOutsideRadius: 0,
      gpsRadiusM: GPS_RADIUS_M,
      finalReportsNoPhoto: 0,
      invoiceOverCommitment: [],
    });
  }
  for (const o of overruns) {
    out.get(o.location_id)?.volumeOverruns.push({
      itemName: o.item_name,
      rabVolume: o.rab_volume,
      cumVolume: o.cum_volume,
    });
  }
  const locMeta = new Map(locations.map((l) => [l.id, l]));
  for (const p of photoChecks) {
    const locId = p.report?.locationId;
    if (!locId) continue;
    const d = out.get(locId);
    if (!d) continue;
    if (p.exifTakenAt && p.report) {
      // Bandingkan tanggal kalender Jakarta (EXIF tersimpan sbg instan +07:00).
      if (jakartaDateKey(p.exifTakenAt) !== dateKeyOf(p.report.reportDate)) d.exifDateMismatch++;
    }
    const meta = locMeta.get(locId);
    // Hanya koordinat ASLI foto yang boleh diuji radius. Koordinat cadangan
    // titik proyek jaraknya PASTI nol — memasukkannya membuat rule ini tampak
    // selalu lulus justru pada foto yang tidak punya bukti GPS (DECISIONS 197).
    const gpsAsli = p.gpsSource === "exif" || p.gpsSource === "device";
    if (gpsAsli && p.exifGpsLat != null && p.exifGpsLng != null && meta?.gpsLat != null && meta?.gpsLng != null) {
      const dist = haversineMeters(
        Number(p.exifGpsLat),
        Number(p.exifGpsLng),
        Number(meta.gpsLat),
        Number(meta.gpsLng),
      );
      if (dist > GPS_RADIUS_M) d.gpsOutsideRadius++;
    }
  }
  for (const r of finalNoPhoto) {
    const d = out.get(r.location_id);
    if (d) d.finalReportsNoPhoto = Number(r.cnt);
  }
  for (const r of invoiceOver) {
    out.get(r.location_id)?.invoiceOverCommitment.push({
      invoiceNumber: r.number,
      invoiceAmount: `Rp ${BigInt(r.invoice_amount).toLocaleString("id-ID")}`,
      commitmentAmount: `Rp ${BigInt(r.commitment_amount).toLocaleString("id-ID")}`,
    });
  }
  return out;
}
