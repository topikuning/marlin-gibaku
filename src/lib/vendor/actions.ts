"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";

export type VendorActionState = { error?: string; success?: string } | undefined;

function fail(err: unknown): VendorActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const mergeSchema = z.object({
  fromId: z.uuid("Vendor sumber tidak valid"),
  toId: z.uuid("Vendor tujuan tidak valid"),
});

/**
 * Gabung dua vendor duplikat: SEMUA kontrak & komitmen `from` dialihkan ke `to`,
 * lalu `from` dihapus. Satu transaksi. `to` = vendor kanonik (dipertahankan).
 */
export async function mergeVendorsAction(_prev: VendorActionState, formData: FormData): Promise<VendorActionState> {
  const parsed = mergeSchema.safeParse({ fromId: formData.get("fromId"), toId: formData.get("toId") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { fromId, toId } = parsed.data;
  if (fromId === toId) return { error: "Pilih vendor tujuan yang berbeda." };

  try {
    const actor = await requireCapability("contract.manage");
    const [from, to] = await Promise.all([
      db.vendor.findFirst({ where: { id: fromId, orgId: actor.orgId }, select: { id: true, name: true } }),
      db.vendor.findFirst({ where: { id: toId, orgId: actor.orgId }, select: { id: true, name: true } }),
    ]);
    if (!from || !to) return { error: "Vendor tidak ditemukan." };

    const result = await db.$transaction(async (tx) => {
      const c = await tx.contract.updateMany({ where: { vendorId: fromId }, data: { vendorId: toId } });
      const k = await tx.commitment.updateMany({ where: { vendorId: fromId }, data: { vendorId: toId } });
      await tx.vendor.delete({ where: { id: fromId } });
      return { contracts: c.count, commitments: k.count };
    });

    await audit(actor.id, "vendor.merge", "vendor", toId, {
      fromId,
      fromName: from.name,
      toName: to.name,
      movedContracts: result.contracts,
      movedCommitments: result.commitments,
    });
    revalidatePath("/paket/vendor");
    revalidatePath("/paket");
    return {
      success: `"${from.name}" digabung ke "${to.name}" — ${result.contracts} kontrak & ${result.commitments} komitmen dialihkan.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/** Hapus vendor yang BELUM dipakai (0 kontrak & 0 komitmen). */
export async function deleteVendorAction(_prev: VendorActionState, formData: FormData): Promise<VendorActionState> {
  const parsed = z.uuid().safeParse(formData.get("vendorId"));
  if (!parsed.success) return { error: "Vendor tidak valid." };
  try {
    const actor = await requireCapability("contract.manage");
    const vendor = await db.vendor.findFirst({
      where: { id: parsed.data, orgId: actor.orgId },
      select: { id: true, name: true, _count: { select: { contracts: true, commitments: true } } },
    });
    if (!vendor) return { error: "Vendor tidak ditemukan." };
    if (vendor._count.contracts > 0 || vendor._count.commitments > 0) {
      return { error: "Vendor masih dipakai kontrak/komitmen — gabungkan ke vendor lain, jangan hapus." };
    }
    await db.vendor.delete({ where: { id: vendor.id } });
    await audit(actor.id, "vendor.delete", "vendor", vendor.id, { name: vendor.name });
    revalidatePath("/paket/vendor");
    return { success: `Vendor "${vendor.name}" dihapus.` };
  } catch (err) {
    return fail(err);
  }
}
