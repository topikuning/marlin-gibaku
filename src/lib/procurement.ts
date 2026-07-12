import type { ProcurementStage, UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";

export const PROC_STAGES: ProcurementStage[] = [
  "belum_diundang",
  "diundang",
  "negosiasi",
  "sppbj",
  "kontrak",
  "survey",
  "pcm",
  "spmk",
];

export const STAGE_LABEL: Record<ProcurementStage, string> = {
  belum_diundang: "Belum Diundang",
  diundang: "Diundang",
  negosiasi: "Negosiasi",
  sppbj: "SPPBJ",
  kontrak: "Kontrak",
  survey: "Survey",
  pcm: "PCM",
  spmk: "SPMK",
};

export const STAGE_COLOR: Record<ProcurementStage, string> = {
  belum_diundang: "#CBD5E1",
  diundang: "#94A3B8",
  negosiasi: "#F59E0B",
  sppbj: "#8B5CF6",
  kontrak: "#3B82F6",
  survey: "#0EA5E9",
  pcm: "#14B8A6",
  spmk: "#22C55E",
};

export function canSetStage(role: UserRole): boolean {
  return canManageUsers(role);
}

export type ProcRow = {
  id: string;
  slug: string;
  name: string;
  regency: string;
  province: string;
  stage: ProcurementStage;
  hps: bigint; // SUM RAB kategori aktif
  kontrak: bigint; // nilai kontrak
  contractor: string;
};

/** Baris pengadaan per lokasi + HPS (dari RAB aktif) + nilai kontrak. */
export async function getProcRows(
  locations: {
    id: string;
    slug: string;
    name: string;
    regency: string;
    province: string;
    procurementStage: ProcurementStage;
    contract: { contractValue: bigint; contractor: { name: string } };
  }[]
): Promise<ProcRow[]> {
  const ids = locations.map((l) => l.id);
  // HPS per lokasi = SUM kategori aktif (satu query, dijumlah di JS).
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
  return locations.map((l) => ({
    id: l.id,
    slug: l.slug,
    name: l.name,
    regency: l.regency,
    province: l.province,
    stage: l.procurementStage,
    hps: hpsByLoc.get(l.id) ?? 0n,
    kontrak: l.contract.contractValue,
    contractor: l.contract.contractor.name,
  }));
}

export type ProcRollup = {
  count: number;
  totalHps: bigint;
  totalKontrak: bigint;
  selisih: bigint;
  byStage: { stage: ProcurementStage; label: string; color: string; count: number }[];
};

export function rollup(rows: ProcRow[]): ProcRollup {
  const totalHps = rows.reduce((s, r) => s + r.hps, 0n);
  const totalKontrak = rows.reduce((s, r) => s + r.kontrak, 0n);
  const counts = new Map<ProcurementStage, number>();
  for (const r of rows) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  return {
    count: rows.length,
    totalHps,
    totalKontrak,
    selisih: totalHps - totalKontrak,
    byStage: PROC_STAGES.map((s) => ({
      stage: s,
      label: STAGE_LABEL[s],
      color: STAGE_COLOR[s],
      count: counts.get(s) ?? 0,
    })),
  };
}
