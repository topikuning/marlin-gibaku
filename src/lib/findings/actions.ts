"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requireCapability, requireLocationAccess, type SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  addFollowUp,
  askClarification,
  createFinding,
  FindingError,
  findingLocationId,
  linkEvidence,
  rejectVerification,
  reopenFinding,
  respondClarification,
  submitForVerification,
  verifyClose,
  verifyEvidence,
} from "./service";

/**
 * Server actions TEMUAN — otorisasi hidup DI SINI (capability + lokasi),
 * logika di `service.ts`. Pola berkas: `src/lib/issues.ts`.
 */

export type FindingActionState = { error?: string; success?: string } | undefined;

const SEVERITIES = ["rendah", "sedang", "tinggi", "kritis"] as const;
const CATEGORIES = ["mutu", "volume", "k3", "administrasi", "jadwal", "lingkungan", "lainnya"] as const;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function fail(err: unknown): FindingActionState {
  if (err instanceof ForbiddenError || err instanceof FindingError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

async function guardTemuan(capability: "finding.create" | "finding.respond" | "finding.verify", locationId: string): Promise<SessionUser> {
  const user = await requireCapability(capability);
  await requireLocationAccess(user, locationId);
  return user;
}

function revalidateTemuan(findingId?: string): void {
  revalidatePath("/temuan");
  if (findingId) revalidatePath(`/temuan/${findingId}`);
  revalidatePath("/verifikasi");
  revalidatePath("/perlu-tindakan");
}

const createSchema = z.object({
  locationId: z.uuid(),
  title: z.string().trim().min(3, "Judul temuan minimal 3 karakter").max(200),
  description: z.string().trim().max(4000).optional(),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  findingDateKey: z.string().regex(DATE_KEY, "Tanggal temuan tidak sah"),
  dueDateKey: z.string().regex(DATE_KEY).optional(),
  assignedToId: z.uuid().optional(),
  assignedName: z.string().trim().max(120).optional(),
  reportId: z.uuid().optional(),
  inspectionId: z.uuid().optional(),
  lineageKey: z.string().trim().max(200).optional(),
  workItemName: z.string().trim().max(300).optional(),
});

export async function createFindingAction(_prev: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const parsed = createSchema.safeParse({
    locationId: formData.get("locationId"),
    title: formData.get("title"),
    description: String(formData.get("description") ?? "").trim() || undefined,
    category: formData.get("category"),
    severity: formData.get("severity"),
    findingDateKey: formData.get("findingDateKey"),
    dueDateKey: String(formData.get("dueDateKey") ?? "").trim() || undefined,
    assignedToId: String(formData.get("assignedToId") ?? "").trim() || undefined,
    assignedName: String(formData.get("assignedName") ?? "").trim() || undefined,
    reportId: String(formData.get("reportId") ?? "").trim() || undefined,
    inspectionId: String(formData.get("inspectionId") ?? "").trim() || undefined,
    lineageKey: String(formData.get("lineageKey") ?? "").trim() || undefined,
    workItemName: String(formData.get("workItemName") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const user = await guardTemuan("finding.create", d.locationId);
    // Asal temuan diturunkan dari tautannya, bukan diketik klien.
    const source = d.inspectionId ? "inspeksi" : d.reportId ? "laporan_harian" : "manual";
    if (d.inspectionId) {
      const insp = await db.inspection.findUnique({ where: { id: d.inspectionId }, select: { locationId: true } });
      if (!insp || insp.locationId !== d.locationId) return { error: "Inspeksi itu bukan milik lokasi ini." };
    }
    if (d.reportId) {
      const rep = await db.dailyReport.findUnique({ where: { id: d.reportId }, select: { locationId: true } });
      if (!rep || rep.locationId !== d.locationId) return { error: "Laporan itu bukan milik lokasi ini." };
    }
    await createFinding({ ...d, source }, user.id);
    revalidateTemuan();
    return { success: "Temuan dicatat." };
  } catch (err) {
    return fail(err);
  }
}

const clarifySchema = z.object({
  findingId: z.uuid(),
  question: z.string().trim().min(5, "Pertanyaan klarifikasi minimal 5 karakter").max(2000),
  dueDateKey: z.string().regex(DATE_KEY).optional(),
});

export async function askClarificationAction(_prev: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const parsed = clarifySchema.safeParse({
    findingId: formData.get("findingId"),
    question: formData.get("question"),
    dueDateKey: String(formData.get("dueDateKey") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await guardTemuan("finding.verify", await findingLocationId(parsed.data.findingId));
    await askClarification(parsed.data.findingId, parsed.data.question, parsed.data.dueDateKey ?? null, user.id);
    revalidateTemuan(parsed.data.findingId);
    return { success: "Permintaan klarifikasi dikirim." };
  } catch (err) {
    return fail(err);
  }
}

const respondClarSchema = z.object({
  clarificationId: z.uuid(),
  response: z.string().trim().min(3, "Jawaban minimal 3 karakter").max(4000),
});

export async function respondClarificationAction(_prev: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const parsed = respondClarSchema.safeParse({
    clarificationId: formData.get("clarificationId"),
    response: formData.get("response"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const clar = await db.findingClarification.findUnique({
      where: { id: parsed.data.clarificationId },
      select: { findingId: true, finding: { select: { locationId: true } } },
    });
    if (!clar) return { error: "Klarifikasi tidak ditemukan." };
    const user = await guardTemuan("finding.respond", clar.finding.locationId);
    await respondClarification(parsed.data.clarificationId, parsed.data.response, user.id);
    revalidateTemuan(clar.findingId);
    return { success: "Jawaban klarifikasi tersimpan." };
  } catch (err) {
    return fail(err);
  }
}

const noteSchema = z.object({
  findingId: z.uuid(),
  note: z.string().trim().min(3, "Catatan tindak lanjut minimal 3 karakter").max(4000),
});

export async function addFollowUpAction(_prev: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const parsed = noteSchema.safeParse({ findingId: formData.get("findingId"), note: formData.get("note") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await guardTemuan("finding.respond", await findingLocationId(parsed.data.findingId));
    await addFollowUp(parsed.data.findingId, parsed.data.note, user.id);
    revalidateTemuan(parsed.data.findingId);
    return { success: "Tindak lanjut dicatat." };
  } catch (err) {
    return fail(err);
  }
}

const submitSchema = z.object({
  findingId: z.uuid(),
  note: z.string().trim().max(2000).optional(),
});

export async function submitForVerificationAction(_prev: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const parsed = submitSchema.safeParse({
    findingId: formData.get("findingId"),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await guardTemuan("finding.respond", await findingLocationId(parsed.data.findingId));
    await submitForVerification(parsed.data.findingId, parsed.data.note ?? null, user.id);
    revalidateTemuan(parsed.data.findingId);
    return { success: "Diajukan untuk verifikasi." };
  } catch (err) {
    return fail(err);
  }
}

const closeSchema = z.object({
  findingId: z.uuid(),
  note: z.string().trim().min(5, "Catatan penutup minimal 5 karakter").max(2000),
});

export async function verifyCloseAction(_prev: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const parsed = closeSchema.safeParse({ findingId: formData.get("findingId"), note: formData.get("note") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await guardTemuan("finding.verify", await findingLocationId(parsed.data.findingId));
    await verifyClose(parsed.data.findingId, parsed.data.note, user.id);
    revalidateTemuan(parsed.data.findingId);
    return { success: "Temuan ditutup." };
  } catch (err) {
    return fail(err);
  }
}

const reasonSchema = z.object({
  findingId: z.uuid(),
  reason: z.string().trim().min(5, "Alasan minimal 5 karakter").max(2000),
});

export async function rejectVerificationAction(_prev: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const parsed = reasonSchema.safeParse({ findingId: formData.get("findingId"), reason: formData.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await guardTemuan("finding.verify", await findingLocationId(parsed.data.findingId));
    await rejectVerification(parsed.data.findingId, parsed.data.reason, user.id);
    revalidateTemuan(parsed.data.findingId);
    return { success: "Pengajuan ditolak – dikembalikan untuk ditindaklanjuti." };
  } catch (err) {
    return fail(err);
  }
}

export async function reopenFindingAction(_prev: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const parsed = reasonSchema.safeParse({ findingId: formData.get("findingId"), reason: formData.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await guardTemuan("finding.verify", await findingLocationId(parsed.data.findingId));
    await reopenFinding(parsed.data.findingId, parsed.data.reason, user.id);
    revalidateTemuan(parsed.data.findingId);
    return { success: "Temuan dibuka kembali." };
  } catch (err) {
    return fail(err);
  }
}

/* ── Bukti ───────────────────────────────────────────────────────────────── */

const linkSchema = z
  .object({
    findingId: z.uuid().optional(),
    inspectionId: z.uuid().optional(),
    clarificationId: z.uuid().optional(),
    photoId: z.uuid().optional(),
    documentId: z.uuid().optional(),
    caption: z.string().trim().max(300).optional(),
  })
  .refine((d) => [d.photoId, d.documentId].filter(Boolean).length === 1, {
    message: "Pilih tepat satu bukti: foto ATAU dokumen.",
  })
  .refine((d) => d.findingId || d.inspectionId || d.clarificationId, {
    message: "Bukti harus menempel ke temuan, inspeksi, atau klarifikasi.",
  });

export async function linkEvidenceAction(_prev: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const parsed = linkSchema.safeParse({
    findingId: String(formData.get("findingId") ?? "").trim() || undefined,
    inspectionId: String(formData.get("inspectionId") ?? "").trim() || undefined,
    clarificationId: String(formData.get("clarificationId") ?? "").trim() || undefined,
    photoId: String(formData.get("photoId") ?? "").trim() || undefined,
    documentId: String(formData.get("documentId") ?? "").trim() || undefined,
    caption: String(formData.get("caption") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    // Menautkan bukti = bagian tindak lanjut ATAU pemeriksaan; dua-duanya sah.
    // Guard: cukup salah satu capability + akses lokasi induk.
    let locationId: string;
    if (d.findingId) locationId = await findingLocationId(d.findingId);
    else if (d.inspectionId) {
      const i = await db.inspection.findUnique({ where: { id: d.inspectionId }, select: { locationId: true } });
      if (!i) return { error: "Inspeksi tidak ditemukan." };
      locationId = i.locationId;
    } else {
      const c = await db.findingClarification.findUnique({
        where: { id: d.clarificationId! },
        select: { finding: { select: { locationId: true } } },
      });
      if (!c) return { error: "Klarifikasi tidak ditemukan." };
      locationId = c.finding.locationId;
    }
    let user: SessionUser;
    try {
      user = await guardTemuan("finding.respond", locationId);
    } catch {
      user = await guardTemuan("finding.verify", locationId);
    }
    await linkEvidence(d, user.id);
    revalidateTemuan(d.findingId);
    return { success: "Bukti ditautkan." };
  } catch (err) {
    return fail(err);
  }
}

const verifyEvidenceSchema = z.object({
  linkId: z.uuid(),
  status: z.enum(["diterima", "ditolak"]),
  note: z.string().trim().max(1000).optional(),
});

export async function verifyEvidenceAction(_prev: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const parsed = verifyEvidenceSchema.safeParse({
    linkId: formData.get("linkId"),
    status: formData.get("status"),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const link = await db.evidenceLink.findUnique({
      where: { id: parsed.data.linkId },
      select: {
        findingId: true,
        finding: { select: { locationId: true } },
        inspection: { select: { locationId: true } },
        clarification: { select: { finding: { select: { locationId: true } } } },
      },
    });
    if (!link) return { error: "Tautan bukti tidak ditemukan." };
    const locationId =
      link.finding?.locationId ?? link.inspection?.locationId ?? link.clarification?.finding.locationId;
    if (!locationId) return { error: "Tautan bukti tidak punya induk." };
    const user = await guardTemuan("finding.verify", locationId);
    await verifyEvidence(parsed.data.linkId, parsed.data.status, parsed.data.note ?? null, user.id);
    revalidateTemuan(link.findingId ?? undefined);
    return { success: parsed.data.status === "diterima" ? "Bukti diterima." : "Bukti ditolak." };
  } catch (err) {
    return fail(err);
  }
}
