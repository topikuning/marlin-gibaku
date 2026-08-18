import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { duplicateGroups, listVendorsWithUsage } from "@/lib/vendor/queries";
import { presignKeys } from "@/lib/photos";
import { VendorManager } from "./vendor-client";

export const metadata: Metadata = { title: "Master Perusahaan" };
export const dynamic = "force-dynamic";

export default async function VendorPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "contract.manage");

  const vendors = await listVendorsWithUsage(user.orgId);
  const imageUrls = await presignKeys(
    vendors.flatMap((v) => [v.logoKey, v.kopKey, v.stempelKey]).filter((k): k is string => !!k),
  );
  const groups = duplicateGroups(vendors);

  // Ringkasan angka, bilah "perlu perhatian", saringan, dan laci edit semuanya
  // dirakit di klien (DECISIONS 359) — angkanya ikut berubah saat disaring, dan
  // KPI yang membeku di server akan berselisih dengan daftar di bawahnya.
  return (
    <VendorManager
      vendors={vendors.map((v) => ({
        id: v.id,
        name: v.name,
        npwp: v.npwp,
        contact: v.contact,
        address: v.address,
        phone: v.phone,
        email: v.email,
        logoUrl: v.logoKey ? (imageUrls.get(v.logoKey) ?? null) : null,
        kopUrl: v.kopKey ? (imageUrls.get(v.kopKey) ?? null) : null,
        stempelUrl: v.stempelKey ? (imageUrls.get(v.stempelKey) ?? null) : null,
        contractCount: v.contractCount,
        commitmentCount: v.commitmentCount,
        normKey: v.normKey,
      }))}
      duplicateKeys={groups.map((g) => g[0].normKey)}
    />
  );
}
