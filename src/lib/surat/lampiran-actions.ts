"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, accessibleLocationIds, requireCapability } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { arsipkanLampiran } from "@/lib/waha/lampiran-tangkap";
import { jakartaToday } from "@/lib/format";
import { aiCall } from "@/lib/ai/client";
import { promptDefault } from "@/lib/ai/prompt-registry";
import { resolvePrompt } from "@/lib/ai/prompts";

/**
 * Antrean "Lampiran masuk" (DECISIONS 432): berkas yang ditangkap dari grup WA
 * ditetapkan perannya oleh MANUSIA. Mesin hanya mengusulkan — ketetapan user
 * 2026-08-25: *"jangan langsung putuskan tapi sarankan"*.
 *
 * Arsip R2 baru dibuat pada saat konfirmasi, bukan saat penangkapan —
 * ketetapan user: *"disimpan di lokal dulu, baru kemudian saat dokumen itu
 * dikonfirmasi, baru ke R2."*
 */

export type LampiranState = { error?: string; success?: string } | undefined;

function fail(err: unknown): LampiranState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const tetapkanSchema = z.object({
  attachmentId: z.uuid(),
  keputusan: z.enum(["jadi_surat", "jadi_dokumen", "bukan_apa_apa"]),
});

/**
 * Tetapkan peran satu lampiran. Untuk `jadi_surat` / `jadi_dokumen` berkasnya
 * sekalian dinaikkan ke arsip permanen; `bukan_apa_apa` sengaja TIDAK
 * diarsipkan — itulah gunanya menunggu konfirmasi.
 */
export async function tetapkanLampiranAction(
  _prev: LampiranState,
  formData: FormData,
): Promise<LampiranState> {
  try {
    const user = await requireCapability("letter.manage");
    const parsed = tetapkanSchema.safeParse({
      attachmentId: formData.get("attachmentId"),
      keputusan: formData.get("keputusan"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { attachmentId, keputusan } = parsed.data;

    const scope = packageScopeWhere(user, await accessibleLocationIds(user));
    const att = await db.waAttachment.findFirst({
      where: { id: attachmentId, package: scope },
      select: { id: true, packageId: true, fileName: true, status: true },
    });
    if (!att) return { error: "Lampiran tidak ditemukan dalam scope Anda." };

    let catatan = "";
    if (keputusan !== "bukan_apa_apa") {
      const arsip = await arsipkanLampiran(att.id);
      if (!arsip.ok) return { error: arsip.alasan };
      if (arsip.catatan) catatan = ` ${arsip.catatan}`;
    }

    await db.waAttachment.update({
      where: { id: att.id },
      data: { decision: keputusan, decidedById: user.id, decidedAt: new Date() },
    });
    await audit(user.id, "wa.lampiran.tetapkan", "package", att.packageId, {
      attachmentId: att.id,
      fileName: att.fileName,
      keputusan,
    });
    revalidatePath("/lampiran");
    revalidatePath("/surat");
    return {
      success:
        keputusan === "bukan_apa_apa"
          ? "Ditandai bukan bahan kerja – berkas tidak diarsipkan."
          : `Ditetapkan. Berkas diarsipkan.${catatan}`,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Minta AI membaca keterangan berkas dan MENGUSULKAN perihal + jenisnya.
 * Hasilnya hanya mengisi `saranRingkas` — tidak pernah mengubah `decision`.
 */
export async function usulkanIsiLampiranAction(
  _prev: LampiranState,
  formData: FormData,
): Promise<LampiranState> {
  try {
    const user = await requireCapability("letter.manage");
    const parsed = z.object({ attachmentId: z.uuid() }).safeParse({
      attachmentId: formData.get("attachmentId"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const scope = packageScopeWhere(user, await accessibleLocationIds(user));
    const att = await db.waAttachment.findFirst({
      where: { id: parsed.data.attachmentId, package: scope },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        saranAlasan: true,
        message: { select: { body: true, fromName: true } },
        package: { select: { name: true, contract: { select: { workTitle: true } } } },
      },
    });
    if (!att) return { error: "Lampiran tidak ditemukan dalam scope Anda." };

    const r = await aiCall({
      system: (await resolvePrompt("surat.pahami")) || promptDefault("surat.pahami"),
      prompt:
        `Paket: ${att.package?.name ?? "-"}${att.package?.contract?.workTitle ? ` (${att.package.contract.workTitle})` : ""}\n` +
        `Nama berkas: ${att.fileName ?? "(tanpa nama)"}\n` +
        `Jenis berkas: ${att.mimeType ?? "tidak diketahui"}\n` +
        `Pengirim: ${att.message.fromName ?? "anggota grup"}\n` +
        `Teks pengiring di grup: ${att.message.body?.trim() || "(tidak ada)"}\n` +
        `Dugaan sistem: ${att.saranAlasan ?? "-"}`,
      maxTokens: 300,
      timeoutMs: 60_000,
    });
    if (!r.ok) return { error: r.error };

    await db.waAttachment.update({
      where: { id: att.id },
      data: { saranRingkas: r.text.trim().slice(0, 2000) },
    });
    await audit(user.id, "wa.lampiran.usul_ai", "wa_attachment", att.id, { provider: r.provider });
    revalidatePath("/lampiran");
    return { success: "Usulan AI tersimpan – periksa sebelum menetapkan." };
  } catch (err) {
    return fail(err);
  }
}

/* ── Dari lampiran menjadi surat ────────────────────────────────────────── */

const jadiSuratSchema = z.object({
  attachmentId: z.uuid(),
  direction: z.enum(["masuk", "keluar"]),
  party: z.enum(["penyedia", "wakil_ppk", "ppk", "konsultan", "dinas", "internal", "lainnya"]),
  partyName: z.string().trim().max(150).optional(),
  subject: z.string().trim().min(3, "Perihal minimal 3 karakter").max(300),
  letterNumber: z.string().trim().max(120).optional(),
  letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  category: z.enum(["mutu", "jadwal", "pembayaran", "administrasi", "koordinasi", "k3", "lainnya"]),
  needsReply: z.enum(["ya", "tidak"]),
  replyDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

/**
 * Catat lampiran sebagai SURAT di register. Nomor agenda dibuat sistem,
 * berurut per organisasi per tahun.
 */
export async function lampiranJadiSuratAction(
  _prev: LampiranState,
  formData: FormData,
): Promise<LampiranState> {
  try {
    const user = await requireCapability("letter.manage");
    const parsed = jadiSuratSchema.safeParse({
      attachmentId: formData.get("attachmentId"),
      direction: formData.get("direction"),
      party: formData.get("party"),
      partyName: formData.get("partyName") ?? undefined,
      subject: formData.get("subject"),
      letterNumber: formData.get("letterNumber") ?? undefined,
      letterDate: formData.get("letterDate") ?? undefined,
      category: formData.get("category"),
      needsReply: formData.get("needsReply") ?? "tidak",
      replyDueDate: formData.get("replyDueDate") ?? undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const scope = packageScopeWhere(user, await accessibleLocationIds(user));
    const att = await db.waAttachment.findFirst({
      where: { id: d.attachmentId, package: scope },
      select: { id: true, packageId: true, message: { select: { timestamp: true } } },
    });
    if (!att) return { error: "Lampiran tidak ditemukan dalam scope Anda." };

    const arsip = await arsipkanLampiran(att.id);
    if (!arsip.ok) return { error: arsip.alasan };

    const needsReply = d.needsReply === "ya";
    const surat = await buatSurat({
      orgId: user.orgId,
      createdById: user.id,
      packageId: att.packageId,
      direction: d.direction,
      party: d.party,
      partyName: d.partyName || null,
      subject: d.subject,
      letterNumber: d.letterNumber || null,
      letterDate: d.letterDate ? new Date(`${d.letterDate}T00:00:00.000Z`) : null,
      handledDate: att.message.timestamp,
      category: d.category,
      needsReply,
      replyDueDate: needsReply && d.replyDueDate ? new Date(`${d.replyDueDate}T00:00:00.000Z`) : null,
      attachmentId: att.id,
    });

    await db.waAttachment.update({
      where: { id: att.id },
      data: { decision: "jadi_surat", decidedById: user.id, decidedAt: new Date() },
    });
    await audit(user.id, "surat.catat_dari_lampiran", "package", att.packageId, {
      letterId: surat.id,
      agenda: `${surat.agendaNo}/${surat.agendaYear}`,
      direction: d.direction,
    });
    revalidatePath("/lampiran");
    revalidatePath("/surat");
    return {
      success:
        `Tercatat sebagai surat, agenda ${surat.agendaNo}/${surat.agendaYear}.` +
        (arsip.catatan ? ` ${arsip.catatan}` : ""),
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Buat baris surat + nomor agenda. Nomor diambil dalam satu transaksi supaya
 * dua pencatatan berbarengan tidak mendapat nomor yang sama.
 */
export async function buatSurat(input: {
  orgId: string;
  createdById: string;
  packageId: string | null;
  locationId?: string | null;
  direction: "masuk" | "keluar";
  party: "penyedia" | "wakil_ppk" | "ppk" | "konsultan" | "dinas" | "internal" | "lainnya";
  partyName: string | null;
  subject: string;
  summary?: string | null;
  letterNumber: string | null;
  letterDate: Date | null;
  handledDate: Date;
  category: "mutu" | "jadwal" | "pembayaran" | "administrasi" | "koordinasi" | "k3" | "lainnya";
  needsReply: boolean;
  replyDueDate: Date | null;
  attachmentId?: string | null;
  documentId?: string | null;
}): Promise<{ id: string; agendaNo: number; agendaYear: number }> {
  const tahun = jakartaToday().getUTCFullYear();
  return db.$transaction(async (tx) => {
    const terakhir = await tx.letter.aggregate({
      where: { orgId: input.orgId, agendaYear: tahun },
      _max: { agendaNo: true },
    });
    const agendaNo = (terakhir._max.agendaNo ?? 0) + 1;
    const row = await tx.letter.create({
      data: {
        orgId: input.orgId,
        packageId: input.packageId,
        locationId: input.locationId ?? null,
        agendaNo,
        agendaYear: tahun,
        direction: input.direction,
        party: input.party,
        partyName: input.partyName,
        subject: input.subject,
        summary: input.summary ?? null,
        letterNumber: input.letterNumber,
        letterDate: input.letterDate,
        handledDate: input.handledDate,
        category: input.category,
        // Status awal mengikuti kenyataan: surat yang menuntut jawaban langsung
        // berdiri sebagai utang, bukan "baru" yang tidak menagih apa pun.
        status: input.needsReply ? "perlu_jawaban" : "baru",
        needsReply: input.needsReply,
        replyDueDate: input.replyDueDate,
        attachmentId: input.attachmentId ?? null,
        documentId: input.documentId ?? null,
        createdById: input.createdById,
      },
      select: { id: true, agendaNo: true, agendaYear: true },
    });
    return row;
  });
}
