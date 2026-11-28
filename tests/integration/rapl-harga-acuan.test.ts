// "PAKAI HARGA ACUAN" DI LAYAR HARGA RAPL (DECISIONS 804).
//
// Harga acuan templat hanya rujukan (802) sampai ORANG memilih memakainya.
// Yang dijaga di sini:
//  - pintunya `rapl.manage` + akses lokasi; pelaksana ditolak;
//  - peramban hanya mengirim KUNCI sumber daya, bukan angka – harganya dibaca
//    ulang di server dari templat;
//  - hanya sumber daya yang BELUM berharga yang diisi: harga yang diketik
//    orang tidak pernah ditimpa;
//  - sumber harga menyebut asalnya (katalog estimasi / perkiraan dari RAB),
//    dan tercatat di audit.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let peranUji: "super_admin" | "field_supervisor" = "super_admin";
let lokasiBoleh = true;

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  const pengguna = () => ({ id: userId, orgId, fullName: "Penguji", username: `ha-${suffix}`, email: null, role: peranUji, mustChangePassword: false });
  return {
    ...asli,
    requireUser: async () => pengguna(),
    requireCapability: async (cap: Parameters<typeof can>[1]) => {
      if (!can(peranUji, cap)) throw new asli.ForbiddenError();
      return pengguna();
    },
    requireLocationAccess: async () => {
      if (!lokasiBoleh) throw new asli.ForbiddenError();
    },
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { keadaanHarga } = await import("@/lib/ahsp/hsd");
const { kunciSumberDaya } = await import("@/lib/ahsp/rapl-calc");
const { pakaiHargaAcuanAction } = await import("@/lib/ahsp/hsd-actions");

const suffix = `ha${Date.now().toString(36)}`;
let orgId = "";
let userId = "";
let lokasiId = "";
let pekerja = { kategori: "", nama: "", satuan: "" };

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

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  userId = (await db.user.create({ data: { orgId, username: `ha-${suffix}`, fullName: "Penguji", passwordHash: "x", role: "super_admin" } })).id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  lokasiId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Lokasi HA", slug: `ha-${suffix}`, village: "V", regency: "Bitung", province: "Sulawesi Utara", status: "berjalan" },
    })
  ).id;
  const r = await createRevisionFromNodes(
    lokasiId,
    [
      { kind: "kategori" as const, code: "I", name: "PEKERJAAN STRUKTUR", volume: null, unit: null, unitPrice: null, amount: 0n, lineageKey: "I", parentLineageKey: null, sortOrder: 0, excelRow: null },
      item("I#1", "1", "Beton fc' 20 MPa site mix", "m³", 10, 1_500_000, 1),
      item("I#2", "2", "Mesin pembuat es balok 5 ton", "unit", 1, 100_000_000, 2),
    ],
    { source: "hps_awal", userId, note: "uji" },
  );
  await activateRevision(r.revisionId, userId);
  // Satu upah sudah diisi orang: tidak boleh ditimpa acuan.
  const awal = await keadaanHarga(lokasiId);
  const p = awal.baris.find((b) => b.kategori === "upah" && b.hargaAcuan != null)!;
  pekerja = { kategori: p.kategori, nama: p.nama, satuan: p.satuan };
  await db.hargaSatuanDasar.create({
    data: { locationId: lokasiId, ...pekerja, harga: 150_000n, sumber: "Input manual", updatedById: userId },
  });
}, 120_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
});

const baris = async (nama: string) => (await keadaanHarga(lokasiId)).baris.find((b) => b.nama === nama)!;

describe("pakai harga acuan", () => {
  it("pelaksana ditolak, lokasi terlarang ditolak – tidak ada yang tersimpan", async () => {
    peranUji = "field_supervisor";
    expect((await pakaiHargaAcuanAction({ locationId: lokasiId, slug: "x", kunci: [] })).ok).toBe(false);
    peranUji = "super_admin";
    lokasiBoleh = false;
    expect((await pakaiHargaAcuanAction({ locationId: lokasiId, slug: "x", kunci: [] })).ok).toBe(false);
    lokasiBoleh = true;
    expect(await db.hargaSatuanDasar.count({ where: { locationId: lokasiId } })).toBe(1);
  });

  it("yang dicentang saja: semen diisi acuan katalog, yang lain tetap kosong", async () => {
    const semen = await baris("Semen Portland komposit 50 kg");
    expect(semen).toMatchObject({ harga: null, hargaAcuan: 88_000, asalAcuan: "katalog" });
    const h = await pakaiHargaAcuanAction({ locationId: lokasiId, slug: "x", kunci: [kunciSumberDaya(semen.kategori, semen.nama, semen.satuan)] });
    expect(h).toMatchObject({ ok: true, tersimpan: 1 });
    expect(await baris("Semen Portland komposit 50 kg")).toMatchObject({ harga: 88_000n, sumber: expect.stringContaining("Harga acuan templat RAPL") });
    expect((await baris("Mesin pembuat es balok 5 ton")).harga).toBeNull();
  });

  it("semua yang kosong: acuan dipakai, perkiraan RAB disebut asalnya, harga orang tidak ditimpa, tercatat di audit", async () => {
    const sebelum = await keadaanHarga(lokasiId);
    const kosongBerAcuan = sebelum.baris.filter((b) => b.harga === null && b.hargaAcuan != null).length;
    const h = await pakaiHargaAcuanAction({ locationId: lokasiId, slug: "x", kunci: [] });
    expect(h).toMatchObject({ ok: true, tersimpan: kosongBerAcuan });
    expect(await baris("Mesin pembuat es balok 5 ton")).toMatchObject({
      harga: 82_000_000n,
      sumber: expect.stringContaining("Perkiraan dari harga satuan RAB"),
    });
    expect(await baris(pekerja.nama)).toMatchObject({ harga: 150_000n, sumber: "Input manual" });
    const log = await db.auditLog.findFirst({ where: { action: "rapl.harga_acuan.pakai", resourceId: lokasiId }, orderBy: { createdAt: "desc" } });
    expect(log?.payload).toMatchObject({ jumlah: kosongBerAcuan });
  });

  it("tidak ada lagi yang bisa diisi: ditolak dengan alasan", async () => {
    const h = await pakaiHargaAcuanAction({ locationId: lokasiId, slug: "x", kunci: [] });
    expect(h).toMatchObject({ ok: false, error: expect.stringContaining("Tidak ada") });
  });
});
