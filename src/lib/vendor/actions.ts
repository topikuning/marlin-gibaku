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
    revalidatePath("/administrasi/perusahaan");
    revalidatePath("/proyek/paket");
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
    revalidatePath("/administrasi/perusahaan");
    return { success: `Vendor "${vendor.name}" dihapus.` };
  } catch (err) {
    return fail(err);
  }
}

/* ── Master data perusahaan: edit profil + logo (DECISIONS 134) ─────────── */

const updateSchema = z.object({
  id: z.uuid("Vendor tidak valid"),
  name: z.string().min(2, "Nama minimal 2 karakter").max(160),
  npwp: z.string().max(40).optional(),
  contact: z.string().max(120).optional(),
  address: z.string().max(400).optional(),
  phone: z.string().max(40).optional(),
  email: z.union([z.literal(""), z.email("Format email tidak valid")]).optional(),
});

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Perbarui master data perusahaan (profil kop surat) + logo opsional.
 * Logo: PNG/JPG/WebP ≤ 2 MB → resize 512px webp → R2 `vendors/{id}/logo.webp`.
 */
export async function updateVendorAction(_prev: VendorActionState, formData: FormData): Promise<VendorActionState> {
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    name: String(formData.get("name") ?? "").trim(),
    npwp: String(formData.get("npwp") ?? "").trim(),
    contact: String(formData.get("contact") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const actor = await requireCapability("contract.manage");
    const vendor = await db.vendor.findFirst({
      where: { id: d.id, orgId: actor.orgId },
      select: { id: true, name: true, logoKey: true, kopKey: true },
    });
    if (!vendor) return { error: "Vendor tidak ditemukan." };

    // Nama unik per org — cegah tabrakan dgn vendor lain.
    const clash = await db.vendor.findFirst({
      where: { orgId: actor.orgId, name: d.name, id: { not: d.id } },
      select: { id: true },
    });
    if (clash) return { error: `Nama "${d.name}" sudah dipakai vendor lain — gunakan fitur gabung bila memang sama.` };

    const { isR2Configured, r2Put } = await import("@/lib/r2");
    const processImage = async (
      file: File,
      maxW: number,
      maxH: number,
      key: string,
      label: string,
    ): Promise<{ key: string } | { error: string }> => {
      if (file.size > LOGO_MAX_BYTES) return { error: `${label} terlalu besar (maks 2 MB).` };
      if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return { error: `Format ${label} harus PNG/JPG/WebP.` };
      if (!isR2Configured()) return { error: "Penyimpanan file (R2) belum dikonfigurasi — gambar tidak dapat diunggah." };
      const sharp = (await import("sharp")).default;
      const buf = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "none" })
        .resize(maxW, maxH, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer();
      await r2Put(key, buf, "image/webp");
      return { key };
    };

    let logoKey = vendor.logoKey;
    const logoFile = formData.get("logo");
    if (logoFile instanceof File && logoFile.size > 0) {
      const r = await processImage(logoFile, 512, 512, `vendors/${vendor.id}/logo.webp`, "logo");
      if ("error" in r) return { error: r.error };
      logoKey = r.key;
    }
    if (formData.get("removeLogo") === "1") logoKey = null;

    // Kop surat = gambar desain jadi milik perusahaan (lebar penuh; dipakai
    // header dokumen cetak — penempatan di laporan menyusul).
    let kopKey = vendor.kopKey;
    const kopFile = formData.get("kop");
    if (kopFile instanceof File && kopFile.size > 0) {
      const r = await processImage(kopFile, 2000, 700, `vendors/${vendor.id}/kop.webp`, "kop surat");
      if ("error" in r) return { error: r.error };
      kopKey = r.key;
    }
    if (formData.get("removeKop") === "1") kopKey = null;

    await db.vendor.update({
      where: { id: vendor.id },
      data: {
        name: d.name,
        npwp: d.npwp || null,
        contact: d.contact || null,
        address: d.address || null,
        phone: d.phone || null,
        email: d.email || null,
        logoKey,
        kopKey,
      },
    });
    await audit(actor.id, "vendor.update", "vendor", vendor.id, {
      name: d.name,
      logoChanged: logoKey !== vendor.logoKey,
      kopChanged: kopKey !== vendor.kopKey,
    });
    revalidatePath("/administrasi/perusahaan");
    return { success: `Master data "${d.name}" tersimpan.` };
  } catch (err) {
    return fail(err);
  }
}
