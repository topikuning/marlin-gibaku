import "server-only";
import { db } from "@/lib/db";

export type VendorRow = {
  id: string;
  name: string;
  npwp: string | null;
  contact: string | null;
  contractCount: number;
  commitmentCount: number;
  /** Kunci ternormalisasi utk mendeteksi kemungkinan duplikat (CV./PT/spasi/titik dibuang). */
  normKey: string;
};

/** Buang prefix badan usaha + non-alfanumerik → kunci pembanding duplikat. */
export function normalizeVendorName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\b(CV|PT|UD|PD|TB|FA|KOPERASI)\b/g, " ")
    .replace(/[^A-Z0-9]/g, "");
}

export async function listVendorsWithUsage(orgId: string): Promise<VendorRow[]> {
  const vendors = await db.vendor.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      npwp: true,
      contact: true,
      _count: { select: { contracts: true, commitments: true } },
    },
  });
  return vendors.map((v) => ({
    id: v.id,
    name: v.name,
    npwp: v.npwp,
    contact: v.contact,
    contractCount: v._count.contracts,
    commitmentCount: v._count.commitments,
    normKey: normalizeVendorName(v.name),
  }));
}

/** Kelompok kemungkinan duplikat: normKey sama & anggota > 1. */
export function duplicateGroups(vendors: VendorRow[]): VendorRow[][] {
  const map = new Map<string, VendorRow[]>();
  for (const v of vendors) {
    if (!v.normKey) continue;
    const arr = map.get(v.normKey) ?? [];
    arr.push(v);
    map.set(v.normKey, arr);
  }
  return [...map.values()].filter((g) => g.length > 1);
}
