// KATALOG HARGA WILAYAH – alur lengkap (DECISIONS 806).
//
// Perintah user 2026-11-28: *"rancang matang sistem ini, buat dia mencari
// online atau sambungkan dengan ai untuk handle ini semua"*. Yang dijaga:
//  1. lokasi pertama di satu kabupaten MERISET (web), hasilnya disimpan ke
//     katalog; sumber karangan AI dibuang; harga tanpa sumber sah = estimasi;
//  2. lokasi kedua sekabupaten TIDAK meriset ulang – usulan dari katalog;
//     harga yang diisi orang di lokasi sekabupaten didahulukan;
//  3. memakai usulan menulis asal harga dan alamat sumbernya ke HSD, dan
//     harga hasil usulan tidak pernah kembali sebagai "harga lapangan";
//  4. web dimatikan / provider bukan Claude → estimasi AI, ditandai;
//  5. katalog lebih tua dari 90 hari diriset ulang;
//  6. satu paket sekali klik; pelaksana ditolak.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { normalUrl } from "@/lib/harga-wilayah/aturan";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let pakaiClaude = true;
const CFG = { id: "claude", apiStyle: "anthropic", jalurPdf: "anthropic_document", baseUrl: "https://api.uji", tokenParam: "max_tokens", model: "claude-opus-5", apiKey: "k" };
vi.mock("@/lib/ai/config", async (asli) => ({
  ...(await asli<typeof import("@/lib/ai/config")>()),
  getActiveAiConfig: async () => (pakaiClaude ? CFG : null),
}));

/** Riset web palsu: id genap bersumber sah (+1 karangan), id ganjil hanya karangan. */
let modeWeb: "jalan" | "mati" = "jalan";
const panggilanWeb: { lokasi: { provinsi: string; kabupaten: string }; nama: string[] }[] = [];
const SAH = "https://demakkab.go.id/ssh-2026";
vi.mock("@/lib/harga-wilayah/web", () => ({
  risetWeb: async (_cfg: unknown, req: { prompt: string; lokasi: { provinsi: string; kabupaten: string } }) => {
    const daftar = JSON.parse(req.prompt.split("\n").at(-1)!) as { id: string; nama: string }[];
    panggilanWeb.push({ lokasi: req.lokasi, nama: daftar.map((d) => d.nama) });
    if (modeWeb === "mati") return { ok: false, kode: "web_tidak_aktif", error: "HTTP 400 – web search is not enabled" };
    const harga = daftar.map((d, i) => ({
      id: d.id,
      harga: 10_000 * (i + 1),
      min: 9_000 * (i + 1),
      maks: 11_000 * (i + 1),
      keyakinan: "tinggi",
      alasan: `harga ${d.nama} di wilayah ini`,
      sumber: i % 2 === 0 ? [{ url: `${SAH}/?utm_source=ai`, judul: "SSH" }, { url: "https://karangan.example/a" }] : [{ url: "https://karangan.example/b" }],
    }));
    return {
      ok: true,
      teks: JSON.stringify({ harga }),
      ditemukan: new Map([[normalUrl(SAH)!, { url: SAH, judul: "SSH Kabupaten 2026" }]]),
      kueri: ["harga material"],
      galat: [],
      stopReason: "end_turn",
      model: "claude-opus-5",
      pencarian: 3,
      inputTokens: 0,
      outputTokens: 0,
    };
  },
}));

/** Estimasi AI tanpa web (jalur cadangan). */
let panggilanEstimasi = 0;
vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async (_s: unknown, req: { prompt: string }) => {
    panggilanEstimasi++;
    const daftar = JSON.parse(req.prompt.split("\n").at(-1)!) as { id: string }[];
    return {
      ok: true,
      attempts: 1,
      meta: { ok: true, model: "uji-estimasi" },
      data: { suggestions: daftar.map((d) => ({ id: d.id, harga: 50_000, keyakinan: "tinggi", alasan: "estimasi uji" })) },
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
    accessibleLocationIds: async () => null,
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { mintaUsulanHargaAiAction, terapkanUsulanHargaAiAction } = await import("@/lib/ahsp/hsd-actions");
const { estimasiHargaPaketAction, risetUlangWilayahAction } = await import("@/lib/harga-wilayah/actions");
const { hargaLapangan } = await import("@/lib/harga-wilayah/katalog");
const { kunciSumberDaya } = await import("@/lib/ahsp/rapl-calc");

const sfx = `hw${Date.now().toString(36)}`;
let orgId = "";
let adminId = "";
let paketId = "";
const L: Record<"A" | "B" | "C", { id: string; slug: string }> = { A: { id: "", slug: "" }, B: { id: "", slug: "" }, C: { id: "", slug: "" } };
const SEMEN = { kategori: "bahan", nama: "Semen Portland komposit 50 kg", satuan: "zak" };

const item = (lk: string, code: string, name: string, unit: string, volume: number, unitPrice: number, sortOrder: number) => ({
  kind: "item" as const, code, name, volume, unit, unitPrice, amount: BigInt(Math.round(volume * unitPrice)),
  lineageKey: lk, parentLineageKey: "I", sortOrder, excelRow: null,
});

async function buatLokasi(nama: string, kabupaten: string) {
  const slug = `${nama.toLowerCase()}-${sfx}`;
  const id = (
    await db.location.create({ data: { packageId: paketId, name: nama, slug, village: `Desa ${nama}`, regency: kabupaten, province: "Jawa Tengah", status: "berjalan" } })
  ).id;
  const r = await createRevisionFromNodes(
    id,
    [
      { kind: "kategori" as const, code: "I", name: "PEKERJAAN", volume: null, unit: null, unitPrice: null, amount: 0n, lineageKey: "I", parentLineageKey: null, sortOrder: 0, excelRow: null },
      item("I#1", "1", "Beton fc' 20 MPa site mix", "m³", 10, 1_500_000, 1),
      item("I#2", "2", "Mesin pembuat es balok 5 ton", "unit", 1, 100_000_000, 2),
    ],
    { source: "hps_awal", userId: adminId, note: "uji" },
  );
  await activateRevision(r.revisionId, adminId);
  return { id, slug };
}

/**
 * Analisa yang sudah DITERIMA untuk satu uraian (DECISIONS 807): rincian kini
 * datang dari analisa kontrak/AHSP/AI, bukan templat. Diterima di satu lokasi,
 * dipakai ulang oleh uraian yang sama di lokasi lain organisasi.
 */
async function terimaAnalisa(
  locationId: string,
  lineageKey: string,
  uraian: string,
  satuan: string,
  komponen: { kategori: string; nama: string; satuan: string; koefisien: number }[],
) {
  const { tandaItem } = await import("@/lib/ahsp/cocok");
  const run = await db.raplAnalisaAiRun.create({ data: { locationId, status: "selesai", diminta: 1, totalTanpa: 1, requestedById: adminId } });
  await db.raplAnalisaAi.create({
    data: {
      runId: run.id,
      locationId,
      lineageKey,
      code: lineageKey,
      uraian,
      satuan,
      tanda: tandaItem(uraian, satuan),
      keyakinan: "sedang",
      alasan: "uji",
      status: "diterima",
      diputuskanOlehId: adminId,
      diputuskanAt: new Date(),
      komponen: { create: komponen.map((k, i) => ({ urutan: i + 1, ...k })) },
    },
  });
}

const BETON = [
  { kategori: "bahan", nama: "Semen Portland komposit 50 kg", satuan: "zak", koefisien: 7.68 },
  { kategori: "bahan", nama: "Pasir beton", satuan: "m3", koefisien: 0.5 },
  { kategori: "bahan", nama: "Kerikil beton", satuan: "m3", koefisien: 0.8 },
  { kategori: "bahan", nama: "Air kerja", satuan: "liter", koefisien: 215 },
  { kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 1.65 },
  { kategori: "upah", nama: "Tukang batu", satuan: "OH", koefisien: 0.25 },
  { kategori: "upah", nama: "Mandor", satuan: "OH", koefisien: 0.083 },
  { kategori: "alat", nama: "Molen beton 0,35 m3", satuan: "jam", koefisien: 0.25 },
];

async function tungguRun(locationId: string, sejak: Date) {
  for (let i = 0; i < 200; i++) {
    const run = await db.hsdUsulanRun.findFirst({ where: { locationId, createdAt: { gte: sejak } }, orderBy: { createdAt: "desc" } });
    if (run && run.pendingSince === null) return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("run tidak selesai");
}

async function estimasi(k: "A" | "B" | "C") {
  const t0 = new Date();
  const r = await mintaUsulanHargaAiAction({ locationId: L[k].id, slug: L[k].slug, dipilih: [] });
  expect(r.ok).toBe(true);
  return tungguRun(L[k].id, t0);
}

const draf = (runId: string) => db.hsdUsulanAi.findMany({ where: { runId, status: "draf" }, orderBy: { nama: "asc" } });

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${sfx}`, slug: `o-${sfx}` } });
  orgId = org.id;
  adminId = (await db.user.create({ data: { orgId, username: `hw-${sfx}`, fullName: "Admin", passwordHash: "x", role: "super_admin" } })).id;
  sesi = { id: adminId, orgId, role: "super_admin" };
  paketId = (await db.package.create({ data: { orgId, name: `Paket ${sfx}`, stage: "pelaksanaan" } })).id;
  L.A = await buatLokasi("Alfa", "Demak");
  L.B = await buatLokasi("Beta", "Demak");
  L.C = await buatLokasi("Gama", "Jepara");
  // Rincian kedua uraian diterima di A; B dan C memakainya ulang (DECISIONS 807).
  await terimaAnalisa(L.A.id, "I#1", "Beton fc' 20 MPa site mix", "m³", BETON);
  await terimaAnalisa(L.A.id, "I#2", "Mesin pembuat es balok 5 ton", "unit", [
    { kategori: "bahan", nama: "Mesin pembuat es balok 5 ton", satuan: "unit", koefisien: 1 },
  ]);
}, 120_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
});

describe("katalog harga wilayah", () => {
  it("lokasi pertama meriset lewat web; katalog terisi; sumber karangan dibuang; tanpa sumber sah = estimasi", async () => {
    const run = await estimasi("A");
    expect(run.status).toBe("selesai");
    expect(panggilanWeb).toHaveLength(1);
    expect(panggilanWeb[0]!.lokasi).toMatchObject({ provinsi: "Jawa Tengah", kabupaten: "Demak" });

    const katalog = await db.hargaWilayah.findMany({ where: { orgId, kabupaten: "Demak" } });
    const d = await draf(run.id);
    expect(katalog).toHaveLength(d.length);
    expect(d.length).toBe(panggilanWeb[0]!.nama.length);
    for (const k of katalog) {
      if (k.metode === "web") {
        expect(k.sumber).toEqual([{ url: SAH, judul: "SSH Kabupaten 2026" }]);
        expect(k.keyakinan).toBe("tinggi");
      } else {
        expect(k.sumber).toEqual([]);
        expect(k.keyakinan).toBe("sedang");
      }
    }
    expect(katalog.filter((k) => k.metode === "web")).toHaveLength(Math.ceil(d.length / 2));
    const web = d.find((x) => x.metode === "web")!;
    expect(web.alasan).toContain("Sumber: demakkab.go.id");
    expect(web.sumber).toEqual([{ url: SAH, judul: "SSH Kabupaten 2026" }]);
    expect(d.find((x) => x.metode === "ai")!.alasan).toContain("Estimasi AI, tanpa sumber web");
  });

  it("lokasi kedua sekabupaten: tanpa riset baru; harga yang diisi orang di lokasi sekabupaten didahulukan", async () => {
    await db.hargaSatuanDasar.create({ data: { locationId: L.A.id, ...SEMEN, harga: 95_000n, sumber: "Input manual", updatedById: adminId } });
    const run = await estimasi("B");
    expect(panggilanWeb).toHaveLength(1);
    const d = await draf(run.id);
    expect(d.length).toBe(panggilanWeb[0]!.nama.length);
    const semen = d.find((x) => x.nama === SEMEN.nama)!;
    expect(semen).toMatchObject({ metode: "lapangan", harga: 95_000n });
    expect(semen.alasan).toContain("Median harga yang diisi di 1 lokasi sekabupaten: Alfa");
  });

  it("memakai usulan: HSD menyebut asalnya dan alamat sumbernya; harga hasil usulan bukan harga lapangan", async () => {
    const run = await db.hsdUsulanRun.findFirst({ where: { locationId: L.B.id }, orderBy: { createdAt: "desc" } });
    const d = await draf(run!.id);
    const r = await terapkanUsulanHargaAiAction({ locationId: L.B.id, slug: L.B.slug, ids: d.map((x) => x.id) });
    expect(r.ok).toBe(true);
    const hsd = await db.hargaSatuanDasar.findMany({ where: { locationId: L.B.id } });
    const webNama = d.find((x) => x.metode === "web")!.nama;
    expect(hsd.find((h) => h.nama === webNama)).toMatchObject({ sumber: "Harga web (katalog wilayah) – disetujui pengguna", catatan: `Sumber: ${SAH}` });
    expect(hsd.find((h) => h.nama === SEMEN.nama)).toMatchObject({ sumber: "Harga lapangan sekabupaten – disetujui pengguna", harga: 95_000n });
    expect(hsd.find((h) => h.nama === d.find((x) => x.metode === "ai")!.nama)!.sumber).toBe("Usulan AI – disetujui pengguna");
    // Dari sudut lokasi A: harga B semuanya hasil usulan → tidak satu pun jadi "harga lapangan".
    const lap = await hargaLapangan({ id: L.A.id, orgId, provinsi: "Jawa Tengah", kabupaten: "Demak" }, new Set(hsd.map((h) => kunciSumberDaya(h.kategori, h.nama, h.satuan))));
    expect(lap.size).toBe(0);
  });

  it("pencarian web dimatikan di akun: jatuh ke estimasi AI, ditandai, catatannya disebut", async () => {
    modeWeb = "mati";
    try {
      const sebelum = panggilanEstimasi;
      const run = await estimasi("C");
      expect(panggilanWeb.at(-1)!.lokasi.kabupaten).toBe("Jepara");
      expect(panggilanEstimasi).toBe(sebelum + 1);
      expect(run.status).toBe("selesai");
      expect(run.errorMessage).toContain("Pencarian web dimatikan");
      const d = await draf(run.id);
      expect(d.every((x) => x.metode === "ai" && x.keyakinan === "sedang")).toBe(true);
      expect(await db.hargaWilayah.count({ where: { orgId, kabupaten: "Jepara", metode: "ai" } })).toBe(d.length);
    } finally {
      modeWeb = "jalan";
    }
  });

  it("riset ulang satu kabupaten; provider bukan Claude tidak pernah memanggil web", async () => {
    const r = await risetUlangWilayahAction({ provinsi: "Jawa Tengah", kabupaten: "Jepara" });
    expect(r).toMatchObject({ ok: true });
    expect(await db.hargaWilayah.count({ where: { orgId, kabupaten: "Jepara" } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "rapl.katalog_harga.riset_ulang", resourceId: orgId } })).toBe(1);
    pakaiClaude = false;
    try {
      const web = panggilanWeb.length;
      const run = await estimasi("C");
      expect(panggilanWeb).toHaveLength(web);
      expect(run.errorMessage).toContain("bukan Claude");
    } finally {
      pakaiClaude = true;
    }
  });

  it("katalog lebih tua dari 90 hari diriset ulang", async () => {
    await db.hargaWilayah.updateMany({ where: { orgId, kabupaten: "Demak" }, data: { diperbarui: new Date(Date.now() - 100 * 86_400_000) } });
    const web = panggilanWeb.length;
    await estimasi("A");
    expect(panggilanWeb).toHaveLength(web + 1);
    // Yang tetap usang hanya semen: di A harganya sudah diisi orang, jadi tidak diminta.
    const usang = await db.hargaWilayah.findMany({ where: { orgId, kabupaten: "Demak", diperbarui: { lt: new Date(Date.now() - 86_400_000) } } });
    expect(usang.map((u) => u.nama)).toEqual([SEMEN.nama]);
  });

  it("estimasi satu paket: pelaksana ditolak; lokasi dikerjakan berurutan, yang sudah berharga dilewati", async () => {
    sesi = { ...sesi, role: "field_supervisor" };
    expect((await estimasiHargaPaketAction({ packageId: paketId })).ok).toBe(false);
    sesi = { ...sesi, role: "super_admin" };

    const t0 = new Date();
    const r = await estimasiHargaPaketAction({ packageId: paketId });
    expect(r).toEqual({ ok: true, lokasi: 3 });
    // A dan C masih punya yang kosong → run baru; B sudah berharga semua → dilewati.
    await tungguRun(L.A.id, t0);
    await tungguRun(L.C.id, t0);
    await new Promise((x) => setTimeout(x, 300));
    expect(await db.hsdUsulanRun.count({ where: { locationId: L.B.id, createdAt: { gte: t0 } } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "rapl.harga_paket.minta", resourceId: paketId } })).toBe(1);
  });
});
