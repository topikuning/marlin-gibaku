// KLAIM TERIKAT dijalankan BENAR-BENAR oleh `executeAiRun` (DECISIONS 378).
//
// `tests/unit/ai-klaim-terikat.test.ts` sudah membuktikan validatornya secara
// murni. Yang TIDAK bisa dibuktikan di sana: apakah run benar-benar
// MEMANGGILNYA, membuang bagian yang gagal dari teks yang dibaca penanya, dan
// menimpa `confidence` model dengan angka deterministik. Aturan yang benar tapi
// tidak terpanggil terlihat persis sama seperti aturan yang salah.
//
// Prompt-nya ikut diperiksa. Kalau daftar FAKTA tidak sampai ke model, ia harus
// menebak sourceRef & periode — tebakan yang meleset membuat SEMUA klaim
// ditolak dan setiap jawaban jatuh ke keyakinan 0. Pagar yang menghukum
// jawaban benar karena format rujukannya salah lebih buruk daripada tidak ada.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Prompt terakhir yang diterima "provider" — dipakai memeriksa payload FAKTA. */
let promptTerakhir = "";
/** Keluaran yang dipalsukan; disetel per uji dari fakta yang ada di prompt. */
let buatKeluaran: (prompt: string) => Record<string, unknown> = () => ({});

vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async (_schema: unknown, opts: { prompt: string }) => {
    promptTerakhir = opts.prompt;
    return {
      ok: true,
      data: buatKeluaran(opts.prompt),
      meta: {
        ok: true,
        provider: "anthropic",
        model: "uji",
        text: "",
        usage: { inputTokens: 10, outputTokens: 5 },
        latencyMs: 1,
        finishReason: null,
      },
      attempts: 1,
    };
  },
}));

const { db } = await import("@/lib/db");
const { executeAiRun } = await import("@/lib/ai-hub/runs");
import type { SessionUser } from "@/lib/auth/session";

const suffix = `klm${Date.now().toString(36)}`;
let orgId = "";
let locId = "";
let user: SessionUser;

const MULAI = "2026-06-01";
const AKHIR = "2026-08-19";

type Fakta = {
  locationId: string;
  metric: string;
  value: number;
  periodKey: string;
  sourceRefId: string;
};

/**
 * Baca daftar FAKTA dari prompt.
 *
 * Sengaja dibaca dari prompt, bukan dihitung ulang di uji: itu sekaligus
 * membuktikan payload memuat bentuk yang PERSIS dituntut validator. Kalau
 * formatnya berubah sepihak di salah satu sisi, uji ini yang memerah.
 */
function faktaDariPrompt(prompt: string): Fakta[] {
  const out: Fakta[] = [];
  for (const baris of prompt.split("\n")) {
    const m = baris.match(
      /^- locationId=(\S+) metric=(\S+) value=(\S+) periodKey=(\S+) sourceRefId=(\S+)$/,
    );
    if (m) {
      out.push({
        locationId: m[1],
        metric: m[2],
        value: Number(m[3]),
        periodKey: m[4],
        sourceRefId: m[5],
      });
    }
  }
  return out;
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org KLM ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const pkg = await db.package.create({
    data: { orgId, name: `Paket KLM ${suffix}`, stage: "pelaksanaan" },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Bulusan ${suffix}`,
      slug: `bulusan-${suffix}`,
      village: "Bulusan",
      regency: "Demak",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true },
  });
  locId = loc.id;

  const u = await db.user.create({
    data: {
      orgId,
      username: `pd-${suffix}`,
      email: `pd-${suffix}@contoh.id`,
      fullName: "PD KLM",
      // Peran lintas lokasi supaya scope tidak perlu penugasan terpisah —
      // yang diuji berkas ini validasi klaim, bukan aturan scope.
      role: "program_director",
      passwordHash: "x",
    },
    select: { id: true, orgId: true, fullName: true, username: true, email: true, role: true },
  });
  user = { ...u, mustChangePassword: false };
});

beforeEach(async () => {
  promptTerakhir = "";
  // Kuota AI dinolkan supaya jumlah uji tidak ikut menentukan hasilnya.
  await db.aiRun.deleteMany({ where: { orgId } });
});

afterAll(async () => {
  /*
   * Fixture TIDAK dihapus. Menghapus pengguna/organisasi meng-cascade ke
   * `audit_logs`, dan tabel itu append-only di tingkat basis data (trigger
   * menolak UPDATE/DELETE) — jejak audit memang tidak boleh bisa dihapus,
   * termasuk oleh uji. Nama fixture ber-suffix waktu, jadi sisa baris tidak
   * pernah bertabrakan dengan uji berikutnya.
   */
  await db.aiRun.deleteMany({ where: { orgId } });
  await db.$disconnect();
});

async function jalankan(): Promise<Record<string, unknown>> {
  const r = await executeAiRun(user, {
    kind: "tanya",
    locationIds: [locId],
    startKey: MULAI,
    endKey: AKHIR,
    question: "Bagaimana progressnya?",
  });
  expect(r.status).toBe("siap");
  const run = await db.aiRun.findUniqueOrThrow({
    where: { id: r.runId },
    select: { outputJson: true, confidence: true, limitations: true },
  });
  const out = run.outputJson as { tanya?: Record<string, unknown> };
  return { ...out.tanya, _confidence: run.confidence, _limitations: run.limitations };
}

describe("payload FAKTA sampai ke model", () => {
  it("prompt memuat daftar fakta yang bisa disalin jadi claims", async () => {
    buatKeluaran = () => ({
      answer: "Belum ada angka.",
      answerParts: [],
      citations: [],
      confidence: 90,
      limitations: [],
    });
    await jalankan();
    const fakta = faktaDariPrompt(promptTerakhir);
    expect(fakta.length).toBeGreaterThan(0);
    // Metrik hitungan IKUT — jalur regex lama tidak pernah bisa memvalidasinya.
    expect(fakta.map((f) => f.metric)).toContain("realisasi");
    expect(fakta.map((f) => f.metric)).toContain("kendala_terbuka");
    expect(fakta.every((f) => f.periodKey === AKHIR)).toBe(true);
  });
});

describe("bagian yang klaimnya salah DIBUANG dari jawaban", () => {
  it("teks yang dibaca penanya hanya berisi bagian yang lolos", async () => {
    /*
     * Kalau `answer` dibiarkan apa adanya, membuang bagian tidak ada gunanya:
     * kalimat yang sama tetap terbaca penanya lewat `answer`.
     */
    buatKeluaran = (p) => {
      const f = faktaDariPrompt(p).find((x) => x.metric === "realisasi")!;
      return {
        answer: "BENAR. SALAH.",
        answerParts: [
          { text: "BENAR.", claims: [f] },
          // Nilai digeser jauh di luar toleransi — inilah yang harus dibuang.
          { text: "SALAH 99,9%.", claims: [{ ...f, value: f.value + 50 }] },
        ],
        citations: [{ sourceRefId: f.sourceRefId, note: null }],
        confidence: 90,
        limitations: [],
      };
    };
    const o = await jalankan();
    expect(o.answer).toBe("BENAR.");
    expect((o.answerParts as unknown[]).length).toBe(1);
    expect((o._limitations as string[]).some((l) => l.includes("dibuang"))).toBe(true);
  });
});

describe("keyakinan DETERMINISTIK, bukan pengakuan model", () => {
  it("model bilang 90, yang tersimpan porsi bagian yang selamat", async () => {
    buatKeluaran = (p) => {
      const f = faktaDariPrompt(p).find((x) => x.metric === "realisasi")!;
      return {
        answer: "a b",
        answerParts: [
          { text: "Bagian benar.", claims: [f] },
          { text: "Bagian salah 99,9%.", claims: [{ ...f, value: f.value + 50 }] },
        ],
        citations: [],
        confidence: 90,
        limitations: [],
      };
    };
    const o = await jalankan();
    expect(o._confidence).toBe(50);
    expect(o.confidence).toBe(50);
  });

  it("NOL bila tidak ada klaim yang cocok — walau model bilang 95", async () => {
    // Syarat keras brief butir 26.
    buatKeluaran = (p) => {
      const f = faktaDariPrompt(p).find((x) => x.metric === "realisasi")!;
      return {
        answer: "Realisasi 99,9%.",
        answerParts: [{ text: "Realisasi 99,9%.", claims: [{ ...f, value: f.value + 50 }] }],
        citations: [],
        confidence: 95,
        limitations: [],
      };
    };
    const o = await jalankan();
    expect(o._confidence).toBe(0);
    // Jawaban kosong TIDAK dikirim sebagai jawaban kosong — dikatakan apa adanya.
    expect(o.answer).toContain("tidak punya angka bersumber");
  });

  it("periode yang meleset ditolak walau nilainya benar", async () => {
    // Angka hari ini tidak boleh memvalidasi klaim tentang tanggal lain.
    buatKeluaran = (p) => {
      const f = faktaDariPrompt(p).find((x) => x.metric === "realisasi")!;
      return {
        answer: "x",
        answerParts: [{ text: "Realisasi 10,0% pada 1 Juni.", claims: [{ ...f, periodKey: "2026-06-01" }] }],
        citations: [],
        confidence: 88,
        limitations: [],
      };
    };
    const o = await jalankan();
    expect(o._confidence).toBe(0);
  });
});

describe("sumber ikut tersimpan supaya sitasi bisa dibaca", () => {
  it("snapshot resmi memuat sourceRefs berlabel dan bertautan", async () => {
    /*
     * Tanpa ini sitasi hanya bisa ditampilkan sebagai id mentah
     * ("bulusan:progress") — tidak memberi tahu angka apa yang dirujuk, dan
     * tidak bisa diklik untuk memeriksanya.
     */
    buatKeluaran = () => ({
      answer: "Tidak ada angka.",
      answerParts: [],
      citations: [],
      confidence: 10,
      limitations: [],
    });
    const r = await executeAiRun(user, {
      kind: "tanya",
      locationIds: [locId],
      startKey: MULAI,
      endKey: AKHIR,
      question: "Sumbernya apa saja?",
    });
    const run = await db.aiRun.findUniqueOrThrow({
      where: { id: r.runId },
      select: { outputJson: true },
    });
    const refs =
      (run.outputJson as { official?: { sourceRefs?: { id: string; label: string; href?: string }[] } })
        .official?.sourceRefs ?? [];
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((x) => !!x.label)).toBe(true);
    expect(refs.some((x) => !!x.href)).toBe(true);
  });
});
