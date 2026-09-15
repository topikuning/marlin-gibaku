import "server-only";
import { db } from "@/lib/db";

/**
 * Node item pada revisi RAB **AKTIF**, dicari lewat `lineageKey`.
 *
 * `DailyReportItem.rabNodeId` ditulis sekali saat barisnya dibuat dan tidak
 * pernah dipetakan ulang. Begitu adendum diaktifkan, node itu menjadi milik
 * revisi `digantikan` — masa lalu. Siapa pun yang membaca "volume kontrak" dari
 * `item.rabNode` sesudah itu membaca volume kontrak LAMA: pagar volume
 * meloloskan angka yang melampaui kontrak berlaku, dan blanko harian mencetak
 * "Volume Kontrak" yang berbeda dari laporan mingguan untuk item yang sama.
 *
 * `lineageKey` justru identitas yang bertahan lintas revisi — itu sebabnya
 * seluruh lapisan hitung (progress, periodic-report, ringkas) menjodohkan
 * dengannya. Modul ini menyediakan jalan yang sama untuk lapisan laporan
 * harian. Audit 2026-09-15 (B-2).
 */
export type NodeAktif = {
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
};

/** Peta lineageKey → node revisi AKTIF. Lineage yang sudah tidak ada: absen. */
export async function nodeAktifByLineage(
  locationId: string,
  lineageKeys: Iterable<string>,
): Promise<Map<string, NodeAktif>> {
  const keys = [...new Set(lineageKeys)];
  if (keys.length === 0) return new Map();
  const rows = await db.rabNode.findMany({
    where: {
      lineageKey: { in: keys },
      kind: "item",
      revision: { locationId, status: "aktif" },
    },
    select: { lineageKey: true, code: true, name: true, unit: true, volume: true },
  });
  return new Map(
    rows.map((r) => [
      r.lineageKey,
      {
        lineageKey: r.lineageKey,
        code: r.code,
        name: r.name,
        unit: r.unit,
        volume: r.volume != null ? Number(r.volume) : null,
      },
    ]),
  );
}
