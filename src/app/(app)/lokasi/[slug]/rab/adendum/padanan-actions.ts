"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCapability, requireLocationAccess, ForbiddenError } from "@/lib/auth/session";
import { lepasPadananDraft, pasangkanItemDraft, PadananDraftError } from "@/lib/rab/padanan-draft";

/**
 * Aksi PEMETAAN item terlapor ke item draft adendum (DECISIONS 754). Aturan
 * dan penulisannya di `lib/rab/padanan-draft`; di sini otorisasi, parsing,
 * dan revalidate. Audit ditulis layanannya, di dalam transaksi yang sama.
 */

export type PadananActionState = { error?: string; success?: string } | undefined;

function gagal(err: unknown): PadananActionState {
  if (err instanceof PadananDraftError || err instanceof ForbiddenError) return { error: err.message };
  console.error("[padanan-draft] aksi gagal:", err);
  return { error: "Terjadi kesalahan tak terduga. Coba lagi." };
}

async function konteks(slug: string) {
  const user = await requireCapability("rab.manage");
  const location = await db.location.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!location) throw new PadananDraftError("Lokasi tidak ditemukan.");
  await requireLocationAccess(user, location.id);
  return { user, location };
}

function segarkan(slug: string) {
  revalidatePath(`/lokasi/${slug}/rab/adendum`);
  revalidatePath(`/lokasi/${slug}/rab`);
}

const skemaPasang = z.object({
  slug: z.string().trim().min(1),
  revisionId: z.uuid(),
  lineageLama: z.string().trim().min(1, "Item kontrak tidak valid."),
  nodeIdDraft: z.uuid("Pilih dulu item draft pasangannya."),
});

export async function pasangkanItemDraftAction(_prev: PadananActionState, formData: FormData): Promise<PadananActionState> {
  const p = skemaPasang.safeParse({
    slug: formData.get("slug"),
    revisionId: formData.get("revisionId"),
    lineageLama: formData.get("lineageLama"),
    nodeIdDraft: formData.get("nodeIdDraft"),
  });
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    const { user, location } = await konteks(p.data.slug);
    const h = await pasangkanItemDraft({
      locationId: location.id,
      revisionId: p.data.revisionId,
      lineageLama: p.data.lineageLama,
      nodeIdDraft: p.data.nodeIdDraft,
      userId: user.id,
    });
    segarkan(location.slug);
    return {
      success:
        "Dipasangkan. Laporan harian dan fotonya ikut item draft ini, tanpa ada laporan yang diubah." +
        (h.barisDraftDipindah > 0 ? ` ${h.barisDraftDipindah} baris yang dilaporkan terhadap draft ikut.` : "") +
        " Persetujuan yang sudah diberikan untuk draft ini perlu diberikan ulang.",
    };
  } catch (e) {
    return gagal(e);
  }
}

const skemaLepas = z.object({
  slug: z.string().trim().min(1),
  revisionId: z.uuid(),
  nodeIdDraft: z.uuid(),
});

export async function lepasPadananDraftAction(_prev: PadananActionState, formData: FormData): Promise<PadananActionState> {
  const p = skemaLepas.safeParse({
    slug: formData.get("slug"),
    revisionId: formData.get("revisionId"),
    nodeIdDraft: formData.get("nodeIdDraft"),
  });
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    const { user, location } = await konteks(p.data.slug);
    await lepasPadananDraft({
      locationId: location.id,
      revisionId: p.data.revisionId,
      nodeIdDraft: p.data.nodeIdDraft,
      userId: user.id,
    });
    segarkan(location.slug);
    return { success: "Pasangan dilepas. Item kontrak itu kembali ke daftar yang belum dipasangkan." };
  } catch (e) {
    return gagal(e);
  }
}
