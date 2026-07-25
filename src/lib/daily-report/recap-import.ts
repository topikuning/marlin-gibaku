import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { jakartaDateKey } from "@/lib/format";
import { getOrCreateDraft, upsertItem, submitReport, DailyReportError } from "./service";
import { parseRecapWorkbook, matchRows, type RecapLeaf, type RecapMatch } from "./recap-parse";

export type { ParsedRecapRow, RecapLeaf, RecapMatch, RecapRowStatus } from "./recap-parse";
export { parseRecapWorkbook, matchRows } from "./recap-parse";

/**
 * Orkestrasi DB impor REKAP laporan harian dari Excel — untuk kasus lapangan
 * lupa lapor lalu admin merekap volume per pekerjaan per tanggal.
 *
 * PENTING (arsitektur): progress DERIVED dari laporan harian (src/lib/progress.ts).
 * Impor ini TIDAK menulis angka progress; ia merekonstruksi DailyReport +
 * DailyReportItem lewat service yang sama dengan input manual (guard volume,
 * hitung nilai, histori status, audit). Laporan masuk status "dikirim"
 * (menunggu verifikasi), progress ikut naik setelah disetujui. DECISIONS 114.
 */

export type RecapPreview = {
  rows: RecapMatch[];
  okCount: number;
  problemCount: number;
  dates: { dateKey: string; count: number }[];
  totalValue: number;
};

export type RecapCommitResult = {
  reportsTouched: number;
  itemsSaved: number;
  reportsSubmitted: number;
  skipped: number;
  errors: { rowNum: number; message: string }[];
};

/** Leaf item RAB revisi aktif + volume kumulatif counted (untuk pencocokan & sisa). */
export async function getRecapLeaves(locationId: string): Promise<RecapLeaf[]> {
  const revision = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  if (!revision) return [];
  const [nodes, cumulative] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: revision.id, kind: "item" },
      select: { id: true, code: true, name: true, unit: true, volume: true, unitPrice: true, lineageKey: true },
    }),
    cumulativeVolumeByLineage(locationId),
  ]);
  return nodes.map((n) => ({
    id: n.id,
    code: n.code ?? "",
    name: n.name,
    unit: n.unit,
    volume: n.volume != null ? Number(n.volume) : null,
    unitPrice: n.unitPrice != null ? Number(n.unitPrice) : 0,
    lineageKey: n.lineageKey,
    doneCumulative: cumulative.get(n.lineageKey) ?? 0,
  }));
}

export async function buildRecapPreview(locationId: string, buf: Buffer): Promise<RecapPreview> {
  const [rows, leaves] = await Promise.all([parseRecapWorkbook(buf), getRecapLeaves(locationId)]);
  const matches = matchRows(rows, leaves, jakartaDateKey(new Date()));
  const okRows = matches.filter((m) => m.status === "ok");
  const dateCount = new Map<string, number>();
  for (const m of okRows) dateCount.set(m.dateKey!, (dateCount.get(m.dateKey!) ?? 0) + 1);
  return {
    rows: matches,
    okCount: okRows.length,
    problemCount: matches.length - okRows.length,
    dates: [...dateCount.entries()].map(([dateKey, count]) => ({ dateKey, count })).sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    totalValue: okRows.reduce((s, m) => s + (m.valueDone ?? 0), 0),
  };
}

/**
 * Terapkan rekap: per tanggal (urut menaik) buat/ambil draft, upsert item, lalu
 * submit (→ dikirim). Urut menaik penting supaya guard volume kumulatif
 * memperhitungkan tanggal sebelumnya yang sudah di-submit dalam batch.
 */
export async function commitRecap(locationId: string, buf: Buffer, userId: string): Promise<RecapCommitResult> {
  const preview = await buildRecapPreview(locationId, buf);
  const okRows = preview.rows.filter((m) => m.status === "ok");
  const result: RecapCommitResult = { reportsTouched: 0, itemsSaved: 0, reportsSubmitted: 0, skipped: 0, errors: [] };

  const byDate = new Map<string, RecapMatch[]>();
  for (const m of okRows) (byDate.get(m.dateKey!) ?? byDate.set(m.dateKey!, []).get(m.dateKey!)!).push(m);
  const dateKeys = [...byDate.keys()].sort((a, b) => a.localeCompare(b));

  for (const dateKey of dateKeys) {
    const rows = byDate.get(dateKey)!;
    let report;
    try {
      report = await getOrCreateDraft(locationId, dateKey, userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal membuat laporan";
      for (const r of rows) result.errors.push({ rowNum: r.rowNum, message });
      result.skipped += rows.length;
      continue;
    }
    result.reportsTouched += 1;

    let savedForDate = 0;
    for (const row of rows) {
      try {
        await upsertItem(report.id, { rabNodeId: row.matchedNodeId!, volumeDone: row.volume }, userId);
        result.itemsSaved += 1;
        savedForDate += 1;
      } catch (err) {
        result.skipped += 1;
        result.errors.push({ rowNum: row.rowNum, message: err instanceof Error ? err.message : "Gagal menyimpan item" });
      }
    }

    if (savedForDate > 0 && (report.status === "draft" || report.status === "perlu_koreksi")) {
      try {
        await submitReport(report.id, userId);
        result.reportsSubmitted += 1;
      } catch (err) {
        // Biarkan sebagai draft bila submit gagal; item tetap tersimpan.
        if (!(err instanceof DailyReportError)) throw err;
      }
    }
  }

  await audit(userId, "daily_report.recap_import", "location", locationId, {
    reportsTouched: result.reportsTouched,
    itemsSaved: result.itemsSaved,
    reportsSubmitted: result.reportsSubmitted,
    skipped: result.skipped,
  });
  return result;
}
