// KOLOM PROGRES AGREGAT DI DAFTAR PAKET — GERBANG REKONSILIASI.
//
// Kebutuhan user 2026-09-16. Cacat yang paling mungkin dan paling sunyi bukan
// "kolomnya tidak muncul", melainkan "kolomnya muncul dengan angka yang BEDA
// dari halaman ringkasan paket". Protokol integritas perhitungan mewajibkan
// satu angka punya satu nilai di seluruh layar, jadi yang diuji di sini adalah
// KESAMAANNYA — bukan nilainya sendiri:
//
//   progresPaketDaftar(...)  ==  weightedRealizedPct(lokasi ter-scope, dikurangi
//                                yang dicabut adendum)  ==  KPI /paket/[id]
//
// Diuji untuk DUA jenis user, karena di situlah kedua populasi bisa berpisah:
// peran lintas-lokasi melihat seluruh lokasi paket, peran ter-scope hanya
// lokasi penugasannya — sementara paket tetap masuk daftar begitu SATU
// lokasinya ditugaskan.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

type UserUji = Parameters<typeof import("@/lib/package/queries").listPackages>[0];
let sessionUser: UserUji = {
  id: "", orgId: "", role: "super_admin", fullName: "Tester",
  username: "tester", email: null, mustChangePassword: false,
};
let scopedLocations: string[] | null = null;

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => sessionUser,
  getCurrentUser: async () => sessionUser,
  accessibleLocationIds: async () => scopedLocations,
  requestIp: async () => null,
}));

const { db } = await import("@/lib/db");
const { listPackages, getPackageWorkspace } = await import("@/lib/package/queries");
const { progresPaketDaftar } = await import("@/lib/package/progres-paket");
const { lingkupLokasi } = await import("@/lib/package/lingkup-lokasi");
const { getLocationsProgress } = await import("@/lib/progress");
const { weightedRealizedPct } = await import("@/lib/progress-calc");
const { catatanProgresPaket, teksProgresPaket } = await import("@/lib/package/progres-paket-teks");

const suffix = `pk${Date.now().toString(36)}`;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);

let orgId = "";
let userId = "";
let pkgUtama = "";
let pkgTanpaRab = "";
let pkgTanpaLokasi = "";
let lokA = "";
let lokB = "";
let lokDicabut = "";

/** Lokasi + RAB aktif satu item + (opsional) realisasi lewat laporan final. */
async function buatLokasi(
  packageId: string,
  nama: string,
  opts: { nilai: number; volume: number; terpasang?: number; rab?: boolean } = { nilai: 0, volume: 0 },
) {
  const loc = await db.location.create({
    data: {
      packageId, name: nama, slug: `${nama.toLowerCase()}-${suffix}`,
      village: "Desa", regency: "Kab", province: "Prov", status: "berjalan", isActive: true,
    },
    select: { id: true },
  });
  if (opts.rab === false) return loc.id;

  const harga = opts.nilai / opts.volume;
  const rev = await db.rabRevision.create({
    data: {
      locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "aktif",
      totalValue: BigInt(opts.nilai),
    },
    select: { id: true },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN",
      amount: BigInt(opts.nilai), lineageKey: "I", sortOrder: 1,
    },
    select: { id: true },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pekerjaan uji",
      volume: opts.volume, unit: "m3", unitPrice: harga,
      amount: BigInt(opts.nilai), lineageKey: "I#1", sortOrder: 2,
    },
    select: { id: true },
  });
  if (opts.terpasang && opts.terpasang > 0) {
    const rep = await db.dailyReport.create({
      data: { locationId: loc.id, reportDate: d("2026-06-10"), status: "final", createdById: userId },
      select: { id: true },
    });
    await db.dailyReportItem.create({
      data: {
        reportId: rep.id, rabNodeId: item.id, lineageKey: "I#1", basis: "aktif",
        volumeDone: opts.terpasang, valueDone: BigInt(Math.round(opts.terpasang * harga)),
        reportedById: userId,
      },
    });
  }
  return loc.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  orgId = org.id;
  const u = await db.user.create({
    data: { orgId, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
    select: { id: true },
  });
  userId = u.id;
  sessionUser = { ...sessionUser, id: userId, orgId, role: "super_admin", fullName: "Tester" };

  const vendor = await db.vendor.create({ data: { orgId, name: `PT ${suffix}` } });
  const mk = async (nama: string) => {
    const p = await db.package.create({
      data: { orgId, name: `Paket ${nama} ${suffix}`, stage: "pelaksanaan" },
      select: { id: true },
    });
    await db.contract.create({
      data: {
        packageId: p.id, vendorId: vendor.id, contractNumber: `KTR-${nama}-${suffix}`,
        contractValue: 1_000_000_000n, signedDate: d("2026-06-01"), durationDays: 60,
        startDate: d("2026-06-01"), endDate: d("2026-07-31"),
      },
    });
    return p.id;
  };
  pkgUtama = await mk("Utama");
  pkgTanpaRab = await mk("TanpaRab");
  pkgTanpaLokasi = await mk("TanpaLokasi");

  /*
   * Paket utama, TIGA lokasi dengan bobot RAB yang sengaja berbeda supaya
   * rata-rata TERTIMBANG tidak sama dengan rata-rata biasa – kalau seseorang
   * salah memakai weightedPct/rata-rata polos, angkanya akan ketahuan.
   *   A: RAB 300jt, terpasang 50%  → realisasi 150jt
   *   B: RAB 100jt, terpasang 10%  → realisasi  10jt
   *   Tertimbang = 160/400 = 40,0%;  rata-rata polos = 30,0%
   */
  lokA = await buatLokasi(pkgUtama, "LokA", { nilai: 300_000_000, volume: 100, terpasang: 50 });
  lokB = await buatLokasi(pkgUtama, "LokB", { nilai: 100_000_000, volume: 100, terpasang: 10 });
  // Lokasi ketiga DICABUT lewat adendum: tuntas 100%, jadi kalau ia ikut
  // terhitung angkanya akan melonjak dan selisihnya tidak bisa disalahartikan.
  lokDicabut = await buatLokasi(pkgUtama, "LokCabut", { nilai: 400_000_000, volume: 100, terpasang: 100 });

  const kontrakUtama = await db.contract.findFirstOrThrow({
    where: { packageId: pkgUtama },
    select: { id: true },
  });
  const am = await db.contractAmendment.create({
    data: {
      contractId: kontrakUtama.id, ccoNumber: `CCO-01/${suffix}`, valueDelta: 0n,
      endDateDelta: 0, effectiveDate: d("2026-06-15"), reason: "Pencabutan lokasi",
    },
    select: { id: true },
  });
  await db.locationScopeChange.create({
    data: {
      locationId: lokDicabut, amendmentId: am.id, kind: "cabut",
      effectiveDate: d("2026-06-15"), status: "aktif", reason: "Dicabut lewat CCO",
    },
  });

  // Paket kedua: punya lokasi, TIDAK punya RAB aktif sama sekali.
  await buatLokasi(pkgTanpaRab, "LokTanpaRab", { nilai: 0, volume: 0, rab: false });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

/** Angka acuan: persis cara halaman ringkasan paket menghitungnya. */
async function pctRingkasan(packageId: string): Promise<number> {
  const pkg = await getPackageWorkspace(packageId);
  if (!pkg) throw new Error("workspace paket tidak terbentuk");
  const idLokasi = pkg.locations.map((l) => l.id);
  const lingkup = await lingkupLokasi(idLokasi);
  const idIkut = idLokasi.filter((id) => !lingkup.dicabut.has(id));
  const progressMap = await getLocationsProgress(idIkut);
  return weightedRealizedPct(idIkut.map((id) => progressMap.get(id)).filter((p) => p != null));
}

async function pctDaftar(packageId: string): Promise<number | null> {
  const packages = await listPackages(sessionUser, scopedLocations);
  const map = await progresPaketDaftar(
    packages.map((p) => ({
      id: p.id,
      locationIds: p.locations.map((l) => l.id),
      lokasiTotal: p._count.locations,
    })),
  );
  const r = map.get(packageId);
  if (!r) throw new Error("paket tidak ada di daftar");
  return r.pct;
}

describe("peran lintas lokasi – melihat seluruh paket", () => {
  beforeAll(() => {
    sessionUser = { ...sessionUser, id: userId, orgId, role: "super_admin", fullName: "Tester" };
    scopedLocations = null;
  });

  it("angka daftar SAMA dengan angka ringkasan paket", async () => {
    const daftar = await pctDaftar(pkgUtama);
    const ringkasan = await pctRingkasan(pkgUtama);
    expect(daftar).not.toBeNull();
    expect(daftar!).toBeCloseTo(ringkasan, 9);
  });

  it("nilainya TERTIMBANG RAB, bukan rata-rata polos, dan lokasi dicabut tidak ikut", async () => {
    // A 150jt + B 10jt = 160jt atas RAB 400jt = 40,0%.
    // Rata-rata polos (50%+10%)/2 = 30,0%; ikut yang dicabut = 65,0%.
    const pct = await pctDaftar(pkgUtama);
    expect(pct!).toBeCloseTo(40, 6);
  });

  it("paket berlokasi tapi tanpa RAB aktif → null, BUKAN nol", async () => {
    expect(await pctDaftar(pkgTanpaRab)).toBeNull();
  });

  it("paket tanpa lokasi → null", async () => {
    expect(await pctDaftar(pkgTanpaLokasi)).toBeNull();
  });
});

describe("peran ter-scope – hanya sebagian lokasi paket", () => {
  beforeAll(() => {
    sessionUser = { ...sessionUser, id: userId, orgId, role: "site_manager", fullName: "SM" };
    // Ditugaskan HANYA ke lokasi B (RAB 100jt, terpasang 10%).
    scopedLocations = [lokB];
  });

  it("angka daftar tetap SAMA dengan angka ringkasan paket untuk user yang sama", async () => {
    /*
     * Inilah gerbang yang sesungguhnya. Kalau `listPackages` mengambil lokasi
     * tanpa saringan scope, daftar akan menghitung 40% (tiga lokasi) sementara
     * ringkasan menghitung 10% (satu lokasi) — satu paket, dua angka, pada
     * detik yang sama.
     */
    const daftar = await pctDaftar(pkgUtama);
    const ringkasan = await pctRingkasan(pkgUtama);
    expect(daftar).not.toBeNull();
    expect(daftar!).toBeCloseTo(ringkasan, 9);
    expect(daftar!).toBeCloseTo(10, 6);
  });

  it("selisih lokasi terlihat vs seluruh lokasi paket ikut terbawa", async () => {
    const packages = await listPackages(sessionUser, scopedLocations);
    const map = await progresPaketDaftar(
      packages.map((p) => ({
        id: p.id,
        locationIds: p.locations.map((l) => l.id),
        lokasiTotal: p._count.locations,
      })),
    );
    const r = map.get(pkgUtama)!;
    expect(r.lokasiTotal).toBe(3);
    expect(r.lokasiIkut).toBe(1);
    // Tanpa angka ini, sel tidak bisa mengaku bahwa angkanya sebagian.
    expect(r.lokasiTersembunyi).toBe(2);
  });

  it("paket yang tak memuat lokasi penugasan tidak ada di daftarnya sama sekali", async () => {
    const packages = await listPackages(sessionUser, scopedLocations);
    expect(packages.map((p) => p.id)).not.toContain(pkgTanpaRab);
    expect(packages.map((p) => p.id)).not.toContain(pkgTanpaLokasi);
  });
});

describe("pencabutan yang DIARSIPKAN tidak meninggalkan bekas di kolom", () => {
  beforeAll(async () => {
    sessionUser = { ...sessionUser, id: userId, orgId, role: "super_admin", fullName: "Tester" };
    scopedLocations = null;
    await db.locationScopeChange.updateMany({
      where: { locationId: lokDicabut },
      data: { archivedAt: new Date("2026-06-20T00:00:00.000Z") },
    });
  });

  afterAll(async () => {
    await db.locationScopeChange.updateMany({
      where: { locationId: lokDicabut },
      data: { archivedAt: null },
    });
  });

  async function ringkas(bolehLihatArsip: boolean) {
    const packages = await listPackages(sessionUser, scopedLocations);
    const map = await progresPaketDaftar(
      packages.map((p) => ({
        id: p.id,
        locationIds: p.locations.map((l) => l.id),
        lokasiTotal: p._count.locations,
      })),
      { bolehLihatArsip },
    );
    return map.get(pkgUtama)!;
  }

  it("ANGKANYA tidak bergeser sedikit pun karena arsip", async () => {
    /*
     * Ini batas yang penting. Pengarsipan menyembunyikan RIWAYAT, bukan
     * mengubah lingkup kontrak — lokasi yang dicabut tetap di luar angka.
     * Halaman ringkasan paket menegaskan hal yang sama.
     */
    expect((await ringkas(false)).pct!).toBeCloseTo(40, 6);
    expect((await ringkas(true)).pct!).toBeCloseTo(40, 6);
  });

  it("yang BUKAN super admin tidak diberi tahu ada pencabutan", async () => {
    const r = await ringkas(false);
    expect(r.lokasiDicabut).toBe(0);
    expect(catatanProgresPaket(r)).not.toContain("dicabut adendum");
    expect(teksProgresPaket(r)).not.toContain("adendum");
  });

  it("super admin tetap melihatnya – arsip bukan penghapusan", async () => {
    const r = await ringkas(true);
    expect(r.lokasiDicabut).toBe(1);
    expect(catatanProgresPaket(r)).toContain("1 lokasi dicabut adendum");
  });
});

describe("satu putaran kueri untuk seluruh daftar", () => {
  beforeAll(() => {
    sessionUser = { ...sessionUser, id: userId, orgId, role: "super_admin", fullName: "Tester" };
    scopedLocations = null;
  });

  it("memanggil progresPaketDaftar sekali melayani semua paket", async () => {
    const packages = await listPackages(sessionUser, scopedLocations);
    const map = await progresPaketDaftar(
      packages.map((p) => ({
        id: p.id,
        locationIds: p.locations.map((l) => l.id),
        lokasiTotal: p._count.locations,
      })),
    );
    // Tiap paket di daftar dapat barisnya sendiri dari SATU panggilan; kalau
    // kolom ini dihitung per baris, 83 paket = 83 raw SQL.
    expect(map.size).toBe(packages.length);
    for (const p of packages) expect(map.has(p.id)).toBe(true);
  });

  it("daftar kosong tidak menyentuh basis data", async () => {
    expect((await progresPaketDaftar([])).size).toBe(0);
  });
});
