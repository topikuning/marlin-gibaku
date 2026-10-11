/*
 * ANALISA AI URUTAN RAB AKTIF (DECISIONS 667) – jalur penuh dengan basis data
 * sungguhan; hanya provider AI yang ditiru.
 *
 * Yang dibuktikan: aktivasi RAB langsung mengantrekan analisa dan
 * mendorongnya ke latar; tiap bangunan disimpan begitu jadi; bangunan yang
 * gagal dilanjutkan cron tanpa mengulang yang sudah selesai; seluruhnya
 * tercatat sebagai SATU AiRun; dan saran rencana mingguan memakai hasilnya.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Pekerjaan yang didorong `after()` – dijalankan uji sendiri. */
const latar: (() => Promise<unknown>)[] = [];
vi.mock("next/server", async (asli) => ({
  ...(await asli<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown>) => {
    latar.push(fn);
  },
}));

vi.mock("@/lib/ai/config", async (asli) => ({
  ...(await asli<typeof import("@/lib/ai/config")>()),
  getActiveAiConfig: async () => ({ id: "anthropic", model: "uji", apiKey: "x" }),
}));

const prompts: string[] = [];
/** Bangunan yang jawabannya gagal sekali (meniru provider yang sedang sibuk). */
const gagalSekali = new Set<string>(["BANGUNAN GENSET"]);
vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async (_schema: unknown, opts: { prompt: string }) => {
    prompts.push(opts.prompt);
    const meta = {
      ok: true,
      provider: "anthropic",
      model: "model-uji",
      text: "",
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 1,
      finishReason: null,
    };
    for (const g of gagalSekali) {
      if (opts.prompt.includes(g)) {
        gagalSekali.delete(g);
        return {
          ok: false,
          errorCode: "overloaded",
          error: "HTTP 529 – sedang sibuk",
          meta: { ok: false, provider: "anthropic", model: "model-uji", errorCode: "overloaded", error: "sibuk", latencyMs: 1 },
          attempts: 1,
        };
      }
    }
    // Jawab setiap kunci yang ada di daftar yang dianalisa, plus satu kunci karangan.
    const kunci = [...opts.prompt.matchAll(/^([A-Z]+#[^ |]+) \|/gm)].map((m) => m[1]);
    return {
      ok: true,
      data: {
        catatan: "Pondasi dulu, lalu struktur atas.",
        item: [
          ...kunci.map((k, i) => ({
            kunci: k,
            mulai: i * 0.3,
            selesai: i * 0.3 + 0.4,
            prasyarat: i > 0 ? [kunci[i - 1]] : [],
            kritis: i === 0,
            cuaca: false,
            alasan: `urutan ke-${i + 1}`,
          })),
          { kunci: "KARANGAN#1", mulai: 0, selesai: 1, prasyarat: [], kritis: false, cuaca: false, alasan: "" },
        ],
      },
      meta,
      attempts: 1,
    };
  },
}));

let sesi: { id: string; orgId: string; role: string };
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => sesi,
    requireCapability: async () => sesi,
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { activateRevision } = await import("@/lib/rab/import");
const { bacaJadwalAi, jemputJadwalAi } = await import("@/lib/plan/jadwal-ai");
const { suggestWeeklyPlan } = await import("@/lib/plan/suggest");
const { applyWeeklySuggestions } = await import("@/app/(app)/lokasi/[slug]/rab/actions");

const suffix = `ja${Date.now().toString(36)}`;
let userId = "";
let locationId = "";
let revisionId = "";
let orgId = "";
let packageId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  userId = (
    await db.user.create({
      data: { orgId: org.id, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
      select: { id: true },
    })
  ).id;
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" },
    select: { id: true },
  });
  packageId = pkg.id;
  locationId = (
    await db.location.create({
      data: {
        packageId: pkg.id, name: "Kedung Uji", slug: `lokasi-ja-${suffix}`,
        village: "V", regency: "Jepara", province: "Jawa Tengah", status: "berjalan", isActive: true,
      },
      select: { id: true },
    })
  ).id;
  revisionId = (
    await db.rabRevision.create({
      data: { locationId, revisionNo: 1, source: "hps_awal", status: "draft", totalValue: 3_000_000n },
      select: { id: true },
    })
  ).id;
  let urut = 0;
  const node = (data: Record<string, unknown>) =>
    db.rabNode.create({ data: { revisionId, sortOrder: ++urut, ...data } as never, select: { id: true } });
  const balai = await node({ kind: "kategori", code: "II", name: "PEKERJAAN BALAI NELAYAN", amount: 2_000_000n, lineageKey: "II" });
  const str = await node({ parentId: balai.id, kind: "grup", code: "A", name: "STRUKTUR", amount: 2_000_000n, lineageKey: "II#A" });
  for (const [i, nama] of ["Pembesian plat lantai", "Pengecoran plat lantai"].entries()) {
    await node({
      parentId: str.id, kind: "item", code: String(i + 1), name: nama, volume: 10, unit: "m3",
      unitPrice: 100_000, amount: 1_000_000n, lineageKey: `II#A#${i + 1}`,
    });
  }
  const genset = await node({ kind: "kategori", code: "III", name: "PEKERJAAN BANGUNAN GENSET", amount: 1_000_000n, lineageKey: "III" });
  await node({
    parentId: genset.id, kind: "item", code: "1", name: "Pondasi genset", volume: 5, unit: "m3",
    unitPrice: 200_000, amount: 1_000_000n, lineageKey: "III#1",
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("analisa AI urutan RAB", () => {
  it("aktivasi RAB langsung mengantrekan analisa per bangunan dan mendorongnya ke latar", async () => {
    await activateRevision(revisionId, userId);
    const a = await db.rabJadwalAi.findUniqueOrThrow({
      where: { revisionId },
      include: { kelompok: { orderBy: { kategoriKey: "asc" } } },
    });
    expect(a).toMatchObject({ status: "antre", locationId, dimintaOlehId: userId });
    expect(a.kelompok.map((k) => [k.kategoriKey, k.nama, k.status])).toEqual([
      ["II", "PEKERJAAN BALAI NELAYAN", "antre"],
      ["III", "PEKERJAAN BANGUNAN GENSET", "antre"],
    ]);
    expect(latar).toHaveLength(1);
  });

  it("pekerja latar: bangunan yang jadi disimpan, yang gagal menunggu giliran berikutnya", async () => {
    await latar.shift()!();
    const a = await db.rabJadwalAi.findUniqueOrThrow({ where: { revisionId }, include: { kelompok: true } });
    expect(a.status).toBe("jalan");
    expect(a.pendingSince).toBeNull();
    const k = Object.fromEntries(a.kelompok.map((x) => [x.kategoriKey, x]));
    expect(k.II).toMatchObject({ status: "selesai", percobaan: 1 });
    expect(k.III).toMatchObject({ status: "antre", percobaan: 1, galat: "HTTP 529 – sedang sibuk" });
    // Isi yang dikirim: kunci, uraian, jalur, volume – dan pagar anti-karang.
    const p = prompts.find((x) => x.includes("BALAI"))!;
    expect(p).toContain("II#A#1 | 1 | Pembesian plat lantai | STRUKTUR | 10 m3");
    expect(p).toContain("Jepara, Jawa Tengah");
    expect(p).toContain("JANGAN MENGARANG");
  });

  it("cron melanjutkan tanpa mengulang bangunan yang sudah selesai; satu AiRun untuk seluruh analisa", async () => {
    const sebelum = prompts.length;
    const h = await jemputJadwalAi({ batasMs: 600_000 });
    expect(h.analisa).toBe(1);
    expect(prompts.slice(sebelum).map((x) => x.includes("GENSET"))).toEqual([true]);

    const a = await db.rabJadwalAi.findUniqueOrThrow({ where: { revisionId } });
    expect(a).toMatchObject({ status: "selesai", provider: "anthropic", model: "model-uji", galat: null });
    expect(a.selesaiAt).not.toBeNull();
    const run = await db.aiRun.findUniqueOrThrow({ where: { id: a.runId! } });
    expect(run).toMatchObject({
      runKind: "jadwal_rab",
      status: "siap",
      userId,
      scopeType: "location",
      waChatId: `jadwal-rab:${locationId}`,
    });
    // Dua jawaban yang jadi; yang gagal tidak membawa hitungan token.
    expect(run.inputTokens).toBe(200);
    expect(await db.aiRun.count({ where: { runKind: "jadwal_rab", scopeIds: { equals: [locationId] } } })).toBe(1);
  });

  it("hasil dibaca per pekerjaan: kunci karangan tidak ikut, prasyarat tersimpan", async () => {
    const j = (await bacaJadwalAi(revisionId))!;
    expect([...j.peta.keys()].sort()).toEqual(["II#A#1", "II#A#2", "III#1"]);
    expect(j.peta.get("II#A#2")).toMatchObject({ prasyarat: ["II#A#1"], alasan: "urutan ke-2" });
    expect(j.ringkas).toMatchObject({ status: "selesai", bangunan: { total: 2, selesai: 2, gagal: 0 } });
    expect(j.ringkas.catatan.map((c) => c.nama)).toEqual(["PEKERJAAN BALAI NELAYAN", "PEKERJAAN BANGUNAN GENSET"]);
  });

  it("saran rencana mingguan memakai urutan AI dan menahan cor sampai besinya ≥ 80%", async () => {
    const res = (await suggestWeeklyPlan(locationId, 22))!;
    expect(res.jadwalAi).toMatchObject({ status: "selesai", pekerjaan: 3 });
    const kode = res.suggestions.map((s) => `${s.categoryName}|${s.name}`);
    expect(kode).toContain("PEKERJAAN BALAI NELAYAN|Pembesian plat lantai");
    expect(kode).not.toContain("PEKERJAAN BALAI NELAYAN|Pengecoran plat lantai");
    const besi = res.suggestions.find((s) => s.name === "Pembesian plat lantai")!;
    expect(besi).toMatchObject({ sumberUrutan: "ai", alasanAi: "urutan ke-1", kritis: true });
  });

  it("sebelum SPMK: rencana 0%, bukan titik terakhir kurva (dulu 100% dan deviasi −100%)", async () => {
    await db.baseline.create({
      data: {
        locationId, baselineNo: 1, source: "auto", contractDays: 154,
        points: { create: [1, 2, 3].map((w) => ({ weekNumber: w, plannedPct: w === 3 ? 100 : w * 20 })) },
      },
    });
    const res = (await suggestWeeklyPlan(locationId, 2))!;
    expect(res).toMatchObject({ currentWeek: 0, planPct: 0, targetPct: 40, deviationPct: 0, behind: false });
    // Belum ada yang jatuh tempo, jadi tidak ada yang disebut tertinggal.
    expect(res.suggestions.every((s) => s.catchUpVolume === 0 && !/Tertinggal/.test(s.reason))).toBe(true);
  });

  it("terapkan saran: hanya baris yang dicentang yang masuk rencana", async () => {
    sesi = { id: userId, orgId, role: "super_admin" };
    const vendor = await db.vendor.create({ data: { orgId, name: `Vendor ${suffix}` } });
    await db.contract.create({
      data: {
        packageId, vendorId: vendor.id, contractNumber: `K-${suffix}`, contractValue: 3_300_000n,
        signedDate: new Date("2026-09-01T00:00:00Z"), startDate: new Date(Date.now() - 14 * 86_400_000),
        durationDays: 154,
      },
    });
    const saran = (await suggestWeeklyPlan(locationId, 22))!.suggestions;
    expect(saran.length).toBeGreaterThanOrEqual(2);
    const kirim = (pilih: string[]) => {
      const f = new FormData();
      f.set("locationId", locationId);
      f.set("weekNumber", "22");
      f.set("pilihDikirim", "1");
      for (const p of pilih) f.append("pilih", p);
      return applyWeeklySuggestions(undefined, f);
    };
    expect(await kirim([])).toEqual({ error: "Centang minimal satu saran yang mau diterapkan." });
    const r = await kirim([saran[1].rabNodeId]);
    expect(r?.success).toMatch(/^1 pekerjaan/);
    const items = await db.weeklyPlanItem.findMany({ where: { plan: { locationId, weekNumber: 22 } } });
    expect(items.map((i) => i.rabNodeId)).toEqual([saran[1].rabNodeId]);
  });

  it("revisi yang dihapus membawa analisanya", async () => {
    const ada = await db.rabJadwalAi.count({ where: { revisionId } });
    expect(ada).toBe(1);
    await db.weeklyPlanItem.deleteMany({ where: { plan: { locationId } } });
    await db.rabNode.deleteMany({ where: { revisionId } });
    await db.rabRevision.delete({ where: { id: revisionId } });
    expect(await db.rabJadwalAi.count({ where: { revisionId } })).toBe(0);
    expect(await db.rabJadwalAiKelompok.count({ where: { analisa: { revisionId } } })).toBe(0);
  });
});
