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
    revalidatePath("/master/perusahaan");
    revalidatePath("/paket");
    return {
      success: `"${from.name}" digabung ke "${to.name}" – ${result.contracts} kontrak & ${result.commitments} komitmen dialihkan.`,
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
      return { error: "Vendor ini masih dipakai di kontrak atau komitmen, jadi tidak bisa dihapus. Gabungkan saja ke vendor lain." };
    }
    await db.vendor.delete({ where: { id: vendor.id } });
    await audit(actor.id, "vendor.delete", "vendor", vendor.id, { name: vendor.name });
    revalidatePath("/master/perusahaan");
    return { success: `Vendor "${vendor.name}" dihapus.` };
  } catch (err) {
    return fail(err);
  }
}

/* ── Master data perusahaan: edit profil + logo (DECISIONS 134) ─────────── */

const updateSchema = z.object({
  id: z.uuid("Vendor tidak valid"),
  // Pesan per kolom WAJIB berbahasa Indonesia dan menyebut kolomnya: pesan
  // bawaan zod ("Too big: expected string to have <=40 characters") menggagalkan
  // simpan tanpa memberi tahu kolom mana – dan kop/logo yang diunggah bersamaan
  // ikut tidak tersimpan.
  name: z.string().min(2, "Nama minimal 2 karakter").max(160, "Nama perusahaan terlalu panjang (maks 160 karakter)."),
  npwp: z.string().max(40, "NPWP terlalu panjang (maks 40 karakter).").optional(),
  contact: z.string().max(120, "Narahubung terlalu panjang (maks 120 karakter).").optional(),
  address: z.string().max(400, "Alamat terlalu panjang (maks 400 karakter).").optional(),
  phone: z.string().max(40, "Telepon terlalu panjang (maks 40 karakter) – tulis satu nomor saja.").optional(),
  email: z.union([z.literal(""), z.email("Format email tidak valid")]).optional(),
});

/**
 * Batas berkas gambar identitas. 8 MB, bukan 2 MB: gambarnya selalu diperkecil
 * & dikompres ulang ke WebP di server, jadi berkas asli yang besar (pindaian,
 * ekspor desain PNG) tidak perlu ditolak – menolaknya hanya memindahkan kerja
 * kompres ke user (DECISIONS 638). Tiga berkas × 8 MB tetap di bawah batas
 * badan server action 30 MB.
 */
const GAMBAR_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Perbarui master data perusahaan (profil kop surat) + logo opsional.
 * Logo: PNG/JPG/WebP ≤ 2 MB → resize 512px webp → R2 `vendors/{id}/logo-<versi>.webp`.
 * Setiap unggahan berkas BARU (DECISIONS 634): menimpa kunci yang sama membuat
 * laporan final yang membekukan kuncinya ikut berganti gambar, dan cache logo
 * cap foto tetap menyajikan gambar lama.
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
      select: { id: true, name: true, logoKey: true, kopKey: true, stempelKey: true },
    });
    if (!vendor) return { error: "Vendor tidak ditemukan." };

    // Nama unik per org — cegah tabrakan dgn vendor lain.
    const clash = await db.vendor.findFirst({
      where: { orgId: actor.orgId, name: d.name, id: { not: d.id } },
      select: { id: true },
    });
    if (clash) return { error: `Nama "${d.name}" sudah dipakai vendor lain. Kalau memang vendor yang sama, gabungkan keduanya.` };

    const { isR2Configured, r2Put } = await import("@/lib/r2");
    const versi = Date.now().toString(36);
    const processImage = async (
      file: File,
      maxW: number,
      maxH: number,
      key: string,
      label: string,
    ): Promise<{ key: string } | { error: string }> => {
      if (file.size > GAMBAR_MAX_BYTES) return { error: `Berkas ${label} terlalu besar (maks 8 MB).` };
      if (!isR2Configured()) return { error: "Penyimpanan berkas (R2) belum diatur, jadi gambar belum bisa diunggah." };
      // Format dibaca dari ISI berkas, bukan `file.type`: berkas dari WhatsApp,
      // seret-lepas, atau ekstensi .jfif kerap datang tanpa MIME (atau MIME
      // salah) padahal gambarnya sah.
      const sharp = (await import("sharp")).default;
      const asli = Buffer.from(await file.arrayBuffer());
      let format: string | undefined;
      try {
        format = (await sharp(asli, { failOn: "none" }).metadata()).format;
      } catch {
        format = undefined;
      }
      if (!format || !["png", "jpeg", "webp"].includes(format)) {
        return {
          error: `Berkas ${label} "${file.name}" bukan gambar PNG/JPG/WebP${format ? ` (terbaca: ${format.toUpperCase()})` : ""}. Simpan ulang sebagai PNG atau JPG lalu unggah lagi.`,
        };
      }
      const buf = await sharp(asli, { failOn: "none" })
        .resize(maxW, maxH, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer();
      await r2Put(key, buf, "image/webp");
      return { key };
    };

    let logoKey = vendor.logoKey;
    const logoFile = formData.get("logo");
    if (logoFile instanceof File && logoFile.size > 0) {
      const r = await processImage(logoFile, 512, 512, `vendors/${vendor.id}/logo-${versi}.webp`, "logo");
      if ("error" in r) return { error: r.error };
      logoKey = r.key;
    }
    if (formData.get("removeLogo") === "1") logoKey = null;

    // Kop surat = gambar desain jadi milik perusahaan (lebar penuh; dipakai
    // header dokumen cetak — penempatan di laporan menyusul).
    let kopKey = vendor.kopKey;
    const kopFile = formData.get("kop");
    if (kopFile instanceof File && kopFile.size > 0) {
      const r = await processImage(kopFile, 2000, 700, `vendors/${vendor.id}/kop-${versi}.webp`, "kop surat");
      if ("error" in r) return { error: r.error };
      kopKey = r.key;
    }
    if (formData.get("removeKop") === "1") kopKey = null;

    // Stempel perusahaan (DECISIONS 328). Satu perusahaan satu stempel — itu
    // benda fisik yang sama di semua kontrak, jadi tempatnya di master vendor,
    // bukan diunggah ulang tiap kontrak. Kontrak boleh menimpanya bila memang
    // ada stempel khusus. Latar TIDAK dibuat transparan otomatis: menebak mana
    // "kertas" dan mana "tinta" pada pindaian bisa memakan garis stempelnya
    // sendiri; penempelan pakai mix-blend-multiply yang tidak merusak berkas.
    let stempelKey = vendor.stempelKey;
    const stempelFile = formData.get("stempel");
    if (stempelFile instanceof File && stempelFile.size > 0) {
      const r = await processImage(stempelFile, 600, 600, `vendors/${vendor.id}/stempel-${versi}.webp`, "stempel");
      if ("error" in r) return { error: r.error };
      stempelKey = r.key;
    }
    if (formData.get("removeStempel") === "1") stempelKey = null;

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
        stempelKey,
      },
    });
    await audit(actor.id, "vendor.update", "vendor", vendor.id, {
      name: d.name,
      logoChanged: logoKey !== vendor.logoKey,
      kopChanged: kopKey !== vendor.kopKey,
      stempelChanged: stempelKey !== vendor.stempelKey,
    });
    revalidatePath("/master/perusahaan");
    // Sebut aset yang BERUBAH: "tersimpan" saja tidak membedakan kop yang
    // masuk dari kop yang tidak ikut terkirim.
    const aset = [
      [logoKey, vendor.logoKey, "logo"],
      [stempelKey, vendor.stempelKey, "stempel"],
      [kopKey, vendor.kopKey, "kop surat"],
    ]
      .filter(([baru, lama]) => baru !== lama)
      .map(([baru, , nama]) => `${nama} ${baru ? "diperbarui" : "dihapus"}`);
    return {
      success: `Master data "${d.name}" tersimpan${aset.length ? ` – ${aset.join(", ")}` : " – logo, stempel & kop tidak berubah"}.`,
    };
  } catch (err) {
    return fail(err);
  }
}
