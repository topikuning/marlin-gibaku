import { z } from "zod";

/**
 * Skema output AI terstruktur (zod) + validator grounding — MURNI, unit-testable.
 * Setiap output AI WAJIB lolos: (1) skema, (2) validasi lokasi ∈ scope,
 * (3) validasi sourceRefId ∈ sumber run, (4) validasi klaim angka. Bagian yang
 * gagal DIBUANG dan dicatat sebagai limitation — tidak pernah tampil sebagai
 * "siap review". DECISIONS 133.
 */

const sev = z.enum(["sedang", "tinggi", "kritis"]);
const refIds = z.array(z.string()).min(1);

export const pulseOutputSchema = z.object({
  summary: z.string().min(20).max(3000),
  overallStatus: z.enum(["normal", "perhatian", "kritis", "data_kurang"]),
  confidence: z.number().int().min(0).max(100),
  priorityLocations: z
    .array(
      z.object({
        locationId: z.string(),
        severity: sev,
        reason: z.string().max(600),
        sourceRefIds: refIds,
      }),
    )
    .max(10),
  actionsToConsider: z
    .array(
      z.object({
        locationId: z.string().nullable(),
        title: z.string().max(160),
        reason: z.string().max(500),
        proposedRole: z.string().nullable(),
        sourceRefIds: refIds,
      }),
    )
    .max(10),
  whatChanged: z.string().max(800).nullable(),
  limitations: z.array(z.string().max(300)).max(10),
});
export type PulseOutput = z.infer<typeof pulseOutputSchema>;

const driver = z.object({
  category: z.enum(["fisik", "material", "cuaca", "sdm", "perizinan", "data", "keuangan", "lainnya"]),
  explanation: z.string().max(500),
  impact: z.enum(["rendah", "sedang", "besar"]),
  confidence: z.number().int().min(0).max(100),
  sourceRefIds: refIds,
});

export const varianceOutputSchema = z.object({
  summary: z.string().min(20).max(3000),
  confidence: z.number().int().min(0).max(100),
  locations: z
    .array(
      z.object({
        locationId: z.string(),
        dataConfidence: z.enum(["rendah", "sedang", "tinggi"]),
        confirmedDrivers: z.array(driver).max(6),
        suspectedDrivers: z.array(driver).max(6),
        requiredValidations: z
          .array(z.object({ action: z.string().max(300), sourceRefIds: refIds }))
          .max(6),
      }),
    )
    .max(25),
  limitations: z.array(z.string().max(300)).max(10),
});
export type VarianceOutput = z.infer<typeof varianceOutputSchema>;

export const riskOutputSchema = z.object({
  summary: z.string().min(20).max(3000),
  confidence: z.number().int().min(0).max(100),
  rationales: z
    .array(
      z.object({
        locationId: z.string(),
        category: z.enum(["schedule", "data_quality", "compliance", "cost"]),
        aiRationale: z.string().max(600),
        sourceRefIds: refIds,
      }),
    )
    .max(30),
  limitations: z.array(z.string().max(300)).max(10),
});
export type RiskOutput = z.infer<typeof riskOutputSchema>;

export const qualityOutputSchema = z.object({
  summary: z.string().min(20).max(3000),
  confidence: z.number().int().min(0).max(100),
  explanations: z
    .array(
      z.object({
        locationId: z.string(),
        findingKey: z.string(),
        explanation: z.string().max(600),
        sourceRefIds: refIds,
      }),
    )
    .max(40),
  limitations: z.array(z.string().max(300)).max(10),
});
export type QualityOutput = z.infer<typeof qualityOutputSchema>;

export const reportOutputSchema = z.object({
  title: z.string().max(160),
  executiveSummary: z.string().min(20).max(4000),
  overallStatus: z.enum(["normal", "perhatian", "kritis", "data_kurang"]),
  confidence: z.number().int().min(0).max(100),
  sections: z
    .array(
      z.object({
        heading: z.string().max(120),
        body: z.string().max(4000),
        locationId: z.string().nullable(),
      }),
    )
    .min(1)
    .max(12),
  recommendations: z
    .array(z.object({ title: z.string().max(160), reason: z.string().max(500), locationId: z.string().nullable() }))
    .max(10),
  waSummary: z.string().min(10).max(1800),
  limitations: z.array(z.string().max(300)).max(10),
});
export type ReportOutput = z.infer<typeof reportOutputSchema>;

export const askOutputSchema = z.object({
  answer: z.string().min(5).max(4000),
  citations: z.array(z.object({ sourceRefId: z.string(), note: z.string().max(200).nullable() })).max(12),
  confidence: z.number().int().min(0).max(100),
  limitations: z.array(z.string().max(300)).max(6),
});
export type AskOutput = z.infer<typeof askOutputSchema>;

/* ── Validasi grounding (pasca-skema) ──────────────────────────────────── */

export type GroundingContext = {
  allowedLocationIds: ReadonlySet<string>;
  allowedSourceRefIds: ReadonlySet<string>;
  /** Angka resmi per lokasi (plan/actual/deviasi/readiness/…) utk validasi klaim. */
  officialNumbersByLocation: ReadonlyMap<string, readonly number[]>;
};

/** Ekstrak klaim angka "penting" dari teks: berpola persen/pp (mis. "12,5%", "−90,2 pp"). */
export function extractNumericClaims(text: string): number[] {
  const out: number[] = [];
  // Normalisasi tanda minus tipografis (U+2212) → ASCII agar ikut tertangkap.
  const norm = text.replace(/−/g, "-");
  const re = /(-?\d+(?:[.,]\d+)?)\s*(?:%|pp\b|poin persen)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const v = Number(m[1].replace(",", "."));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** Klaim angka valid bila tiap angka cocok (±0.6) dengan salah satu angka resmi. */
export function numericClaimsValid(text: string, official: readonly number[]): boolean {
  const claims = extractNumericClaims(text);
  return claims.every((c) => official.some((o) => Math.abs(Math.abs(c) - Math.abs(o)) <= 0.6));
}

export type GroundingReport = { dropped: string[] };

/**
 * Saring bagian output yang tidak tergrounding: lokasi di luar scope, sourceRef
 * tak dikenal, atau klaim angka tanpa sumber. Mutasi-out immutable — kembalikan
 * salinan + daftar alasan yang dibuang (jadi limitations).
 */
export function filterGrounded<
  T extends { locationId?: string | null; sourceRefIds?: string[]; reason?: string; explanation?: string; aiRationale?: string },
>(items: T[], ctx: GroundingContext): { kept: T[]; report: GroundingReport } {
  const dropped: string[] = [];
  const kept = items.filter((it) => {
    if (it.locationId != null && !ctx.allowedLocationIds.has(it.locationId)) {
      dropped.push(`lokasi di luar scope (${it.locationId}) dibuang`);
      return false;
    }
    if (it.sourceRefIds && !it.sourceRefIds.every((r) => ctx.allowedSourceRefIds.has(r))) {
      dropped.push("bagian dengan sourceRef tidak dikenal dibuang");
      return false;
    }
    const text = it.reason ?? it.explanation ?? it.aiRationale ?? "";
    if (text && it.locationId != null) {
      const official = ctx.officialNumbersByLocation.get(it.locationId) ?? [];
      if (!numericClaimsValid(text, official)) {
        dropped.push(`klaim angka tanpa sumber utk lokasi ${it.locationId} dibuang`);
        return false;
      }
    }
    return true;
  });
  return { kept, report: { dropped } };
}

/** Hint skema ringkas untuk prompt (dibaca model, bukan zod dump). */
export const SCHEMA_HINTS = {
  pulse: `{
  "summary": string,                       // ringkasan situasi (Bahasa Indonesia)
  "overallStatus": "normal"|"perhatian"|"kritis"|"data_kurang",
  "confidence": number 0-100,
  "priorityLocations": [{ "locationId": string (HARUS dari daftar scope), "severity": "sedang"|"tinggi"|"kritis", "reason": string, "sourceRefIds": [string dari daftar sumber] }],
  "actionsToConsider": [{ "locationId": string|null, "title": string, "reason": string, "proposedRole": string|null, "sourceRefIds": [string] }],
  "whatChanged": string|null,
  "limitations": [string]
}`,
  variance: `{
  "summary": string,
  "confidence": number 0-100,
  "locations": [{ "locationId": string, "dataConfidence": "rendah"|"sedang"|"tinggi",
    "confirmedDrivers": [{ "category": "fisik"|"material"|"cuaca"|"sdm"|"perizinan"|"data"|"keuangan"|"lainnya", "explanation": string, "impact": "rendah"|"sedang"|"besar", "confidence": number, "sourceRefIds": [string] }],
    "suspectedDrivers": [sama seperti confirmedDrivers],
    "requiredValidations": [{ "action": string, "sourceRefIds": [string] }] }],
  "limitations": [string]
}`,
  risk: `{
  "summary": string, "confidence": number 0-100,
  "rationales": [{ "locationId": string, "category": "schedule"|"data_quality"|"compliance"|"cost", "aiRationale": string, "sourceRefIds": [string] }],
  "limitations": [string]
}`,
  quality: `{
  "summary": string, "confidence": number 0-100,
  "explanations": [{ "locationId": string, "findingKey": string, "explanation": string, "sourceRefIds": [string] }],
  "limitations": [string]
}`,
  report: `{
  "title": string, "executiveSummary": string,
  "overallStatus": "normal"|"perhatian"|"kritis"|"data_kurang",
  "confidence": number 0-100,
  "sections": [{ "heading": string, "body": string, "locationId": string|null }],
  "recommendations": [{ "title": string, "reason": string, "locationId": string|null }],
  "waSummary": string (ringkas utk WhatsApp, tanpa markdown),
  "limitations": [string]
}`,
  ask: `{
  "answer": string (Bahasa Indonesia, langsung ke inti),
  "citations": [{ "sourceRefId": string dari daftar sumber, "note": string|null }],
  "confidence": number 0-100,
  "limitations": [string]
}`,
} as const;
