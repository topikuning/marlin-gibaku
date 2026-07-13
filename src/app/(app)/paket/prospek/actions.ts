"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageProspek, slugify, deriveStageFromDocs } from "@/lib/prospek";
import { uploadDocumentSchema, isTypeValidForStage, validateFile } from "@/lib/schemas/document";
import { r2Put, isR2Configured } from "@/lib/r2";
import type { DocumentStage, DocumentType, ProspekStage } from "@prisma/client";

const ORG = "00000000-0000-0000-0000-000000000001";
type Result = { ok?: string; error?: string };

function parseRupiahV(s: unknown): bigint {
  const d = String(s ?? "").replace(/[^0-9]/g, "");
  return d ? BigInt(d) : 0n;
}
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/** Ubah data prospek (nama paket dll) — hanya sebelum jadi kontrak. */
export async function updateProspek(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const session = await auth();
  if (!session?.user || !canManageProspek(session.user.role)) return { error: "Tidak berwenang." };
  const id = String(formData.get("id") ?? "");
  const p = await db.prospek.findUnique({ where: { id }, select: { stage: true } });
  if (!p) return { error: "Prospek tidak ditemukan." };
  if (p.stage === "jadi_kontrak") return { error: "Sudah jadi kontrak — tidak bisa diubah." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Nama paket wajib diisi." };
  await db.prospek.update({
    where: { id },
    data: {
      name,
      packageNumber: String(formData.get("packageNumber") ?? "").trim() || null,
      hpsValue: parseRupiahV(formData.get("hpsValue")),
      province: String(formData.get("province") ?? "").trim() || null,
      contractorName: String(formData.get("contractorName") ?? "").trim() || null,
      note: String(formData.get("note") ?? "").trim() || null,
    },
  });
  revalidatePath(`/paket/prospek/${id}`);
  return { ok: "Data prospek diperbarui." };
}

/** Unggah dokumen ke PROSPEK (sejak tahap tender, sebelum kontrak). */
export async function uploadProspekDocument(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const session = await auth();
  if (!session?.user || !canManageProspek(session.user.role)) return { error: "Tidak berwenang." };
  const prospekId = String(formData.get("prospekId") ?? "");
  const prospek = await db.prospek.findUnique({ where: { id: prospekId }, select: { id: true } });
  if (!prospek) return { error: "Prospek tidak ditemukan." };

  const parsed = uploadDocumentSchema.safeParse({
    stage: formData.get("stage"),
    type: formData.get("type"),
    title: formData.get("title"),
    docNumber: formData.get("docNumber") ?? undefined,
    docDate: formData.get("docDate") ?? undefined,
    description: formData.get("description") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  const d = parsed.data;
  if (!isTypeValidForStage(d.stage, d.type)) return { error: "Jenis dokumen tidak sesuai tahapnya." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "File wajib dipilih." };
  const fileErr = validateFile(file.type, file.size);
  if (fileErr) return { error: fileErr };
  if (!isR2Configured()) return { error: "Penyimpanan (R2) belum dikonfigurasi di server." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const key = `documents/prospek/${prospekId}/${d.stage}/${randomUUID()}-${safeName(file.name)}`;
  try {
    await r2Put(key, buffer, file.type);
  } catch {
    return { error: "Gagal mengunggah file ke penyimpanan." };
  }

  await db.document.create({
    data: {
      prospekId,
      stage: d.stage as DocumentStage,
      type: d.type as DocumentType,
      title: d.title,
      docNumber: d.docNumber || null,
      docDate: d.docDate instanceof Date ? d.docDate : null,
      description: d.description || null,
      r2Key: key,
      fileName: file.name,
      mimeType: file.type,
      bytes: file.size,
      sha256,
      uploadedByUserId: session.user.id,
    },
  });

  // Tahap ditentukan OTOMATIS dari dokumen yang ada.
  const allDocs = await db.document.findMany({ where: { prospekId }, select: { type: true } });
  const derived = deriveStageFromDocs(allDocs.map((x) => x.type));
  const prospekData: { stage: typeof derived; hpsValue?: bigint } = { stage: derived };
  // HPS bisa diisi saat aanwijzing/penawaran (dari form upload).
  const hpsRaw = String(formData.get("hpsValue") ?? "").replace(/[^0-9]/g, "");
  if (hpsRaw) prospekData.hpsValue = BigInt(hpsRaw);
  const cur = await db.prospek.findUnique({ where: { id: prospekId }, select: { stage: true } });
  if (cur && cur.stage !== "jadi_kontrak" && cur.stage !== "batal") {
    await db.prospek.update({ where: { id: prospekId }, data: prospekData });
  }

  revalidatePath(`/paket/prospek/${prospekId}`);
  revalidatePath("/paket");
  return { ok: `Dokumen "${d.title}" tersimpan. Tahap diperbarui otomatis.` };
}

/** Batalkan prospek (satu-satunya perubahan tahap manual). */
export async function cancelProspek(prospekId: string): Promise<void> {
  const session = await auth();
  if (!session?.user || !canManageProspek(session.user.role)) return;
  const p = await db.prospek.findUnique({ where: { id: prospekId }, select: { stage: true } });
  if (!p || p.stage === "jadi_kontrak") return;
  await db.prospek.update({ where: { id: prospekId }, data: { stage: "batal" } });
  revalidatePath(`/paket/prospek/${prospekId}`);
  revalidatePath("/paket");
}

const STAGES: ProspekStage[] = [
  "identifikasi",
  "undangan",
  "penawaran",
  "negosiasi",
  "penetapan",
  "jadi_kontrak",
  "batal",
];

/** "Rp 1.234.567" / "1234567" → BigInt. */
function parseRupiah(s: unknown): bigint {
  const digits = String(s ?? "").replace(/[^0-9]/g, "");
  return digits ? BigInt(digits) : 0n;
}

type LokasiInput = { name: string; village: string; regency: string; province: string; gpsLat?: string; gpsLng?: string };

export async function createProspek(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const session = await auth();
  if (!session?.user || !canManageProspek(session.user.role))
    return { error: "Tidak berwenang." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Nama paket wajib diisi." };

  let lokasi: LokasiInput[] = [];
  try {
    const raw = JSON.parse(String(formData.get("lokasi") ?? "[]"));
    if (Array.isArray(raw))
      lokasi = raw
        .filter((x) => x && String(x.name ?? "").trim())
        .map((x) => ({
          name: String(x.name).trim(),
          village: String(x.village ?? "").trim(),
          regency: String(x.regency ?? "").trim(),
          province: String(x.province ?? "").trim(),
          gpsLat: String(x.gpsLat ?? "").trim(),
          gpsLng: String(x.gpsLng ?? "").trim(),
        }));
  } catch {}

  const created = await db.prospek.create({
    data: {
      orgId: ORG,
      name,
      packageNumber: String(formData.get("packageNumber") ?? "").trim() || null,
      hpsValue: parseRupiah(formData.get("hpsValue")),
      province: String(formData.get("province") ?? "").trim() || null,
      contractorName: String(formData.get("contractorName") ?? "").trim() || null,
      note: String(formData.get("note") ?? "").trim() || null,
      createdByUserId: session.user.id,
      lokasi: {
        create: lokasi.map((l) => ({
          name: l.name,
          village: l.village || l.name,
          regency: l.regency,
          province: l.province || String(formData.get("province") ?? "").trim(),
          gpsLat: l.gpsLat ? l.gpsLat : null,
          gpsLng: l.gpsLng ? l.gpsLng : null,
        })),
      },
    },
    select: { id: true },
  });

  revalidatePath("/paket");
  redirect(`/paket/prospek/${created.id}`);
}

export async function updateProspekStage(prospekId: string, stage: string): Promise<void> {
  const session = await auth();
  if (!session?.user || !canManageProspek(session.user.role)) return;
  if (!STAGES.includes(stage as ProspekStage)) return;
  const p = await db.prospek.findUnique({ where: { id: prospekId }, select: { stage: true } });
  if (!p || p.stage === "jadi_kontrak") return; // terkunci setelah jadi kontrak
  await db.prospek.update({ where: { id: prospekId }, data: { stage: stage as ProspekStage } });
  revalidatePath(`/paket/prospek/${prospekId}`);
  revalidatePath("/paket");
}

/** Konversi prospek → Kontrak + Lokasi real. Terminal: prospek jadi_kontrak. */
export async function convertToContract(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const session = await auth();
  if (!session?.user || !canManageProspek(session.user.role))
    return { error: "Tidak berwenang." };

  const prospekId = String(formData.get("prospekId") ?? "");
  const prospek = await db.prospek.findUnique({
    where: { id: prospekId },
    include: { lokasi: true },
  });
  if (!prospek) return { error: "Prospek tidak ditemukan." };
  if (prospek.stage === "jadi_kontrak") return { error: "Prospek ini sudah jadi kontrak." };
  if (prospek.lokasi.length === 0) return { error: "Tambahkan minimal satu lokasi dulu." };

  const contractNumber = String(formData.get("contractNumber") ?? "").trim();
  if (!contractNumber) return { error: "Nomor kontrak wajib diisi." };
  const contractValue = parseRupiah(formData.get("contractValue"));
  if (contractValue <= 0n) return { error: "Nilai kontrak final wajib diisi." };
  const contractorName = String(formData.get("contractorName") ?? prospek.contractorName ?? "").trim();
  if (!contractorName) return { error: "Nama kontraktor wajib diisi." };

  const dstr = (k: string) => String(formData.get(k) ?? "").trim();
  const signed = dstr("signedDate");
  const start = dstr("startDate");
  const end = dstr("endDate");
  if (!signed || !start || !end) return { error: "Tanggal tanda tangan/mulai/selesai wajib diisi." };

  const dup = await db.contract.findUnique({ where: { contractNumber }, select: { id: true } });
  if (dup) return { error: "Nomor kontrak sudah ada." };

  // slug unik untuk tiap lokasi
  const existing = new Set((await db.location.findMany({ select: { slug: true } })).map((l) => l.slug));
  const slugFor = (name: string) => {
    const base = slugify(name);
    let s = base, n = 2;
    while (existing.has(s)) s = `${base}-${n++}`;
    existing.add(s);
    return s;
  };

  await db.$transaction(async (tx) => {
    const contractor = await tx.contractor.upsert({
      where: { orgId_name: { orgId: ORG, name: contractorName } },
      create: { orgId: ORG, name: contractorName },
      update: {},
      select: { id: true },
    });
    const contract = await tx.contract.create({
      data: {
        orgId: ORG,
        contractorId: contractor.id,
        contractNumber,
        contractValue,
        hpsValue: prospek.hpsValue,
        prospekId: prospek.id,
        signedDate: new Date(signed),
        startDate: new Date(start),
        endDate: new Date(end),
      },
      select: { id: true },
    });
    for (const l of prospek.lokasi) {
      const loc = await tx.location.create({
        data: {
          orgId: ORG,
          contractId: contract.id,
          name: l.name,
          slug: slugFor(l.name),
          village: l.village,
          regency: l.regency,
          province: l.province,
          gpsLat: l.gpsLat ?? "0",
          gpsLng: l.gpsLng ?? "0",
          status: "planning",
          procurementStage: "kontrak",
        },
        select: { id: true },
      });
      await tx.prospekLokasi.update({ where: { id: l.id }, data: { createdLocationId: loc.id } });
    }
    await tx.prospek.update({
      where: { id: prospek.id },
      data: { stage: "jadi_kontrak", contractId: contract.id },
    });
    // Dokumen tender (undangan/penawaran/dst) ikut ke kontrak.
    await tx.document.updateMany({
      where: { prospekId: prospek.id },
      data: { contractId: contract.id },
    });
  });

  revalidatePath("/paket");
  revalidatePath("/lokasi");
  return { ok: "Prospek berhasil jadi kontrak. Lokasi sudah dibuat — lanjut import RAB/HPS per lokasi." };
}
