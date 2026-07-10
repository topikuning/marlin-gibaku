"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canApprove, PENDING_STATES } from "@/lib/report";
import { hasLocationAccess } from "@/lib/access";
import { getRabItemLocationId } from "@/lib/rab";

function todayDateOnly(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Validasi umum: user boleh approve, item masih pending, punya akses lokasi. */
async function loadPendingItem(itemId: string) {
  const session = await auth();
  if (!session?.user || !canApprove(session.user.role)) return null;
  const item = await db.dailyReportItem.findUnique({
    where: { id: itemId },
    select: { id: true, rabItemId: true, state: true },
  });
  if (!item || !PENDING_STATES.includes(item.state)) return null;
  const locationId = await getRabItemLocationId(item.rabItemId);
  if (!locationId) return null;
  if (!(await hasLocationAccess(session.user.id, session.user.role, locationId))) {
    return null;
  }
  return { userId: session.user.id, item, locationId };
}

export async function approveItem(itemId: string) {
  const ctx = await loadPendingItem(itemId);
  if (!ctx) return;
  const { userId, locationId } = ctx;
  const reportDate = todayDateOnly();

  // Find-or-create laporan harian (lokasi + tanggal + SM penyetuju).
  let report = await db.dailyReport.findFirst({
    where: { locationId, submittedByUserId: userId, reportDate },
    select: { id: true },
  });
  if (!report) {
    const signatureHash = createHash("sha256")
      .update(`${locationId}|${reportDate.toISOString()}|${userId}`)
      .digest("hex");
    report = await db.dailyReport.create({
      data: { locationId, submittedByUserId: userId, reportDate, signatureHash },
      select: { id: true },
    });
  }

  await db.dailyReportItem.update({
    where: { id: itemId },
    data: {
      dailyReportId: report.id,
      state: "sent",
      approvedByUserId: userId,
      approvedAt: new Date(),
    },
  });
  revalidatePath("/laporan");
}

export async function rejectItem(itemId: string, formData: FormData) {
  const ctx = await loadPendingItem(itemId);
  if (!ctx) return;
  const reason = String(formData.get("reason") ?? "").trim();
  await db.dailyReportItem.update({
    where: { id: itemId },
    data: {
      state: "rejected",
      rejectedReason: reason || "Ditolak tanpa alasan",
      approvedByUserId: ctx.userId,
      approvedAt: new Date(),
    },
  });
  revalidatePath("/laporan");
}
