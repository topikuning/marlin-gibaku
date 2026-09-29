/*
 * RESET LAPORAN HARIAN SATU LOKASI (DECISIONS 630).
 *
 * Permintaan user 2026-09-29: hapus semua laporan harian satu lokasi – data
 * dan foto bertagging dihapus TOTAL – dan hanya super admin UTAMA yang boleh.
 * Cakupan pilihan user: foto laporan + Foto Cepat; temuan, verifikasi, dan
 * kendala yang menempel ke laporan ikut dihapus.
 *
 * Yang dijaga di sini:
 * - semua itu benar-benar hilang, termasuk berkasnya di R2;
 * - lokasi LAIN tidak tersentuh sama sekali;
 * - temuan yang TIDAK menempel ke laporan tetap ada (hanya bukti fotonya dilepas);
 * - super admin biasa ditolak, dan nama lokasi wajib diketik persis.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
const suffix = `rh${Date.now().toString(36)}`;
process.env.SUPER_ADMIN_UTAMA = `akar-${suffix}`;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const terhapus: string[] = [];
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2HapusBanyak: async (keys: string[]) => {
    terhapus.push(...keys);
    return { terhapus: keys.length, gagal: [] };
  },
}));

type UserUji = { id: string; orgId: string; username: string; role: "super_admin" | "site_manager" };
let sebagai: UserUji | null = null;
vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  return {
    requireCapability: async (cap: string) => {
      if (!sebagai || !can(sebagai.role, cap as never)) throw new Error("FORBIDDEN");
      return sebagai;
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { resetHarianLokasiAction } = await import("@/lib/reset-harian/actions");
const { ringkasResetHarian } = await import("@/lib/reset-harian/service");

let akar: UserUji;
let adminBiasa: UserUji;
let lokA = { id: "", name: "" };
let lokB = { id: "", name: "" };
let temuanLokasi = "";
let lapB = "";

async function isiLokasi(locationId: string, tag: string, userId: string) {
  const lap = await db.dailyReport.create({
    data: { locationId, reportDate: new Date("2026-09-01"), status: "final", createdById: userId },
  });
  await db.dailyReportStatusHistory.create({ data: { reportId: lap.id, toStatus: "final", changedById: userId } });
  const foto = await db.photo.create({
    data: {
      locationId,
      reportId: lap.id,
      r2Key: `photos/${tag}/lap.webp`,
      thumbnailKey: `photos/${tag}/lap.thumb.webp`,
      originalKey: `photos/${tag}/lap.asli.jpg`,
      sha256: `sha-${tag}-1`,
      bytes: 100,
      uploadedById: userId,
    },
  });
  await db.photo.create({
    data: { locationId, r2Key: `photos/${tag}/cepat.webp`, sha256: `sha-${tag}-2`, bytes: 100, uploadedById: userId },
  });
  const t = await db.finding.create({
    data: {
      locationId,
      reportId: lap.id,
      category: "mutu",
      severity: "sedang",
      title: `Temuan laporan ${tag}`,
      findingDate: new Date("2026-09-01"),
      status: "baru",
      raisedById: userId,
    },
  });
  await db.findingStatusHistory.create({ data: { findingId: t.id, toStatus: "baru", changedById: userId } });
  await db.reportVerification.create({ data: { reportId: lap.id, status: "diverifikasi", verifiedById: userId } });
  const k = await db.issue.create({
    data: { locationId, reportId: lap.id, title: `Kendala ${tag}`, severity: "sedang", status: "terbuka" },
  });
  await db.recoveryAction.create({ data: { issueId: k.id, description: "Tambah tukang" } });
  return { lap: lap.id, foto: foto.id };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  const buat = async (username: string, role: UserUji["role"]): Promise<UserUji> => {
    const u = await db.user.create({
      data: { orgId: org.id, username, fullName: username, passwordHash: "x", role },
      select: { id: true },
    });
    return { id: u.id, orgId: org.id, username, role };
  };
  akar = await buat(`akar-${suffix}`, "super_admin");
  adminBiasa = await buat(`admin-${suffix}`, "super_admin");
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  const lokasi = async (nama: string) =>
    db.location.create({
      data: {
        packageId: pkg.id,
        name: nama,
        slug: `${nama.toLowerCase().replace(/\s+/g, "-")}-${suffix}`,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
        status: "berjalan",
        isActive: true,
      },
      select: { id: true, name: true },
    });
  lokA = await lokasi("Klidang Lor");
  lokB = await lokasi("Pasir");
  const a = await isiLokasi(lokA.id, `a-${suffix}`, akar.id);
  lapB = (await isiLokasi(lokB.id, `b-${suffix}`, akar.id)).lap;
  // Temuan tingkat LOKASI (tanpa laporan) yang memakai foto laporan sebagai bukti.
  temuanLokasi = (
    await db.finding.create({
      data: {
        locationId: lokA.id,
        category: "k3",
        severity: "rendah",
        title: "Temuan lokasi",
        findingDate: new Date("2026-09-02"),
        status: "baru",
        raisedById: akar.id,
      },
    })
  ).id;
  await db.evidenceLink.create({ data: { findingId: temuanLokasi, photoId: a.foto, addedById: akar.id } });
});

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("reset laporan harian lokasi", () => {
  it("ringkasan menyebut semua yang akan hilang", async () => {
    expect(await ringkasResetHarian(lokA.id)).toMatchObject({
      laporan: 1,
      fotoLaporan: 1,
      fotoCepat: 1,
      temuan: 1,
      verifikasi: 1,
      kendala: 1,
      dari: "2026-09-01",
      sampai: "2026-09-01",
    });
  });

  it("super admin BIASA ditolak – hanya super admin utama", async () => {
    sebagai = adminBiasa;
    const r = await resetHarianLokasiAction(undefined, fd({ locationId: lokA.id, konfirmasi: lokA.name }));
    expect(r?.error).toMatch(/super admin utama/);
    expect(await db.dailyReport.count({ where: { locationId: lokA.id } })).toBe(1);
  });

  it("nama lokasi yang salah ketik ditolak", async () => {
    sebagai = akar;
    const r = await resetHarianLokasiAction(undefined, fd({ locationId: lokA.id, konfirmasi: "Klidang" }));
    expect(r?.error).toMatch(/Ketik nama lokasi persis/);
    expect(await db.dailyReport.count({ where: { locationId: lokA.id } })).toBe(1);
  });

  it("super admin utama: semuanya hilang total, lokasi lain utuh", async () => {
    sebagai = akar;
    const r = await resetHarianLokasiAction(undefined, fd({ locationId: lokA.id, konfirmasi: lokA.name }));
    expect(r?.success, r?.error).toMatch(/1 laporan harian Klidang Lor dihapus, bersama 2 foto/);

    const idLapA = (await db.dailyReport.findMany({ where: { locationId: lokA.id } })).map((l) => l.id);
    expect(idLapA).toEqual([]);
    expect(await db.photo.count({ where: { locationId: lokA.id } })).toBe(0);
    expect(await db.issue.count({ where: { locationId: lokA.id } })).toBe(0);
    expect(await db.finding.count({ where: { locationId: lokA.id, reportId: { not: null } } })).toBe(0);
    // Berkas ber-cap, thumbnail, dan berkas asli ikut dihapus dari R2.
    expect(terhapus).toEqual(
      expect.arrayContaining([
        `photos/a-${suffix}/lap.webp`,
        `photos/a-${suffix}/lap.thumb.webp`,
        `photos/a-${suffix}/lap.asli.jpg`,
        `photos/a-${suffix}/cepat.webp`,
      ]),
    );
    expect(terhapus.some((k) => k.includes(`b-${suffix}`))).toBe(false);

    // Temuan tingkat lokasi tetap ada; hanya bukti fotonya yang dilepas.
    expect(await db.finding.findUnique({ where: { id: temuanLokasi } })).not.toBeNull();
    expect(await db.evidenceLink.count({ where: { findingId: temuanLokasi } })).toBe(0);

    // Lokasi B tidak tersentuh.
    expect(await ringkasResetHarian(lokB.id)).toMatchObject({
      laporan: 1,
      fotoLaporan: 1,
      fotoCepat: 1,
      temuan: 1,
      verifikasi: 1,
      kendala: 1,
    });

    // Jejaknya tercatat.
    expect(await db.auditLog.count({ where: { action: "location.daily_reset", resourceId: lokA.id } })).toBe(1);
  });

  it("riwayat & verifikasi tetap append-only selama induknya masih ada", async () => {
    await expect(db.dailyReportStatusHistory.deleteMany({ where: { reportId: lapB } })).rejects.toThrow(/append-only/);
    await expect(db.reportVerification.deleteMany({ where: { reportId: lapB } })).rejects.toThrow(/append-only/);
    const temuanB = await db.finding.findFirstOrThrow({ where: { reportId: lapB } });
    await expect(db.findingStatusHistory.deleteMany({ where: { findingId: temuanB.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      db.dailyReportStatusHistory.updateMany({ where: { reportId: lapB }, data: { reason: "ubah" } }),
    ).rejects.toThrow(/append-only/);
  });
});
