"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, accessibleLocationIds, requireCapability } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { transisiSurat } from "./lifecycle";
import { buatSurat } from "./lampiran-actions";
import type { LetterStatus } from "@/generated/prisma/enums";

/**
 * Aksi register surat (DECISIONS 432) — tahap 1–4:
 * 1. catat surat manual (yang tidak lewat grup WA)
 * 2. kaitkan ke paket/lokasi (lewat form)
 * 3. utang jawab: tandai dijawab + rantai balasan
 * 4. petakan surat menjadi kendala / temuan, dengan sumber TEGAS `surat`
 *    supaya asalnya terbaca di papan (pola DECISIONS 392).
 */

export type SuratState = { error?: string; success?: string } | undefined;

function fail(err: unknown): SuratState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const tanggal = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid");

const catatSchema = z.object({
  packageId: z.uuid().optional().or(z.literal("")),
  direction: z.enum(["masuk", "keluar"]),
  party: z.enum(["penyedia", "wakil_ppk", "ppk", "konsultan", "dinas", "internal", "lainnya"]),
  partyName: z.string().trim().max(150).optional(),
  subject: z.string().trim().min(3, "Perihal minimal 3 karakter").max(300),
  summary: z.string().trim().max(4000).optional(),
  letterNumber: z.string().trim().max(120).optional(),
  letterDate: tanggal.optional().or(z.literal("")),
  handledDate: tanggal,
  category: z.enum(["mutu", "jadwal", "pembayaran", "administrasi", "koordinasi", "k3", "lainnya"]),
  needsReply: z.enum(["ya", "tidak"]),
  replyDueDate: tanggal.optional().or(z.literal("")),
  inReplyToId: z.uuid().optional().or(z.literal("")),
});

/** Catat surat langsung di register (bukan dari lampiran WA). */
export async function catatSuratAction(_prev: SuratState, formData: FormData): Promise<SuratState> {
  try {
    const user = await requireCapability("letter.manage");
    const parsed = catatSchema.safeParse({
      packageId: formData.get("packageId") ?? "",
      direction: formData.get("direction"),
      party: formData.get("party"),
      partyName: formData.get("partyName") ?? undefined,
      subject: formData.get("subject"),
      summary: formData.get("summary") ?? undefined,
      letterNumber: formData.get("letterNumber") ?? undefined,
      letterDate: formData.get("letterDate") ?? "",
      handledDate: formData.get("handledDate"),
      category: formData.get("category"),
      needsReply: formData.get("needsReply") ?? "tidak",
      replyDueDate: formData.get("replyDueDate") ?? "",
      inReplyToId: formData.get("inReplyToId") ?? "",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    // Paket harus dalam scope user — surat menempel pada paket yang ia pegang.
    if (d.packageId) {
      const scope = packageScopeWhere(user, await accessibleLocationIds(user));
      const pkg = await db.package.findFirst({ where: { AND: [{ id: d.packageId }, scope] }, select: { id: true } });
      if (!pkg) return { error: "Paket tidak ditemukan dalam scope Anda." };
    }

    const needsReply = d.needsReply === "ya";
    const surat = await buatSurat({
      orgId: user.orgId,
      createdById: user.id,
      packageId: d.packageId || null,
      direction: d.direction,
      party: d.party,
      partyName: d.partyName || null,
      subject: d.subject,
      summary: d.summary || null,
      letterNumber: d.letterNumber || null,
      letterDate: d.letterDate ? new Date(`${d.letterDate}T00:00:00.000Z`) : null,
      handledDate: new Date(`${d.handledDate}T00:00:00.000Z`),
      category: d.category,
      needsReply,
      replyDueDate: needsReply && d.replyDueDate ? new Date(`${d.replyDueDate}T00:00:00.000Z`) : null,
    });

    // Surat keluar yang menjawab surat masuk: rantainya ditutup sekalian,
    // supaya "sudah dijawab" tidak perlu diketuk dua kali.
    if (d.inReplyToId) {
      const asal = await db.letter.findFirst({
        where: { id: d.inReplyToId, orgId: user.orgId },
        select: { id: true, status: true },
      });
      if (asal) {
        await db.letter.update({ where: { id: surat.id }, data: { inReplyToId: asal.id } });
        const gate = transisiSurat(asal.status as LetterStatus, "dijawab");
        if (gate.ok) {
          await db.letter.update({
            where: { id: asal.id },
            data: { status: "dijawab", repliedAt: new Date() },
          });
        }
      }
    }

    await audit(user.id, "surat.catat", "package", d.packageId || null, {
      letterId: surat.id,
      agenda: `${surat.agendaNo}/${surat.agendaYear}`,
      direction: d.direction,
      needsReply,
    });
    revalidatePath("/surat");
    return { success: `Surat tercatat – agenda ${surat.agendaNo}/${surat.agendaYear}.` };
  } catch (err) {
    return fail(err);
  }
}

/* ── Utang jawab (tahap 3) ──────────────────────────────────────────────── */

const statusSchema = z.object({
  letterId: z.uuid(),
  status: z.enum(["baru", "perlu_jawaban", "dijawab", "selesai", "arsip"]),
});

export async function ubahStatusSuratAction(_prev: SuratState, formData: FormData): Promise<SuratState> {
  try {
    const user = await requireCapability("letter.manage");
    const parsed = statusSchema.safeParse({
      letterId: formData.get("letterId"),
      status: formData.get("status"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const surat = await db.letter.findFirst({
      where: { id: parsed.data.letterId, orgId: user.orgId },
      select: { id: true, status: true, packageId: true },
    });
    if (!surat) return { error: "Surat tidak ditemukan." };

    const gate = transisiSurat(surat.status as LetterStatus, parsed.data.status);
    if (!gate.ok) return { error: gate.error };

    await db.letter.update({
      where: { id: surat.id },
      data: {
        status: gate.status,
        ...(gate.status === "dijawab" ? { repliedAt: new Date() } : {}),
      },
    });
    await audit(user.id, "surat.ubah_status", "package", surat.packageId, {
      letterId: surat.id,
      dari: surat.status,
      ke: gate.status,
    });
    revalidatePath("/surat");
    revalidatePath("/perlu-tindakan");
    return { success: "Status surat diperbarui." };
  } catch (err) {
    return fail(err);
  }
}

/* ── Surat menjadi kendala / temuan (tahap 4) ───────────────────────────── */

const petakanSchema = z.object({
  letterId: z.uuid(),
  jadi: z.enum(["kendala", "temuan"]),
  locationId: z.uuid("Pilih lokasi"),
  judul: z.string().trim().min(5, "Judul minimal 5 karakter").max(200),
  severity: z.enum(["rendah", "sedang", "tinggi"]).optional(),
});

/**
 * Buat kendala atau temuan DARI surat. Sumbernya ditulis tegas (`surat`) dan
 * suratnya ditautkan, sehingga papan terpusat tetap satu pintu dan bukti
 * asalnya bisa dibuka kembali — pola DECISIONS 392/426.
 */
export async function petakanSuratAction(_prev: SuratState, formData: FormData): Promise<SuratState> {
  try {
    const user = await requireCapability("letter.manage");
    const parsed = petakanSchema.safeParse({
      letterId: formData.get("letterId"),
      jadi: formData.get("jadi"),
      locationId: formData.get("locationId"),
      judul: formData.get("judul"),
      severity: formData.get("severity") ?? undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const surat = await db.letter.findFirst({
      where: { id: d.letterId, orgId: user.orgId },
      select: { id: true, subject: true, summary: true, category: true, handledDate: true, packageId: true },
    });
    if (!surat) return { error: "Surat tidak ditemukan." };

    const izin = await accessibleLocationIds(user);
    const lokasi = await db.location.findFirst({
      where: { id: d.locationId, ...(izin ? { id: { in: izin } } : {}) },
      select: { id: true },
    });
    if (!lokasi) return { error: "Lokasi tidak ditemukan dalam scope Anda." };

    const keterangan = [surat.summary?.trim(), `Sumber: surat "${surat.subject}"`]
      .filter(Boolean)
      .join("\n\n");

    if (d.jadi === "kendala") {
      const issue = await db.issue.create({
        data: {
          locationId: lokasi.id,
          title: d.judul,
          description: keterangan,
          severity: d.severity ?? "sedang",
          source: "surat",
          letterId: surat.id,
          raisedById: user.id,
        },
        select: { id: true },
      });
      await audit(user.id, "surat.jadi_kendala", "location", lokasi.id, {
        letterId: surat.id,
        issueId: issue.id,
      });
      revalidatePath("/kendala");
    } else {
      const finding = await db.finding.create({
        data: {
          locationId: lokasi.id,
          source: "surat",
          letterId: surat.id,
          category: kategoriTemuanDari(surat.category),
          severity: d.severity ?? "sedang",
          title: d.judul,
          description: keterangan,
          findingDate: surat.handledDate,
          raisedById: user.id,
        },
        select: { id: true },
      });
      await audit(user.id, "surat.jadi_temuan", "location", lokasi.id, {
        letterId: surat.id,
        findingId: finding.id,
      });
      revalidatePath("/temuan");
    }
    revalidatePath("/surat");
    return {
      success: d.jadi === "kendala" ? "Kendala dibuat dari surat ini." : "Temuan dibuat dari surat ini.",
    };
  } catch (err) {
    return fail(err);
  }
}

/** Perihal surat → kategori temuan. Yang tidak punya padanan jatuh ke lainnya. */
function kategoriTemuanDari(k: string): "mutu" | "volume" | "k3" | "administrasi" | "jadwal" | "lingkungan" | "lainnya" {
  switch (k) {
    case "mutu":
      return "mutu";
    case "jadwal":
      return "jadwal";
    case "k3":
      return "k3";
    case "pembayaran":
    case "administrasi":
      return "administrasi";
    default:
      return "lainnya";
  }
}
