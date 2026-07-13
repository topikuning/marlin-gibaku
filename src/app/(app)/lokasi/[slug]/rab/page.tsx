import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation, canManageUsers } from "@/lib/roles";
import { formatRupiah } from "@/lib/format";

type RabItem = {
  id: string;
  parentItemId: string | null;
  code: string;
  name: string;
  volume: Prisma.Decimal | null;
  unit: string | null;
  totalPrice: Prisma.Decimal | null;
};

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

function fmtVolume(item: RabItem): string {
  if (item.volume == null) return "";
  return `${volFmt.format(item.volume.toNumber())} ${item.unit ?? ""}`.trim();
}

function fmtHarga(v: Prisma.Decimal | null): string {
  return v == null ? "" : formatRupiah(Math.round(v.toNumber()));
}

export default async function RabPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  const { slug } = await params;

  const location = await db.location.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!location) notFound();

  if (!isCrossLocation(role)) {
    const assigned = await db.userLocationAssignment.findFirst({
      where: { userId, locationId: location.id, unassignedAt: null },
    });
    if (!assigned) notFound();
  }

  const categories = await db.rabCategory.findMany({
    where: { locationId: location.id, revision: { status: "active" } },
    orderBy: { sortOrder: "asc" },
    include: {
      subcategories: { orderBy: { sortOrder: "asc" } },
    },
  });
  const catIds = categories.map((c) => c.id);
  const subIds = categories.flatMap((c) => c.subcategories.map((s) => s.id));

  // Ambil semua item lokasi ini secara iteratif (item → child → grandchild).
  const itemSelect = {
    id: true,
    parentItemId: true,
    categoryId: true,
    subcategoryId: true,
    code: true,
    name: true,
    volume: true,
    unit: true,
    totalPrice: true,
  };
  const allItems: (RabItem & {
    categoryId: string | null;
    subcategoryId: string | null;
  })[] = [];
  let frontier = await db.rabItem.findMany({
    where: { OR: [{ categoryId: { in: catIds } }, { subcategoryId: { in: subIds } }] },
    orderBy: { sortOrder: "asc" },
    select: itemSelect,
  });
  allItems.push(...frontier);
  while (frontier.length > 0) {
    const ids = frontier.map((i) => i.id);
    frontier = await db.rabItem.findMany({
      where: { parentItemId: { in: ids } },
      orderBy: { sortOrder: "asc" },
      select: itemSelect,
    });
    allItems.push(...frontier);
  }

  // Index anak per parent.
  const childrenByParent = new Map<string, RabItem[]>();
  for (const it of allItems) {
    if (it.parentItemId) {
      const arr = childrenByParent.get(it.parentItemId) ?? [];
      arr.push(it);
      childrenByParent.set(it.parentItemId, arr);
    }
  }
  const directByCategory = new Map<string, RabItem[]>();
  const itemsBySubcategory = new Map<string, RabItem[]>();
  for (const it of allItems) {
    if (it.parentItemId) continue;
    if (it.categoryId) {
      const arr = directByCategory.get(it.categoryId) ?? [];
      arr.push(it);
      directByCategory.set(it.categoryId, arr);
    } else if (it.subcategoryId) {
      const arr = itemsBySubcategory.get(it.subcategoryId) ?? [];
      arr.push(it);
      itemsBySubcategory.set(it.subcategoryId, arr);
    }
  }

  function renderItem(item: RabItem, depth: number): React.ReactNode {
    const children = childrenByParent.get(item.id) ?? [];
    return (
      <div key={item.id}>
        <div className="flex items-start gap-3 border-b border-[#F1F5F9] py-1.5 last:border-0">
          <div
            className="min-w-0 flex-1"
            style={{ paddingLeft: `${depth * 18}px` }}
          >
            <span className="mr-2 font-mono text-[11px] text-[#64748B]">
              {item.code}
            </span>
            <span className="text-[#0F172A]">{item.name}</span>
          </div>
          <div className="w-28 shrink-0 text-right text-xs text-[#1e3a8a]">
            {fmtVolume(item)}
          </div>
          <div className="w-32 shrink-0 text-right text-xs tabular-nums text-[#0F172A]">
            {fmtHarga(item.totalPrice)}
          </div>
        </div>
        {children.map((c) => renderItem(c, depth + 1))}
      </div>
    );
  }

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-semibold text-[#0F172A]">
          RAB — {location.name}
        </h1>
        {canManageUsers(role) && (
          <Link
            href={`/lokasi/${slug}/rab/import`}
            className="rounded-md border border-[#1e3a8a] px-3 py-1.5 text-sm font-semibold text-[#1e3a8a] transition hover:bg-[#F1F5F9]"
          >
            Import / Adendum RAB
          </Link>
        )}
      </div>
      <p className="mb-8 text-sm text-[#1e3a8a]">
        {categories.length} kategori · rincian item sampai sub-item. Klik
        kategori untuk buka/tutup.
      </p>

      <div className="space-y-3">
        {categories.map((cat) => {
          const directItems = directByCategory.get(cat.id) ?? [];
          return (
            <details
              key={cat.id}
              open
              className="overflow-hidden rounded-lg border border-[#E2E8F0]"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 bg-[#FFFFFF] px-4 py-2.5">
                <span className="font-semibold text-[#0F172A]">
                  <span className="mr-2 text-[#64748B]">{cat.romanNumeral}</span>
                  {cat.name}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-[#1e3a8a]">
                  {formatRupiah(cat.totalValue)}
                </span>
              </summary>

              <div className="px-4 py-2">
                {directItems.map((it) => renderItem(it, 0))}

                {cat.subcategories.map((sub) => {
                  const subItems = itemsBySubcategory.get(sub.id) ?? [];
                  return (
                    <div key={sub.id} className="mt-2">
                      <div className="flex items-center justify-between gap-3 border-b border-[#E2E8F0] py-1.5">
                        <span className="text-sm font-semibold text-[#1e3a8a]">
                          <span className="mr-2 font-mono text-[11px] text-[#64748B]">
                            {sub.code}
                          </span>
                          {sub.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-[#64748B]">
                          {formatRupiah(sub.totalValue)}
                        </span>
                      </div>
                      {subItems.map((it) => renderItem(it, 0))}
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
