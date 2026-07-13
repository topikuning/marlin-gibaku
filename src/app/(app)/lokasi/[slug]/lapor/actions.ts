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

  // KUNCI ANTI-GANDA: item ini tidak boleh punya laporan yang belum tuntas
  // (menunggu persetujuan / sudah di-approve belum ter-submit). Cegah double input.
  const openDraft = await db.dailyReportItem.findFirst({
    where: { rabItemId, state: { in: ["draft_mandor", "draft_sm", "approved"] } },
    select: { id: true },
  });
  if (openDraft) {
    return {
      error:
        `Item "${item.code}" masih punya laporan yang belum tuntas (menunggu persetujuan/proses). ` +
        `Setujui atau tolak dulu laporan itu sebelum lapor lagi — untuk cegah volume ganda.`,
    };
  }

  // Kumulatif hitung yang sudah komit (sent) + approved (belum ter-submit).
  const prior = await db.dailyReportItem.aggregate({
    where: { rabItemId, state: { in: ["sent", "approved"] } },
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
    // Tag foto (di-cap ke gambar): koordinat & waktu dari klien, label lokasi dari master.
    const latRaw = Number(formData.get("photoLat"));
    const lngRaw = Number(formData.get("photoLng"));
    const takenRaw = String(formData.get("photoTakenAt") ?? "");
    const takenAt = takenRaw && !Number.isNaN(Date.parse(takenRaw)) ? new Date(takenRaw) : null;
    const loc = await db.location.findUnique({
      where: { id: locationId },
      select: { name: true, village: true, regency: true, province: true },
    });
    const locationLabel = loc
      ? [loc.name, loc.regency, loc.province].filter(Boolean).join(", ")
      : null;
    try {
      const { saved, skipped } = await savePhotosForReportItem(
        draftItem.id,
        photoFiles,
        {
          lat: Number.isFinite(latRaw) && latRaw !== 0 ? latRaw : null,
          lng: Number.isFinite(lngRaw) && lngRaw !== 0 ? lngRaw : null,
          takenAt,
          locationLabel,
        }
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
