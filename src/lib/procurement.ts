import type { DocumentStage } from "@prisma/client";
import { db } from "@/lib/db";
import { deriveDocStage, floorStage, STAGE_ORDER, STAGE_LABEL, STAGE_COLOR } from "@/lib/documents";

/** Tahap yang ditampilkan di funnel paket (semua lokasi ini sudah kontrak). */
export const PAKET_STAGES: DocumentStage[] = STAGE_ORDER.filter((s) => s !== "lainnya");

export type ProcRow = {
  id: string;
  slug: string;
  name: string;
  regency: string;
  province: string;
  stage: DocumentStage; // DITURUNKAN dari dokumen (bukan set manual)
  hps: bigint; // SUM RAB kategori aktif
  kontrak: bigint; // nilai kontrak
  contractor: string;
};

type LocInput = {
  id: string;
  slug: string;
  name: string;
  regency: string;
  province: string;
  contractId: string;
  contract: { contractValue: bigint; contractor: { name: string } };
};

/**
 * Baris paket per lokasi. Tahap DITURUNKAN dari dokumen (level lokasi + level
 * kontrak), bukan dipilih manual. Semua lokasi di sini sudah punya kontrak,
 * jadi tahap minimal = "kontrak"; dokumen SPMK/BAST/dst menggesernya maju.
 */
export async function getProcRows(locations: LocInput[]): Promise<ProcRow[]> {
  const ids = locations.map((l) => l.id);
  const contractIds = [...new Set(locations.map((l) => l.contractId))];

  // HPS per lokasi = SUM kategori aktif.
  const cats = ids.length
    ? await db.rabCategory.findMany({
        where: { locationId: { in: ids }, revision: { status: "active" } },
        select: { locationId: true, totalValue: true },
      })
    : [];
  const hpsByLoc = new Map<string, bigint>();
  for (const c of cats) {
    hpsByLoc.set(c.locationId, (hpsByLoc.get(c.locationId) ?? 0n) + c.totalValue);
  }

  // Dokumen level lokasi + level kontrak → tahap terjauh.
  const docs =
    ids.length || contractIds.length
      ? await db.document.findMany({
          where: {
            OR: [{ locationId: { in: ids } }, { contractId: { in: contractIds } }],
          },
          select: { locationId: true, contractId: true, stage: true },
        })
      : [];
  const stagesByLoc = new Map<string, DocumentStage[]>();
  const stagesByContract = new Map<string, DocumentStage[]>();
  for (const d of docs) {
    if (d.locationId) {
      const arr = stagesByLoc.get(d.locationId) ?? [];
      arr.push(d.stage);
      stagesByLoc.set(d.locationId, arr);
    } else if (d.contractId) {
      const arr = stagesByContract.get(d.contractId) ?? [];
      arr.push(d.stage);
      stagesByContract.set(d.contractId, arr);
    }
  }

  return locations.map((l) => {
    const stages = [
      ...(stagesByLoc.get(l.id) ?? []),
      ...(stagesByContract.get(l.contractId) ?? []),
    ];
    const derived = deriveDocStage(stages);
    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      regency: l.regency,
      province: l.province,
      stage: floorStage(derived, "kontrak"),
      hps: hpsByLoc.get(l.id) ?? 0n,
      kontrak: l.contract.contractValue,
      contractor: l.contract.contractor.name,
    };
  });
}

export type ProcRollup = {
  count: number;
  totalHps: bigint;
  totalKontrak: bigint;
  selisih: bigint;
  byStage: { stage: DocumentStage; label: string; color: string; count: number }[];
};

export function rollup(rows: ProcRow[]): ProcRollup {
  const totalHps = rows.reduce((s, r) => s + r.hps, 0n);
  const totalKontrak = rows.reduce((s, r) => s + r.kontrak, 0n);
  const counts = new Map<DocumentStage, number>();
  for (const r of rows) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  return {
    count: rows.length,
    totalHps,
    totalKontrak,
    selisih: totalHps - totalKontrak,
    // Hanya tampilkan tahap yang punya isi (mulai dari "kontrak" ke atas).
    byStage: PAKET_STAGES.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({
      stage: s,
      label: STAGE_LABEL[s],
      color: STAGE_COLOR[s],
      count: counts.get(s) ?? 0,
    })),
  };
}
