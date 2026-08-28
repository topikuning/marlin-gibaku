// JEJAK UNGGAHAN TERJADWAL HARUS TERCATAT (keluhan user 2026-08-27).
//
// *"daftar laporan harian, informasi terupload ke drive tidak ada, padahal file
// sudah terupload di drive untuk hari itu, sepertinya terunggah terjadwal, tapi
// tidak ada informasi."*
//
// Persis begitu kejadiannya, dan seluruh rantainya senyap:
//
//   1. penjadwal (`gdrive/antrean.ts`) memanggil dengan `byId: null` — memang
//      tidak ada orang yang menekan tombol;
//   2. `konteksUnggah` mengubahnya jadi `""`;
//   3. `GDriveUpload.created_by_id` bertipe `uuid` dan menolak string kosong,
//      jadi INSERT-nya gagal;
//   4. `.catch(() => {})` menelan galatnya tanpa sisa.
//
// Berkasnya sampai di Drive, jejaknya tidak pernah ditulis, dan daftar laporan
// harian — yang membaca `GDriveUpload` — menulis "Belum ke Drive". Bukan cuma
// salah: itu mengundang orang mengunggah ulang berkas yang sudah ada.
//
// Diuji terhadap basis data SUNGGUHAN karena yang gagal memang penolakan tipe
// kolomnya; tiruan Prisma akan menerima "" dengan senang hati dan uji ini jadi
// hijau tanpa membuktikan apa pun.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { catatUnggah } = await import("@/lib/gdrive/upload");
const { refKeyHarian } = await import("@/lib/gdrive/kirim");

const suffix = `gd${Date.now().toString(36)}`;
let packageId = "";
let locationId = "";
let userId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `pengguna-${suffix}`,
      fullName: "Pengunggah",
      passwordHash: "x",
      role: "project_manager",
    },
    select: { id: true },
  });
  userId = u.id;
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" },
    select: { id: true },
  });
  packageId = pkg.id;
  const loc = await db.location.create({
    data: {
      packageId,
      name: `Lokasi ${suffix}`,
      slug: `l-${suffix}`,
      village: "Desa Uji",
      regency: "Kabupaten Uji",
      province: "Provinsi Uji",
    },
    select: { id: true },
  });
  locationId = loc.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE gdrive_uploads, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

function sasaran(byId: string | null) {
  return {
    packageId,
    locationId,
    rootFolderId: "folder-uji",
    kind: "laporan_harian" as const,
    refKey: refKeyHarian(`l-${suffix}`, "2026-08-26"),
    byId,
  };
}

describe("jejak unggah Drive", () => {
  it("REGRESI: unggahan TERJADWAL (tanpa pengguna) tetap tercatat", async () => {
    await catatUnggah(sasaran(null), "Laporan Harian.pdf", "sukses", {
      fileId: "berkas-1",
      webLink: "https://drive.example/berkas-1",
    });

    const baris = await db.gDriveUpload.findFirst({
      where: { packageId, refKey: sasaran(null).refKey },
      select: { status: true, createdById: true, webLink: true },
    });
    expect(baris, "jejak unggahan terjadwal WAJIB ada – ini yang dibaca daftar laporan harian").not.toBeNull();
    expect(baris?.status).toBe("sukses");
    // Tanpa pengguna berarti NULL, bukan string kosong: kolomnya uuid.
    expect(baris?.createdById).toBeNull();
    expect(baris?.webLink).toBe("https://drive.example/berkas-1");
  });

  it("unggahan MANUAL tetap membawa nama penekan tombolnya", async () => {
    await catatUnggah(sasaran(userId), "Laporan Harian Manual.pdf", "sukses", { fileId: "berkas-2" });
    const baris = await db.gDriveUpload.findFirst({
      where: { packageId, fileName: "Laporan Harian Manual.pdf" },
      select: { createdById: true },
    });
    expect(baris?.createdById).toBe(userId);
  });

  it("kegagalan mencatat TIDAK dilempar ke pemanggil, tetapi juga tidak senyap", async () => {
    /*
     * Berkasnya sudah terlanjur ada di Drive; melempar di sini hanya membuat
     * penjadwal mengulang unggahan yang sudah berhasil. Yang tidak boleh adalah
     * gagal tanpa jejak — persis cara cacat ini bertahan sekian lama.
     */
    const errs: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errs.push(a);
    });
    await expect(
      catatUnggah(
        { ...sasaran(null), packageId: "00000000-0000-0000-0000-000000000000" },
        "Yatim.pdf",
        "gagal",
        { error: "paket tidak ada" },
      ),
    ).resolves.toBeUndefined();
    spy.mockRestore();
    expect(errs.length, "kegagalan mencatat wajib muncul di log").toBeGreaterThan(0);
  });
});
