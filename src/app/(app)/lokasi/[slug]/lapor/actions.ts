"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canReport } from "@/lib/report";
import { hasLocationAccess } from "@/lib/access";
import { getReportableItems } from "@/lib/rab";
import { savePhotosForReportItem } from "@/lib/photos";
import { submitDraftItemSchema } from "@/lib/schemas/report";

type ActionState = { ok?: string; error?: string };

export async function submitDraftItem(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Sesi berakhir." };
  const { id: userId, role } = session.user;
  if (!canReport(role)) return { error: "Role Anda tidak bisa input laporan." };

  const locationId = String(formData.get("locationId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!(await hasLocationAccess(userId, role, locationId))) {
    return { error: "Tidak punya akses ke lokasi ini." };
  }

  const parsed = submitDraftItemSchema.safeParse({
    rabItemId: formData.get("rabItemId"),
    volumeDone: formData.get("volumeDone"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }
  const { rabItemId, volumeDone, notes } = parsed.data;

  const workerRaw = Number(formData.get("workerCount"));
  const workerCount = Number.isFinite(workerRaw) && workerRaw > 0 ? Math.floor(workerRaw) : null;
  const constraintNote = String(formData.get("constraintNote") ?? "").trim() || null;

  // Item harus benar-benar milik lokasi ini (cegah lapor item lokasi lain).
  const reportable = await getReportableItems(locationId);
  const item = reportable.find((i) => i.id === rabItemId);
  if (!item) return { error: "Item tidak valid untuk lokasi ini." };

  const prior = await db.dailyReportItem.aggregate({
    where: { rabItemId, state: "sent" },
    _sum: { volumeDone: true },
  });
  const priorSent = prior._sum.volumeDone?.toNumber() ?? 0;
  const cumulative = priorSent + volumeDone;

  // Blokir kalau kumulatif melampaui volume rencana item (toleransi kecil untuk
  // pembulatan). Realisasi tidak boleh > 100% dari item RAB.
  const planned = item.volume ?? null;
  if (planned != null && cumulative > planned + 1e-6) {
    const remaining = Math.max(0, planned - priorSent);
    return {
      error:
        `Volume melebihi rencana. Item "${item.code}" rencana ${planned} ${item.unit}, ` +
        `sudah dilaporkan ${priorSent} ${item.unit}, sisa ${remaining.toFixed(3).replace(/\.?0+$/, "")} ${item.unit}.`,
    };
  }
  const unitPrice = item.unitPrice?.toNumber() ?? 0;
  const valueDone = BigInt(Math.round(volumeDone * unitPrice));

  const draftItem = await db.dailyReportItem.create({
    data: {
      dailyReportId: null,
      rabItemId,
      volumeDone,
      volumeCumulative: cumulative,
      valueDone,
      state: role === "field_supervisor" ? "draft_mandor" : "draft_sm",
      suggestionSource: "manual",
      suggestedByUserId: userId,
      suggestedAt: new Date(),
      notes: notes || null,
      workerCount,
      constraintNote,
    },
  });

  // Foto bukti (opsional). Kegagalan foto tidak membatalkan draft yang sudah tersimpan.
  const photoFiles = formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);
  let photoNote = "";
  if (photoFiles.length > 0) {
    try {
      const { saved, skipped } = await savePhotosForReportItem(
        draftItem.id,
        photoFiles
      );
      if (saved > 0) photoNote += ` + ${saved} foto`;
      if (skipped > 0) photoNote += ` (${skipped} foto dilewati)`;
    } catch {
      photoNote = " (foto gagal diunggah, draft tetap tersimpan)";
    }
  }

  revalidatePath(`/lokasi/${slug}/lapor`);
  revalidatePath("/laporan");
  return {
    ok: `Laporan ${item.code} (${volumeDone} ${item.unit}) tersimpan sebagai draft${photoNote}.`,
  };
}
