import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { aiStructured } from "@/lib/ai/structured";
import { getActiveAiConfig } from "@/lib/ai/config";
import { checkAiGuard, getAiGuardConfig } from "@/lib/ai-hub/guard";
import { muatPaketPaparan, type PaketPaparan } from "./akses";
import { buatSnapshotPaparan } from "./snapshot";
import {
  PAPARAN_TEMPLATE_KEY,
  PAPARAN_TEMPLATE_VERSION,
  paparanNarasiSchema,
  type PaparanContent,
  type PaparanNarasi,
  type PaparanSnapshot,
} from "./jenis";
import { narasiDeterministik, saringNarasiPaparan } from "./susun";
import { pilihFotoAwal } from "./susun";

/**
 * GENERATE PAPARAN MINGGUAN KKP (DECISIONS 416).
 *
 * Workflow terkontrol, BUKAN agentic: snapshot deterministik → maksimal SATU
 * panggilan AI terstruktur (pola `aiStructured`, +1 repair internal) → saring
 * grounding → artefak draft. AI gagal dalam bentuk apa pun → narasi
 * deterministik, deck tetap terbentuk, run mencatat errornya jujur.
 */

export class PaparanGenerateError extends Error {}

export type GeneratePaparanInput = {
  packageId: string;
  weekNumber: number;
  focus?: "lengkap" | "progres" | "kendala";
};

function hashInput(userId: string, i: GeneratePaparanInput): string {
  return createHash("sha256")
    .update(["paparan", userId, i.packageId, i.weekNumber, i.focus ?? "lengkap"].join("|"))
    .digest("hex");
}

const INSTRUKSI_DASAR = `Susun narasi PAPARAN MINGGUAN kontrak untuk dipresentasikan ke KKP (pemberi kerja), dalam Bahasa Indonesia formal dan ringkas.
Aturan mutlak:
- JANGAN mengarang angka. Angka persen/deviasi hanya boleh disalin persis dari DATA.
- Setiap butir wajib menyebut sourceRefIds dari daftar sumber yang diberikan.
- locationId hanya boleh dari daftar lokasi paket.
- Rencana minggu depan yang tidak ada di DATA jangan dikarang.
- Jangan menyinggung keuangan internal pelaksana.`;

const FOKUS: Record<string, string> = {
  lengkap: "",
  progres: "\nFokus utama paparan ini: PROGRES fisik dan capaian pekerjaan.",
  kendala: "\nFokus utama paparan ini: KENDALA, dampaknya, dan tindak lanjutnya.",
};

/** Payload data untuk model — ringkas, tanpa foto, tanpa uang internal. */
function payloadSnapshot(s: PaparanSnapshot): string {
  const bag = {
    paket: s.paket.name,
    periode: s.periode,
    progresPaket: s.progres.paket,
    lokasi: s.progres.lokasi.map((l) => ({
      locationId: l.locationId,
      nama: l.name,
      targetPct: l.targetPct,
      realisasiPct: l.realisasiPct,
      deviasiPp: l.deviasiPp,
      kenaikanPp: l.kenaikanPp,
    })),
    kelengkapanLaporan: s.kelengkapan,
    capaian: s.capaian,
    kegiatan: s.kegiatan.map((g) => ({
      locationId: g.locationId,
      lokasi: g.lokasiNama,
      tanggal: g.tanggalKey,
      jenis: g.jenis,
      judul: g.judul,
      hasil: g.hasil,
    })),
    kendalaBaru: s.kendala.baruMingguIni,
    kendalaAktif: s.kendala.terbukaSaatIni,
    pemulihan: s.pemulihan,
    rencanaMingguDepan: s.rencanaMingguDepan,
    sumber: s.sourceRefs.map((r) => ({ id: r.id, label: r.label })),
  };
  return JSON.stringify(bag, null, 1);
}

export type HasilGeneratePaparan = {
  artifactId: string;
  runId: string;
  versi: number;
  narasiSumber: "ai" | "deterministik";
};

export async function generatePaparan(
  user: SessionUser,
  input: GeneratePaparanInput,
  now = new Date(),
): Promise<HasilGeneratePaparan> {
  // 1. Akses paket = SATU pintu (org + kontrak + SPMK + seluruh lokasi aktif).
  const pkg: PaketPaparan = await muatPaketPaparan(user, input.packageId);
  const locationIds = pkg.locations.map((l) => l.id);

  /*
   * 2. Guard AI. BEDA dari run analisis: kill switch yang mati TIDAK menolak
   * pembuatan paparan — deck-nya jatuh ke narasi deterministik (spec §9,
   * "paparan harus tetap dapat dibuat bila kill switch AI mati"). Yang tetap
   * ditegakkan saat AI aktif: kuota per pengguna/organisasi dan batas ukuran,
   * lewat `checkAiGuard` yang sama dengan seluruh run AI.
   */
  const guardCfg = await getAiGuardConfig();
  if (guardCfg.enabled) {
    await checkAiGuard(user, { kind: "paparan", locationCount: locationIds.length });
  }

  // 3. Anti double-click: run sama dalam 90 detik → pakai artefak yang ada.
  const inputHash = hashInput(user.id, input);
  const recent = await db.aiRun.findFirst({
    where: {
      userId: user.id,
      inputHash,
      createdAt: { gte: new Date(now.getTime() - 90_000) },
      status: { in: ["berjalan", "siap"] },
    },
    select: { id: true, artifacts: { select: { id: true, version: true }, take: 1 } },
  });
  if (recent?.artifacts[0]) {
    return {
      artifactId: recent.artifacts[0].id,
      runId: recent.id,
      versi: recent.artifacts[0].version,
      narasiSumber: "ai",
    };
  }

  // 4. Snapshot deterministik (menolak minggu belum terjadi / weekNumber < 1).
  const snapshot = await buatSnapshotPaparan(pkg, input.weekNumber, now);

  // 5. Persist run — scopeType package, scopeIds lokasi terresolve (utk scope
  //    baca `scopeCoveredBy` yang sudah dipakai seluruh jalur baca AI Hub).
  const run = await db.aiRun.create({
    data: {
      userId: user.id,
      orgId: user.orgId,
      runKind: "paparan",
      status: "berjalan",
      scopeType: "package",
      scopeIds: locationIds,
      periodStart: new Date(`${snapshot.periode.mulaiKey}T00:00:00.000Z`),
      periodEnd: new Date(`${snapshot.periode.akhirKey}T00:00:00.000Z`),
      promptVersion: `paparan-v${PAPARAN_TEMPLATE_VERSION}`,
      inputHash,
      sourceSnapshotAt: snapshot.dataAsOf ? new Date(snapshot.dataAsOf) : null,
      sourcesJson: JSON.parse(JSON.stringify(snapshot.sourceRefs)),
    },
    select: { id: true },
  });
  await audit(user.id, "ai.run.buat", "ai_run", run.id, {
    kind: "paparan",
    packageId: pkg.id,
    weekNumber: input.weekNumber,
    locations: locationIds.length,
  });

  // 6. Maks SATU panggilan AI; setiap kegagalan jatuh ke deterministik.
  let narasi: PaparanNarasi;
  let narasiSumber: "ai" | "deterministik" = "deterministik";
  let dibuang: string[] = [];
  let aiError: string | null = null;
  let aiMeta: { provider: string; model: string; inputTokens?: number; outputTokens?: number; latencyMs?: number } | null =
    null;
  const aiCfg = guardCfg.enabled ? await getActiveAiConfig() : null;
  if (aiCfg) {
    const prompt = `${INSTRUKSI_DASAR}${FOKUS[input.focus ?? "lengkap"] ?? ""}\n\n=== DATA ===\n${payloadSnapshot(snapshot)}`;
    if (prompt.length > guardCfg.maxInputChars) {
      aiError = "input_too_big";
      narasi = narasiDeterministik(snapshot);
    } else {
      const result = await aiStructured(paparanNarasiSchema as never, {
        system:
          "Kamu penyusun narasi paparan proyek. Angka bukan wewenangmu – salin persis dari data atau jangan sebut.",
        prompt,
        schemaHint:
          "Objek: title, ringkasanEksekutif[{text,sourceRefIds}] maks 4, capaianNaratif/kegiatanNaratif/sintesisKendala/rencanaNaratif[{text,locationId,sourceRefIds}], dukunganDibutuhkan[{text,sourceRefIds}], limitations[string].",
        maxTokens: guardCfg.maxOutputTokens,
        timeoutMs: guardCfg.timeoutMs,
      });
      if (result.ok) {
        const hasil = saringNarasiPaparan(result.data, snapshot);
        narasi = hasil.narasi;
        dibuang = hasil.dibuang;
        narasiSumber = hasil.dibuang.some((d) => d.includes("deterministik")) ? "deterministik" : "ai";
        aiMeta = {
          provider: result.meta.provider,
          model: result.meta.model,
          inputTokens: result.meta.usage.inputTokens ?? undefined,
          outputTokens: result.meta.usage.outputTokens ?? undefined,
          latencyMs: result.meta.latencyMs,
        };
      } else {
        aiError = result.errorCode;
        narasi = narasiDeterministik(snapshot);
      }
    }
  } else {
    narasi = narasiDeterministik(snapshot);
    aiError = guardCfg.enabled ? "no_provider" : "ai_disabled";
  }

  // 7. Artefak draft — regenerate = VERSI BARU, tidak menimpa (spec §5).
  const scopeHash = createHash("sha256")
    .update(`${PAPARAN_TEMPLATE_KEY}|${pkg.id}|${input.weekNumber}`)
    .digest("hex")
    .slice(0, 16);
  const versi =
    (await db.aiArtifact.count({
      where: {
        kind: "paparan",
        packageId: pkg.id,
        structuredContent: { path: ["weekNumber"], equals: input.weekNumber },
      },
    })) + 1;
  const content: PaparanContent = {
    scopeHash,
    templateKey: PAPARAN_TEMPLATE_KEY,
    templateVersion: PAPARAN_TEMPLATE_VERSION,
    packageId: pkg.id,
    weekNumber: input.weekNumber,
    snapshot,
    narasi,
    narasiSumber,
    selectedPhotoIds: pilihFotoAwal(snapshot.fotoKandidat),
    humanEdits: null,
  };
  const artifact = await db.aiArtifact.create({
    data: {
      runId: run.id,
      packageId: pkg.id,
      kind: "paparan",
      templateKey: PAPARAN_TEMPLATE_KEY,
      templateVersion: PAPARAN_TEMPLATE_VERSION,
      version: versi,
      status: "draft",
      title: narasi.title,
      structuredContent: JSON.parse(JSON.stringify(content)),
      createdById: user.id,
    },
    select: { id: true },
  });

  // 8. Run selesai — error AI dicatat jujur, tetapi run TIDAK gagal: deck
  //    deterministiknya tetap jadi dan itulah hasil operasi ini.
  await db.aiRun.update({
    where: { id: run.id },
    data: {
      status: "siap",
      provider: aiMeta?.provider,
      model: aiMeta?.model,
      inputTokens: aiMeta?.inputTokens,
      outputTokens: aiMeta?.outputTokens,
      latencyMs: aiMeta?.latencyMs,
      errorCode: aiError,
      limitations: JSON.parse(JSON.stringify([...dibuang, ...narasi.limitations].slice(0, 15))),
      outputJson: JSON.parse(JSON.stringify({ paparan: { artifactId: artifact.id, narasiSumber } })),
      finishedAt: new Date(),
    },
  });
  await audit(user.id, "ai.artifact.buat", "ai_artifact", artifact.id, {
    kind: "paparan",
    packageId: pkg.id,
    weekNumber: input.weekNumber,
    version: versi,
    narasiSumber,
    aiError,
  });
  return { artifactId: artifact.id, runId: run.id, versi, narasiSumber };
}
