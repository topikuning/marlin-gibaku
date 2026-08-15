import "server-only";
import { db } from "@/lib/db";
import { deriveCategorySchedule } from "@/lib/baseline";
import { susunRincian, type BarisRincian, type SimpulRab } from "@/lib/export/rincian-jadwal";

/**
 * Pemuat data RINCIAN TIME SCHEDULE (DECISIONS 316) — menyatukan pohon RAB
 * aktif dengan jadwal per kategori.
 *
 * Dipisah dari penyusun barisnya (`export/rincian-jadwal.ts`, murni) dan dari
 * penulis Excel-nya: yang menyentuh database cuma berkas ini.
 */

export type RincianJadwal = {
  rows: BarisRincian[];
  totalWeeks: number;
  origin: "tersimpan" | "otomatis";
};

export async function muatRincianJadwal(locationId: string): Promise<RincianJadwal | null> {
  const revision = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  if (!revision) return null;

  // Jadwal per kategori memakai lapisan yang SAMA dengan editor jadwal & kurva-S
  // (`deriveCategorySchedule`) — kalau berkas ini menghitung jadwalnya sendiri,
  // rincian dan kurva bisa bercerita beda tentang minggu yang sama.
  const jadwal = await deriveCategorySchedule(locationId);
  if (!jadwal) return null;

  const nodes = await db.rabNode.findMany({
    where: { revisionId: revision.id },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      parentId: true,
      kind: true,
      code: true,
      name: true,
      volume: true,
      unit: true,
      unitPrice: true,
      amount: true,
      lineageKey: true,
    },
  });
  if (nodes.length === 0) return null;

  const simpul: SimpulRab[] = nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    kind: n.kind,
    code: n.code,
    name: n.name,
    volume: n.volume === null ? null : Number(n.volume),
    unit: n.unit,
    unitPrice: n.unitPrice === null ? null : Number(n.unitPrice),
    amount: Number(n.amount),
    lineageKey: n.lineageKey,
  }));

  // Pembagi bobot = Σ KATEGORI, definisi yang sama dengan `lib/progress.ts`.
  // Menjumlahkan seluruh simpul akan menghitung ganda (kategori + anaknya).
  const grand = simpul.filter((n) => n.kind === "kategori").reduce((s, n) => s + n.amount, 0);
  if (grand <= 0) return null;

  return {
    rows: susunRincian(
      simpul,
      grand,
      jadwal.rows.map((r) => ({ lineageKey: r.lineageKey, segments: r.segments })),
    ),
    totalWeeks: jadwal.totalWeeks,
    origin: jadwal.origin,
  };
}
