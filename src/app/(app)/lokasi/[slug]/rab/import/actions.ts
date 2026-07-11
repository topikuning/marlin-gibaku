"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { getActiveRevisionId } from "@/lib/rab";
import { r2Put, r2GetBuffer, isR2Configured } from "@/lib/r2";
import { parseHpsBuffer } from "@/lib/hps-parser";
import { createRevisionFromParsed } from "@/lib/rab-import";

const XLSX_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

export type PreviewState = {
  error?: string;
  preview?: {
    r2Key: string;
    fileName: string;
    mimeType: string;
    bytes: number;
    grandTotal: number;
    isAdendum: boolean;
    warnings: string[];
    categories: { roman: string; name: string; total: number }[];
  };
};

function safeName(n: string): string {
  return n.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export async function previewImport(
  _prev: PreviewState | undefined,
  formData: FormData
): Promise<PreviewState> {
  const session = await auth();
  if (!session?.user || !canManageUsers(session.user.role))
    return { error: "Tidak berwenang." };
  const locationId = String(formData.get("locationId") ?? "");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "File HPS wajib dipilih." };
  if (!XLSX_MIME.includes(file.type) && !/\.xlsx?$/i.test(file.name))
    return { error: "File harus Excel (.xlsx)." };
  if (!isR2Configured()) return { error: "Penyimpanan (R2) belum dikonfigurasi." };

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseHpsBuffer(buffer);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gagal membaca file HPS." };
  }
  if (parsed.categories.length === 0)
    return { error: "Tidak ada kategori RAB terbaca. Cek sheet 'RAB'." };

  const key = `hps-import/${locationId}/${randomUUID()}-${safeName(file.name)}`;
  try {
    await r2Put(key, buffer, file.type || XLSX_MIME[0]);
  } catch {
    return { error: "Gagal mengunggah file ke penyimpanan." };
  }

  const isAdendum = (await getActiveRevisionId(locationId)) !== null;
  return {
    preview: {
      r2Key: key,
      fileName: file.name,
      mimeType: file.type || XLSX_MIME[0],
      bytes: file.size,
      grandTotal: parsed.grandTotal,
      isAdendum,
      warnings: parsed.warnings,
      categories: parsed.categories.map((c) => ({
        roman: c.roman,
        name: c.name,
        total: c.totalValue,
      })),
    },
  };
}

export type CommitState = { error?: string; ok?: string };

export async function commitImport(
  _prev: CommitState | undefined,
  formData: FormData
): Promise<CommitState> {
  const session = await auth();
  if (!session?.user || !canManageUsers(session.user.role))
    return { error: "Tidak berwenang." };
  const userId = session.user.id;

  const locationId = String(formData.get("locationId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const r2Key = String(formData.get("r2Key") ?? "");
  const fileName = String(formData.get("fileName") ?? "hps.xlsx");
  const mimeType = String(formData.get("mimeType") ?? XLSX_MIME[0]);
  const bytes = Number(formData.get("bytes") ?? 0);
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!r2Key) return { error: "Sesi import kadaluarsa, ulangi." };

  let buffer: Buffer;
  try {
    buffer = await r2GetBuffer(r2Key);
  } catch {
    return { error: "Gagal mengambil file dari penyimpanan." };
  }
  const parsed = await parseHpsBuffer(buffer);
  if (parsed.categories.length === 0) return { error: "File tidak valid." };

  const isAdendum = (await getActiveRevisionId(locationId)) !== null;
  const source = isAdendum ? "adendum" : "initial_hps";

  // Arsipkan file HPS sebagai dokumen.
  const doc = await db.document.create({
    data: {
      locationId,
      stage: isAdendum ? "adendum" : "kontrak",
      type: isAdendum ? "adendum" : "kontrak",
      title: `HPS/RAB ${isAdendum ? "revisi (adendum)" : "awal"} — ${fileName}`,
      r2Key,
      fileName,
      mimeType,
      bytes: bytes || buffer.length,
      uploadedByUserId: userId,
    },
  });

  try {
    const { revisionNo } = await createRevisionFromParsed(locationId, parsed, {
      source,
      note,
      createdByUserId: userId,
      hpsFileDocId: doc.id,
    });
    revalidatePath(`/lokasi/${slug}/rab`);
    revalidatePath(`/lokasi/${slug}`);
    revalidatePath(`/lokasi/${slug}/rab/import`);
    revalidatePath("/dashboard");
    return { ok: `Revisi RAB #${revisionNo} (${source}) berhasil disimpan.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gagal menyimpan revisi." };
  }
}
