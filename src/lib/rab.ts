import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type ReportableItem = {
  id: string;
  code: string;
  name: string;
  unit: string;
  unitPrice: Prisma.Decimal | null;
};

/**
 * Semua item RAB milik satu lokasi (termasuk sub-item bertingkat via
 * parentItemId), diambil iteratif per level.
 */
async function getAllLocationItems(locationId: string) {
  const cats = await db.rabCategory.findMany({
    where: { locationId },
    select: { id: true, subcategories: { select: { id: true } } },
  });
  const catIds = cats.map((c) => c.id);
  const subIds = cats.flatMap((c) => c.subcategories.map((s) => s.id));

  const select = {
    id: true,
    code: true,
    name: true,
    unit: true,
    volume: true,
    unitPrice: true,
  } as const;

  const acc: {
    id: string;
    code: string;
    name: string;
    unit: string | null;
    volume: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal | null;
  }[] = [];

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
  return acc;
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
      code: i.code,
      name: i.name,
      unit: i.unit as string,
      unitPrice: i.unitPrice,
    }));
}
