"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess, ForbiddenError, type SessionUser } from "@/lib/auth/session";
import { cariDuplikat } from "@/lib/kendala/duplikat";

/**
 * Server actions kendala (Issue) + aksi pemulihan (RecoveryAction/Update).
 * Semua mutasi: capability issue.manage + scope lokasi + zod + audit +
 * revalidatePath. Dipakai dari halaman /lokasi/[slug]/progress.
 */

/**
 * `duplikat` bukan kegagalan: ia TAWARAN. Isian yang sudah diketik ikut
 * dikembalikan lewat `nilai` supaya orang tidak perlu mengetik ulang – kalau
 * harus mengetik ulang, tawaran ini akan dibaca sebagai penolakan dan orang
 * akan mengakalinya dengan mengubah judul sedikit. DECISIONS 392.
 */
export type KandidatDuplikatUI = { id: string; title: string; createdAt: string; skor: number };
export type IssueActionState =
  | {
      error?: string;
      success?: string;
      duplikat?: KandidatDuplikatUI[];
      nilai?: { title: string; description: string; severity: string };
    }
  | undefined;

const SEVERITIES = ["rendah", "sedang", "tinggi", "kritis"] as const;
const ISSUE_STATUSES = ["terbuka", "ditangani", "selesai"] as const;
const RECOVERY_STATUSES = ["direncanakan", "berjalan", "selesai", "batal"] as const;

async function guard(locationId: string): Promise<{ user: SessionUser; slug: string }> {
  const user = await requireCapability("issue.manage");
  await requireLocationAccess(user, locationId);
  const loc = await db.location.findUniqueOrThrow({
    where: { id: locationId },
    select: { slug: true },
  });
  return { user, slug: loc.slug };
}

function revalidateLocation(slug: string): void {
  revalidatePath(`/lokasi/${slug}/progress`);
  revalidatePath(`/lokasi/${slug}`);
  // Papan terpusat membaca kendala yang sama — kalau tidak ikut disegarkan,
  // ia menampilkan keadaan lama dan orang menyimpulkan aksinya gagal.
  revalidatePath("/kendala");
}

function fail(err: unknown): IssueActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const createIssueSchema = z.object({
  locationId: z.uuid(),
  title: z.string().trim().min(3, "Judul kendala minimal 3 karakter").max(200),
  description: z.string().trim().max(2000).optional(),
  severity: z.enum(SEVERITIES),
  /** Dikirim hanya oleh tombol "Tetap buat baru" sesudah tawaran duplikat. */
  paksa: z.coerce.boolean().optional(),
});

export async function createIssue(_prev: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const parsed = createIssueSchema.safeParse({
    locationId: formData.get("locationId"),
    title: formData.get("title"),
    description: String(formData.get("description") ?? "").trim() || undefined,
    severity: formData.get("severity"),
    paksa: String(formData.get("paksa") ?? "") === "1" || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const { user, slug } = await guard(d.locationId);

    if (!d.paksa) {
      const terbuka = await db.issue.findMany({
        where: { locationId: d.locationId, status: { in: ["terbuka", "ditangani"] } },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const mirip = cariDuplikat(d.title, terbuka);
      if (mirip.length) {
        return {
          duplikat: mirip.map((m) => ({
            id: m.id,
            title: m.title,
            createdAt: m.createdAt.toISOString(),
            skor: m.skor,
          })),
          nilai: { title: d.title, description: d.description ?? "", severity: d.severity },
        };
      }
    }

    const issue = await db.issue.create({
      data: {
        locationId: d.locationId,
        title: d.title,
        description: d.description ?? null,
        severity: d.severity,
        raisedById: user.id,
        source: "manual",
      },
    });
    await audit(user.id, "issue.create", "issue", issue.id, {
      locationId: d.locationId,
      severity: d.severity,
      ...(d.paksa ? { duplikatDiabaikan: true } : {}),
    });
    revalidateLocation(slug);
    return { success: "Kendala dicatat." };
  } catch (err) {
    return fail(err);
  }
}

const updateIssueStatusSchema = z.object({
  issueId: z.uuid(),
  status: z.enum(ISSUE_STATUSES),
});

export async function updateIssueStatus(_prev: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const parsed = updateIssueStatusSchema.safeParse({
    issueId: formData.get("issueId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const issue = await db.issue.findUniqueOrThrow({
      where: { id: parsed.data.issueId },
      select: { id: true, locationId: true, status: true },
    });
    const { user, slug } = await guard(issue.locationId);
    await db.issue.update({
      where: { id: issue.id },
      data: {
        status: parsed.data.status,
        /*
         * `closedAt` diisi/ dikosongkan mengikuti status, bukan dibiarkan
         * melayang. Papan terpusat memakai kolom ini untuk "selesai 30 hari
         * terakhir"; kalau ia tidak pernah terisi, kendala yang baru ditutup
         * langsung hilang dari layar seolah tidak pernah ada.
         */
        closedAt: parsed.data.status === "selesai" ? new Date() : null,
      },
    });
    await audit(user.id, "issue.update_status", "issue", issue.id, {
      from: issue.status,
      to: parsed.data.status,
    });
    revalidateLocation(slug);
    return { success: `Status kendala → ${parsed.data.status}.` };
  } catch (err) {
    return fail(err);
  }
}

const addRecoveryActionSchema = z.object({
  issueId: z.uuid(),
  description: z.string().trim().min(3, "Uraian aksi minimal 3 karakter").max(2000),
  picName: z.string().trim().max(120).optional(),
  dueDate: z.iso.date("Tanggal target tidak valid").optional(),
});

export async function addRecoveryAction(_prev: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const parsed = addRecoveryActionSchema.safeParse({
    issueId: formData.get("issueId"),
    description: formData.get("description"),
    picName: String(formData.get("picName") ?? "").trim() || undefined,
    dueDate: String(formData.get("dueDate") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const issue = await db.issue.findUniqueOrThrow({
      where: { id: d.issueId },
      select: { id: true, locationId: true, status: true },
    });
    const { user, slug } = await guard(issue.locationId);
    const action = await db.recoveryAction.create({
      data: {
        issueId: issue.id,
        description: d.description,
        picName: d.picName ?? null,
        dueDate: d.dueDate ? new Date(`${d.dueDate}T00:00:00.000Z`) : null,
        createdById: user.id,
      },
    });
    // Kendala yang sudah punya aksi pemulihan otomatis "ditangani".
    if (issue.status === "terbuka") {
      await db.issue.update({ where: { id: issue.id }, data: { status: "ditangani" } });
    }
    await audit(user.id, "issue.add_recovery_action", "recovery_action", action.id, {
      issueId: issue.id,
    });
    revalidateLocation(slug);
    return { success: "Aksi pemulihan ditambahkan." };
  } catch (err) {
    return fail(err);
  }
}

const updateRecoveryStatusSchema = z.object({
  actionId: z.uuid(),
  status: z.enum(RECOVERY_STATUSES),
});

export async function updateRecoveryStatus(_prev: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const parsed = updateRecoveryStatusSchema.safeParse({
    actionId: formData.get("actionId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const action = await db.recoveryAction.findUniqueOrThrow({
      where: { id: parsed.data.actionId },
      select: { id: true, status: true, issue: { select: { id: true, locationId: true } } },
    });
    const { user, slug } = await guard(action.issue.locationId);
    await db.recoveryAction.update({
      where: { id: action.id },
      data: { status: parsed.data.status },
    });
    await audit(user.id, "issue.update_recovery_status", "recovery_action", action.id, {
      issueId: action.issue.id,
      from: action.status,
      to: parsed.data.status,
    });
    revalidateLocation(slug);
    return { success: `Status aksi → ${parsed.data.status}.` };
  } catch (err) {
    return fail(err);
  }
}

const addRecoveryUpdateSchema = z.object({
  actionId: z.uuid(),
  note: z.string().trim().min(2, "Catatan perkembangan wajib diisi").max(2000),
});

export async function addRecoveryUpdate(_prev: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const parsed = addRecoveryUpdateSchema.safeParse({
    actionId: formData.get("actionId"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const action = await db.recoveryAction.findUniqueOrThrow({
      where: { id: parsed.data.actionId },
      select: { id: true, issue: { select: { id: true, locationId: true } } },
    });
    const { user, slug } = await guard(action.issue.locationId);
    const update = await db.recoveryUpdate.create({
      data: { actionId: action.id, note: parsed.data.note, createdById: user.id },
    });
    await audit(user.id, "issue.add_recovery_update", "recovery_update", update.id, {
      actionId: action.id,
      issueId: action.issue.id,
    });
    revalidateLocation(slug);
    return { success: "Perkembangan dicatat." };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------------ */
/* Pemilik & tenggat kendala (DECISIONS 392)                           */
/* ------------------------------------------------------------------ */

const setPemilikSchema = z.object({
  issueId: z.uuid(),
  /** Pengguna MARLIN — bisa dikirimi pengingat. */
  picUserId: z.uuid().optional(),
  /** PIC di luar MARLIN (PLN, pemilik lahan, dinas). */
  picName: z.string().trim().max(120).optional(),
  dueDate: z.iso.date("Tanggal target tidak valid").optional(),
});

/**
 * Tetapkan PEMILIK dan TENGGAT kendala.
 *
 * Inti perbaikan DECISIONS 392: sebelum ini PIC hanya ada di aksi pemulihan,
 * jadi kendala baru bermilik setelah seseorang sempat merencanakan pemulihan.
 * Padahal justru kendala yang belum disentuh yang paling perlu ditagih.
 *
 * Dua bentuk PIC (keputusan user 2026-08-20): pengguna MARLIN yang bisa
 * dikirimi pengingat, ATAU nama bebas untuk pihak ketiga. Yang kedua tetap
 * pemilik yang sah — kenyataan lapangan memang begitu — dan layarnya
 * mengatakan bahwa ia tidak akan menerima pengingat.
 */
export async function setPemilikKendala(
  _prev: IssueActionState,
  formData: FormData,
): Promise<IssueActionState> {
  const parsed = setPemilikSchema.safeParse({
    issueId: formData.get("issueId"),
    picUserId: String(formData.get("picUserId") ?? "").trim() || undefined,
    picName: String(formData.get("picName") ?? "").trim() || undefined,
    dueDate: String(formData.get("dueDate") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const issue = await db.issue.findUniqueOrThrow({
      where: { id: d.issueId },
      select: { id: true, locationId: true },
    });
    const { user, slug } = await guard(issue.locationId);

    /*
     * Kedua bentuk PIC tidak boleh terisi bersamaan.
     *
     * Kalau boleh, "siapa yang ditagih" punya dua jawaban dan pengingat harus
     * menebak salah satunya — persis jenis keputusan yang tidak boleh diambil
     * diam-diam oleh mesin.
     */
    if (d.picUserId && d.picName) {
      return { error: "Pilih SATU: pengguna MARLIN atau nama PIC luar – bukan keduanya." };
    }
    await db.issue.update({
      where: { id: issue.id },
      data: {
        picUserId: d.picUserId ?? null,
        picName: d.picName ?? null,
        dueDate: d.dueDate ? new Date(`${d.dueDate}T00:00:00.000Z`) : null,
      },
    });
    await audit(user.id, "issue.set_pemilik", "issue", issue.id, {
      picUserId: d.picUserId ?? null,
      picName: d.picName ?? null,
      dueDate: d.dueDate ?? null,
    });
    revalidateLocation(slug);
    return { success: "Pemilik & tenggat kendala disimpan." };
  } catch (err) {
    return fail(err);
  }
}

const tutupSchema = z.object({
  issueId: z.uuid(),
  closingNote: z.string().trim().max(2000).optional(),
});

/**
 * Tutup kendala dengan catatan penutup.
 *
 * Catatannya OPSIONAL tapi diminta: menuntutnya membuat orang enggan menutup
 * kendala, dan kendala yang tidak pernah ditutup merusak papan lebih parah
 * daripada kendala yang ditutup tanpa keterangan. Yang tidak boleh adalah
 * tidak pernah menawarkannya sama sekali — riwayat tanpa catatan penutup tidak
 * bisa dipakai belajar maupun dipertanggungjawabkan ke PPK.
 */
export async function tutupKendala(
  _prev: IssueActionState,
  formData: FormData,
): Promise<IssueActionState> {
  const parsed = tutupSchema.safeParse({
    issueId: formData.get("issueId"),
    closingNote: String(formData.get("closingNote") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const issue = await db.issue.findUniqueOrThrow({
      where: { id: parsed.data.issueId },
      select: { id: true, locationId: true, status: true },
    });
    const { user, slug } = await guard(issue.locationId);
    await db.issue.update({
      where: { id: issue.id },
      data: {
        status: "selesai",
        closedAt: new Date(),
        closingNote: parsed.data.closingNote ?? null,
      },
    });
    await audit(user.id, "issue.tutup", "issue", issue.id, {
      from: issue.status,
      adaCatatan: !!parsed.data.closingNote,
    });
    revalidateLocation(slug);
    return { success: "Kendala ditutup." };
  } catch (err) {
    return fail(err);
  }
}
