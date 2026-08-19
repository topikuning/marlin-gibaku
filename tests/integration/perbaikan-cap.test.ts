// Perbaikan cap foto + penghapusan arsip asli (DECISIONS 198).
//
// Permintaan user 2026-08-01: "ada fitur perbaikan stamp, itu tujuan utamaku.
// jadi kalau ada kesalahan masih bisa diperbaiki" + "foto asli nanti bisa
// dihapus, tapi atas mauku".
//
// Dua fitur ini bertolak belakang dengan sengaja: yang satu bergantung pada
// arsip asli, yang satu menghapusnya. Karena itu yang diuji paling keras di
// sini adalah SAMBUNGANNYA — setelah arsip dihapus, perbaikan cap harus
// menolak dengan sebab yang benar, bukan gagal dengan pesan yang menyesatkan.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** R2 palsu di memori — isi berkas tidak penting, keberadaannya yang diuji. */
const bucket = new Map<string, Buffer>();
const dihapus: string[] = [];
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async (key: string, body: Buffer) => {
    bucket.set(key, Buffer.from(body));
  },
  r2GetBuffer: async (key: string) => {
    const b = bucket.get(key);
    if (!b) throw new Error(`objek tidak ada: ${key}`);
    return b;
  },
  r2Delete: async (key: string) => {
    dihapus.push(key);
    bucket.delete(key);
  },
  r2PresignGet: async (key: string) => `https://contoh/${key}`,
  classifyR2Error: (e: unknown) => String(e),
}));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";
let scopedLocations: string[] | null = null;

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Aktor" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => scopedLocations,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async (_u: unknown, locationId: string) => {
      if (scopedLocations !== null && !scopedLocations.includes(locationId)) {
        throw new ForbiddenError("Tidak punya akses ke lokasi ini");
      }
    },
  };
});

const { db } = await import("@/lib/db");
const { restampPhotoAction, purgeOneOriginalAction, purgeOriginalsAction } = await import(
  "@/lib/photo-restamp/actions"
);

const suffix = `pc${Date.now().toString(36)}`;
let orgId = "";
let packageId = "";
let locId = "";
let locLainId = "";
let kegiatanId = "";
let kegiatanLainId = "";
let fotoId = "";

/** JPEG 1×1 yang sah — cukup untuk sharp; kalau sharp mati, jalur fallback tetap jalan. */
const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

function fdRestamp(o: Record<string, string>): FormData {
  const f = new FormData();
  f.set("photoId", fotoId);
  f.set("reason", "koordinat lokasi salah saat foto diunggah");
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

/**
 * Setiap tes memakai LOKASI + kegiatan sendiri. Baris lama tidak pernah
 * dihapus: `photo_stamp_revisions` append-only (trigger DB), dan menghapus
 * foto akan meng-cascade ke sana — jadi isolasi dilakukan lewat data baru,
 * bukan pembersihan.
 */
async function buatLokasiBaru(): Promise<{ locationId: string; activityId: string }> {
  const tag = Math.random().toString(36).slice(2, 9);
  const l = await db.location.create({
    data: {
      packageId,
      name: `Pengaradan ${tag}`,
      slug: `pengaradan-${suffix}-${tag}`,
      village: "Pengaradan",
      regency: "Brebes",
      province: "Jawa Tengah",
      gpsLat: "-6.8472020",
      gpsLng: "108.8789000",
    },
    select: { id: true },
  });
  const a = await db.fieldActivity.create({
    data: {
      locationId: l.id,
      activityDate: new Date("2026-07-31T00:00:00.000Z"),
      type: "lainnya",
      title: "Peninjauan Lapangan Bersama",
      createdById: sessionUserId,
    },
    select: { id: true },
  });
  return { locationId: l.id, activityId: a.id };
}

async function buatFoto(over: Record<string, unknown> = {}) {
  const kunci = `photos/lok/2026-07-31/${Math.random().toString(36).slice(2)}`;
  bucket.set(`${kunci}.webp`, Buffer.from("bercap"));
  bucket.set(`${kunci}.thumb.webp`, Buffer.from("thumb"));
  bucket.set(`${kunci}.asli.jpg`, JPEG_1X1);
  const p = await db.photo.create({
    data: {
      locationId: locId,
      // photos_parent_xor_ck: setiap foto WAJIB menempel pada TEPAT satu
      // induk (laporan harian ATAU kegiatan lapangan).
      activityId: kegiatanId,
      r2Key: `${kunci}.webp`,
      thumbnailKey: `${kunci}.thumb.webp`,
      originalKey: `${kunci}.asli.jpg`,
      originalBytes: JPEG_1X1.length,
      sha256: Math.random().toString(36).slice(2),
      bytes: 100,
      exifTakenAt: new Date("2026-07-31T00:00:00.000Z"),
      exifGpsLat: "-6.8472020",
      exifGpsLng: "108.8789000",
      gpsSource: "project",
      metadataSource: "server",
      stampPhotoId: "PEN-260731-0700-006",
      uploadedById: sessionUserId,
      ...over,
    },
    select: { id: true },
  });
  return p.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org PC ${suffix}`, slug: `pc-${suffix}` } });
  orgId = org.id;
  sessionOrgId = orgId;
  const u = await db.user.create({
    data: { orgId, username: `pc-${suffix}`, fullName: "Aktor", role: "super_admin", passwordHash: "x" },
  });
  sessionUserId = u.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket PC ${suffix}` } });
  packageId = pkg.id;
  const l1 = await db.location.create({
    data: {
      packageId,
      name: "Pengaradan",
      slug: `pengaradan-${suffix}`,
      village: "Pengaradan",
      regency: "Brebes",
      province: "Jawa Tengah",
      gpsLat: "-6.8472020",
      gpsLng: "108.8789000",
    },
  });
  locId = l1.id;
  const l2 = await db.location.create({
    data: {
      packageId,
      name: "Lain",
      slug: `lain-${suffix}`,
      village: "Lain",
      regency: "K",
      province: "P",
    },
  });
  locLainId = l2.id;

  kegiatanLainId = (
    await db.fieldActivity.create({
      data: {
        locationId: locLainId,
        activityDate: new Date("2026-07-31T00:00:00.000Z"),
        type: "lainnya",
        title: "Kegiatan lain",
        createdById: sessionUserId,
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  // photo_stamp_revisions & audit_logs append-only → foto, lokasi, paket,
  // user, dan organisasi SENGAJA tidak dibersihkan (menghapusnya memicu
  // cascade DELETE yang ditolak trigger). Isolasi dijaga lewat data baru.
  await db.$disconnect();
});

beforeEach(async () => {
  role = "super_admin";
  scopedLocations = null;
  dihapus.length = 0;
  const baru = await buatLokasiBaru();
  locId = baru.locationId;
  kegiatanId = baru.activityId;
  fotoId = await buatFoto();
});

describe("KASUS INTI: cap salah bisa diperbaiki", () => {
  it("render ulang dari berkas ASLI, bukan mengecap di atas cap lama", async () => {
    const sebelum = await db.photo.findUniqueOrThrow({
      where: { id: fotoId },
      select: { r2Key: true, thumbnailKey: true, originalKey: true },
    });
    const res = await restampPhotoAction(undefined, fdRestamp({ reporterName: "Nama Benar" }));
    expect(res?.error).toBeUndefined();
    expect(res?.ok).toMatch(/revisi 1/i);

    const p = await db.photo.findUniqueOrThrow({
      where: { id: fotoId },
      select: { r2Key: true, stampRevision: true, originalKey: true, stampPhotoId: true },
    });
    expect(p.stampRevision).toBe(1);
    // Berkas ber-cap LAMA dibuang; arsip ASLI tetap utuh — itu sumber revisi
    // berikutnya, jadi tidak boleh ikut hilang.
    expect(p.r2Key).not.toBe(sebelum.r2Key);
    expect(dihapus).toContain(sebelum.r2Key);
    expect(dihapus).toContain(sebelum.thumbnailKey);
    expect(dihapus).not.toContain(sebelum.originalKey);
    expect(p.originalKey).toBe(sebelum.originalKey);
    expect(bucket.has(p.originalKey!)).toBe(true);
    // Photo ID TIDAK berubah — identitas itu sudah beredar di berkas KKP.
    expect(p.stampPhotoId).toBe("PEN-260731-0700-006");
  });

  it("mencatat riwayat sebelum→sesudah + field yang diketik manual", async () => {
    await restampPhotoAction(undefined, fdRestamp({ reporterName: "Nama Benar" }));
    const r = await db.photoStampRevision.findFirstOrThrow({
      where: { photoId: fotoId },
      select: { revision: true, reason: true, manualFields: true, before: true, after: true },
    });
    expect(r.revision).toBe(1);
    expect(r.reason).toMatch(/koordinat lokasi salah/i);
    expect(r.manualFields).toContain("reporterName");
    expect((r.before as { pelapor?: string }).pelapor).toBe("Aktor");
    expect((r.after as { pelapor?: string }).pelapor).toBe("Nama Benar");
    // Yang TIDAK diubah tidak boleh ikut tercatat sebagai ketikan manusia.
    expect(r.manualFields).not.toContain("koordinat");
  });

  it("koordinat yang diketik ditandai `manual` – bukan diam-diam jadi bukti GPS", async () => {
    await restampPhotoAction(undefined, fdRestamp({ lat: "-6.9", lng: "109.1" }));
    const p = await db.photo.findUniqueOrThrow({
      where: { id: fotoId },
      select: { gpsSource: true, exifGpsLat: true },
    });
    expect(p.gpsSource).toBe("manual");
    expect(Number(p.exifGpsLat)).toBeCloseTo(-6.9, 5);
  });

  it("koordinat yang persis titik proyek tetap `project`, bukan `manual`", async () => {
    // Bedanya penting: `manual` = pernyataan manusia, `project` = cadangan
    // sistem. Menandai cadangan sebagai pernyataan manusia sama menyesatkannya.
    await restampPhotoAction(undefined, fdRestamp({ lat: "-6.847202", lng: "108.8789", reporterName: "X" }));
    const p = await db.photo.findUniqueOrThrow({ where: { id: fotoId }, select: { gpsSource: true } });
    expect(p.gpsSource).toBe("project");
  });

  it("mengosongkan koordinat membuang koordinat dari cap", async () => {
    await restampPhotoAction(undefined, fdRestamp({ lat: "", lng: "" }));
    const p = await db.photo.findUniqueOrThrow({
      where: { id: fotoId },
      select: { gpsSource: true, exifGpsLat: true, exifGpsLng: true },
    });
    expect(p.gpsSource).toBe("none");
    expect(p.exifGpsLat).toBeNull();
    expect(p.exifGpsLng).toBeNull();
  });

  it("revisi kedua menambah nomor, bukan menimpa riwayat", async () => {
    await restampPhotoAction(undefined, fdRestamp({ reporterName: "Satu" }));
    await restampPhotoAction(undefined, fdRestamp({ reporterName: "Dua" }));
    const semua = await db.photoStampRevision.findMany({
      where: { photoId: fotoId },
      orderBy: { revision: "asc" },
      select: { revision: true },
    });
    expect(semua.map((r) => r.revision)).toEqual([1, 2]);
  });
});

describe("pagar perbaikan cap", () => {
  it("alasan wajib diisi", async () => {
    const f = fdRestamp({ reporterName: "X" });
    f.set("reason", "");
    const res = await restampPhotoAction(undefined, f);
    expect(res?.error).toMatch(/alasan/i);
  });

  it("tanpa perubahan ditolak – perbaikan kosong hanya membuang berkas lama", async () => {
    // Form sungguhan selalu mengirim nilai yang SEDANG berlaku; menekan Simpan
    // tanpa mengubah apa pun berarti mengirim itu kembali.
    const lok = await db.location.findUniqueOrThrow({ where: { id: locId }, select: { name: true } });
    const res = await restampPhotoAction(
      undefined,
      fdRestamp({
        lat: "-6.847202",
        lng: "108.8789",
        locationLabel: lok.name,
        companyName: `Org PC ${suffix}`,
        reporterName: "Aktor",
        categoryName: "Peninjauan Lapangan Bersama",
      }),
    );
    expect(res?.error).toMatch(/tidak ada yang berubah/i);
  });

  it("koordinat di luar Indonesia ditolak", async () => {
    const res = await restampPhotoAction(undefined, fdRestamp({ lat: "48.85", lng: "2.35" }));
    expect(res?.error).toBeTruthy();
    const p = await db.photo.findUniqueOrThrow({ where: { id: fotoId }, select: { stampRevision: true } });
    expect(p.stampRevision).toBe(0);
  });

  it("peran tanpa photo.restamp ditolak", async () => {
    role = "project_manager";
    const res = await restampPhotoAction(undefined, fdRestamp({ reporterName: "X" }));
    expect(res?.error).toMatch(/izin/i);
  });

  it("lokasi di luar penugasan ditolak", async () => {
    scopedLocations = [locLainId];
    const res = await restampPhotoAction(undefined, fdRestamp({ reporterName: "X" }));
    expect(res?.error).toMatch(/akses/i);
  });

  it("foto TANPA arsip asli ditolak, dan sebabnya dibedakan", async () => {
    // (a) tidak pernah diarsipkan (foto lama)
    fotoId = await buatFoto({ originalKey: null, originalBytes: null });
    const lama = await restampPhotoAction(undefined, fdRestamp({ reporterName: "X" }));
    expect(lama?.error).toMatch(/sebelum arsip berkas asli aktif/i);

    // (b) arsipnya SENGAJA dihapus — pesannya harus beda, bukan menyamakan
    // "tidak pernah ada" dengan "kamu yang menghapusnya".
    fotoId = await buatFoto({ originalKey: null, originalPurgedAt: new Date() });
    const purged = await restampPhotoAction(undefined, fdRestamp({ reporterName: "X" }));
    expect(purged?.error).toMatch(/sudah dihapus/i);
  });
});

describe("hapus arsip foto asli", () => {
  it("satu foto: berkas hilang, baris ditandai, cap tidak bisa diperbaiki lagi", async () => {
    const asli = (await db.photo.findUniqueOrThrow({ where: { id: fotoId }, select: { originalKey: true } }))
      .originalKey!;
    const f = new FormData();
    f.set("photoId", fotoId);
    const res = await purgeOneOriginalAction(undefined, f);
    expect(res?.ok).toMatch(/tidak bisa diperbaiki lagi/i);
    expect(dihapus).toContain(asli);

    const p = await db.photo.findUniqueOrThrow({
      where: { id: fotoId },
      select: { originalKey: true, originalPurgedAt: true, originalPurgedById: true, r2Key: true },
    });
    expect(p.originalKey).toBeNull();
    expect(p.originalPurgedAt).not.toBeNull();
    expect(p.originalPurgedById).toBe(sessionUserId);
    // Foto ber-capnya TETAP ada — yang dihapus cuma arsip aslinya.
    expect(bucket.has(p.r2Key)).toBe(true);

    const lanjut = await restampPhotoAction(undefined, fdRestamp({ reporterName: "X" }));
    expect(lanjut?.error).toMatch(/sudah dihapus/i);
  });

  it("borongan: wajib mengetik HAPUS", async () => {
    const f = new FormData();
    f.set("konfirmasi", "ya");
    const res = await purgeOriginalsAction(undefined, f);
    expect(res?.error).toMatch(/ketik HAPUS/i);
    const p = await db.photo.findUniqueOrThrow({ where: { id: fotoId }, select: { originalKey: true } });
    expect(p.originalKey).not.toBeNull();
  });

  it("borongan berfilter lokasi: hanya yang cocok yang terhapus", async () => {
    const lain = await db.photo.create({
      data: {
        locationId: locLainId,
        activityId: kegiatanLainId,
        r2Key: `photos/lain/${suffix}.webp`,
        originalKey: `photos/lain/${suffix}.asli.jpg`,
        originalBytes: 10,
        sha256: `x${suffix}`,
        bytes: 10,
        uploadedById: sessionUserId,
      },
      select: { id: true },
    });
    bucket.set(`photos/lain/${suffix}.asli.jpg`, JPEG_1X1);

    const f = new FormData();
    f.set("konfirmasi", "HAPUS");
    f.set("locationId", locId);
    const res = await purgeOriginalsAction(undefined, f);
    expect(res?.ok).toMatch(/1 arsip asli dihapus/i);

    const target = await db.photo.findUniqueOrThrow({ where: { id: fotoId }, select: { originalKey: true } });
    expect(target.originalKey).toBeNull();
    const luar = await db.photo.findUniqueOrThrow({ where: { id: lain.id }, select: { originalKey: true } });
    expect(luar.originalKey).not.toBeNull();
  });

  it("filter yang tidak cocok apa pun ditolak, bukan 'berhasil menghapus 0'", async () => {
    const kosong = await buatLokasiBaru(); // lokasi baru, belum punya foto
    const f = new FormData();
    f.set("konfirmasi", "HAPUS");
    f.set("locationId", kosong.locationId);
    const res = await purgeOriginalsAction(undefined, f);
    expect(res?.error).toMatch(/tidak ada arsip asli yang cocok/i);
  });

  it("peran tanpa photo.archive_purge ditolak", async () => {
    role = "project_manager";
    const f = new FormData();
    f.set("konfirmasi", "HAPUS");
    const res = await purgeOriginalsAction(undefined, f);
    expect(res?.error).toMatch(/izin/i);
  });
});
