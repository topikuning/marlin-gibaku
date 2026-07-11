import type { RabRevisionSource } from "@prisma/client";
import { db } from "@/lib/db";
import type { ParsedHps, ParsedItem } from "@/lib/hps-parser";

/**
 * Peta lineage revisi lama: key `${roman}#${code}` → lineageId, untuk carry-over
 * realisasi saat adendum (DECISIONS 023). Kedalaman anak ≤ 2 (sesuai data HPS).
 */
async function getPriorLineageMap(revisionId: string): Promise<Map<string, string>> {
  const kid = { select: { code: true, lineageId: true } } as const;
  const kids2 = { select: { code: true, lineageId: true, children: kid } } as const;
  const itemSel = {
    select: { code: true, lineageId: true, children: kids2 },
  } as const;

  const cats = await db.rabCategory.findMany({
    where: { revisionId },
    select: {
      romanNumeral: true,
      items: { where: { parentItemId: null }, ...itemSel },
      subcategories: {
        select: { items: { where: { parentItemId: null }, ...itemSel } },
      },
    },
  });

  const map = new Map<string, string>();
  type Node = { code: string; lineageId: string; children?: Node[] };
  const walk = (roman: string, items: Node[]) => {
    for (const it of items) {
      map.set(`${roman}#${it.code}`, it.lineageId);
      if (it.children?.length) walk(roman, it.children);
    }
  };
  for (const c of cats) {
    walk(c.romanNumeral, c.items as Node[]);
    for (const s of c.subcategories) walk(c.romanNumeral, s.items as Node[]);
  }
  return map;
}

export type CreateRevisionOpts = {
  source: RabRevisionSource;
  note?: string | null;
  amendmentId?: string | null;
  createdByUserId?: string | null;
  hpsFileDocId?: string | null;
};

/**
 * Buat revisi RAB baru dari hasil parse HPS. Non-transaksional (11k+ item),
 * tapi AMAN: revisi baru dibuat status `draft` (tak terlihat) → tree di-insert →
 * finalize atomik (draft→active, active lama→superseded).
 */
export async function createRevisionFromParsed(
  locationId: string,
  parsed: ParsedHps,
  opts: CreateRevisionOpts
): Promise<{ revisionId: string; revisionNo: number }> {
  const prior = await db.rabRevision.findFirst({
    where: { locationId, status: "active" },
    select: { id: true, revisionNo: true },
  });
  const lineageMap = prior ? await getPriorLineageMap(prior.id) : new Map<string, string>();

  const maxRev = await db.rabRevision.aggregate({
    where: { locationId },
    _max: { revisionNo: true },
  });
  const revisionNo = (maxRev._max.revisionNo ?? 0) + 1;

  const grandTotal = BigInt(Math.round(parsed.grandTotal));
  const revision = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo,
      source: opts.source,
      status: "draft",
      totalValue: grandTotal,
      note: opts.note ?? null,
      amendmentId: opts.amendmentId ?? null,
      hpsFileDocId: opts.hpsFileDocId ?? null,
      createdByUserId: opts.createdByUserId ?? null,
    },
  });

  const lineageFor = (roman: string, code: string): string | undefined =>
    lineageMap.get(`${roman}#${code}`);

  // Insert item + anak rekursif (sequential, warisi lineage by roman#code).
  const insertItem = async (
    item: ParsedItem,
    roman: string,
    link: { categoryId?: string; subcategoryId?: string; parentItemId?: string },
    sort: number
  ): Promise<void> => {
    const created = await db.rabItem.create({
      data: {
        ...link,
        lineageId: lineageFor(roman, item.code), // undefined → default uuid baru
        code: item.code,
        name: item.name,
        volume: item.volume ?? undefined,
        unit: item.unit ?? undefined,
        unitPrice: item.unitPrice ?? undefined,
        totalPrice: item.totalPrice ?? undefined,
        tkdnRatio: item.tkdn ?? undefined,
        sortOrder: sort,
      },
    });
    let cs = 0;
    for (const ch of item.children) {
      await insertItem(ch, roman, { parentItemId: created.id }, cs++);
    }
  };

  let catSort = 0;
  for (const cat of parsed.categories) {
    if (cat.totalValue <= 0) continue;
    const category = await db.rabCategory.create({
      data: {
        locationId,
        revisionId: revision.id,
        romanNumeral: cat.roman,
        name: cat.name,
        totalValue: BigInt(Math.round(cat.totalValue)),
        sortOrder: catSort++,
      },
    });
    let dSort = 0;
    for (const it of cat.directItems) {
      await insertItem(it, cat.roman, { categoryId: category.id }, dSort++);
    }
    let sSort = 0;
    const seen = new Map<string, number>();
    for (const sub of cat.subcategories) {
      const n = seen.get(sub.code) ?? 0;
      seen.set(sub.code, n + 1);
      const subcategory = await db.rabSubcategory.create({
        data: {
          categoryId: category.id,
          code: n === 0 ? sub.code : `${sub.code}#${n + 1}`,
          name: sub.name,
          totalValue: BigInt(Math.round(sub.totalValue)),
          sortOrder: sSort++,
        },
      });
      let iSort = 0;
      for (const it of sub.items) {
        await insertItem(it, cat.roman, { subcategoryId: subcategory.id }, iSort++);
      }
    }
  }

  // Finalize atomik: draft → active, active lama → superseded.
  await db.$transaction([
    ...(prior
      ? [
          db.rabRevision.update({
            where: { id: prior.id },
            data: { status: "superseded", supersededAt: new Date() },
          }),
        ]
      : []),
    db.rabRevision.update({ where: { id: revision.id }, data: { status: "active" } }),
  ]);

  return { revisionId: revision.id, revisionNo };
}
