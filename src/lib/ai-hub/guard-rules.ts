/**
 * Aturan guard AI Hub — MURNI (tanpa DB) supaya unit-testable. Admin dapat
 * mengubahnya via Sistem → AI (AppSetting). DECISIONS 133.
 *
 * DEFAULT HARUS MEMUAT SELURUH PORTOFOLIO. Versi pertama memasang
 * `maxLocationsPerRun: 25` dengan alasan "konservatif", padahal programnya 83
 * lokasi dan arsitekturnya menargetkan 200+ (PROJECT.md). Akibatnya laporan
 * portofolio penuh — justru kegunaan utama AI Hub — DITOLAK pada pemakaian
 * pertama, dengan pesan yang bahkan tidak menyebut bahwa batasnya bisa diubah.
 * Laporan user 2026-08-03: *"siapa yang membatasi 25 lokasi? bagaimana jika aku
 * butuh laporan penuh!"* Batas yang menghalangi pemakaian normal bukan
 * kehati-hatian, melainkan cacat.
 *
 * `maxInputChars` ikut dinaikkan, dan itu WAJIB bersamaan: payload ±810 karakter
 * per lokasi (satu baris data + 4–5 baris sumber), jadi 83 lokasi ≈ 67.000
 * karakter — sudah melewati batas lama 60.000. Menaikkan batas lokasi saja
 * hanya memindahkan penolakan ke pesan yang lain. Ongkos tetap terjaga oleh
 * batas run per user/jam dan per organisasi/hari, yang membatasi pemakaian
 * tanpa melarang cakupannya.
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
  // 200 = target arsitektur PROJECT.md; 83 lokasi hari ini muat dengan lapang.
  maxLocationsPerRun: 200,
  // 200 lokasi × ±810 karakter ≈ 162 rb, + risiko/narasi/instruksi. 400 rb
  // (~100 rb token) memberi ruang tanpa melepas pagar sama sekali.
  maxInputChars: 400_000,
  maxOutputTokens: 4_000,
  maxAskPerConversation: 20,
  timeoutMs: 90_000,
};

/**
 * Batas hidup satu pertanyaan yang sedang dijawab di latar (DECISIONS 455).
 *
 * Diturunkan dari anggaran waktu yang BENAR-BENAR mungkin, bukan angka ajaib:
 * `aiCallWithConfig` mencoba dua kali (timeout + retry) dan `aiStructured`
 * boleh meminta perbaikan skema sekali lagi — jadi maksimal empat panggilan
 * provider, ditambah dua jeda 1,5 detik dan waktu menyusun sumber.
 *
 * Lewat dari ini, percakapan yang masih bertanda menunggu berarti prosesnya
 * mati di tengah (deploy ulang, container restart) dan layar harus mengatakan
 * itu apa adanya — bukan memutar penanda tunggu selamanya.
 */
export function batasJawabanMs(cfg: AiGuardConfig): number {
  return cfg.timeoutMs * 4 + 30_000;
}

export type KeadaanTunggu = {
  /** Pertanyaan tercatat, jawabannya masih disusun. */
  menunggu: boolean;
  /** Penanda tunggu lewat batas – prosesnya mati sebelum menjawab. */
  terputus: boolean;
  menungguMs: number;
  batasMs: number;
};

/**
 * Terjemahkan `AiConversation.pendingSince` menjadi keadaan layar. MURNI:
 * "sekarang" diberikan pemanggil supaya bisa diuji tanpa mengunci jam.
 */
export function keadaanTunggu(
  pendingSince: Date | null,
  cfg: AiGuardConfig,
  sekarangMs: number,
): KeadaanTunggu {
  const batasMs = batasJawabanMs(cfg);
  if (!pendingSince) return { menunggu: false, terputus: false, menungguMs: 0, batasMs };
  const menungguMs = Math.max(0, sekarangMs - pendingSince.getTime());
  return { menunggu: menungguMs < batasMs, terputus: menungguMs >= batasMs, menungguMs, batasMs };
}

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
      reason: `Batas ${cfg.maxRunsPerUserPerHour} analisis AI per jam per pengguna tercapai – coba lagi nanti.`,
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
      // Pesan menyebut ANGKANYA, jumlah yang diminta, DAN tempat mengubahnya —
      // penolakan tanpa jalan keluar membuat orang mengira ini batas mati.
      reason:
        `Scope ${f.locationCount} lokasi melebihi batas ${cfg.maxLocationsPerRun} lokasi per analisis. ` +
        `Persempit scope, atau naikkan batasnya di Sistem → AI.`,
    };
  }
  if (f.inputChars > cfg.maxInputChars) {
    return {
      ok: false,
      code: "input_too_big",
      reason:
        `Data sumber ${Math.round(f.inputChars / 1000)} rb karakter melebihi batas ` +
        `${Math.round(cfg.maxInputChars / 1000)} rb. Persempit scope/periode, atau naikkan ` +
        `"Maks karakter input" di Sistem → AI.`,
    };
  }
  return { ok: true };
}
