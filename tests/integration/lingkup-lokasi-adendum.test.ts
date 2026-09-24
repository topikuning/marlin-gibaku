// ADENDUM MENAMBAH / MENCABUT LOKASI (kebutuhan user 2026-09-05).
//
// Tiga ketetapan user yang diuji di sini, karena ketiganya menentukan angka:
//   1. lokasi yang dicabut DITANDAI, angka lampaunya tetap – ia hanya berhenti
//      ikut agregat paket sejak tanggal berlaku CCO;
//   2. lokasi baru mulai dari tanggal berlaku adendum;
//   3. keduanya EMPAT MATA (Program Director + AM/PM/SM) dan wajib bernomor CCO.
//      Sejak DECISIONS 613 nomor CCO lahir saat DIBERLAKUKAN di tingkat paket
//      (`aktifkanAdendumPaket`), bukan saat diajukan.
//
// Aturan empat matanya sendiri diuji murni di tests/unit/adendum-persetujuan;
// yang diuji DI SINI: gerbangnya benar-benar terpasang di jalur database, dan
// akibatnya pada bacaan lingkup yang dipakai seluruh agregat paket.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let sesi = "pd";

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => pengguna(),
    requireCapability: async () => pengguna(),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { regenerateBaseline } = await import("@/lib/rab/import");
const {
  ajukanPerubahanLingkup,
  batalkanPerubahanLingkup,
  daftarPerubahanLingkup,
  lingkupLokasi,
  setujuiPerubahanLingkup,
  LingkupError,
} = await import("@/lib/package/lingkup-lokasi");
const { aktifkanAdendumPaket } = await import("@/lib/package/aktivasi-adendum");

/** Berlakukan usulan lewat satu pintu paket – di sinilah CCO lahir. */
const berlakukan = (changeIds: string[], ccoNumber: string, tanggal: string) =>
  aktifkanAdendumPaket({
    packageId,
    revisionIds: [],
    changeIds,
    ccoNumber,
    effectiveDate: new Date(`${tanggal}T00:00:00.000Z`),
    endDateDelta: 0,
    reason: "Uji lingkup lokasi",
    valueDelta: null,
  });

const suffix = `lk${Date.now().toString(36)}`;
let orgId: string;
let packageId: string;
let lokasiA: string;
let lokasiB: string;
const orang: Record<string, string> = {};

async function pengguna() {
  return db.user.findUniqueOrThrow({
    where: { id: orang[sesi]! },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org LK ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket LK ${suffix}` } });
  packageId = pkg.id;
  const lain = await db.package.create({ data: { orgId, name: `Paket Lain ${suffix}` } });

  for (const [tag, role] of [
    ["pd", "program_director"],
    ["sm", "site_manager"],
    ["fs", "field_supervisor"],
  ] as const) {
    const u = await db.user.create({
      data: { orgId, username: `${tag}-${suffix}`, fullName: tag.toUpperCase(), passwordHash: "x", role },
    });
    orang[tag] = u.id;
  }

  const buatLokasi = async (nama: string, packageId: string) =>
    (
      await db.location.create({
        data: {
          packageId,
          name: nama,
          slug: `${nama.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`,
          village: "Desa",
          regency: "Kab",
          province: "Prov",
        },
      })
    ).id;
  lokasiA = await buatLokasi("Lokasi A", packageId);
  lokasiB = await buatLokasi("Lokasi B", packageId);

  const vendor = await db.vendor.create({ data: { orgId, name: `Vendor ${suffix}` } });
  const buatKontrak = async (pkgId: string, nomor: string) =>
    db.contract.create({
      data: {
        packageId: pkgId,
        vendorId: vendor.id,
        contractNumber: nomor,
        contractValue: 1_000_000_000n,
        durationDays: 180,
        signedDate: new Date("2026-06-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
  await buatKontrak(packageId, `K-${suffix}`);
  await buatKontrak(lain.id, `KL-${suffix}`);
});

afterAll(async () => {
  await db.locationScopeApproval.deleteMany({ where: { change: { location: { packageId } } } });
  await db.locationScopeChange.deleteMany({ where: { location: { packageId } } });
  // audit_logs append-only (trigger DB) – jejaknya memang tidak dihapus.
  // Lokasi uji punya revisi RAB + baseline; dibersihkan dari daun ke akar.
  await db.baselinePoint.deleteMany({ where: { baseline: { location: { package: { orgId } } } } });
  await db.baselineScheduleItem.deleteMany({ where: { baseline: { location: { package: { orgId } } } } });
  await db.baseline.deleteMany({ where: { location: { package: { orgId } } } });
  await db.rabNode.deleteMany({ where: { revision: { location: { package: { orgId } } } } });
  await db.rabRevision.deleteMany({ where: { location: { package: { orgId } } } });
  await db.location.deleteMany({ where: { package: { orgId } } });
  // contract_amendments & audit_logs append-only (trigger DB) – sisanya
  // ditinggal bersama org uji ini, bukan dipaksa hilang.
  // Pengguna & organisasi ditinggal: jejak audit menunjuk ke sana, dan jejak itu
  // tidak boleh dihapus.
});

describe("gerbang pengajuan", () => {
  it("draft TIDAK menuntut CCO – nomornya lahir saat diberlakukan", async () => {
    sesi = "pd";
    const { id } = await ajukanPerubahanLingkup({ locationId: lokasiB, kind: "cabut", reason: "tanpa CCO" });
    const row = await db.locationScopeChange.findUniqueOrThrow({ where: { id } });
    expect(row.amendmentId).toBeNull();
    expect(row.effectiveDate).toBeNull();
    await batalkanPerubahanLingkup(id);
  });

  it("alasan kosong ditolak – ini dokumen perubahan kontrak", async () => {
    await expect(
      ajukanPerubahanLingkup({ locationId: lokasiA, kind: "cabut", reason: "   " }),
    ).rejects.toBeInstanceOf(LingkupError);
  });
});

describe("empat mata sebelum berlaku", () => {
  let changeId: string;

  it("usulan tercatat sebagai draft, belum mengubah lingkup apa pun", async () => {
    sesi = "pd";
    changeId = (
      await ajukanPerubahanLingkup({
        locationId: lokasiA,
        kind: "cabut",
        reason: "Lokasi dipindah ke paket lain",
      })
    ).id;
    const lg = await lingkupLokasi([lokasiA, lokasiB]);
    expect(lg.dicabut.size).toBe(0);
    const daftar = await daftarPerubahanLingkup([lokasiA]);
    expect(daftar).toHaveLength(1);
    expect(daftar[0]!.status).toBe("draft");
    expect(daftar[0]!.ccoNumber).toBeNull();
  });

  it("lokasi yang sama tidak boleh punya dua usulan sekaligus", async () => {
    await expect(
      ajukanPerubahanLingkup({ locationId: lokasiA, kind: "cabut", reason: "dobel" }),
    ).rejects.toBeInstanceOf(LingkupError);
  });

  it("satu peran saja belum lengkap, dan aktivasi paket MENOLAKNYA", async () => {
    sesi = "pd";
    const h = await setujuiPerubahanLingkup(changeId);
    expect(h.lengkap).toBe(false);
    await expect(berlakukan([changeId], "CCO-00", "2026-08-01")).rejects.toThrow(/belum lengkap/i);
    expect((await lingkupLokasi([lokasiA])).dicabut.size).toBe(0);
    // Penolakan di depan: tidak ada CCO setengah jadi yang tertinggal.
    expect(await db.contractAmendment.count({ where: { ccoNumber: "CCO-00", contract: { packageId } } })).toBe(0);
  });

  it("peran yang tidak berhak ditolak", async () => {
    sesi = "fs";
    await expect(setujuiPerubahanLingkup(changeId)).rejects.toBeInstanceOf(LingkupError);
  });

  it("kursi kedua melengkapi → SIAP, tetapi BELUM berlaku tanpa CCO", async () => {
    sesi = "sm";
    const h = await setujuiPerubahanLingkup(changeId);
    expect(h.lengkap).toBe(true);
    expect((await lingkupLokasi([lokasiA])).dicabut.size).toBe(0);
  });

  it("diberlakukan lewat aktivasi paket → berlaku sejak tanggal CCO-nya", async () => {
    sesi = "pd";
    await berlakukan([changeId], "CCO-01", "2026-08-01");
    const lg = await lingkupLokasi([lokasiA, lokasiB]);
    expect(lg.dicabut.get(lokasiA)?.ccoNumber).toBe("CCO-01");
    // Lokasi lain tidak ikut tercabut.
    expect(lg.dicabut.has(lokasiB)).toBe(false);
  });

  it("yang SUDAH berlaku tidak bisa dibatalkan diam-diam", async () => {
    sesi = "pd";
    await expect(batalkanPerubahanLingkup(changeId)).rejects.toBeInstanceOf(LingkupError);
  });
});

describe("tanggal berlaku menentukan, bukan tanggal persetujuan", () => {
  it("pencabutan yang berlaku di MASA DEPAN belum mengeluarkan lokasi dari agregat", async () => {
    sesi = "pd";
    const { id } = await ajukanPerubahanLingkup({
      locationId: lokasiB,
      kind: "cabut",
      reason: "Dicabut tahun depan",
    });
    await setujuiPerubahanLingkup(id);
    sesi = "sm";
    await setujuiPerubahanLingkup(id);
    sesi = "pd";
    await berlakukan([id], "CCO-02", "2099-01-01");
    const lg = await lingkupLokasi([lokasiB]);
    expect(lg.dicabut.has(lokasiB)).toBe(false);
    // Pada tanggal berlakunya, barulah ia keluar.
    const nanti = await lingkupLokasi([lokasiB], new Date("2099-06-01T00:00:00.000Z"));
    expect(nanti.dicabut.get(lokasiB)?.ccoNumber).toBe("CCO-02");
  });
});

describe("lokasi yang MASUK lewat adendum: kurvanya mulai di tanggal berlaku", () => {
  it("minggu sebelum berlaku 0%, dan tetap tuntas 100% di akhir kontrak", async () => {
    sesi = "pd";
    // Kontrak paket ini: SPMK 1 Juni 2026, 180 hari. Adendum berlaku 1 Agustus
    // 2026; minggu-1 = 1–7 Juni, jadi 1 Agustus jatuh di MINGGU KE-9 — delapan
    // minggu pertama bukan urusan lokasi ini.
    const kontrak = await db.contract.findFirstOrThrow({
      where: { packageId },
      select: { id: true },
    });
    await db.contract.update({
      where: { id: kontrak.id },
      data: { startDate: new Date("2026-06-01T00:00:00.000Z"), weekMode: "tujuh_hari" },
    });
    const lok = await db.location.create({
      data: {
        packageId,
        name: `Lokasi Baru ${suffix}`,
        slug: `lok-baru-${suffix}`,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
      },
      select: { id: true },
    });
    const rev = await db.rabRevision.create({
      data: {
        locationId: lok.id,
        revisionNo: 1,
        status: "aktif",
        source: "hps_awal",
        totalValue: 100_000_000n,
      },
      select: { id: true },
    });
    const kat = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        kind: "kategori",
        code: "I",
        name: "PEKERJAAN PERSIAPAN",
        amount: 100_000_000n,
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
        name: "Galian Tanah",
        unit: "m3",
        volume: 100,
        unitPrice: 1_000_000,
        amount: 100_000_000n,
        lineageKey: "I#1",
        sortOrder: 1,
      },
    });

    const tanpaAdendum = await regenerateBaseline(lok.id, { source: "auto", userId: orang.pd! });
    const titikAwal = await db.baselinePoint.findMany({
      where: { baselineId: tanpaAdendum.id },
      orderBy: { weekNumber: "asc" },
      select: { plannedPct: true },
    });
    // Tanpa adendum, minggu-1 sudah bergerak – itu pembanding untuk uji di bawah.
    expect(Number(titikAwal[0]!.plannedPct)).toBeGreaterThan(0);

    const { id: changeId } = await ajukanPerubahanLingkup({
      locationId: lok.id,
      kind: "tambah",
      reason: "Lokasi tambahan lewat CCO-03",
    });
    await setujuiPerubahanLingkup(changeId);
    sesi = "sm";
    await setujuiPerubahanLingkup(changeId);
    sesi = "pd";
    const hasil = await berlakukan([changeId], "CCO-03", "2026-08-01");
    // Lokasi masuk membawa seluruh RAB-nya: 100 jt pra-PPN → 111 jt (PPN 11%).
    expect(hasil.valueDeltaRab).toBe(111_000_000n);
    expect(hasil.valueDelta).toBe(111_000_000n);

    // Aktivasi sendiri yang membuat ulang kurva-S lokasi tambahan – tidak ada
    // langkah manual "hitung ulang" yang bisa terlupa.
    const baru = await db.baseline.findFirstOrThrow({
      where: { locationId: lok.id, status: "aktif" },
      select: { id: true },
    });
    expect(baru.id).not.toBe(tanpaAdendum.id);
    const titik = await db.baselinePoint.findMany({
      where: { baselineId: baru.id },
      orderBy: { weekNumber: "asc" },
      select: { weekNumber: true, plannedPct: true },
    });
    // Minggu 1..8 = sebelum tanggal berlaku → 0%. Bukan "tertinggal": lokasinya
    // memang belum ada dalam kontrak saat itu.
    for (const t of titik.filter((x) => x.weekNumber < 9)) {
      expect(Number(t.plannedPct)).toBeCloseTo(0, 6);
    }
    // Minggu berlakunya sudah bergerak, dan akhirnya tetap tuntas 100%.
    expect(Number(titik.find((t) => t.weekNumber === 9)!.plannedPct)).toBeGreaterThan(0);
    expect(Number(titik[titik.length - 1]!.plannedPct)).toBeCloseTo(100, 3);
  });
});
