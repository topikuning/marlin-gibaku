// PROFIL KURVA-S PADA BASELINE — permintaan user 2026-09-19.
//
// *"aku ingin kamu default kurva S, saat RAB diimpor menggunakan ratio ini …
// 1 → 3 → 6 → 11 → 18 → 28 → 40 → 54 → 68 → 80 → 89 → 94 → 97 → 99 → 100%"*,
// karena *"dalam 3 minggu, bahkan kalau bisa 4 minggu pertama, itu banyak tidak
// ada kegiatan karena persiapan"*.
//
// Bentuk kurvanya sendiri sudah diuji murni di tests/unit/scurve-profil. Yang
// diuji DI SINI adalah tiga hal yang hanya kelihatan lewat basis data, dan
// ketiganya menentukan angka yang dilihat orang:
//
//   1. baseline yang benar-benar TERSIMPAN mengikuti profilnya — titiknya,
//      matriks kategorinya, dan bobot tiap kategorinya;
//   2. regenerate TANPA menyebut profil MEWARISI pilihan lokasi itu, bukan
//      kembali ke bawaan sistem (itu persis "pemaksaan" yang dikeluhkan);
//   3. impor HPS awal TIDAK lagi membuat baseline sama sekali.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let sessionUserId = "";
let sessionOrgId = "";

vi.mock("@/lib/auth/session", () => {
  const user = () => ({
    id: sessionUserId,
    orgId: sessionOrgId,
    role: "super_admin",
    fullName: "Tester",
  });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => null,
    requireCapability: async () => user(),
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { regenerateBaseline, totalWeeksFor } = await import("@/lib/rab/import");
const { kurvaProfilLambat } = await import("@/lib/scurve/profil");
const { validateBaselinePoints } = await import("@/lib/scurve/generate");
const { importHps, pilihProfilKurvaAction } = await import(
  "@/app/(app)/lokasi/[slug]/rab/import/actions"
);

const suffix = `pk${Date.now().toString(36)}`;
let locationId = "";
let slug = "";
let revisionId = "";

/** Tiga kategori berbobot jauh berbeda — supaya warp benar-benar teruji. */
const KATEGORI = [
  { code: "I", name: "PEKERJAAN PERSIAPAN", amount: 100_000_000n },
  { code: "II", name: "PEKERJAAN STRUKTUR", amount: 700_000_000n },
  { code: "III", name: "PEKERJAAN FINISHING", amount: 200_000_000n },
];
const TOTAL = KATEGORI.reduce((t, k) => t + k.amount, 0n);

async function titik(baselineId: string): Promise<number[]> {
  const rows = await db.baselinePoint.findMany({
    where: { baselineId },
    orderBy: { weekNumber: "asc" },
    select: { plannedPct: true },
  });
  return rows.map((r) => Number(r.plannedPct));
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  sessionOrgId = org.id;
  sessionUserId = (
    await db.user.create({
      data: {
        orgId: org.id,
        username: `u-${suffix}`,
        fullName: "Admin",
        passwordHash: "x",
        role: "super_admin",
      },
      select: { id: true },
    })
  ).id;

  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${suffix}` } });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" },
  });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `KTR-${suffix}`,
      contractValue: TOTAL,
      signedDate: new Date("2026-04-01"),
      // 126 hari = 18 minggu pas — jumlah minggu yang dipakai user sebagai contoh.
      durationDays: 126,
      startDate: new Date("2026-04-06"),
      endDate: new Date("2026-08-10"),
    },
  });
  slug = `lokasi-${suffix}`;
  locationId = (
    await db.location.create({
      data: {
        packageId: pkg.id,
        name: `Lokasi ${suffix}`,
        slug,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
        status: "persiapan",
        isActive: true,
      },
      select: { id: true },
    })
  ).id;

  revisionId = (
    await db.rabRevision.create({
      data: {
        locationId,
        revisionNo: 1,
        source: "hps_awal",
        status: "aktif",
        totalValue: TOTAL,
      },
      select: { id: true },
    })
  ).id;
  let urut = 0;
  for (const k of KATEGORI) {
    const kat = await db.rabNode.create({
      data: {
        revisionId,
        kind: "kategori",
        code: k.code,
        name: k.name,
        amount: k.amount,
        lineageKey: k.code,
        sortOrder: urut++,
      },
      select: { id: true },
    });
    await db.rabNode.create({
      data: {
        revisionId,
        parentId: kat.id,
        kind: "item",
        code: "1",
        name: `${k.name} – pekerjaan utama`,
        unit: "ls",
        volume: 1,
        unitPrice: Number(k.amount),
        amount: k.amount,
        lineageKey: `${k.code}#1`,
        sortOrder: urut++,
      },
    });
  }
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("baseline berprofil awal lambat", () => {
  it("titik baseline = kurvaProfilLambat pada grid minggu lokasi ini", async () => {
    const { totalWeeks, weekEndFracs } = await totalWeeksFor(locationId);
    const b = await regenerateBaseline(locationId, {
      source: "auto",
      profil: "lambat",
      userId: sessionUserId,
    });
    expect(b.unchanged).toBe(false);
    expect(b.profil).toBe("lambat");

    const harap = kurvaProfilLambat(totalWeeks, weekEndFracs);
    const ada = await titik(b.id);
    expect(ada).toHaveLength(totalWeeks);
    // Toleransi 0,005 = presisi kolom `planned_pct` Decimal(6,3).
    ada.forEach((v, i) => expect(v).toBeCloseTo(harap[i], 2));
    expect(validateBaselinePoints(ada)).toBeNull();
  });

  it("empat minggu pertama masih di bawah 10% – seluruh alasan profil ini ada", async () => {
    const b = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { id: true },
    });
    const ada = await titik(b.id);
    expect(ada[3]).toBeLessThan(10);
    expect(ada[ada.length - 1]).toBeCloseTo(100, 2);
  });

  it("bobot tiap kategori UTUH – warp memundurkan jam, tidak memindahkan uang", async () => {
    const b = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { id: true },
    });
    const rows = await db.baselineScheduleItem.findMany({
      where: { baselineId: b.id },
      select: { lineageKey: true, weekly: true },
    });
    expect(rows).toHaveLength(KATEGORI.length);
    for (const k of KATEGORI) {
      const r = rows.find((x) => x.lineageKey === k.code);
      if (!r) throw new Error(`kategori ${k.code} hilang dari jadwal`);
      const weekly = r.weekly as number[];
      const jumlah = weekly.reduce((t, v) => t + v, 0);
      expect(jumlah).toBeCloseTo((Number(k.amount) / Number(TOTAL)) * 100, 2);
      for (const v of weekly) expect(v).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("Σ matriks kategori = titik kurva – satu dokumen, satu rencana", async () => {
    const b = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { id: true },
    });
    const rows = await db.baselineScheduleItem.findMany({
      where: { baselineId: b.id },
      select: { weekly: true },
    });
    const ada = await titik(b.id);
    let kum = 0;
    ada.forEach((v, i) => {
      kum += rows.reduce((t, r) => t + ((r.weekly as number[])[i] ?? 0), 0);
      expect(kum).toBeCloseTo(v, 2);
    });
  });
});

describe("profil optimal vs lambat", () => {
  let titikLambat: number[] = [];

  it("optimal menghasilkan kurva BERBEDA dan lebih tinggi di minggu-minggu awal", async () => {
    const lambat = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { id: true },
    });
    titikLambat = await titik(lambat.id);

    const b = await regenerateBaseline(locationId, {
      source: "auto",
      profil: "optimal",
      userId: sessionUserId,
    });
    expect(b.unchanged).toBe(false);
    expect(b.profil).toBe("optimal");
    const titikOptimal = await titik(b.id);

    expect(titikOptimal).not.toEqual(titikLambat);
    // Yang dijanjikan ke user: awalnya LEBIH LAMBAT. Diperiksa di sepertiga
    // pertama masa kontrak, bukan pada satu minggu yang kebetulan cocok.
    const sepertiga = Math.ceil(titikLambat.length / 3);
    for (let i = 0; i < sepertiga; i++) {
      expect(titikLambat[i]).toBeLessThanOrEqual(titikOptimal[i] + 1e-9);
    }
    expect(titikLambat[sepertiga - 1]).toBeLessThan(titikOptimal[sepertiga - 1]);
    // …dan keduanya tetap rencana yang sah.
    expect(validateBaselinePoints(titikOptimal)).toBeNull();
  });

  it("regenerate TANPA profil mewarisi pilihan lokasi – tidak diam-diam balik ke lambat", async () => {
    const b = await regenerateBaseline(locationId, { source: "auto", userId: sessionUserId });
    expect(b.profil).toBe("optimal");
    // Hasilnya identik dengan yang aktif ⇒ idempoten, bukan versi baru.
    expect(b.unchanged).toBe(true);
    const aktif = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { profil: true },
    });
    expect(aktif.profil).toBe("optimal");
  });

  it("idempoten: profil sama = tidak ada versi baru, profil beda = versi baru", async () => {
    const sebelum = await db.baseline.count({ where: { locationId } });

    const sama = await regenerateBaseline(locationId, {
      source: "auto",
      profil: "optimal",
      userId: sessionUserId,
    });
    expect(sama.unchanged).toBe(true);
    expect(await db.baseline.count({ where: { locationId } })).toBe(sebelum);

    const beda = await regenerateBaseline(locationId, {
      source: "auto",
      profil: "lambat",
      userId: sessionUserId,
    });
    expect(beda.unchanged).toBe(false);
    expect(beda.profil).toBe("lambat");
    expect(await db.baseline.count({ where: { locationId } })).toBe(sebelum + 1);
    // Hanya SATU yang aktif; yang lama digantikan, bukan dihapus.
    expect(await db.baseline.count({ where: { locationId, status: "aktif" } })).toBe(1);
  });
});

describe("pilihProfilKurvaAction", () => {
  function fd(o: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.append(k, v);
    return f;
  }

  it('"manual" TIDAK membuat baseline apa pun, dan menyebut jalannya', async () => {
    const sebelum = await db.baseline.count({ where: { locationId } });
    const r = await pilihProfilKurvaAction(undefined, fd({ slug, profil: "manual" }));
    expect(r?.error).toBeUndefined();
    expect(r?.success ?? "").toMatch(/Kurva-S/i);
    // Jalannya disebutkan – "tidak terjadi apa-apa" tanpa keterangan = gagal.
    expect(r?.success ?? "").toMatch(/Excel/);
    expect(await db.baseline.count({ where: { locationId } })).toBe(sebelum);
  });

  it('"optimal" membuat baseline berprofil optimal lewat jalur layar', async () => {
    const r = await pilihProfilKurvaAction(undefined, fd({ slug, profil: "optimal" }));
    expect(r?.error).toBeUndefined();
    const aktif = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { profil: true, source: true },
    });
    expect(aktif.profil).toBe("optimal");
    expect(aktif.source).toBe("auto");
    const jejak = await db.auditLog.findFirst({
      where: { action: "baseline.profil_pilih", resourceId: locationId },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    expect((jejak?.payload as { profil?: string } | null)?.profil).toBe("optimal");
  });

  it("profil yang tidak dikenal ditolak, tidak diam-diam jatuh ke bawaan", async () => {
    const r = await pilihProfilKurvaAction(undefined, fd({ slug, profil: "ngebut" }));
    expect(r?.error ?? "").toMatch(/tidak dikenali/i);
  });
});

describe("impor HPS awal tidak lagi memaksakan kurva-S", () => {
  it("impor HPS awal lewat aksi server: revisi AKTIF, baseline NOL, layar diminta memilih", async () => {
    const pkg = await db.package.findFirstOrThrow({
      where: { orgId: sessionOrgId },
      select: { id: true },
    });
    const lok = await db.location.create({
      data: {
        packageId: pkg.id,
        name: `Lokasi impor ${suffix}`,
        slug: `lokasi-impor-${suffix}`,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
      },
      select: { id: true },
    });

    const nama = "rab-aktif-situbondo.xlsx";
    const isi = readFileSync(new URL(`../fixtures/${nama}`, import.meta.url).pathname);
    const berkas = () =>
      new File([new Uint8Array(isi)], nama, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    const fdPratinjau = new FormData();
    fdPratinjau.set("locationId", lok.id);
    fdPratinjau.set("mode", "aktifkan");
    fdPratinjau.set("file", berkas());
    const pratinjau = await importHps(undefined, fdPratinjau);
    expect(pratinjau?.error, `pratinjau gagal: ${pratinjau?.error}`).toBeUndefined();
    expect(pratinjau?.preview?.isAdendum).toBe(false);

    const fdSimpan = new FormData();
    fdSimpan.set("locationId", lok.id);
    fdSimpan.set("mode", "aktifkan");
    fdSimpan.set("file", berkas());
    fdSimpan.set("confirm", "1");
    fdSimpan.set("previewSha", pratinjau!.preview!.sha256);
    const simpan = await importHps(undefined, fdSimpan);
    expect(simpan?.error, `simpan gagal: ${simpan?.error}`).toBeUndefined();

    // RAB-nya memang aktif …
    expect(
      await db.rabRevision.count({ where: { locationId: lok.id, status: "aktif" } }),
    ).toBe(1);
    // … tetapi TIDAK ada satu pun kurva-S yang dibuatkan untuknya.
    expect(await db.baseline.count({ where: { locationId: lok.id } })).toBe(0);
    // Dan itu dikatakan, bukan didiamkan: layar diminta menawarkan pilihan.
    expect(simpan?.pilihProfil?.itemCount).toBeGreaterThan(0);
    expect(simpan?.success ?? "").toMatch(/Kurva-S BELUM dibuat/i);
  }, 300_000);

  it("lokasi baru yang RAB-nya aktif belum punya baseline sampai profilnya dipilih", async () => {
    // Lokasi KEDUA di paket yang sama: RAB aktif, tanpa satu pun baseline —
    // persis keadaan sesudah impor HPS awal dengan perilaku yang baru.
    const pkg = await db.package.findFirstOrThrow({
      where: { orgId: sessionOrgId },
      select: { id: true },
    });
    const lok = await db.location.create({
      data: {
        packageId: pkg.id,
        name: `Lokasi 2 ${suffix}`,
        slug: `lokasi2-${suffix}`,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
      },
      select: { id: true, slug: true },
    });
    const rev = await db.rabRevision.create({
      data: { locationId: lok.id, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: TOTAL },
      select: { id: true },
    });
    const kat = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        kind: "kategori",
        code: "I",
        name: "PEKERJAAN PERSIAPAN",
        amount: TOTAL,
        lineageKey: "I",
        sortOrder: 0,
      },
      select: { id: true },
    });
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        code: "1",
        name: "Pekerjaan utama",
        unit: "ls",
        volume: 1,
        unitPrice: Number(TOTAL),
        amount: TOTAL,
        lineageKey: "I#1",
        sortOrder: 1,
      },
    });
    expect(await db.baseline.count({ where: { locationId: lok.id } })).toBe(0);

    // Pilihan bawaan layar = "lambat", dan di lokasi TANPA baseline itulah yang
    // dipakai (tidak ada pilihan sebelumnya untuk diwarisi).
    const b = await regenerateBaseline(lok.id, { source: "auto", userId: sessionUserId });
    expect(b.profil).toBe("lambat");
  });
});
