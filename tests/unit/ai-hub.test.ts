import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  deriveEncryptionKey,
  encryptSecret,
  isEncryptedSecret,
  readStoredSecret,
  SecretDecryptError,
} from "@/lib/ai/crypto";
import {
  errorCodeFromStatus,
  extractJsonBlock,
  parseAnthropicBody,
  parseOpenAiBody,
} from "@/lib/ai/parse";
import { AI_GUARD_DEFAULTS, decideAiGuard, parseGuardConfig } from "@/lib/ai-hub/guard-rules";
import { computeReadiness, gradeOf } from "@/lib/ai-hub/readiness";
import { computeRisks, exceptionFirst } from "@/lib/ai-hub/risk";
import { haversineMeters, runQualityRules, type QualityDetailFacts } from "@/lib/ai-hub/quality-rules";
import {
  extractNumericClaims,
  filterGrounded,
  numericClaimsValid,
  pulseOutputSchema,
  reportOutputSchema,
} from "@/lib/ai-hub/schemas";
import { renderAiReportExcelRows, renderAiReportWhatsApp, type AiReportContent } from "@/lib/ai-hub/render";
import { canTransitionAiArtifact } from "@/lib/lifecycle";
import type { LocationFacts } from "@/lib/ai-hub/types";

/* ── Enkripsi API key ────────────────────────────────────────────────────── */

describe("ai/crypto", () => {
  const key = deriveEncryptionKey("passphrase-rahasia-yang-panjang")!;

  it("round-trip enkripsi/dekripsi + format enc:v1", () => {
    const ct = encryptSecret("sk-abc123", key);
    expect(isEncryptedSecret(ct)).toBe(true);
    expect(ct.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(ct, key)).toBe("sk-abc123");
  });

  it("nonce unik – dua enkripsi nilai sama menghasilkan ciphertext berbeda", () => {
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key));
  });

  it("kunci salah / data dimodifikasi → SecretDecryptError", () => {
    const other = deriveEncryptionKey("kunci-lain-yang-panjang-juga")!;
    const ct = encryptSecret("rahasia", key);
    expect(() => decryptSecret(ct, other)).toThrow(SecretDecryptError);
    const tampered = ct.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered, key)).toThrow(SecretDecryptError);
  });

  it("kompatibel-mundur: plaintext lama terbaca; terenkripsi tanpa kunci → null", () => {
    expect(readStoredSecret("sk-plaintext-lama", null)).toBe("sk-plaintext-lama");
    const ct = encryptSecret("baru", key);
    expect(readStoredSecret(ct, null)).toBeNull();
    expect(readStoredSecret(ct, key)).toBe("baru");
  });

  it("passphrase terlalu pendek → tidak menghasilkan kunci", () => {
    expect(deriveEncryptionKey("pendek")).toBeNull();
    expect(deriveEncryptionKey("")).toBeNull();
    expect(deriveEncryptionKey(undefined)).toBeNull();
  });
});

/* ── Parser respons provider ─────────────────────────────────────────────── */

describe("ai/parse", () => {
  it("Anthropic: text + usage + stop_reason", () => {
    const p = parseAnthropicBody({
      model: "claude-x",
      content: [{ type: "text", text: "halo" }, { type: "tool_use" }, { type: "text", text: " dunia" }],
      usage: { input_tokens: 120, output_tokens: 45 },
      stop_reason: "end_turn",
    });
    expect(p.text).toBe("halo dunia");
    expect(p.usage).toEqual({ inputTokens: 120, outputTokens: 45 });
    expect(p.finishReason).toBe("end_turn");
  });

  it("OpenAI-compatible: prompt/completion tokens + finish_reason", () => {
    const p = parseOpenAiBody({
      model: "gpt-x",
      choices: [{ message: { content: " jawab " }, finish_reason: "stop" }],
      usage: { prompt_tokens: 80, completion_tokens: 20 },
    });
    expect(p.text).toBe("jawab");
    expect(p.usage).toEqual({ inputTokens: 80, outputTokens: 20 });
    expect(p.finishReason).toBe("stop");
  });

  it("respons tanpa usage → null (bukan 0 palsu)", () => {
    expect(parseAnthropicBody({ content: [{ type: "text", text: "x" }] }).usage).toEqual({
      inputTokens: null,
      outputTokens: null,
    });
  });

  it("extractJsonBlock: buang code fence + ambil objek seimbang", () => {
    expect(extractJsonBlock('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonBlock('kata pengantar {"a":{"b":"}"}} akhir')).toBe('{"a":{"b":"}"}}');
    expect(extractJsonBlock("tanpa json")).toBeNull();
  });

  it("mapping kode error HTTP", () => {
    expect(errorCodeFromStatus(401)).toBe("authentication");
    expect(errorCodeFromStatus(429)).toBe("rate_limited");
    expect(errorCodeFromStatus(500)).toBe("provider_error");
  });
});

/* ── Guard rules ─────────────────────────────────────────────────────────── */

describe("ai-hub/guard-rules", () => {
  const cfg = AI_GUARD_DEFAULTS;
  const base = { enabled: true, userRunsLastHour: 0, orgRunsToday: 0, locationCount: 3, inputChars: 1000 };

  it("lolos pada kondisi normal", () => {
    expect(decideAiGuard(cfg, base)).toEqual({ ok: true });
  });
  it("kill switch menolak segalanya", () => {
    const v = decideAiGuard(cfg, { ...base, enabled: false });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("ai_disabled");
  });
  it("rate limit user & org", () => {
    expect(decideAiGuard(cfg, { ...base, userRunsLastHour: cfg.maxRunsPerUserPerHour }).ok).toBe(false);
    expect(decideAiGuard(cfg, { ...base, orgRunsToday: cfg.maxRunsPerOrgPerDay }).ok).toBe(false);
  });
  it("scope & input terlalu besar ditolak", () => {
    expect(decideAiGuard(cfg, { ...base, locationCount: cfg.maxLocationsPerRun + 1 }).ok).toBe(false);
    expect(decideAiGuard(cfg, { ...base, inputChars: cfg.maxInputChars + 1 }).ok).toBe(false);
  });

  // Laporan portofolio PENUH adalah kegunaan utama AI Hub. Default yang
  // menolaknya bukan kehati-hatian melainkan cacat — laporan user 2026-08-03:
  // "siapa yang membatasi 25 lokasi? bagaimana jika aku butuh laporan penuh!".
  // DECISIONS 240.
  it("BAWAAN memuat seluruh portofolio, bukan sebagiannya", () => {
    // 83 lokasi hari ini, 200+ target arsitektur (PROJECT.md).
    for (const jumlah of [83, 200]) {
      const v = decideAiGuard(cfg, { ...base, locationCount: jumlah });
      expect(v, `${jumlah} lokasi harus lolos default`).toEqual({ ok: true });
    }
  });

  it("BAWAAN muat payload seluruh portofolio, bukan cuma jumlah lokasinya", () => {
    // Payload ±810 karakter per lokasi (1 baris data + 4-5 baris sumber).
    // Menaikkan batas lokasi tanpa menaikkan batas ukuran hanya memindahkan
    // penolakan ke pesan yang lain.
    const perLokasi = 810;
    for (const jumlah of [83, 200]) {
      const v = decideAiGuard(cfg, { ...base, locationCount: jumlah, inputChars: jumlah * perLokasi });
      expect(v, `payload ${jumlah} lokasi harus lolos default`).toEqual({ ok: true });
    }
  });

  it("penolakan menyebut angkanya DAN tempat mengubahnya", () => {
    // Penolakan tanpa jalan keluar membuat orang mengira ini batas mati.
    const scope = decideAiGuard(cfg, { ...base, locationCount: cfg.maxLocationsPerRun + 1 });
    expect(scope.ok).toBe(false);
    if (!scope.ok) {
      expect(scope.reason).toContain(String(cfg.maxLocationsPerRun));
      expect(scope.reason).toContain("Sistem → AI");
    }
    const ukuran = decideAiGuard(cfg, { ...base, inputChars: cfg.maxInputChars + 1 });
    expect(ukuran.ok).toBe(false);
    if (!ukuran.ok) expect(ukuran.reason).toContain("Sistem → AI");
  });
  it("parseGuardConfig: JSON rusak/nilai aneh → default", () => {
    expect(parseGuardConfig("bukan json")).toEqual(AI_GUARD_DEFAULTS);
    expect(parseGuardConfig('{"maxRunsPerUserPerHour":-5}').maxRunsPerUserPerHour).toBe(
      AI_GUARD_DEFAULTS.maxRunsPerUserPerHour,
    );
    expect(parseGuardConfig('{"maxRunsPerUserPerHour":7}').maxRunsPerUserPerHour).toBe(7);
  });
});

/* ── Readiness & risk ────────────────────────────────────────────────────── */

function facts(over: Partial<LocationFacts> = {}): LocationFacts {
  return {
    locationId: "loc-1",
    name: "Tengket",
    slug: "tengket",
    packageName: "KNMP Bangkalan",
    province: "Jawa Timur",
    status: "berjalan",
    startDateKey: "2026-06-01",
    hasActiveRab: true,
    hasActiveBaseline: true,
    totalWeeks: 20,
    currentWeek: 8,
    planPct: 40,
    actualPct: 38,
    deviationPp: -2,
    expectedReports: 7,
    finalReports: 6,
    sentReports: 1,
    draftReports: 0,
    needFixReports: 0,
    daysSinceLastReport: 1,
    activityCount: 3,
    photoCount: 12,
    photosNoGps: 1,
    photosServerTime: 0,
    openIssues: 1,
    criticalIssues: 0,
    issuesWithoutRecovery: 0,
    overdueRecoveries: 0,
    milestonesNeedFix: 0,
    ...over,
  };
}

describe("ai-hub/readiness", () => {
  it("lokasi sehat → strong, tanpa blocker", () => {
    const r = computeReadiness(facts());
    expect(r.grade).toBe("strong");
    expect(r.blockers).toHaveLength(0);
  });
  it("tanpa RAB aktif → blocker berat", () => {
    const r = computeReadiness(facts({ hasActiveRab: false, hasActiveBaseline: false }));
    expect(r.blockers.some((b) => b.key === "rab_aktif")).toBe(true);
    expect(r.score).toBeLessThan(85);
  });
  it("bukti foto banyak tapi realisasi 0 & tak pernah final → readiness anjlok", () => {
    const r = computeReadiness(
      facts({ actualPct: 0, finalReports: 0, sentReports: 0, daysSinceLastReport: null, photoCount: 18 }),
    );
    expect(r.grade === "poor" || r.grade === "limited").toBe(true);
    expect(r.blockers.length).toBeGreaterThan(0);
  });
  it("gradeOf ambang", () => {
    expect(gradeOf(85)).toBe("strong");
    expect(gradeOf(70)).toBe("adequate");
    expect(gradeOf(50)).toBe("limited");
    expect(gradeOf(49)).toBe("poor");
  });
});

describe("ai-hub/risk", () => {
  it("deviasi besar → risiko schedule kritis; sehat → tanpa item schedule", () => {
    const bad = computeRisks(facts({ deviationPp: -25, actualPct: 15, planPct: 40 }), computeReadiness(facts()));
    expect(bad.some((r) => r.category === "schedule" && r.severity === "kritis")).toBe(true);
    const ok = computeRisks(facts(), computeReadiness(facts()));
    expect(ok.some((r) => r.category === "schedule")).toBe(false);
  });
  it("recovery overdue → compliance + flag overdue", () => {
    const r = computeRisks(facts({ overdueRecoveries: 2 }), computeReadiness(facts()));
    const item = r.find((x) => x.category === "compliance");
    expect(item?.overdue).toBe(true);
  });
  it("exceptionFirst: risiko tinggi dulu, lalu readiness terburuk", () => {
    const a = { riskScore: 90, readiness: computeReadiness(facts()), deviationPp: -1 };
    const b = { riskScore: 50, readiness: computeReadiness(facts()), deviationPp: -20 };
    expect(exceptionFirst([b, a])[0]).toBe(a);
  });
});

/* ── Quality rules ───────────────────────────────────────────────────────── */

describe("ai-hub/quality-rules", () => {
  const detail: QualityDetailFacts = {
    locationId: "loc-1",
    locationName: "Tengket",
    volumeOverruns: [],
    exifDateMismatch: 0,
    gpsOutsideRadius: 0,
    gpsRadiusM: 1000,
    finalReportsNoPhoto: 0,
    invoiceOverCommitment: [],
  };
  it("semua bersih → tidak ada gagal/periksa (selain info by-design)", () => {
    const out = runQualityRules(facts(), detail);
    expect(out.filter((f) => f.status === "gagal" || f.status === "periksa")).toHaveLength(0);
  });
  it("volume overrun & invoice>commitment → gagal", () => {
    const out = runQualityRules(facts(), {
      ...detail,
      volumeOverruns: [{ itemName: "Galian", rabVolume: 100, cumVolume: 120 }],
      invoiceOverCommitment: [{ invoiceNumber: "INV-1", invoiceAmount: "Rp 120", commitmentAmount: "Rp 100" }],
    });
    expect(out.find((f) => f.key === "volume_overrun")?.status).toBe("gagal");
    expect(out.find((f) => f.key === "invoice_over")?.status).toBe("gagal");
  });
  it("realisasi 0% + bukti besar → gagal (under-reporting)", () => {
    const out = runQualityRules(facts({ actualPct: 0, photoCount: 10 }), detail);
    expect(out.find((f) => f.key === "nol_dengan_bukti")?.status).toBe("gagal");
  });
  it("haversine ~111km per derajat lintang", () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

/* ── Skema output + grounding ────────────────────────────────────────────── */

describe("ai-hub/schemas", () => {
  it("pulseOutputSchema menolak severity liar & sourceRefIds kosong", () => {
    const bad = pulseOutputSchema.safeParse({
      summary: "ringkasan yang cukup panjang untuk lolos minimum",
      overallStatus: "normal",
      confidence: 80,
      priorityLocations: [{ locationId: "x", severity: "parah", reason: "r", sourceRefIds: [] }],
      actionsToConsider: [],
      whatChanged: null,
      limitations: [],
    });
    expect(bad.success).toBe(false);
  });

  it("extractNumericClaims menangkap % dan pp (koma desimal)", () => {
    expect(extractNumericClaims("deviasi −90,2 pp dan realisasi 12.5% serta 7 laporan")).toEqual([-90.2, 12.5]);
  });

  it("numericClaimsValid: cocok ±0.6 dgn angka resmi; angka liar ditolak", () => {
    expect(numericClaimsValid("realisasi 38,0% (deviasi -2,0 pp)", [38, -2, 40])).toBe(true);
    expect(numericClaimsValid("realisasi 55% jauh", [38, -2, 40])).toBe(false);
  });

  it("filterGrounded membuang lokasi di luar scope, ref liar, dan klaim angka salah", () => {
    const ctx = {
      allowedLocationIds: new Set(["loc-1"]),
      allowedSourceRefIds: new Set(["tengket:progress"]),
      officialNumbersByLocation: new Map([["loc-1", [38, -2, 40] as const]]),
    };
    const { kept, report } = filterGrounded(
      [
        { locationId: "loc-1", sourceRefIds: ["tengket:progress"], reason: "deviasi -2,0 pp" },
        { locationId: "loc-liar", sourceRefIds: ["tengket:progress"], reason: "apa saja" },
        { locationId: "loc-1", sourceRefIds: ["ref:liar"], reason: "deviasi -2,0 pp" },
        { locationId: "loc-1", sourceRefIds: ["tengket:progress"], reason: "deviasi -55% parah" },
      ],
      ctx,
    );
    expect(kept).toHaveLength(1);
    expect(report.dropped).toHaveLength(3);
  });
});

/* ── Renderer laporan ────────────────────────────────────────────────────── */

describe("ai-hub/render", () => {
  const content: AiReportContent = {
    templateKey: "exec_portfolio",
    templateVersion: 1,
    report: reportOutputSchema.parse({
      title: "Executive Portfolio Brief",
      executiveSummary: "Ringkasan eksekutif yang cukup panjang untuk validasi.",
      overallStatus: "perhatian",
      confidence: 75,
      sections: [{ heading: "Kondisi umum", body: "Isi bagian.", locationId: null }],
      recommendations: [{ title: "Validasi data Tengket", reason: "0 laporan final", locationId: null }],
      waSummary: "Update: Tengket perlu validasi data.",
      limitations: ["laporan final belum lengkap"],
    }),
    official: {
      periodStart: "2026-07-20",
      periodEnd: "2026-07-26",
      dataAsOf: "2026-07-26T08:00:00.000Z",
      totals: {
        locations: 1,
        reportsExpected: 7,
        reportsFinal: 6,
        negativeDeviationLocations: 1,
        openIssues: 1,
        overdueRecoveries: 0,
        lowReadinessLocations: 0,
      },
      rows: [
        {
          ...facts(),
          readiness: computeReadiness(facts()),
          riskScore: 0,
          riskSeverity: null,
        },
      ],
    },
  };

  it("WA & Excel memakai angka resmi yang SAMA", () => {
    const wa = renderAiReportWhatsApp(content);
    expect(wa).toContain("38.0%"); // realisasi resmi
    expect(wa).toContain("6/7"); // laporan final
    const rows = renderAiReportExcelRows(content);
    expect(rows[0][0]).toBe("Lokasi");
    expect(rows[1]).toContain(38); // realisasi resmi di Excel
    expect(rows[1]).toContain("Tengket");
  });
});

/* ── Lifecycle artefak ───────────────────────────────────────────────────── */

describe("lifecycle AI artifact", () => {
  it("alur maju lengkap valid", () => {
    expect(canTransitionAiArtifact("draft", "direview")).toBe(true);
    expect(canTransitionAiArtifact("direview", "disetujui")).toBe(true);
    expect(canTransitionAiArtifact("disetujui", "beku")).toBe(true);
    expect(canTransitionAiArtifact("beku", "terkirim")).toBe(true);
  });
  it("beku immutable: tidak bisa kembali ke draft/direview", () => {
    expect(canTransitionAiArtifact("beku", "draft")).toBe(false);
    expect(canTransitionAiArtifact("beku", "direview")).toBe(false);
  });
  it("lompat draft→beku dilarang", () => {
    expect(canTransitionAiArtifact("draft", "beku")).toBe(false);
    expect(canTransitionAiArtifact("draft", "disetujui")).toBe(false);
  });
});
