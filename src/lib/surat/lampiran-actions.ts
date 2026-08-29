"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, accessibleLocationIds, requireCapability } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { arsipkanLampiran } from "@/lib/waha/lampiran-tangkap";
import { SuratDuplikatError } from "./duplikat";
/*
 * `buatSurat` sengaja tinggal di modul BIASA, bukan di berkas aksi ini: tiap
 * ekspor modul "use server" adalah endpoint, dan fungsi itu menerima `orgId` +
 * `createdById` sebagai argumen (audit 2026-08-28, C-5).
 */
import { buatSurat } from "./buat";
import { aiCall } from "@/lib/ai/client";
import { promptDefault } from "@/lib/ai/prompt-registry";
import { resolvePrompt } from "@/lib/ai/prompts";

/**
 * Antrean "Lampiran masuk" (DECISIONS 432): berkas yang ditangkap dari grup WA
 * ditetapkan perannya oleh MANUSIA. Mesin hanya mengusulkan — ketetapan user
 * 2026-08-25: *"jangan langsung putuskan tapi sarankan"*.
 *
 * Arsip R2 baru dibuat pada saat konfirmasi, bukan saat penangkapan
 * (DECISIONS 472): arsip permanen bukan tempat seluruh isi grup. Yang ditandai
 * BUKAN BAHAN KERJA malah dibersihkan — objek R2-nya (kalau sempat ada dari
 * masa ketika semua diarsipkan) dihapus saat itu juga.
 */

export type LampiranState = { error?: string; success?: string } | undefined;

function fail(err: unknown): LampiranState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

/**
 * Buang objek R2 milik lampiran yang dinyatakan BUKAN bahan kerja.
 *
 * Objeknya bisa ada karena warisan: pada 2026-08-29 pagi setiap lampiran
 * diarsipkan begitu ditangkap, dan tanpa ini objek-objek itu tinggal di R2
 * selamanya walau orangnya sudah bilang berkasnya tidak dipakai.
 *
 * Berkas yang dipakai bersama baris lain yang SUDAH ditetapkan berguna tidak
 * disentuh — sidik jarinya sama, arsipnya satu.
 */
async function buangArsipTakTerpakai(attachmentId: string): Promise<void> {
  const a = await db.waAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, r2Key: true, sha256: true },
  });
  if (!a?.r2Key) return;
  const dipakai = await db.waAttachment.count({
    where: {
      id: { not: a.id },
      decision: { in: ["jadi_surat", "jadi_dokumen"] },
      ...(a.sha256 ? { sha256: a.sha256 } : { r2Key: a.r2Key }),
    },
  });
  if (dipakai > 0) return;
  try {
    const { isR2Configured, r2Delete } = await import("@/lib/r2");
    if (isR2Configured()) await r2Delete(a.r2Key);
  } catch (err) {
    // Gagal menghapus arsip bukan alasan menggagalkan ketetapan orang.
    console.error("[lampiran] gagal membuang arsip tak terpakai:", err);
  }
  await db.waAttachment.update({ where: { id: a.id }, data: { r2Key: null } });
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
    } else {
      await buangArsipTakTerpakai(att.id);
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
        status: true,
        localPath: true,
        saranAlasan: true,
        message: { select: { body: true, fromName: true } },
        package: { select: { name: true, contract: { select: { workTitle: true } } } },
      },
    });
    if (!att) return { error: "Lampiran tidak ditemukan dalam scope Anda." };

    /*
     * Berkasnya IKUT DIBACA bila tertangkap dan providernya mampu (DECISIONS
     * 434). Tanpa ini AI hanya menebak dari nama berkas — dan surat hasil
     * pindai bernama "IMG-0032.jpg" tidak memberi tahu apa pun.
     */
    const lampiranAi: { mediaType: string; dataBase64: string; nama?: string }[] = [];
    if (att.status === "tertangkap" && att.localPath && att.mimeType) {
      const { getActiveAiConfig } = await import("@/lib/ai/config");
      const { dukunganLampiran } = await import("@/lib/ai/client");
      const cfg = await getActiveAiConfig();
      const dukung = cfg ? dukunganLampiran(cfg.jalurPdf) : null;
      const pdf = att.mimeType === "application/pdf";
      const bisa = dukung ? (pdf ? dukung.pdf : att.mimeType.startsWith("image/") && dukung.gambar) : false;
      if (bisa) {
        try {
          const { readFile } = await import("node:fs/promises");
          const buf = await readFile(att.localPath);
          // Berkas raksasa tidak dikirim — biaya & timeout tidak sepadan.
          if (buf.byteLength <= 20 * 1024 * 1024) {
            lampiranAi.push({
              mediaType: att.mimeType,
              dataBase64: buf.toString("base64"),
              ...(att.fileName ? { nama: att.fileName } : {}),
            });
          }
        } catch {
          /* berkas lokal sudah hilang (kontainer ter-deploy ulang) → tetap
             jalan dengan keterangan saja, bukan gagal */
        }
      }
    }

    const r = await aiCall({
      system: (await resolvePrompt(lampiranAi.length ? "surat.baca" : "surat.pahami")) ||
        promptDefault(lampiranAi.length ? "surat.baca" : "surat.pahami"),
      ...(lampiranAi.length ? { attachments: lampiranAi } : {}),
      prompt:
        `Paket: ${att.package?.name ?? "-"}${att.package?.contract?.workTitle ? ` (${att.package.contract.workTitle})` : ""}\n` +
        `Nama berkas: ${att.fileName ?? "(tanpa nama)"}\n` +
        `Jenis berkas: ${att.mimeType ?? "tidak diketahui"}\n` +
        `Pengirim: ${att.message.fromName ?? "anggota grup"}\n` +
        `Teks pengiring di grup: ${att.message.body?.trim() || "(tidak ada)"}\n` +
        `Dugaan sistem: ${att.saranAlasan ?? "-"}`,
      maxTokens: lampiranAi.length ? 900 : 300,
      timeoutMs: lampiranAi.length ? 120_000 : 60_000,
    });
    if (!r.ok) return { error: r.error };

    await db.waAttachment.update({
      where: { id: att.id },
      data: { saranRingkas: r.text.trim().slice(0, 2000) },
    });
    await audit(user.id, "wa.lampiran.usul_ai", "wa_attachment", att.id, {
      provider: r.provider,
      berkasDibaca: lampiranAi.length > 0,
    });
    revalidatePath("/lampiran");
    return {
      success: lampiranAi.length
        ? "AI membaca isi berkasnya – periksa usulannya sebelum menetapkan."
        : "Usulan AI tersimpan (dari keterangan berkas saja) – periksa sebelum menetapkan.",
    };
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

/* ── Penandaan MASSAL "bukan bahan kerja" (ketetapan user 2026-08-29) ────── */

const massalSchema = z.object({
  attachmentIds: z.array(z.uuid()).min(1, "Pilih dulu berkas yang mau ditandai.").max(200),
});

/**
 * Tandai banyak lampiran sekaligus sebagai BUKAN bahan kerja.
 *
 * Keluhan user: satu-satu terlalu lambat, jadi daftarnya menumpuk dan berhenti
 * dibaca. Yang massal hanya ke arah ini — menyatakan sesuatu BUKAN bahan kerja
 * bisa dibatalkan (barisnya tetap ada, tinggal ditetapkan ulang), sedangkan
 * menjadikan sesuatu surat resmi tidak boleh dilakukan borongan tanpa membaca.
 */
export async function tandaiMassalBukanBahanKerjaAction(
  _prev: LampiranState,
  formData: FormData,
): Promise<LampiranState> {
  try {
    const user = await requireCapability("letter.manage");
    const parsed = massalSchema.safeParse({
      attachmentIds: formData.getAll("attachmentId").map(String),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const scope = packageScopeWhere(user, await accessibleLocationIds(user));
    // Penyaringan scope dilakukan lewat kueri, bukan lewat kepercayaan pada
    // borang: id yang dikirim datang dari peramban.
    const boleh = await db.waAttachment.findMany({
      where: { id: { in: parsed.data.attachmentIds }, package: scope },
      select: { id: true },
    });
    if (boleh.length === 0) return { error: "Tidak ada lampiran yang bisa Anda tetapkan." };

    for (const a of boleh) await buangArsipTakTerpakai(a.id);
    await db.waAttachment.updateMany({
      where: { id: { in: boleh.map((a) => a.id) } },
      data: { decision: "bukan_apa_apa", decidedById: user.id, decidedAt: new Date() },
    });
    await audit(user.id, "wa.lampiran.tetapkan_massal", "package", null, {
      jumlah: boleh.length,
      keputusan: "bukan_apa_apa",
    });
    revalidatePath("/lampiran");

    const luput = parsed.data.attachmentIds.length - boleh.length;
    return {
      success:
        `${boleh.length} lampiran ditandai bukan bahan kerja dan keluar dari daftar.` +
        (luput > 0 ? ` ${luput} dilewati karena di luar lingkup Anda.` : ""),
    };
  } catch (err) {
    return fail(err);
  }
}
