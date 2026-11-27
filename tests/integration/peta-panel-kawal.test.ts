// ANGKA KAWAL DI PANEL PETA (DECISIONS 800).
//
// Permintaan user 2026-11-27: "informasi kawal juga tampilkan di sini" (panel
// detail lokasi di peta). Yang dijaga:
//  - rute /api/peta/[id] menyertakan angka Kawal terbaru lokasi yang
//    berpasangan – apa adanya, tanpa dihitung ulang;
//  - hanya untuk peran ber-`kawal.view`: begitu Super Admin mencabutnya
//    (matriks hak akses 793), angkanya tidak dikirim sama sekali;
//  - lokasi tanpa pasangan Kawal: null, bukan galat.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

let peran: "project_manager" | "field_supervisor" = "project_manager";
let orgId = "";
vi.mock("@/lib/auth/session", async () => ({
  getCurrentUser: async () => ({ id: "u", orgId, role: peran, fullName: "Uji", mustChangePassword: false }),
  hasLocationAccess: async () => true,
}));

const { db } = await import("@/lib/db");
const { GET } = await import("@/app/api/peta/[id]/route");
const { pasangPenggantiHakAkses } = await import("@/lib/authz");
const { susunPengganti } = await import("@/lib/hak-akses/susun");

const suffix = `pk${Date.now().toString(36)}`;
const KAWAL_ID = 900_000 + Math.floor(Math.random() * 90_000);
let berpasangan = "";
let tanpaPasangan = "";
let snapshotId = "";

async function panggil(id: string) {
  const r = await GET(new Request(`http://uji/api/peta/${id}`), { params: Promise.resolve({ id }) });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket ${suffix}` } });
  const buat = (nama: string) =>
    db.location.create({
      data: { packageId: pkg.id, name: nama, slug: `${nama.toLowerCase()}-${suffix}`, village: "D", regency: "Kota Bitung", province: "Sulawesi Utara" },
    });
  berpasangan = (await buat("Tandurusa")).id;
  tanpaPasangan = (await buat("Lain")).id;
  const snap = await db.kawalSnapshot.create({
    data: { rowCount: 1, storedCount: 1, contentHash: `h-${suffix}`, capturedAt: new Date("2026-11-26T03:00:00Z") },
  });
  snapshotId = snap.id;
  await db.kawalLocationSnapshot.create({
    data: {
      snapshotId,
      kawalId: KAWAL_ID,
      namaKnmp: "KNMP Tandurusa",
      kabupaten: "Kota Bitung",
      kurva: [],
      actualPct: 14.25,
      targetPct: 55.1,
      deviasiPct: -40.85,
      weekNo: 11,
      maxWeeks: 16,
    },
  });
  await db.kawalLocationMap.create({ data: { kawalId: KAWAL_ID, locationId: berpasangan, status: "dikonfirmasi" } });
});

afterAll(async () => {
  pasangPenggantiHakAkses(new Map());
  // Snapshot Kawal append-only (UPDATE/DELETE ditolak pemicu) – dibersihkan
  // dengan TRUNCATE seperti `kawal-tahap4`; berkas integrasi jalan serial.
  await db.$executeRawUnsafe(
    "TRUNCATE TABLE kawal_sarana_maps, kawal_sarana_snapshots, kawal_location_snapshots, kawal_snapshots, kawal_location_maps",
  );
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
});

describe("panel peta: angka Kawal", () => {
  it("lokasi berpasangan: angka Kawal apa adanya, dengan minggu dan tanggal datanya", async () => {
    peran = "project_manager";
    const { status, body } = await panggil(berpasangan);
    expect(status).toBe(200);
    expect(body.kawal).toEqual({
      realisasiPct: 14.25,
      rencanaPct: 55.1,
      deviasiPct: -40.85,
      mingguKe: 11,
      totalMinggu: 16,
      diambil: "2026-11-26T03:00:00.000Z",
    });
  });

  it("lokasi tanpa pasangan Kawal: null, bukan galat", async () => {
    peran = "project_manager";
    const { status, body } = await panggil(tanpaPasangan);
    expect(status).toBe(200);
    expect(body.kawal).toBeNull();
  });

  it("kewenangan Kawal dicabut Super Admin: angkanya tidak dikirim", async () => {
    peran = "field_supervisor";
    pasangPenggantiHakAkses(susunPengganti([{ role: "field_supervisor", capability: "kawal.view", boleh: false }]));
    const { body } = await panggil(berpasangan);
    expect(body.kawal).toBeNull();
    // Pelaksana tetap tanpa rupiah (735).
    expect(body.contractValue).toBeNull();
    pasangPenggantiHakAkses(new Map());
  });
});
