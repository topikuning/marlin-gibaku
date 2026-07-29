"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCapability, requireLocationAccess, ForbiddenError } from "@/lib/auth/session";
import {
  AdendumError,
  addDraftItem,
  addDraftKategori,
  createAdendumDraft,
  removeDraftNode,
  updateDraftItemVolume,
  updateDraftNewItemFields,
} from "@/lib/rab/adendum";

/**
 * Server actions EDITOR DRAFT ADENDUM. Semua guard bisnis (draft-only, volume
 * ≥ realisasi, harga item lama terkunci, hapus tanpa realisasi) ada di service
 * `lib/rab/adendum` — di sini hanya otorisasi + parsing + revalidate.
 */

export type AdendumActionState = { error?: string; success?: string } | undefined;

function errState(err: unknown): AdendumActionState {
  if (err instanceof AdendumError || err instanceof ForbiddenError) return { error: err.message };
  console.error("[adendum] aksi gagal:", err);
  return { error: "Terjadi kesalahan tak terduga. Coba lagi." };
}

/** Lokasi dari slug + gate rab.manage + akses lokasi. */
async function requireCtx(slug: string) {
  const user = await requireCapability("rab.manage");
  const location = await db.location.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  });
  if (!location) throw new AdendumError("Lokasi tidak ditemukan.");
  await requireLocationAccess(user, location.id);
  return { user, location };
}

function revalidate(slug: string) {
  revalidatePath(`/lokasi/${slug}/rab/adendum`);
  revalidatePath(`/lokasi/${slug}/rab`);
}

const slugSchema = z.string().min(1);

export async function createDraftAction(_prev: AdendumActionState, formData: FormData): Promise<AdendumActionState> {
  try {
    const slug = slugSchema.parse(formData.get("slug"));
    const { user, location } = await requireCtx(slug);
    const note = String(formData.get("note") ?? "").trim() || null;
    const amendmentRaw = String(formData.get("amendmentId") ?? "").trim();
    const amendmentId = amendmentRaw ? z.uuid().parse(amendmentRaw) : null;
    const res = await createAdendumDraft(location.id, user.id, { note, amendmentId });
    revalidate(slug);
    return { success: `Draft revisi #${res.revisionNo} dibuat — silakan edit lalu aktifkan.` };
  } catch (err) {
    if (err instanceof z.ZodError) return { error: "Adendum kontrak (CCO) tidak valid." };
    return errState(err);
  }
}

const volumeSchema = z.object({
  slug: slugSchema,
  revisionId: z.uuid(),
  nodeId: z.uuid(),
  volume: z.coerce.number(),
});

export async function updateVolumeAction(_prev: AdendumActionState, formData: FormData): Promise<AdendumActionState> {
  try {
    const d = volumeSchema.parse({
      slug: formData.get("slug"),
      revisionId: formData.get("revisionId"),
      nodeId: formData.get("nodeId"),
      volume: formData.get("volume"),
    });
    const { user } = await requireCtx(d.slug);
    await updateDraftItemVolume(d.revisionId, d.nodeId, d.volume, user.id);
    revalidate(d.slug);
    return { success: "Volume diperbarui." };
  } catch (err) {
    return errState(err);
  }
}

const newItemFieldSchema = z.object({
  slug: slugSchema,
  revisionId: z.uuid(),
  nodeId: z.uuid(),
  field: z.enum(["code", "name", "unit", "unitPrice"]),
  value: z.string(),
});

/** Edit satu field item BARU dari sel grid (kode/nama/satuan/harga satuan). */
export async function updateNewItemFieldAction(
  _prev: AdendumActionState,
  formData: FormData,
): Promise<AdendumActionState> {
  try {
    const d = newItemFieldSchema.parse({
      slug: formData.get("slug"),
      revisionId: formData.get("revisionId"),
      nodeId: formData.get("nodeId"),
      field: formData.get("field"),
      value: formData.get("value"),
    });
    const { user } = await requireCtx(d.slug);
    const patch =
      d.field === "unitPrice"
        ? { unitPrice: Number(d.value) }
        : d.field === "unit"
          ? { unit: d.value || null }
          : { [d.field]: d.value };
    await updateDraftNewItemFields(d.revisionId, d.nodeId, patch, user.id);
    revalidate(d.slug);
    return { success: "Tersimpan." };
  } catch (err) {
    if (err instanceof z.ZodError) return { error: err.issues[0].message };
    return errState(err);
  }
}

const addItemSchema = z.object({
  slug: slugSchema,
  revisionId: z.uuid(),
  parentId: z.uuid(),
  code: z.string().trim().min(1, "Kode wajib diisi").max(50),
  name: z.string().trim().min(3, "Nama item wajib diisi").max(300),
  unit: z.string().trim().max(30).optional(),
  volume: z.coerce.number().positive("Volume harus lebih dari 0"),
  unitPrice: z.coerce.number().min(0, "Harga satuan tidak valid"),
});

export async function addItemAction(_prev: AdendumActionState, formData: FormData): Promise<AdendumActionState> {
  try {
    const d = addItemSchema.parse({
      slug: formData.get("slug"),
      revisionId: formData.get("revisionId"),
      parentId: formData.get("parentId"),
      code: formData.get("code"),
      name: formData.get("name"),
      unit: formData.get("unit") ?? "",
      volume: formData.get("volume"),
      unitPrice: formData.get("unitPrice"),
    });
    const { user } = await requireCtx(d.slug);
    await addDraftItem(
      d.revisionId,
      d.parentId,
      { code: d.code, name: d.name, unit: d.unit || null, volume: d.volume, unitPrice: d.unitPrice },
      user.id,
    );
    revalidate(d.slug);
    return { success: `Item "${d.name}" ditambahkan.` };
  } catch (err) {
    if (err instanceof z.ZodError) return { error: err.issues[0].message };
    return errState(err);
  }
}

const addKategoriSchema = z.object({
  slug: slugSchema,
  revisionId: z.uuid(),
  code: z.string().trim().min(1, "Kode wajib diisi").max(50),
  name: z.string().trim().min(3, "Nama kategori wajib diisi").max(300),
});

export async function addKategoriAction(_prev: AdendumActionState, formData: FormData): Promise<AdendumActionState> {
  try {
    const d = addKategoriSchema.parse({
      slug: formData.get("slug"),
      revisionId: formData.get("revisionId"),
      code: formData.get("code"),
      name: formData.get("name"),
    });
    const { user } = await requireCtx(d.slug);
    await addDraftKategori(d.revisionId, { code: d.code, name: d.name }, user.id);
    revalidate(d.slug);
    return { success: `Kategori "${d.name}" ditambahkan — isi item pekerjaannya.` };
  } catch (err) {
    if (err instanceof z.ZodError) return { error: err.issues[0].message };
    return errState(err);
  }
}

const removeSchema = z.object({ slug: slugSchema, revisionId: z.uuid(), nodeId: z.uuid() });

export async function removeNodeAction(_prev: AdendumActionState, formData: FormData): Promise<AdendumActionState> {
  try {
    const d = removeSchema.parse({
      slug: formData.get("slug"),
      revisionId: formData.get("revisionId"),
      nodeId: formData.get("nodeId"),
    });
    const { user } = await requireCtx(d.slug);
    const res = await removeDraftNode(d.revisionId, d.nodeId, user.id);
    revalidate(d.slug);
    return { success: `Dihapus (${res.removedItems} item).` };
  } catch (err) {
    return errState(err);
  }
}
