// DRAF ANALISA AI UNTUK ITEM TANPA ANALISA (DECISIONS baru 2026-10-07).
//
// Permintaan user: *"aku ingin ada integrasi dengan AI atas item-item yang belum
// terpetakan ahsp sistem kita ataupun analisa bahan dan upah dari sumber impor
// data, jadi tujuan utama sistem ini bisa memberikan analisa kebutuhan dan
// breakdown real cost"*. Syarat DECISIONS 326 yang dijaga di sini:
//   1. hanya item yang TIDAK punya analisa dari mana pun yang dimintakan –
//      urut nilai RAB terbesar;
//   2. jawaban AI menjadi DRAF; RAPL tidak berubah sebelum diterima orang;
//   3. sesudah diterima, item dihitung dengan sumber "ai" – terpisah dari
//      kontrak dan AHSP – dan harga lokasi ikut terpakai;
//   4. tolak dan cabut dicatat; item yang dicabut kembali tanpa analisa;
//   5. peran tanpa `rapl.manage` tidak bisa meminta, tanpa `ai.generate`
//      tidak bisa menerima.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Prompt yang terkirim – untuk memastikan konteks lokasi ikut. */
const promptTerkirim: string[] = [];
vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async (_schema: unknown, req: { prompt: string }) => {
    promptTerkirim.push(req.prompt);
    return {
      ok: true,
      attempts: 1,
      meta: { ok: true, model: "uji-model" },
      data: {
        items: [
          {
            id: "r1",
            keyakinan: "sedang",
            alasan: "Pasangan batu kali 1:4 setara SNI",
            komponen: [
              { kategori: "bahan", nama: "Batu kali", satuan: "m3", koefisien: 1.2 },
              { kategori: "bahan", nama: "Semen PC", satuan: "kg", koefisien: 163 },
              { kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 1.5 },
            ],
          },
          {
            id: "r2",
            keyakinan: "rendah",
            alasan: "Mobilisasi alat ringan",
            komponen: [{ kategori: "alat", nama: "Truk 6 ton", satuan: "rit", koefisien: 4 }],
          },
        ],
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
const { mintaAnalisaAiAction, terimaAnalisaAiAction, tolakAnalisaAiAction, cabutAnalisaAiAction } = await import(
  "@/lib/ahsp/analisa-ai-actions"
);
const { keadaanItemRapl, itemUntukRapl } = await import("@/lib/ahsp/rapl");
const { keadaanAnalisaAi } = await import("@/lib/ahsp/analisa-ai-keadaan");

const suffix = `aa${Date.now().toString(36)}`;
let orgId = "";
let adminId = "";
let lokasiId = "";
const slug = `aa-${suffix}`;

const item = (lk: string, code: string, name: string, unit: string, volume: number, unitPrice: number, sortOrder: number) => ({
  kind: "item" as const,
  code,
  name,
  volume,
  unit,
  unitPrice,
  amount: BigInt(Math.round(volume * unitPrice)),
  lineageKey: lk,
  parentLineageKey: "I",
  sortOrder,
  excelRow: null,
});

async function tungguSelesai() {
  for (let i = 0; i < 100; i++) {
    const run = await db.raplAnalisaAiRun.findFirst({ where: { locationId: lokasiId }, orderBy: { createdAt: "desc" } });
    if (run && run.pendingSince === null) return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("run tidak selesai");
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org AA ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  adminId = (
    await db.user.create({ data: { orgId, username: `aa-${suffix}`, fullName: "Admin AA", passwordHash: "x", role: "super_admin" } })
  ).id;
  sesi = { id: adminId, orgId, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId, name: `Paket AA ${suffix}`, stage: "pelaksanaan" } });
  lokasiId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Lokasi AA", slug, village: "V", regency: "Rembang", province: "Jawa Tengah", status: "berjalan" },
    })
  ).id;
  const nodes = [
    { kind: "kategori" as const, code: "I", name: "Pekerjaan Persiapan", volume: null, unit: null, unitPrice: null, amount: 18_000_000n, lineageKey: "I", parentLineageKey: null, sortOrder: 0, excelRow: null },
    item("I#1", "1", "Pasangan batu kali 1:4", "m3", 10, 900_000, 1),
    item("I#2", "2", "Mobilisasi dan demobilisasi", "Ls", 1, 5_000_000, 2),
    item("I#3", "3", "Plesteran 1:4", "m2", 50, 80_000, 3),
  ];
  const r = await createRevisionFromNodes(lokasiId, nodes, { source: "hps_awal", userId: adminId, note: "uji" });
  await activateRevision(r.revisionId, adminId);
  // Harga lokasi untuk satu komponen – harus ikut terpakai setelah diterima.
  await db.hargaSatuanDasar.create({
    data: { locationId: lokasiId, kategori: "bahan", nama: "Semen PC", satuan: "kg", harga: 1_500n, sumber: "Input manual", updatedById: adminId },
  });
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("draf analisa AI", () => {
  it("peran tanpa rapl.manage tidak bisa meminta", async () => {
    const u = await db.user.create({ data: { orgId, username: `ev-${suffix}`, fullName: "Eksekutif", passwordHash: "x", role: "exec_viewer" } });
    sesi = { id: u.id, orgId, role: "exec_viewer" };
    try {
      const r = await mintaAnalisaAiAction({ locationId: lokasiId, slug });
      expect(r.ok).toBe(false);
    } finally {
      sesi = { id: adminId, orgId, role: "super_admin" };
    }
  });

  it("meminta: item tanpa analisa, urut nilai terbesar; hasilnya DRAF, RAPL belum berubah", async () => {
    const r = await mintaAnalisaAiAction({ locationId: lokasiId, slug });
    expect(r).toMatchObject({ ok: true, diminta: 3, totalTanpa: 3 });
    await tungguSelesai();
    expect(promptTerkirim.at(-1)).toContain("Rembang");
    expect(promptTerkirim.at(-1)).toContain("bahan|Semen PC|kg|1500");
    // r1 = nilai terbesar (Pasangan batu, Rp9 jt), r2 = mobilisasi (Rp5 jt).
    const draf = await db.raplAnalisaAi.findMany({ where: { locationId: lokasiId, status: "draf" }, include: { komponen: true } });
    expect(draf.map((d) => d.lineageKey).sort()).toEqual(["I#1", "I#2"]);
    const items = await itemUntukRapl(lokasiId);
    expect(items.every((i) => i.analisa === null)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "rapl.analisa_ai.minta", resourceId: lokasiId } })).toBe(1);

    const k = await keadaanAnalisaAi(lokasiId);
    const batu = k.draf.find((d) => d.lineageKey === "I#1")!;
    // Semen 163 kg × 10 m³ × Rp1.500 – dihitung rapl-calc, komponen lain belum berharga.
    expect(batu.biaya).toBe(2_445_000n);
    expect(batu.komponenBelumBerharga).toBe(2);
  });

  it("menerima menuntut ai.generate; sesudah diterima RAPL memakai sumber 'ai'", async () => {
    const draf = await db.raplAnalisaAi.findFirstOrThrow({ where: { locationId: lokasiId, lineageKey: "I#1", status: "draf" } });
    const fs = await db.user.create({ data: { orgId, username: `fs-${suffix}`, fullName: "Pengawas", passwordHash: "x", role: "field_supervisor" } });
    sesi = { id: fs.id, orgId, role: "field_supervisor" };
    try {
      expect((await terimaAnalisaAiAction({ locationId: lokasiId, slug, ids: [draf.id] })).ok).toBe(false);
    } finally {
      sesi = { id: adminId, orgId, role: "super_admin" };
    }
    const r = await terimaAnalisaAiAction({ locationId: lokasiId, slug, ids: [draf.id] });
    expect(r).toEqual({ ok: true, diterima: 1 });
    const per = await keadaanItemRapl(lokasiId);
    const batu = per.item.find((i) => i.lineageKey === "I#1")!;
    expect(batu.sumberAnalisa).toBe("ai");
    expect(batu.komponen.find((c) => c.nama === "Semen PC")).toMatchObject({ jumlah: 1630, harga: 1_500n, biaya: 2_445_000n });
    expect(per.item.find((i) => i.lineageKey === "I#2")!.sumberAnalisa).toBeNull();
  });

  it("tolak dicatat; cabut mengembalikan item tanpa analisa", async () => {
    const mob = await db.raplAnalisaAi.findFirstOrThrow({ where: { locationId: lokasiId, lineageKey: "I#2", status: "draf" } });
    expect(await tolakAnalisaAiAction({ locationId: lokasiId, slug, ids: [mob.id] })).toEqual({ ok: true, ditolak: 1 });
    expect((await db.raplAnalisaAi.findUniqueOrThrow({ where: { id: mob.id } })).status).toBe("ditolak");

    const batu = await db.raplAnalisaAi.findFirstOrThrow({ where: { locationId: lokasiId, lineageKey: "I#1", status: "diterima" } });
    expect(await cabutAnalisaAiAction({ locationId: lokasiId, slug, ids: [batu.id] })).toEqual({ ok: true, dicabut: 1 });
    const items = await itemUntukRapl(lokasiId);
    expect(items.find((i) => i.lineageKey === "I#1")!.analisa).toBeNull();
    expect(await db.auditLog.count({ where: { resourceId: lokasiId, action: { in: ["rapl.analisa_ai.tolak", "rapl.analisa_ai.cabut"] } } })).toBe(2);
  });
});
