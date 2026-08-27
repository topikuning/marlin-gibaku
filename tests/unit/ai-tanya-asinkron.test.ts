// Ask MARLIN dijawab di latar (DECISIONS 455).
//
// Log edge produksi 2026-08-27: POST /ai/ask berakhir 499 pada detik ke-125
// dengan txBytes 0 — peramban menyerah sementara server masih memanggil
// provider. Anggaran waktunya memang sah selama itu: 4 panggilan provider
// (timeout + retry, lalu perbaikan skema) × timeoutMs.
//
// Tes ini mengunci dua hal yang menentukan perilaku layar: berapa lama sebuah
// pertanyaan boleh dianggap "sedang dijawab", dan kapan ia harus disebut
// TERPUTUS alih-alih memutar penanda tunggu selamanya.
import { describe, expect, it } from "vitest";
import { AI_GUARD_DEFAULTS, batasJawabanMs, keadaanTunggu } from "@/lib/ai-hub/guard-rules";

const cfg = AI_GUARD_DEFAULTS;

describe("batas hidup satu pertanyaan diturunkan dari anggaran nyata", () => {
  it("empat panggilan provider + margin, bukan angka ajaib", () => {
    expect(batasJawabanMs(cfg)).toBe(cfg.timeoutMs * 4 + 30_000);
    expect(batasJawabanMs(cfg)).toBe(390_000);
  });

  it("ikut berubah saat admin mengubah timeout di Sistem → AI", () => {
    expect(batasJawabanMs({ ...cfg, timeoutMs: 30_000 })).toBe(150_000);
    expect(batasJawabanMs({ ...cfg, timeoutMs: 120_000 })).toBe(510_000);
  });

  it("selalu lebih longgar dari satu panggilan, jadi tidak memotong kerja yang sehat", () => {
    expect(batasJawabanMs(cfg)).toBeGreaterThan(cfg.timeoutMs);
  });
});

describe("keadaan tunggu percakapan", () => {
  const mulai = new Date("2026-08-27T15:00:00.000Z");
  const pada = (detik: number) => mulai.getTime() + detik * 1000;

  it("tanpa penanda: tidak menunggu, tidak terputus", () => {
    const k = keadaanTunggu(null, cfg, pada(0));
    expect(k).toMatchObject({ menunggu: false, terputus: false, menungguMs: 0 });
  });

  it("masih di dalam anggaran → sedang dijawab", () => {
    // 125 detik: persis titik peramban menyerah pada log produksi. Server
    // sekarang tidak lagi menahan request, jadi ini keadaan yang SAH.
    const k = keadaanTunggu(mulai, cfg, pada(125));
    expect(k.menunggu).toBe(true);
    expect(k.terputus).toBe(false);
    expect(k.menungguMs).toBe(125_000);
  });

  it("lewat batas → terputus, bukan menunggu selamanya", () => {
    const k = keadaanTunggu(mulai, cfg, pada(391));
    expect(k.menunggu).toBe(false);
    expect(k.terputus).toBe(true);
  });

  it("tepat di batas dihitung terputus", () => {
    const k = keadaanTunggu(mulai, cfg, mulai.getTime() + batasJawabanMs(cfg));
    expect(k.terputus).toBe(true);
  });

  it("jam mundur tidak menghasilkan durasi negatif", () => {
    const k = keadaanTunggu(mulai, cfg, pada(-40));
    expect(k.menungguMs).toBe(0);
    expect(k.menunggu).toBe(true);
  });

  it("batas yang dikembalikan sama dengan batasJawabanMs – layar tidak menghitung sendiri", () => {
    expect(keadaanTunggu(mulai, cfg, pada(1)).batasMs).toBe(batasJawabanMs(cfg));
  });
});

/* ── Pesan gagal untuk PENANYA, bukan galat mentah (DECISIONS 456) ─────── */
describe("pesanGagalUntukPenanya", () => {
  it("penolakan PAGAR disampaikan apa adanya – itu yang bisa ditindak penanya", async () => {
    const { AiGuardError } = await import("@/lib/ai-hub/guard-rules");
    const { pesanGagalUntukPenanya } = await import("@/lib/ai-hub/pesan-gagal");
    const pesan = pesanGagalUntukPenanya(
      new AiGuardError("kuota", "Batas 20 analisis AI per jam tercapai."),
    );
    expect(pesan).toBe("Batas 20 analisis AI per jam tercapai.");
  });

  it("galat provider TIDAK bocor mentah ke percakapan", async () => {
    const { pesanGagalUntukPenanya } = await import("@/lib/ai-hub/pesan-gagal");
    const bocor = "429 Too Many Requests from api.anthropic.com model=claude-x key=sk-abc";
    const pesan = pesanGagalUntukPenanya(new Error(bocor));
    expect(pesan).not.toContain("api.anthropic.com");
    expect(pesan).not.toContain("sk-abc");
    // Tetap mengaku gagal, dan menyebut ke mana rinciannya bisa dicari.
    expect(pesan.toLowerCase()).toContain("belum bisa dijawab");
    expect(pesan.toLowerCase()).toContain("riwayat analisis");
  });
});
