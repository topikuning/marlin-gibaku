"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  accessibleLocationIds,
  ForbiddenError,
  requireCapability,
  type SessionUser,
} from "@/lib/auth/session";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { canTransitionAiArtifact } from "@/lib/lifecycle";
import { AiGuardError } from "@/lib/ai-hub/guard";
import type { AiArtifactStatus } from "@/generated/prisma/enums";
import { PaparanAksesError } from "./akses";
import { PaparanSnapshotError } from "./snapshot";
import { PaparanGenerateError, generatePaparan } from "./generate";
import { parsePaparanContent, PaparanContentError } from "./susun";
import type { PaparanHumanEdits } from "./jenis";

/**
 * SERVER ACTIONS PAPARAN MINGGUAN KKP (DECISIONS 416).
 *
 * Semua mutasi: requireCapability + zod + audit (CLAUDE.md). Lifecycle memakai
 * mesin transisi `canTransitionAiArtifact` yang sama dengan artefak laporan —
 * bukan sistem kedua. Suntingan manusia TERBATAS pada narasi & caption foto;
 * angka tidak pernah bisa diedit dari sini.
 */

export type PaparanState = { error?: string; ok?: string } | undefined;

function fail(err: unknown): { error: string } {
  if (
    err instanceof ForbiddenError ||
    err instanceof AiGuardError ||
    err instanceof PaparanAksesError ||
    err instanceof PaparanSnapshotError ||
    err instanceof PaparanGenerateError ||
    err instanceof PaparanContentError
  ) {
    return { error: err.message };
  }
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

/* ── Loader artefak + gerbang baca ──────────────────────────────────────── */

async function muatArtefakPaparan(user: SessionUser, artifactId: string) {
  const artifact = await db.aiArtifact.findUnique({
    where: { id: artifactId },
    select: {
      id: true,
      kind: true,
      status: true,
      version: true,
      packageId: true,
      structuredContent: true,
      frozenAt: true,
      runId: true,
      run: { select: { scopeIds: true } },
      package: { select: { orgId: true } },
    },
  });
  // Pesan generik yang sama untuk "tidak ada" dan "di luar akses" — jangan
  // konfirmasi keberadaan artefak organisasi/scope lain.
  if (!artifact || artifact.kind !== "paparan" || artifact.package?.orgId !== user.orgId) {
    throw new PaparanAksesError("Paparan tidak ditemukan.");
  }
  if (!scopeCoveredBy(await accessibleLocationIds(user), artifact.run?.scopeIds ?? null)) {
    throw new PaparanAksesError("Paparan tidak ditemukan.");
  }
  return artifact;
}

/* ── Generate ───────────────────────────────────────────────────────────── */

const generateSchema = z.object({
  packageId: z.uuid(),
  weekNumber: z.coerce.number().int().min(1).max(520),
  focus: z.enum(["lengkap", "progres", "kendala"]).default("lengkap"),
});

export async function buatPaparanAction(_prev: PaparanState, formData: FormData): Promise<PaparanState> {
  let artifactId: string;
  try {
    const user = await requireCapability("ai.generate");
    const parsed = generateSchema.safeParse({
      packageId: formData.get("packageId"),
      weekNumber: formData.get("weekNumber"),
      focus: String(formData.get("focus") ?? "lengkap"),
    });
    if (!parsed.success) return { error: "Pilihan paket/minggu tidak valid." };
    const hasil = await generatePaparan(user, parsed.data);
    artifactId = hasil.artifactId;
  } catch (err) {
    return fail(err);
  }
  redirect(`/ai/paparan/${artifactId}`);
}

/* ── Sunting narasi (terbatas) ──────────────────────────────────────────── */

const BAGIAN_NARASI = [
  "ringkasanEksekutif",
  "capaianNaratif",
  "kegiatanNaratif",
  "sintesisKendala",
  "rencanaNaratif",
  "dukunganDibutuhkan",
  "actionPlan",
] as const;

const editSchema = z.object({
  artifactId: z.uuid(),
  title: z.string().trim().min(5).max(160),
  // Tiap bagian = satu textarea, satu butir per baris.
  ringkasanEksekutif: z.string().max(4000),
  capaianNaratif: z.string().max(4000),
  kegiatanNaratif: z.string().max(4000),
  sintesisKendala: z.string().max(4000),
  rencanaNaratif: z.string().max(4000),
  dukunganDibutuhkan: z.string().max(4000),
  actionPlan: z.string().max(4000),
});

const EDITABLE_STATUS: AiArtifactStatus[] = ["draft", "direview", "disetujui"];

export async function suntingNarasiPaparanAction(
  _prev: PaparanState,
  formData: FormData,
): Promise<PaparanState> {
  try {
    const user = await requireCapability("ai.report_review");
    const parsed = editSchema.safeParse({
      artifactId: formData.get("artifactId"),
      title: String(formData.get("title") ?? ""),
      ringkasanEksekutif: String(formData.get("ringkasanEksekutif") ?? ""),
      capaianNaratif: String(formData.get("capaianNaratif") ?? ""),
      kegiatanNaratif: String(formData.get("kegiatanNaratif") ?? ""),
      sintesisKendala: String(formData.get("sintesisKendala") ?? ""),
      rencanaNaratif: String(formData.get("rencanaNaratif") ?? ""),
      dukunganDibutuhkan: String(formData.get("dukunganDibutuhkan") ?? ""),
      actionPlan: String(formData.get("actionPlan") ?? ""),
    });
    if (!parsed.success) return { error: "Isian narasi tidak valid." };
    const artifact = await muatArtefakPaparan(user, parsed.data.artifactId);
    if (artifact.frozenAt || !EDITABLE_STATUS.includes(artifact.status)) {
      return { error: "Paparan beku/terkirim tidak dapat diedit – buat versi baru." };
    }
    const content = parsePaparanContent(artifact.structuredContent);
    const edits: PaparanHumanEdits = { ...(content.humanEdits ?? {}) };
    edits.title = parsed.data.title;
    for (const bagian of BAGIAN_NARASI) {
      const baris = parsed.data[bagian]
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8);
      edits[bagian] = baris;
    }
    content.humanEdits = edits;
    await db.aiArtifact.update({
      where: { id: artifact.id },
      data: {
        title: parsed.data.title,
        structuredContent: JSON.parse(JSON.stringify(content)),
        humanEditNote: "narasi diedit manual",
      },
    });
    await audit(user.id, "ai.artifact.edit", "ai_artifact", artifact.id, { kind: "paparan" });
    revalidatePath(`/ai/paparan/${artifact.id}`);
    return { ok: "Narasi tersimpan. Angka tidak berubah – selalu dari snapshot." };
  } catch (err) {
    return fail(err);
  }
}

/* ── Pilih foto + caption ───────────────────────────────────────────────── */

const fotoSchema = z.object({
  artifactId: z.uuid(),
  photoIds: z.array(z.uuid()).max(16),
});

export async function pilihFotoPaparanAction(
  _prev: PaparanState,
  formData: FormData,
): Promise<PaparanState> {
  try {
    const user = await requireCapability("ai.report_review");
    const parsed = fotoSchema.safeParse({
      artifactId: formData.get("artifactId"),
      photoIds: formData.getAll("photoId").map(String),
    });
    if (!parsed.success) return { error: "Pilihan foto tidak valid." };
    const artifact = await muatArtefakPaparan(user, parsed.data.artifactId);
    if (artifact.frozenAt || !EDITABLE_STATUS.includes(artifact.status)) {
      return { error: "Paparan beku/terkirim tidak dapat diedit – buat versi baru." };
    }
    const content = parsePaparanContent(artifact.structuredContent);
    /*
     * ID dari form TIDAK dipercaya: hanya foto yang memang ada di snapshot
     * paket/periode ini yang boleh dipilih (spec §13). Yang di luar itu DITOLAK
     * dengan pesan, bukan dibuang diam-diam — pilihan yang menyusut tanpa
     * penjelasan terbaca sebagai bug.
     */
    const kandidat = new Set(content.snapshot.fotoKandidat.map((f) => f.id));
    const asing = parsed.data.photoIds.filter((id) => !kandidat.has(id));
    if (asing.length > 0) {
      return { error: "Sebagian foto bukan bagian dari paket/periode paparan ini." };
    }
    content.selectedPhotoIds = parsed.data.photoIds;
    // Caption per foto terpilih (opsional).
    const edits: PaparanHumanEdits = { ...(content.humanEdits ?? {}) };
    const captions: Record<string, string> = { ...(edits.captionFoto ?? {}) };
    for (const id of parsed.data.photoIds) {
      const c = String(formData.get(`caption-${id}`) ?? "").trim();
      if (c) captions[id] = c.slice(0, 160);
      else delete captions[id];
    }
    edits.captionFoto = captions;
    content.humanEdits = edits;
    await db.aiArtifact.update({
      where: { id: artifact.id },
      data: { structuredContent: JSON.parse(JSON.stringify(content)) },
    });
    await audit(user.id, "ai.artifact.edit", "ai_artifact", artifact.id, {
      kind: "paparan",
      foto: parsed.data.photoIds.length,
    });
    revalidatePath(`/ai/paparan/${artifact.id}`);
    return { ok: `${parsed.data.photoIds.length} foto dipilih untuk slide dokumentasi.` };
  } catch (err) {
    return fail(err);
  }
}

/* ── Lifecycle (mesin transisi yang sama dgn artefak laporan) ───────────── */

const TRANSITION_CAPABILITY: Record<AiArtifactStatus, "ai.report_review" | "ai.report_approve"> = {
  draft: "ai.report_review",
  direview: "ai.report_review",
  disetujui: "ai.report_approve",
  beku: "ai.report_approve",
  terkirim: "ai.report_approve",
};

export async function transisiPaparanAction(_prev: PaparanState, formData: FormData): Promise<PaparanState> {
  try {
    const artifactId = String(formData.get("artifactId") ?? "");
    const to = String(formData.get("to") ?? "") as AiArtifactStatus;
    if (!artifactId || !(to in TRANSITION_CAPABILITY)) return { error: "Transisi tidak valid." };
    const user = await requireCapability(TRANSITION_CAPABILITY[to]);
    const artifact = await muatArtefakPaparan(user, artifactId);
    if (!canTransitionAiArtifact(artifact.status, to)) {
      return { error: `Transisi ${artifact.status} → ${to} tidak diizinkan.` };
    }
    if (artifact.frozenAt && to !== "terkirim") return { error: "Paparan beku bersifat immutable." };
    // Distribusi (beku → terkirim) untuk paparan belum dibuka dari sini —
    // pengiriman berkas resmi ke luar butuh jalurnya sendiri.
    if (to === "terkirim") return { error: "Distribusi paparan belum tersedia – unduh PDF final untuk dibagikan." };

    const now = new Date();
    const data: Record<string, unknown> = { status: to };
    if (to === "direview") {
      data.reviewedById = user.id;
      data.reviewedAt = now;
    }
    if (to === "disetujui") {
      data.approvedById = user.id;
      data.approvedAt = now;
    }
    if (to === "beku") {
      /*
       * Freeze = validasi ULANG konten kanonik (spec §10): bentuknya harus
       * masih terbaca, dan setiap foto terpilih harus masih anggota snapshot.
       * Sesudah ini structured content immutable; koreksi = versi baru.
       */
      const content = parsePaparanContent(artifact.structuredContent);
      const kandidat = new Set(content.snapshot.fotoKandidat.map((f) => f.id));
      if (!content.selectedPhotoIds.every((id) => kandidat.has(id))) {
        return { error: "Ada foto terpilih yang bukan bagian snapshot – perbaiki dulu sebelum dibekukan." };
      }
      data.frozenAt = now;
      data.contentHash = createHash("sha256")
        .update(JSON.stringify(artifact.structuredContent))
        .digest("hex");
    }
    await db.aiArtifact.update({ where: { id: artifact.id }, data: data as never });
    await audit(user.id, `ai.artifact.${to}`, "ai_artifact", artifact.id, {
      kind: "paparan",
      from: artifact.status,
    });
    revalidatePath(`/ai/paparan/${artifact.id}`);
    revalidatePath("/ai/paparan");
    return { ok: `Status paparan → ${to}.` };
  } catch (err) {
    return fail(err);
  }
}
