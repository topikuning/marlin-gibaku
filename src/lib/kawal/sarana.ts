import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey } from "@/lib/format";
import { volumeHarianByLineage } from "@/lib/progress";
import { progresKelompokPerTanggal } from "@/lib/progress-calc";
import { itemPerKategori } from "@/lib/rab/kategori-lineage";
import {
  pasangkanSarana,
  type HasilPerSarana,
  type KelompokMarlin,
  type KeputusanSarana,
  type SaranaKawalTampil,
} from "./sarana-cocok";

/**
 * Kelompok RAB MARLIN (kategori tingkat 1 revisi AKTIF) beserta progresnya
 * s/d hari ini – rumus yang sama dengan "Progres per Kategori" laporan
 * mingguan dan dokumentasi foto per sarana (DECISIONS 683). Kosong bila
 * lokasi belum punya RAB aktif.
 */
export async function kelompokMarlinKini(locationId: string): Promise<KelompokMarlin[]> {
  const rev = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true, totalValue: true },
  });
  if (!rev) return [];
  const [nodes, realisasi] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: rev.id },
      select: { parentId: true, kind: true, code: true, name: true, lineageKey: true, amount: true, volume: true },
      orderBy: { sortOrder: "asc" },
    }),
    volumeHarianByLineage(locationId),
  ]);
  const { akar, item } = itemPerKategori(nodes);
  const hariIni = jakartaDateKey(new Date());
  const grandTotal = Number(rev.totalValue);
  return akar.map((a) => {
    const items = (item.get(a.lineageKey) ?? []).map((n) => ({
      lineageKey: n.lineageKey,
      amount: Number(n.amount),
      volume: n.volume == null ? null : Number(n.volume),
    }));
    const progres = progresKelompokPerTanggal(items, realisasi, grandTotal, [hariIni]);
    return { kunci: a.lineageKey, code: a.code, name: a.name, progresPct: progres.get(hariIni) ?? 0 };
  });
}

/** Keputusan orang atas sarana Kawal satu lokasi. */
export async function keputusanSaranaKawal(locationId: string): Promise<KeputusanSarana[]> {
  const rows = await db.kawalSaranaMap.findMany({
    where: { locationId },
    select: { kawalItemId: true, status: true, lineageKey: true },
  });
  return rows.map((r) => ({
    kawalItemId: r.kawalItemId,
    status: r.status === "tidak_ada" ? "tidak_ada" : "dikonfirmasi",
    lineageKey: r.lineageKey,
  }));
}

/** Tabel per sarana satu lokasi: sarana Kawal tarikan terbaru lawan kelompok RAB MARLIN. */
export async function perSaranaKawal(
  locationId: string,
  sarana: SaranaKawalTampil[],
): Promise<HasilPerSarana & { kelompok: KelompokMarlin[] }> {
  const [kelompok, keputusan] = await Promise.all([kelompokMarlinKini(locationId), keputusanSaranaKawal(locationId)]);
  return { ...pasangkanSarana(sarana, kelompok, keputusan), kelompok };
}
