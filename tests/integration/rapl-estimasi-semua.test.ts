// ESTIMASI SEMUA HARGA LOKASI SEKALI KLIK (DECISIONS 805).
//
// Koreksi user 2026-11-28: *"yang suruh pakai itu sebagai acuan harga siapa?!
// … kalau harga dan itemnya ya kamu harus bisa auto case by case"*. Harga
// prototipe referensi (katalog Sulut) tidak dipakai lagi; harga diestimasi
// UNTUK LOKASI ITU. Yang dijaga di sini:
//  - tanpa centang = SEMUA sumber daya yang belum berharga diestimasi, 25
//    sekali jalan, berputar dalam satu run sampai habis; tiap sumber daya
//    dimintakan sekali saja; yang sudah berharga tidak ikut;
//  - konteks lokasinya (desa, kabupaten, provinsi, harga sampai di lokasi)
//    ikut ke setiap putaran;
//  - hasilnya DRAF: biaya belum berubah sebelum orang memakainya; Excel siap
//    isi membawa usulan lokasi itu di kolom sebelah harga;
//  - "Pakai semua usulan" mengisi seluruhnya sekaligus;
//  - gagal di tengah: draf putaran sebelumnya tetap ada, galatnya disebut.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Tiap prompt yang terkirim, dan nama sumber daya yang dimintakan di dalamnya. */
const kiriman: { prompt: string; nama: string[] }[] = [];
let gagalDiPanggilanKe: number | null = null;
vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async (_schema: unknown, req: { prompt: string }) => {
    const daftar = JSON.parse(req.prompt.split("\n").at(-1)!) as { id: string; nama: string }[];
    kiriman.push({ prompt: req.prompt, nama: daftar.map((d) => d.nama) });
    if (gagalDiPanggilanKe !== null && kiriman.length === gagalDiPanggilanKe) {
      return { ok: false, error: "Penyedia AI tidak menjawab." };
    }
    return {
      ok: true,
      attempts: 1,
      meta: { ok: true, model: "uji-model" },
      data: { suggestions: daftar.map((d, i) => ({ id: d.id, harga: 10_000 * (i + 1), keyakinan: "sedang", alasan: "estimasi uji lokasi" })) },
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
const { mintaUsulanHargaAiAction, terapkanUsulanHargaAiAction } = await import("@/lib/ahsp/hsd-actions");
const { keadaanHarga } = await import("@/lib/ahsp/hsd");
const { muatRaplSiapIsi } = await import("@/lib/rapl-siap-isi/data");

const suffix = `es${Date.now().toString(36)}`;
let adminId = "";
let paketId = "";

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

/** Lokasi dengan beton (±8 sumber daya templat) + 30 barang jadi (satu sumber daya masing-masing). */
async function buatLokasi(nama: string, kabupaten = "Demak"): Promise<{ id: string; slug: string }> {
  const slug = `${nama.toLowerCase()}-${suffix}`;
  const id = (
    await db.location.create({
      data: { packageId: paketId, name: nama, slug, village: `Desa ${nama}`, regency: kabupaten, province: "Jawa Tengah", status: "berjalan" },
    })
  ).id;
  const nodes = [
    { kind: "kategori" as const, code: "I", name: "PEKERJAAN", volume: null, unit: null, unitPrice: null, amount: 0n, lineageKey: "I", parentLineageKey: null, sortOrder: 0, excelRow: null },
    item("I#0", "0", "Beton fc' 20 MPa site mix", "m³", 10, 1_500_000, 1),
    ...Array.from({ length: 30 }, (_, i) => item(`I#${i + 1}`, String(i + 1), `Perangkat khusus nomor ${i + 1}`, "unit", 1, 1_000_000 + i, i + 2)),
  ];
  const r = await createRevisionFromNodes(id, nodes, { source: "hps_awal", userId: adminId, note: "uji" });
  await activateRevision(r.revisionId, adminId);
  return { id, slug };
}

async function tungguSelesai(locationId: string) {
  for (let i = 0; i < 200; i++) {
    const run = await db.hsdUsulanRun.findFirst({ where: { locationId }, orderBy: { createdAt: "desc" } });
    if (run && run.pendingSince === null) return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("run tidak selesai");
}

let A = { id: "", slug: "" };
let B = { id: "", slug: "" };

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  adminId = (await db.user.create({ data: { orgId: org.id, username: `es-${suffix}`, fullName: "Admin", passwordHash: "x", role: "super_admin" } })).id;
  sesi = { id: adminId, orgId: org.id, role: "super_admin" };
  paketId = (await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } })).id;
  A = await buatLokasi("Alfa");
  // Kabupaten lain: lokasi sekabupaten memakai katalog harga wilayah (DECISIONS
  // 806) dan tidak meminta AI lagi – di sini yang diuji justru perputarannya.
  B = await buatLokasi("Beta", "Jepara");
  // Satu harga sudah diisi orang di lokasi A: tidak boleh dimintakan.
  await db.hargaSatuanDasar.create({
    data: { locationId: A.id, kategori: "bahan", nama: "Perangkat khusus nomor 1", satuan: "unit", harga: 990_000n, sumber: "Input manual", updatedById: adminId },
  });
}, 120_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
});

describe("estimasi semua harga lokasi", () => {
  it("tanpa centang: semua yang kosong diestimasi, 25 sekali jalan, masing-masing sekali, konteks lokasi ikut", async () => {
    const sebelum = await keadaanHarga(A.id);
    const kosong = sebelum.baris.filter((b) => b.harga === null);
    expect(kosong.length).toBeGreaterThan(25);

    kiriman.length = 0;
    const r = await mintaUsulanHargaAiAction({ locationId: A.id, slug: A.slug, dipilih: [] });
    expect(r).toMatchObject({ ok: true, diminta: kosong.length, totalKosong: kosong.length });
    const run = await tungguSelesai(A.id);

    // Tanpa provider Claude di lingkungan uji: estimasi tanpa web, dan itu disebut (DECISIONS 806).
    expect(run).toMatchObject({ status: "selesai", diminta: kosong.length });
    expect(run.errorMessage).toContain("bukan Claude");
    expect(kiriman).toHaveLength(Math.ceil(kosong.length / 25));
    const diminta = kiriman.flatMap((k) => k.nama);
    expect(new Set(diminta).size).toBe(diminta.length);
    expect(diminta.sort()).toEqual(kosong.map((b) => b.nama).sort());
    expect(diminta).not.toContain("Perangkat khusus nomor 1");
    for (const k of kiriman) {
      expect(k.prompt).toContain("Desa Desa Alfa, Demak, Jawa Tengah");
      expect(k.prompt).toContain("SAMPAI DI LOKASI");
    }
  });

  it("hasilnya draf: biaya belum berubah; Excel siap isi membawa usulan lokasi ini", async () => {
    const h = await keadaanHarga(A.id);
    expect(h.berharga).toBe(1);
    expect(await db.hsdUsulanAi.count({ where: { run: { locationId: A.id }, status: "draf" } })).toBe(h.belumBerharga);
    const [data] = await muatRaplSiapIsi([A.id]);
    expect(data!.usulan.size).toBe(h.belumBerharga);
  });

  it("Pakai semua usulan: seluruh sumber daya berharga, harga orang tidak ditimpa", async () => {
    const draf = await db.hsdUsulanAi.findMany({ where: { run: { locationId: A.id }, status: "draf" }, select: { id: true } });
    const r = await terapkanUsulanHargaAiAction({ locationId: A.id, slug: A.slug, ids: draf.map((d) => d.id) });
    expect(r).toMatchObject({ ok: true, dilewat: 0 });
    const h = await keadaanHarga(A.id);
    expect(h.belumBerharga).toBe(0);
    expect(h.baris.find((b) => b.nama === "Perangkat khusus nomor 1")).toMatchObject({ harga: 990_000n, sumber: "Input manual" });
    expect(h.baris.filter((b) => b.sumber === "Usulan AI – disetujui pengguna")).toHaveLength(draf.length);
  });

  it("gagal di putaran kedua: draf putaran pertama tetap ada, galatnya disebut", async () => {
    kiriman.length = 0;
    gagalDiPanggilanKe = 2;
    try {
      const r = await mintaUsulanHargaAiAction({ locationId: B.id, slug: B.slug, dipilih: [] });
      expect(r.ok).toBe(true);
      const run = await tungguSelesai(B.id);
      expect(run.status).toBe("selesai");
      expect(run.errorMessage).toBe("Berhenti setelah 25 usulan: Penyedia AI tidak menjawab.");
      expect(await db.hsdUsulanAi.count({ where: { runId: run.id, status: "draf" } })).toBe(25);
    } finally {
      gagalDiPanggilanKe = null;
    }
  });

  it("dengan centang: hanya yang dicentang, satu putaran", async () => {
    kiriman.length = 0;
    const kunci = JSON.stringify(["bahan", "Perangkat khusus nomor 7", "unit"]);
    const r = await mintaUsulanHargaAiAction({ locationId: B.id, slug: B.slug, dipilih: [kunci] });
    expect(r).toMatchObject({ ok: true, diminta: 1 });
    await tungguSelesai(B.id);
    expect(kiriman.map((k) => k.nama)).toEqual([["Perangkat khusus nomor 7"]]);
  });
});
