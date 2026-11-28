// RINCIAN PER URAIAN UNTUK RAB APA PUN (DECISIONS 807).
//
// Teguran user 2026-11-28: *"lalu bagaimana jika ada item yang berbeda, kamu
// ini aku minta untuk breakdown berbagai rab, kenapa jadi template!"*. Templat
// prototipe dicabut. Yang dijaga di sini:
//  1. item tanpa analisa kontrak/AHSP/AI = BELUM TERURAI, tidak ditebak templat;
//  2. "Urai semua item" meminta AI untuk SETIAP uraian (uraian kembar cukup
//     sekali), berputar sampai habis;
//  3. "Terima semua" sekali klik; item beruraian sama ikut memakai analisanya;
//  4. lokasi lain dengan uraian yang sama memakainya tanpa meminta lagi, asal
//     disebut; hanya uraian yang benar-benar baru yang dimintakan;
//  5. nama sumber daya yang sudah diterima di organisasi dikirim ke AI supaya
//     nama komponen seragam lintas RAB;
//  6. pelaksana tidak bisa menerima.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Tiap panggilan AI: uraian yang diminta dan prompt lengkapnya. */
const panggilan: { uraian: string[]; prompt: string }[] = [];
vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async (_s: unknown, req: { prompt: string }) => {
    const baris = req.prompt.split("\n");
    const daftar = JSON.parse(baris[baris.indexOf("ITEM:") + 1]!) as { id: string; uraian: string }[];
    panggilan.push({ uraian: daftar.map((d) => d.uraian), prompt: req.prompt });
    return {
      ok: true,
      attempts: 1,
      meta: { ok: true, model: "uji-model" },
      data: {
        items: daftar.map((d) => ({
          id: d.id,
          keyakinan: "sedang",
          alasan: `analisa ${d.uraian}`,
          komponen: [
            { kategori: "bahan", nama: "Semen PC 50 kg", satuan: "zak", koefisien: 2 },
            { kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 1 },
          ],
        })),
      },
    };
  },
}));
vi.mock("@/lib/ai-hub/guard", async (asli) => ({
  ...(await asli<typeof import("@/lib/ai-hub/guard")>()),
  checkAiGuard: async () => ({}),
}));

let sesi: { id: string; orgId: string; role: string };
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  return {
    ...asli,
    requireUser: async () => sesi,
    requireCapability: async (cap: string) => {
      if (!can(sesi.role as never, cap as never)) throw new asli.ForbiddenError(`Tanpa izin: ${cap}`);
      return sesi;
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { mintaAnalisaAiAction, terimaSemuaAnalisaAiAction } = await import("@/lib/ahsp/analisa-ai-actions");
const { itemUntukRapl, keadaanItemRapl } = await import("@/lib/ahsp/rapl");
const { keadaanAnalisaAi } = await import("@/lib/ahsp/analisa-ai-keadaan");

const sfx = `au${Date.now().toString(36)}`;
let orgId = "";
let adminId = "";
let paketId = "";
const A = { id: "", slug: "" };
const B = { id: "", slug: "" };

const item = (lk: string, name: string, unit: string, volume: number, unitPrice: number, sortOrder: number) => ({
  kind: "item" as const, code: lk.split("#")[1]!, name, volume, unit, unitPrice, amount: BigInt(Math.round(volume * unitPrice)),
  lineageKey: lk, parentLineageKey: "I", sortOrder, excelRow: null,
});

async function buatLokasi(nama: string, nodes: ReturnType<typeof item>[]) {
  const slug = `${nama.toLowerCase()}-${sfx}`;
  const id = (
    await db.location.create({ data: { packageId: paketId, name: nama, slug, village: "V", regency: "Demak", province: "Jawa Tengah", status: "berjalan" } })
  ).id;
  const r = await createRevisionFromNodes(
    id,
    [
      { kind: "kategori" as const, code: "I", name: "PEKERJAAN", volume: null, unit: null, unitPrice: null, amount: 0n, lineageKey: "I", parentLineageKey: null, sortOrder: 0, excelRow: null },
      ...nodes,
    ],
    { source: "hps_awal", userId: adminId, note: "uji" },
  );
  await activateRevision(r.revisionId, adminId);
  return { id, slug };
}

async function tungguSelesai(locationId: string) {
  for (let i = 0; i < 200; i++) {
    const run = await db.raplAnalisaAiRun.findFirst({ where: { locationId }, orderBy: { createdAt: "desc" } });
    if (run && run.pendingSince === null) return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("run tidak selesai");
}

/** 14 uraian unik + 1 uraian kembar (Pasangan batu kali muncul dua kali). */
const UNIK = [
  "Galian tanah pondasi", "Urugan pasir bawah pondasi", "Pasangan batu kali 1:4", "Plesteran 1:4", "Acian semen",
  "Beton fc' 25 MPa kolom 20/20", "Bekisting kolom", "Pembesian D13", "Pasangan bata merah 1:4", "Rangka atap baja ringan",
  "Penutup atap spandek 0,35 mm", "Pengecatan dinding tembok", "Pintu panel kayu meranti", "Keramik lantai 40x40",
];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${sfx}`, slug: `o-${sfx}` } });
  orgId = org.id;
  adminId = (await db.user.create({ data: { orgId, username: `au-${sfx}`, fullName: "Admin", passwordHash: "x", role: "super_admin" } })).id;
  sesi = { id: adminId, orgId, role: "super_admin" };
  paketId = (await db.package.create({ data: { orgId, name: `Paket ${sfx}`, stage: "pelaksanaan" } })).id;
  Object.assign(
    A,
    await buatLokasi("Alfa", [
      ...UNIK.map((u, i) => item(`I#${i + 1}`, u, i === 2 ? "m3" : i === 3 ? "m2" : "m2", 10, 100_000 + i * 1_000, i + 1)),
      // Uraian KEMBAR di RAB yang sama: tidak boleh dimintakan dua kali.
      item("I#99", "Pasangan  batu kali 1:4", "m3", 5, 100_000, 99),
    ]),
  );
  Object.assign(
    B,
    await buatLokasi("Beta", [
      item("I#1", "Pasangan batu kali 1:4", "m3", 7, 120_000, 1),
      item("I#2", "Plesteran 1:4", "m2", 30, 90_000, 2),
      item("I#3", "Pagar kawat duri 4 lapis", "m'", 50, 75_000, 3),
    ]),
  );
}, 120_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
});

describe("rincian per uraian untuk RAB apa pun", () => {
  it("tanpa analisa kontrak/AHSP/AI: belum terurai – tidak ditebak templat", async () => {
    const items = await itemUntukRapl(A.id);
    expect(items).toHaveLength(15);
    expect(items.every((i) => i.analisa === null)).toBe(true);
    const k = await keadaanAnalisaAi(A.id);
    expect(k).toMatchObject({ jumlahTanpa: 14, itemTanpa: 15 });
  });

  it("urai semua: setiap uraian sekali, berputar 12 sekali jalan sampai habis", async () => {
    const r = await mintaAnalisaAiAction({ locationId: A.id, slug: A.slug });
    expect(r).toMatchObject({ ok: true, diminta: 14, totalTanpa: 14 });
    const run = await tungguSelesai(A.id);
    expect(run).toMatchObject({ status: "selesai", errorMessage: null, diminta: 14 });
    expect(panggilan).toHaveLength(2);
    const diminta = panggilan.flatMap((p) => p.uraian);
    expect(new Set(diminta).size).toBe(14);
    expect(diminta.filter((u) => /pasangan\s+batu kali/i.test(u))).toHaveLength(1);
    const draf = await db.raplAnalisaAi.findMany({ where: { locationId: A.id, status: "draf" } });
    expect(draf).toHaveLength(14);
    expect(draf.every((d) => d.tanda)).toBe(true);
  });

  it("pelaksana tidak bisa menerima; terima semua: semua item – termasuk yang kembar – memakai analisanya", async () => {
    sesi = { ...sesi, role: "field_supervisor" };
    expect((await terimaSemuaAnalisaAiAction({ locationId: A.id, slug: A.slug })).ok).toBe(false);
    sesi = { ...sesi, role: "super_admin" };

    expect(await terimaSemuaAnalisaAiAction({ locationId: A.id, slug: A.slug })).toEqual({ ok: true, diterima: 14 });
    const items = await itemUntukRapl(A.id);
    expect(items.every((i) => i.analisa?.sumber === "ai")).toBe(true);
    expect(items.find((i) => i.lineageKey === "I#99")!.analisa).toMatchObject({ sumber: "ai" });
    expect(items.find((i) => i.lineageKey === "I#99")!.analisa?.dariLokasi).toBeUndefined();
    const per = await keadaanItemRapl(A.id);
    // 5 m³ × 2 zak – kebutuhan item kembar dari analisa uraian yang sama.
    expect(per.item.find((i) => i.lineageKey === "I#99")!.komponen.find((c) => c.nama === "Semen PC 50 kg")!.jumlah).toBe(10);
  });

  it("lokasi lain: uraian yang sama dipakai ulang dengan asal disebut; hanya uraian baru yang dimintakan, dengan nama sumber daya organisasi", async () => {
    const items = await itemUntukRapl(B.id);
    expect(items.find((i) => i.lineageKey === "I#1")!.analisa).toMatchObject({ sumber: "ai", dariLokasi: "Alfa" });
    expect(items.find((i) => i.lineageKey === "I#2")!.analisa).toMatchObject({ sumber: "ai", dariLokasi: "Alfa" });
    expect(items.find((i) => i.lineageKey === "I#3")!.analisa).toBeNull();
    expect(await keadaanAnalisaAi(B.id)).toMatchObject({ jumlahTanpa: 1, itemTanpa: 1 });

    const sebelum = panggilan.length;
    expect((await mintaAnalisaAiAction({ locationId: B.id, slug: B.slug })).ok).toBe(true);
    await tungguSelesai(B.id);
    expect(panggilan).toHaveLength(sebelum + 1);
    expect(panggilan.at(-1)!.uraian).toEqual(["Pagar kawat duri 4 lapis"]);
    expect(panggilan.at(-1)!.prompt).toContain("bahan|Semen PC 50 kg|zak|");
    expect(panggilan.at(-1)!.prompt).toContain("upah|Pekerja|OH|");
  });
});
