"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { VerifikasiError, verifyReportExternal } from "./service";

export type VerifikasiActionState = { error?: string; success?: string } | undefined;

function fail(err: unknown): VerifikasiActionState {
  if (err instanceof ForbiddenError || err instanceof VerifikasiError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const verifSchema = z.object({
  reportId: z.uuid(),
  status: z.enum(["diverifikasi", "perlu_klarifikasi", "ditolak"]),
  note: z.string().trim().max(2000).optional(),
});

export async function verifyReportExternalAction(
  _prev: VerifikasiActionState,
  formData: FormData,
): Promise<VerifikasiActionState> {
  const parsed = verifSchema.safeParse({
    reportId: formData.get("reportId"),
    status: formData.get("status"),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const user = await requireCapability("report.verify_external");
    const report = await db.dailyReport.findUnique({
      where: { id: d.reportId },
      select: { locationId: true, reportDate: true, location: { select: { slug: true } } },
    });
    if (!report) return { error: "Laporan tidak ditemukan." };
    await requireLocationAccess(user, report.locationId);
    await verifyReportExternal(d.reportId, d.status, d.note ?? null, user.id);
    revalidatePath("/verifikasi");
    revalidatePath(`/lokasi/${report.location.slug}/harian/${report.reportDate.toISOString().slice(0, 10)}`);
    return { success: "Hasil pemeriksaan tercatat." };
  } catch (err) {
    return fail(err);
  }
}
