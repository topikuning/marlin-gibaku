// Draf harga AI: siapa boleh menerapkannya, dan dari mana angkanya diambil
// (RAPL-05/RAPL-06, DECISIONS 470).
//
// Yang diuji di sini adalah BATAS-BATASNYA, bukan mutu estimasinya:
//
//  1. Menerapkan draf menuntut `ai.generate` DAN `finance.input`. Versi
//     pertama hanya menuntut yang kedua — sehingga role yang sengaja TIDAK
//     diberi akses AI tetap bisa menuliskan harga bercap "Usulan AI –
//     disetujui pengguna" ke jejak audit.
//  2. Yang dikirim peramban adalah ID DRAF, bukan angka harga. Draf milik
//     lokasi lain tidak bisa diterapkan ke lokasi ini.
//  3. Penolakan dicatat sebagai keputusan (`ditolak`), bukan dibuang dari
//     layar — persetujuan yang tidak bisa sebagian bukan persetujuan.
//
// Jalankan: DATABASE_URL=...marlin_test APP_ENV=test pnpm vitest run tests/integration
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

/**
 * Peran pengguna uji bisa diganti per-kasus. `requireCapability` di-mock
 * dengan memakai `can()` YANG SUNGGUHAN — kalau ia dilonggarkan jadi
 * "selalu lolos", uji ini hanya akan membuktikan mock-nya sendiri.
 */
let peranUji: "super_admin" | "site_manager" = "super_admin";

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  const pengguna = () => ({ ...penggunaUji(), role: peranUji });
  return {
    ...asli,
    requireUser: async () => pengguna(),
    requireCapability: async (cap: Parameters<typeof can>[1]) => {
      if (!can(peranUji, cap)) throw new asli.ForbiddenError();
      return pengguna();
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { can } = await import("@/lib/authz");
const { terapkanUsulanHargaAiAction, tolakUsulanHargaAiAction } = await import(
  "@/lib/ahsp/hsd-actions"
);

const suffix = Date.now().toString(36);
let orgId = "";
let userId = "";
let lokasiA = "";
let lokasiB = "";
let drafA = "";
let drafB = "";

function penggunaUji() {
  return {
    id: userId,
    orgId,
    fullName: "Penguji RAPL",
    username: `rapl-${suffix}`,
    email: null,
    role: "super_admin" as const,
    mustChangePassword: false,
  };
}

async function buatLokasi(nama: string, packageId: string): Promise<string> {
  const loc = await db.location.create({
    data: {
      packageId,
      name: nama,
      slug: `${nama.toLowerCase()}-${suffix}`,
      village: "Desa Uji",
      regency: "Demak",
      province: "Jawa Tengah",
      status: "persiapan",
    },
    select: { id: true },
  });
  return loc.id;
}

async function buatDraf(locationId: string): Promise<string> {
  const run = await db.hsdUsulanRun.create({
    data: {
      locationId,
      status: "selesai",
      model: "uji-model",
      diminta: 1,
      totalKosong: 1,
      requestedById: userId,
    },
    select: { id: true },
  });
  const u = await db.hsdUsulanAi.create({
    data: {
      runId: run.id,
      kategori: "bahan",
      nama: `Semen uji ${suffix}`,
      satuan: "kg",
      harga: 75_000n,
      keyakinan: "sedang",
      alasan: "harga acuan wilayah",
    },
    select: { id: true },
  });
  return u.id;
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org RAPL ${suffix}`, slug: `org-rapl-${suffix}` },
    select: { id: true },
  });
  orgId = org.id;

  const user = await db.user.create({
    data: {
      orgId,
      username: `rapl-${suffix}`,
      fullName: "Penguji RAPL",
      passwordHash: "x",
      role: "super_admin",
    },
    select: { id: true },
  });
  userId = user.id;

  const pkg = await db.package.create({
    data: { orgId, name: `Paket RAPL ${suffix}`, stage: "kontrak" },
    select: { id: true },
  });

  lokasiA = await buatLokasi(`RaplA${suffix}`, pkg.id);
  lokasiB = await buatLokasi(`RaplB${suffix}`, pkg.id);
  drafA = await buatDraf(lokasiA);
  drafB = await buatDraf(lokasiB);
});

afterAll(async () => {
  await db.hsdUsulanRun.deleteMany({ where: { locationId: { in: [lokasiA, lokasiB] } } });
  await db.location.deleteMany({ where: { id: { in: [lokasiA, lokasiB] } } });
  await db.package.deleteMany({ where: { orgId } });
  await db.user.deleteMany({ where: { orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.$disconnect();
});

describe("terapkan draf harga AI", () => {
  it("prasyarat: site_manager memang tidak punya ai.generate", () => {
    // Kalau suatu saat capability-nya dikembalikan, uji berikutnya harus
    // ikut diperbarui — bukan diam-diam berubah arti.
    expect(can("site_manager", "ai.generate")).toBe(false);
  });

  it("ditolak untuk pengguna tanpa ai.generate, dan tidak menulis HSD", async () => {
    peranUji = "site_manager";
    const hasil = await terapkanUsulanHargaAiAction({
      locationId: lokasiA,
      slug: "apa-saja",
      ids: [drafA],
    });
    peranUji = "super_admin";

    expect(hasil.ok).toBe(false);
    const hsd = await db.hargaSatuanDasar.count({ where: { locationId: lokasiA } });
    expect(hsd).toBe(0);
    const draf = await db.hsdUsulanAi.findUniqueOrThrow({ where: { id: drafA } });
    expect(draf.status).toBe("draf");
  });

  it("draf milik lokasi lain tidak bisa diterapkan ke lokasi ini", async () => {
    const hasil = await terapkanUsulanHargaAiAction({
      locationId: lokasiA,
      slug: "apa-saja",
      ids: [drafB],
    });
    expect(hasil.ok).toBe(false);
    const draf = await db.hsdUsulanAi.findUniqueOrThrow({ where: { id: drafB } });
    expect(draf.status).toBe("draf");
  });

  it("id yang bukan draf mana pun ditolak tanpa menulis apa pun", async () => {
    const hasil = await terapkanUsulanHargaAiAction({
      locationId: lokasiA,
      slug: "apa-saja",
      ids: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(hasil.ok).toBe(false);
    expect(await db.hargaSatuanDasar.count({ where: { locationId: lokasiA } })).toBe(0);
  });
});

describe("tolak draf harga AI", () => {
  it("penolakan tercatat sebagai keputusan, bukan dibuang", async () => {
    const hasil = await tolakUsulanHargaAiAction({
      locationId: lokasiA,
      slug: "apa-saja",
      ids: [drafA],
    });
    expect(hasil.ok).toBe(true);
    if (hasil.ok) expect(hasil.ditolak).toBe(1);

    const draf = await db.hsdUsulanAi.findUniqueOrThrow({ where: { id: drafA } });
    expect(draf.status).toBe("ditolak");

    const jejak = await db.auditLog.findFirst({
      where: { action: "rapl.harga_ai.tolak", resourceId: lokasiA },
      select: { id: true },
    });
    expect(jejak).not.toBeNull();
  });

  it("draf yang sudah ditolak tidak bisa ditolak dua kali", async () => {
    const lagi = await tolakUsulanHargaAiAction({
      locationId: lokasiA,
      slug: "apa-saja",
      ids: [drafA],
    });
    expect(lagi.ok).toBe(true);
    if (lagi.ok) expect(lagi.ditolak).toBe(0);
  });

  it("tidak bisa menolak draf milik lokasi lain", async () => {
    const hasil = await tolakUsulanHargaAiAction({
      locationId: lokasiA,
      slug: "apa-saja",
      ids: [drafB],
    });
    expect(hasil.ok).toBe(true);
    if (hasil.ok) expect(hasil.ditolak).toBe(0);
    const draf = await db.hsdUsulanAi.findUniqueOrThrow({ where: { id: drafB } });
    expect(draf.status).toBe("draf");
  });
});
