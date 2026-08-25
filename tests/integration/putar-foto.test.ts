/*
 * PUTAR FOTO — simulasi utuh (DECISIONS 424).
 *
 * Permintaan user 2026-08-23: *"coba simulasikan rotasimu, sepertinya
 * bermasalah"*. Uji unit `putaran-bingkai` hanya membuktikan ATURANNYA; yang
 * belum pernah dijalani adalah jalur nyatanya: ambil berkas ASLI dari R2,
 * putar, cap ulang, tulis objek baru, perbarui baris, catat revisi.
 *
 * R2 diganti penyimpanan dalam memori, TAPI sharp-nya sungguhan — kalau tidak,
 * yang diuji cuma "tidak melempar", dan foto bisa saja tersimpan tanpa berputar
 * sama sekali. Yang diperiksa: dimensinya benar-benar TERTUKAR.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Bucket palsu: objek benar-benar disimpan supaya isinya bisa diperiksa. */
const bucket = new Map<string, Buffer>();
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async (key: string, body: Buffer) => {
    bucket.set(key, body);
  },
  r2GetBuffer: async (key: string) => {
    const b = bucket.get(key);
    if (!b) throw new Error(`objek tidak ada: ${key}`);
    return b;
  },
  r2Delete: async (key: string) => {
    bucket.delete(key);
  },
  r2PresignGet: async () => "https://contoh.invalid/x",
}));

let aktor = "";
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => db.user.findUniqueOrThrow({ where: { id: aktor } }),
    requireCapability: async () => db.user.findUniqueOrThrow({ where: { id: aktor } }),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { putarFotoAction } = await import("@/lib/photo-restamp/actions");
const sharpMod = await import("sharp");
const sharp = sharpMod.default;

const suffix = `pf${Date.now().toString(36)}`;
let photoId = "";
let locationId = "";

/** JPEG lanskap 400×200: separuh kiri merah, separuh kanan biru. */
async function fotoLanskap(): Promise<Buffer> {
  const merah = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 220, g: 20, b: 20 } } })
    .png()
    .toBuffer();
  const biru = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 20, g: 20, b: 220 } } })
    .png()
    .toBuffer();
  return sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: merah, left: 0, top: 0 },
      { input: biru, left: 200, top: 0 },
    ])
    .jpeg()
    .toBuffer();
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org PF ${suffix}`, slug: `org-pf-${suffix}` } });
  const user = await db.user.create({
    data: {
      orgId: org.id,
      username: `pf-${suffix}`,
      fullName: "Mandor PF",
      passwordHash: "x",
      role: "site_manager",
    },
  });
  aktor = user.id;
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket PF ${suffix}`, stage: "pelaksanaan", createdById: user.id },
  });
  const lok = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi PF",
      slug: `lokasi-pf-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = lok.id;

  const asli = await fotoLanskap();
  const kunciAsli = `photos/${lok.slug}/2026-08-23/asli.jpg`;
  const kunciCap = `photos/${lok.slug}/2026-08-23/cap.webp`;
  bucket.set(kunciAsli, asli);
  bucket.set(kunciCap, await sharp(asli).webp().toBuffer());

  const foto = await db.photo.create({
    data: {
      locationId: lok.id,
      r2Key: kunciCap,
      originalKey: kunciAsli,
      sha256: `sha-${suffix}`,
      bytes: asli.length,
      widthPx: 400,
      heightPx: 200,
      gpsSource: "none",
      metadataSource: "server",
      uploadedById: user.id,
      exifTakenAt: new Date("2026-08-23T01:00:00.000Z"),
    },
  });
  photoId = foto.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

function fd(arah: "kiri" | "kanan") {
  const f = new FormData();
  f.set("photoId", photoId);
  f.set("arah", arah);
  return f;
}

describe("putarFotoAction", () => {
  it("memutar 90° ke kanan: dimensi TERTUKAR dan isinya benar-benar berputar", async () => {
    const hasil = await putarFotoAction(undefined, fd("kanan"));
    expect(hasil?.error, hasil?.error).toBeUndefined();

    const foto = await db.photo.findUniqueOrThrow({ where: { id: photoId } });
    // 400×200 → 200×400. Kalau ini tidak tertukar, tidak ada yang berputar.
    expect(foto.widthPx).toBe(200);
    expect(foto.heightPx).toBe(400);
    expect(foto.stampRevision).toBe(1);

    const berkas = bucket.get(foto.r2Key);
    expect(berkas, "objek hasil tidak tertulis ke penyimpanan").toBeDefined();
    const meta = await sharp(berkas!).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(400);

    /*
     * Arah putarannya diperiksa dari WARNA, bukan cuma dari dimensi: gambar
     * yang diputar ke arah yang salah juga menghasilkan dimensi tertukar.
     * Putar KANAN 90° → separuh KIRI (merah) naik ke ATAS.
     */
    const px = await sharp(berkas!).removeAlpha().raw().toBuffer();
    const warna = (x: number, y: number) => {
      const i = (y * 200 + x) * 3;
      return { r: px[i], b: px[i + 2] };
    };
    const atas = warna(100, 20);
    const bawah = warna(100, 380);
    expect(atas.r, `atas seharusnya MERAH, dapat r=${atas.r} b=${atas.b}`).toBeGreaterThan(atas.b);
    expect(bawah.b, `bawah seharusnya BIRU, dapat r=${bawah.r} b=${bawah.b}`).toBeGreaterThan(bawah.r);
  });

  it("berkas ASLI tidak ikut berputar – ia arsip, bukan salinan kerja", async () => {
    const foto = await db.photo.findUniqueOrThrow({ where: { id: photoId } });
    const asli = bucket.get(foto.originalKey!);
    const meta = await sharp(asli!).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(200);
  });

  it("MENUMPUK: kanan dua kali = 180°, bukan 90° lagi", async () => {
    /*
     * Inti DECISIONS 424c. Setiap penekanan merender ulang dari ARSIP ASLI —
     * jadi tanpa putaran kumulatif, penekanan kedua mulai dari nol dan
     * tombolnya tampak macet. Ini yang ketahuan saat menyimulasikan tombolnya.
     */
    const hasil = await putarFotoAction(undefined, fd("kanan"));
    expect(hasil?.error, hasil?.error).toBeUndefined();
    const foto = await db.photo.findUniqueOrThrow({ where: { id: photoId } });
    expect(foto.rotationDeg).toBe(180);
    // 180° dari lanskap = lanskap lagi.
    expect(foto.widthPx).toBe(400);
    expect(foto.heightPx).toBe(200);
    expect(foto.stampRevision).toBe(2);

    // Dan isinya benar-benar terbalik: separuh kiri kini BIRU.
    const px = await sharp(bucket.get(foto.r2Key)!).removeAlpha().raw().toBuffer();
    const i = (20 * 400 + 20) * 3;
    expect(px[i + 2], "kiri-atas seharusnya BIRU setelah 180°").toBeGreaterThan(px[i]);
  });

  it("kiri sesudah kanan MENGEMBALIKAN ke tegak, bukan meloncat ke 270°", async () => {
    const hasil = await putarFotoAction(undefined, fd("kiri"));
    expect(hasil?.error, hasil?.error).toBeUndefined();
    const foto = await db.photo.findUniqueOrThrow({ where: { id: photoId } });
    // 180° − 90° = 90°, bukan 270°.
    expect(foto.rotationDeg).toBe(90);
    expect(foto.widthPx).toBe(200);
    expect(foto.heightPx).toBe(400);
  });

  it("revisi cap tercatat, dan TIDAK menandai nilai apa pun sebagai suntingan manual", async () => {
    const revisi = await db.photoStampRevision.findMany({
      where: { photoId },
      orderBy: { revision: "asc" },
      select: { revision: true, reason: true, manualFields: true },
    });
    expect(revisi).toHaveLength(3);
    expect(revisi[0].reason).toContain("Putar");
    // Memutar tidak mengubah satu pun KLAIM; menandainya manual akan membuat
    // cap menuduh orang mengetik ulang koordinat/jam yang tidak ia sentuh.
    expect(revisi[0].manualFields).toEqual([]);
  });

  it("foto tanpa arsip asli DITOLAK, bukan diputar dari hasil ber-cap", async () => {
    const tanpaArsip = await db.photo.create({
      data: {
        locationId,
        r2Key: `photos/x/${suffix}-noarsip.webp`,
        sha256: `sha2-${suffix}`,
        bytes: 10,
        gpsSource: "none",
        metadataSource: "server",
        uploadedById: aktor,
      },
    });
    const f = new FormData();
    f.set("photoId", tanpaArsip.id);
    f.set("arah", "kanan");
    const hasil = await putarFotoAction(undefined, f);
    expect(hasil?.error).toMatch(/tidak bisa diperbaiki/i);
  });
});
