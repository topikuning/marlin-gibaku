import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey } from "@/lib/format";
import { audit } from "@/lib/audit";
import { latestSettings, putAiSetting } from "@/lib/ai/config";
import type { SessionUser } from "@/lib/auth/session";
import {
  decideAiGuard,
  keadaanTunggu,
  parseGuardConfig,
  type AiGuardConfig,
  type KeadaanTunggu,
} from "./guard-rules";

/**
 * Guard AI Hub: kill-switch global + rate limit per user/jam & per org/hari +
 * batas ukuran — konfigurasi via AppSetting (tanpa Redis; hitung dari tabel
 * ai_runs). Penolakan selalu diaudit. DECISIONS 133.
 */

const GUARD_KEY = "ai.hub.guard"; // JSON AiGuardConfig (partial; default di guard-rules)
const ENABLED_KEY = "ai.hub.enabled"; // "true"/"false" — kill switch
const PRICING_KEY = "ai.hub.pricing"; // JSON {inUsdPerMTok, outUsdPerMTok} utk estimasi biaya

export async function getAiGuardConfig(): Promise<AiGuardConfig & { enabled: boolean }> {
  const s = await latestSettings([GUARD_KEY, ENABLED_KEY]);
  const cfg = parseGuardConfig(s.get(GUARD_KEY));
  const enabled = (s.get(ENABLED_KEY) ?? "true").trim() !== "false";
  return { ...cfg, enabled };
}

export async function setAiGuardConfig(input: Partial<AiGuardConfig>, enabled?: boolean): Promise<void> {
  if (Object.keys(input).length > 0) {
    const current = parseGuardConfig((await latestSettings([GUARD_KEY])).get(GUARD_KEY));
    await putAiSetting(GUARD_KEY, JSON.stringify({ ...current, ...input }));
  }
  if (enabled !== undefined) await putAiSetting(ENABLED_KEY, enabled ? "true" : "false");
}

export type AiPricing = { inUsdPerMTok: number; outUsdPerMTok: number } | null;

/** Harga token (opsional, diatur admin — TIDAK di-hardcode). Null = tanpa estimasi biaya. */
export async function getAiPricing(): Promise<AiPricing> {
  const raw = (await latestSettings([PRICING_KEY])).get(PRICING_KEY);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { inUsdPerMTok?: number; outUsdPerMTok?: number };
    if (typeof j.inUsdPerMTok === "number" && typeof j.outUsdPerMTok === "number") {
      return { inUsdPerMTok: j.inUsdPerMTok, outUsdPerMTok: j.outUsdPerMTok };
    }
  } catch {
    /* setting rusak → tanpa estimasi */
  }
  return null;
}

export async function setAiPricing(p: AiPricing): Promise<void> {
  await putAiSetting(PRICING_KEY, p ? JSON.stringify(p) : "");
}

/** Estimasi biaya USD dari usage (null bila pricing/usage tak tersedia). */
export function estimateCostUsd(
  pricing: AiPricing,
  usage: { inputTokens: number | null; outputTokens: number | null },
): number | null {
  if (!pricing) return null;
  if (usage.inputTokens == null && usage.outputTokens == null) return null;
  return (
    ((usage.inputTokens ?? 0) * pricing.inUsdPerMTok + (usage.outputTokens ?? 0) * pricing.outUsdPerMTok) /
    1_000_000
  );
}

import { AiGuardError } from "./guard-rules";
export { AiGuardError };

/**
 * Siapa yang memakai AI — dan bukan selalu seorang pengguna (DECISIONS 351).
 *
 * Tanya-jawab di grup WhatsApp dijawab tanpa menuntut pengirimnya terdaftar,
 * jadi ada pemakaian AI yang sah TANPA pengguna. Yang tidak boleh dilakukan:
 * mengarang pengguna agar kolomnya terisi — audit yang menunjuk orang yang
 * tidak melakukan apa-apa lebih buruk daripada kolom kosong, dan kuota
 * per-pengguna jadi salah orang.
 *
 * Pembatas lajunya tetap ada, hanya kuncinya yang berbeda: per-CHAT untuk grup.
 * Tanpa itu satu grup ramai bisa menghabiskan anggaran AI sepanjang hari.
 */
export type PemakaiAi =
  | SessionUser
  | { jenis: "grup"; orgId: string; chatId: string };

function bacaPemakai(p: PemakaiAi): {
  orgId: string;
  userId: string | null;
  chatId: string | null;
} {
  return "jenis" in p
    ? { orgId: p.orgId, userId: null, chatId: p.chatId }
    : { orgId: p.orgId, userId: p.id, chatId: null };
}

/**
 * Cek guard SEBELUM memanggil provider. Lempar AiGuardError bila ditolak
 * (ditulis ke audit — provider TIDAK dipanggil).
 */
export async function checkAiGuard(
  pemakai: PemakaiAi,
  input: { kind: string; locationCount: number; inputChars?: number },
): Promise<AiGuardConfig & { enabled: boolean }> {
  const { orgId, userId, chatId } = bacaPemakai(pemakai);
  const cfg = await getAiGuardConfig();
  const now = Date.now();
  // "Hari" = hari kerja Asia/Jakarta, bukan midnight server (audit B18) —
  // kalau server UTC, kuota lama ter-reset jam 07:00 WIB.
  const jakartaMidnight = new Date(`${jakartaDateKey(new Date())}T00:00:00+07:00`);
  const sejam = new Date(now - 3600_000);
  const [userLastHour, orgToday] = await Promise.all([
    // Kunci pembatas laju: pengguna, atau — untuk grup — chat-nya.
    db.aiRun.count({
      where: userId
        ? { userId, createdAt: { gte: sejam } }
        : { waChatId: chatId, createdAt: { gte: sejam } },
    }),
    /*
     * Kuota organisasi dihitung lewat kolom `orgId` (DECISIONS 351).
     *
     * Sebelumnya diturunkan dari daftar id pengguna organisasi (`userId IN
     * (…)`). Cara itu punya dua cacat: run TANPA pengguna tidak terhitung sama
     * sekali — jadi jawaban grup akan memakai anggaran tanpa pernah menyentuh
     * kuota — dan daftarnya memanjang seiring jumlah akun.
     */
    db.aiRun.count({ where: { orgId, createdAt: { gte: jakartaMidnight } } }),
  ]);
  const verdict = decideAiGuard(cfg, {
    enabled: cfg.enabled,
    userRunsLastHour: userLastHour,
    orgRunsToday: orgToday,
    locationCount: input.locationCount,
    inputChars: input.inputChars ?? 0,
  });
  if (!verdict.ok) {
    await audit(userId, "ai.guard.tolak", "ai_run", null, {
      kind: input.kind,
      code: verdict.code,
      reason: verdict.reason,
      ...(chatId ? { chatId } : {}),
    });
    throw new AiGuardError(verdict.code, verdict.reason);
  }
  return cfg;
}

/** Keadaan tunggu percakapan pada saat ini – pembungkus tak-murni dari keadaanTunggu(). */
export function keadaanTungguSekarang(pendingSince: Date | null, cfg: AiGuardConfig): KeadaanTunggu {
  return keadaanTunggu(pendingSince, cfg, Date.now());
}
