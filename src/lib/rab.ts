import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type ReportableItem = {
  id: string;
  lineageId: string;
  code: string;
  name: string;
  unit: string;
  volume: number | null; // volume rencana (untuk validasi & tampilan sisa)
  unitPrice: Prisma.Decimal | null;
  category: string; // "I. PEKERJAAN ... › Sub" — disambiguasi nama sama
};

/** Revisi RAB aktif untuk sebuah lokasi (DECISIONS 023). Null kalau belum ada. */
export async function getActiveRevisionId(locationId: string): Promise<string | null> {
  const rev = await db.rabRevision.findFirst({
    where: { locationId, status: "active" },
    orderBy: { revisionNo: "desc" },
    select: { id: true },
  });
  return rev?.id ?? null;
}

/**
 * Semua item RAB dari REVISI AKTIF satu lokasi (termasuk sub-item bertingkat),
 * diambil iteratif per level.
 */
type RawItem = {
  id: string;
  lineageId: string;
  code: string;
  name: string;
  unit: string | null;
  volume: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  categoryId: string | null;
  subcategoryId: string | null;
  parentItemId: string | null;
};

async function getAllLocationItems(
  locationId: string
): Promise<(RawItem & { category: string })[]> {
  const cats = await db.rabCategory.findMany({
    where: { locationId, revision: { status: "active" } },
    select: {
      id: true,
      name: true,
      romanNumeral: true,
      subcategories: { select: { id: true, name: true } },
    },
  });
  const catIds = cats.map((c) => c.id);
  const subIds = cats.flatMap((c) => c.subcategories.map((s) => s.id));

  // Label kategori/sub untuk disambiguasi item bernama sama.
  const labelByCat = new Map<string, string>();
  const labelBySub = new Map<string, string>();
  for (const c of cats) {
    const catLabel = `${c.romanNumeral}. ${c.name}`;
    labelByCat.set(c.id, catLabel);
    for (const s of c.subcategories) labelBySub.set(s.id, `${catLabel} › ${s.name}`);
  }

  const select = {
    id: true,
    lineageId: true,
    code: true,
    name: true,
    unit: true,
    volume: true,
    unitPrice: true,
    categoryId: true,
    subcategoryId: true,
    parentItemId: true,
  } as const;

  const acc: RawItem[] = [];
  let frontier = await db.rabItem.findMany({
    where: { OR: [{ categoryId: { in: catIds } }, { subcategoryId: { in: subIds } }] },
    orderBy: { sortOrder: "asc" },
    select,
  });
  acc.push(...frontier);
  while (frontier.length > 0) {
    const ids = frontier.map((i) => i.id);
    frontier = await db.rabItem.findMany({
      where: { parentItemId: { in: ids } },
      orderBy: { sortOrder: "asc" },
      select,
    });
    acc.push(...frontier);
  }

  // Resolve label kategori per item (parents diproses lebih dulu oleh BFS).
  const labelByItem = new Map<string, string>();
  return acc.map((it) => {
    const label = it.categoryId
      ? labelByCat.get(it.categoryId) ?? ""
      : it.subcategoryId
        ? labelBySub.get(it.subcategoryId) ?? ""
        : it.parentItemId
          ? labelByItem.get(it.parentItemId) ?? ""
          : "";
    labelByItem.set(it.id, label);
    return { ...it, category: label };
  });
}

/**
 * Item yang bisa dilaporkan = punya satuan + volume rencana (line item kerja
 * riil, bukan header "terdiri atas"). DECISIONS 005: lapor berbasis volume.
 */
/**
 * Cari locationId dari sebuah rabItem — telusuri ke atas (child → parent →
 * kategori/subkategori → lokasi), karena child hanya punya parentItemId.
 */
export async function getRabItemLocationId(
  rabItemId: string
): Promise<string | null> {
  let cur = await db.rabItem.findUnique({
    where: { id: rabItemId },
    select: { categoryId: true, subcategoryId: true, parentItemId: true },
  });
  // Batas iterasi untuk keamanan (kedalaman wajar < 10).
  for (let i = 0; cur && i < 20; i++) {
    if (cur.categoryId) {
      const c = await db.rabCategory.findUnique({
        where: { id: cur.categoryId },
        select: { locationId: true },
      });
      return c?.locationId ?? null;
    }
    if (cur.subcategoryId) {
      const s = await db.rabSubcategory.findUnique({
        where: { id: cur.subcategoryId },
        select: { category: { select: { locationId: true } } },
      });
      return s?.category.locationId ?? null;
    }
    if (!cur.parentItemId) return null;
    cur = await db.rabItem.findUnique({
      where: { id: cur.parentItemId },
      select: { categoryId: true, subcategoryId: true, parentItemId: true },
    });
  }
  return null;
}

export async function getReportableItems(
  locationId: string
): Promise<ReportableItem[]> {
  const items = await getAllLocationItems(locationId);
  return items
    .filter((i) => i.unit != null && i.volume != null)
    .map((i) => ({
      id: i.id,
      lineageId: i.lineageId,
      code: i.code,
      name: i.name,
      unit: i.unit as string,
      volume: i.volume != null ? i.volume.toNumber() : null,
      unitPrice: i.unitPrice,
      category: i.category,
    }));
}

/** Semua lineageId item revisi aktif — untuk rollup realisasi lintas revisi. */
export async function getActiveLineages(locationId: string): Promise<string[]> {
  const items = await getAllLocationItems(locationId);
  return [...new Set(items.map((i) => i.lineageId))];
}
