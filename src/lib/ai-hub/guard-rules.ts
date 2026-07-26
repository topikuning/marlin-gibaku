/**
 * Aturan guard AI Hub — MURNI (tanpa DB) supaya unit-testable. Nilai default
 * konservatif; admin dapat mengubah via Sistem → AI (AppSetting). DECISIONS 133.
 */

export type AiGuardConfig = {
  maxRunsPerUserPerHour: number;
  maxRunsPerOrgPerDay: number;
  maxLocationsPerRun: number;
  maxInputChars: number; // batas ukuran payload sumber yang dikirim ke provider
  maxOutputTokens: number;
  maxAskPerConversation: number;
  timeoutMs: number;
};

export const AI_GUARD_DEFAULTS: AiGuardConfig = {
  maxRunsPerUserPerHour: 20,
  maxRunsPerOrgPerDay: 200,
  maxLocationsPerRun: 25,
  maxInputChars: 60_000,
  maxOutputTokens: 4_000,
  maxAskPerConversation: 20,
  timeoutMs: 90_000,
};

/** Parse JSON setting (partial) → config lengkap dgn default. Toleran nilai rusak. */
export function parseGuardConfig(raw: string | undefined | null): AiGuardConfig {
  if (!raw) return { ...AI_GUARD_DEFAULTS };
  try {
    const j = JSON.parse(raw) as Partial<Record<keyof AiGuardConfig, unknown>>;
    const num = (k: keyof AiGuardConfig) => {
      const v = j[k];
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : AI_GUARD_DEFAULTS[k];
    };
    return {
      maxRunsPerUserPerHour: num("maxRunsPerUserPerHour"),
      maxRunsPerOrgPerDay: num("maxRunsPerOrgPerDay"),
      maxLocationsPerRun: num("maxLocationsPerRun"),
      maxInputChars: num("maxInputChars"),
      maxOutputTokens: num("maxOutputTokens"),
      maxAskPerConversation: num("maxAskPerConversation"),
      timeoutMs: num("timeoutMs"),
    };
  } catch {
    return { ...AI_GUARD_DEFAULTS };
  }
}

export type GuardFacts = {
  enabled: boolean;
  userRunsLastHour: number;
  orgRunsToday: number;
  locationCount: number;
  inputChars: number;
};

export type GuardVerdict = { ok: true } | { ok: false; code: string; reason: string };

/** Keputusan guard MURNI: kill-switch → limit run → limit ukuran. */
export function decideAiGuard(cfg: AiGuardConfig, f: GuardFacts): GuardVerdict {
  if (!f.enabled) {
    return { ok: false, code: "ai_disabled", reason: "Fitur AI sedang dinonaktifkan admin (kill switch)." };
  }
  if (f.userRunsLastHour >= cfg.maxRunsPerUserPerHour) {
    return {
      ok: false,
      code: "rate_user",
      reason: `Batas ${cfg.maxRunsPerUserPerHour} analisis AI per jam per pengguna tercapai — coba lagi nanti.`,
    };
  }
  if (f.orgRunsToday >= cfg.maxRunsPerOrgPerDay) {
    return {
      ok: false,
      code: "rate_org",
      reason: `Batas ${cfg.maxRunsPerOrgPerDay} analisis AI per hari (seluruh organisasi) tercapai.`,
    };
  }
  if (f.locationCount > cfg.maxLocationsPerRun) {
    return {
      ok: false,
      code: "scope_too_big",
      reason: `Maksimal ${cfg.maxLocationsPerRun} lokasi per analisis — persempit scope.`,
    };
  }
  if (f.inputChars > cfg.maxInputChars) {
    return {
      ok: false,
      code: "input_too_big",
      reason: "Data sumber terlalu besar untuk satu analisis — persempit scope atau periode.",
    };
  }
  return { ok: true };
}
