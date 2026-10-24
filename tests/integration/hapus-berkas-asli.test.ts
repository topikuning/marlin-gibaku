/*
 * HAPUS FOTO = BERKAS ASLINYA IKUT HILANG DARI KEDUA TEMPAT (DECISIONS 705).
 *
 * OPEN_ISSUES FOTO-02: berkas asli foto dipindah ke Lenovo oleh `arsip-asli/`
 * dengan kolomnya sendiri, tidak lewat `berkas_pindah`. Semua jalur hapus
 * memakai `hapusBerkas`, yang hanya mengenal R2 + `berkas_pindah` – jadi
 * salinan Lenovo berkas asli TERTINGGAL: "hapus arsip asli" mencatat "dihapus
 * permanen" padahal byte-nya masih di Lenovo, dan foto yang dihapus
 * meninggalkan berkas tanpa induk yang tak bisa ditemukan siapa pun.
 * Hapus foto laporan harian bahkan tidak menyentuh `originalKey` sama sekali.
 *
 * Mesin arsip Lenovo tiruan menjalankan aturan gateway yang sebenarnya:
 * DELETE ditolak bila `X-Delete-SHA256` tidak cocok dengan isinya.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const gudangR2 = new Map<string, Buffer>();
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async (k: string, b: Buffer) => {
    gudangR2.set(k, b);
  },
  r2GetBuffer: async (k: string) => {
    const o = gudangR2.get(k);
    if (!o) throw new Error(`R2 tiruan: ${k} tidak ada`);
    return o;
  },
  r2PresignGet: async (k: string) => `https://r2.tiruan/${k}`,
  r2Delete: async (k: string) => {
    gudangR2.delete(k);
  },
  r2HapusBanyak: async (ks: string[]) => {
    for (const k of ks) gudangR2.delete(k);
    return { terhapus: ks.length, gagal: [] };
  },
}));

let aktor = "";
vi.mock("@/lib/auth/session", async (asli) => {
  const a = await asli<typeof import("@/lib/auth/session")>();
  const pengguna = () =>
    db.user.findUniqueOrThrow({
      where: { id: aktor },
      select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
    });
  return {
    ...a,
    requireUser: pengguna,
    requireCapability: pengguna,
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

/** Mesin arsip Lenovo tiruan: kunci → isi. */
const lenovo = new Map<string, Buffer>();
let lenovoMati = false;
const server: Server = createServer((req, res) => {
  if (lenovoMati) {
    res.writeHead(502);
    return res.end();
  }
  if (req.headers.authorization !== "Bearer rahasia-uji") {
    res.writeHead(401);
    return res.end();
  }
  const kunci = Buffer.from((req.url ?? "").slice("/v1/objects/".length), "base64url").toString("utf8");
  const isi = lenovo.get(kunci);
  if (req.method === "DELETE") {
    if (!isi) {
      res.writeHead(404);
      return res.end();
    }
    const sha = createHash("sha256").update(isi).digest("hex");
    if (req.headers["x-delete-sha256"] !== sha) {
      res.writeHead(409);
      return res.end();
    }
    lenovo.delete(kunci);
    res.writeHead(204);
    return res.end();
  }
  if (!isi) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-length": String(isi.length) });
  res.end(req.method === "HEAD" ? undefined : isi);
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
process.env.ORIGINAL_ARCHIVE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.ORIGINAL_ARCHIVE_TOKEN = "rahasia-uji";

const { db } = await import("@/lib/db");
const { hapusFotoCepatAction } = await import("@/lib/foto-cepat/actions");
const { removeReportPhotoAction } = await import("@/lib/daily-report/actions");
const { removeActivityPhotoAction, deleteActivityAction } = await import("@/lib/field-activity/actions");
const { purgeOneOriginalAction, purgeOriginalsAction } = await import("@/lib/photo-restamp/actions");
const berkas = await import("@/lib/penyimpanan/berkas");
const { setelanDingin } = await import("@/lib/arsip-asli/dingin");

const suffix = `hba${Date.now().toString(36)}`;
let orgId = "";
let locationId = "";
let lokasiBorongan = "";
let slug = "";
let reportId = "";
let nomor = 0;

type Keadaan = "tenggang" | "hanya-lenovo";

/**
 * Foto yang berkas aslinya SUDAH diarsipkan ke Lenovo. "tenggang" = salinan R2
 * masih ada; "hanya-lenovo" = salinan R2 sudah dibuang sesudah masa tenggang.
 */
async function fotoTerarsip(keadaan: Keadaan, induk: Record<string, unknown> = {}, lokasi = locationId) {
  const n = ++nomor;
  const isi = Buffer.from(`isi-asli-${suffix}-${n}`);
  const sha = createHash("sha256").update(isi).digest("hex");
  const kunciAsli = `photos/${slug}/2026-10-19/asli-${n}.asli.jpg`;
  const kunciCap = `photos/${slug}/2026-10-19/cap-${n}.webp`;
  const p = await db.photo.create({
    data: {
      locationId: lokasi,
      r2Key: kunciCap,
      sha256: sha,
      bytes: 10,
      originalKey: kunciAsli,
      originalBytes: isi.length,
      originalArchivedAt: new Date("2026-10-20"),
      originalR2PurgedAt: keadaan === "hanya-lenovo" ? new Date("2026-10-23") : null,
      uploadedById: aktor,
      ...induk,
    },
    select: { id: true },
  });
  gudangR2.set(kunciCap, Buffer.from("cap"));
  if (keadaan === "tenggang") gudangR2.set(kunciAsli, isi);
  lenovo.set(kunciAsli, isi);
  return { id: p.id, kunciAsli };
}

const fd = (isian: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(isian)) f.set(k, v);
  return f;
};

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org HBA ${suffix}`, slug: `hba-${suffix}` } });
  orgId = org.id;
  const u = await db.user.create({
    data: { orgId, username: `hba-${suffix}`, fullName: "Uji", passwordHash: "x", role: "super_admin" },
  });
  aktor = u.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket HBA ${suffix}`, stage: "pelaksanaan" } });
  slug = `matabulu-${suffix}`;
  const buatLokasi = (s: string) =>
    db.location.create({
      data: { packageId: pkg.id, name: s, slug: s, village: "Desa", regency: "Kab", province: "Prov" },
    });
  locationId = (await buatLokasi(slug)).id;
  lokasiBorongan = (await buatLokasi(`borongan-${suffix}`)).id;
  const r = await db.dailyReport.create({
    data: { locationId, reportDate: new Date("2026-10-19T00:00:00Z"), status: "draft", createdById: aktor },
  });
  reportId = r.id;
}, 60_000);

afterAll(async () => {
  await db.berkasPindah.deleteMany({ where: { kunci: { startsWith: `photos/${slug}/` } } });
  // Pola uji integrasi lain (fileParallelism: false). DELETE per organisasi
  // gagal diam-diam oleh kunci asing `users`, dan fotonya lalu ikut diproses
  // uji lain – mis. putaran arsip asli.
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
  await new Promise<void>((ok) => server.close(() => ok()));
});

describe("hapus foto: salinan Lenovo berkas asli ikut terhapus", () => {
  it("Foto Cepat – buang dari kantong", async () => {
    const f = await fotoTerarsip("hanya-lenovo");
    const r = await hapusFotoCepatAction({}, fd({ photoId: f.id }));
    expect(r.error).toBeUndefined();
    expect(lenovo.has(f.kunciAsli), "salinan Lenovo tertinggal").toBe(false);
  });

  it("laporan harian – hapus foto: berkas asli hilang dari R2 DAN Lenovo", async () => {
    const f = await fotoTerarsip("tenggang", { reportId });
    const r = await removeReportPhotoAction(undefined, fd({ photoId: f.id }));
    expect(r?.error).toBeUndefined();
    expect(gudangR2.has(f.kunciAsli), "berkas asli tertinggal di R2").toBe(false);
    expect(lenovo.has(f.kunciAsli), "salinan Lenovo tertinggal").toBe(false);
  });

  it("kegiatan – hapus satu foto, dan hapus kegiatannya", async () => {
    const keg = await db.fieldActivity.create({
      data: { locationId, activityDate: new Date("2026-10-19"), type: "rapat", title: "Uji", createdById: aktor },
    });
    const satu = await fotoTerarsip("hanya-lenovo", { activityId: keg.id });
    const sisa = await fotoTerarsip("tenggang", { activityId: keg.id });

    const r1 = await removeActivityPhotoAction(undefined, fd({ photoId: satu.id }));
    expect(r1?.error).toBeUndefined();
    expect(lenovo.has(satu.kunciAsli), "hapus foto kegiatan: salinan Lenovo tertinggal").toBe(false);

    const r2 = await deleteActivityAction(undefined, fd({ activityId: keg.id }));
    expect(r2?.error).toBeUndefined();
    expect(lenovo.has(sisa.kunciAsli), "hapus kegiatan: salinan Lenovo tertinggal").toBe(false);
    expect(gudangR2.has(sisa.kunciAsli)).toBe(false);
  });

  it("hapus arsip asli satu foto: baru ditandai 'dihapus' sesudah Lenovo ikut bersih", async () => {
    const f = await fotoTerarsip("hanya-lenovo");
    const r = await purgeOneOriginalAction(undefined, fd({ photoId: f.id }));
    expect(r?.error).toBeUndefined();
    expect(lenovo.has(f.kunciAsli), "'dihapus permanen' padahal masih di Lenovo").toBe(false);
    const p = await db.photo.findUniqueOrThrow({ where: { id: f.id }, select: { originalKey: true, originalPurgedAt: true } });
    expect(p.originalKey).toBeNull();
    expect(p.originalPurgedAt).not.toBeNull();
  });

  it("hapus arsip asli borongan", async () => {
    const a = await fotoTerarsip("hanya-lenovo", {}, lokasiBorongan);
    const b = await fotoTerarsip("tenggang", {}, lokasiBorongan);
    const r = await purgeOriginalsAction(undefined, fd({ konfirmasi: "HAPUS", locationId: lokasiBorongan }));
    expect(r?.error).toBeUndefined();
    expect(lenovo.has(a.kunciAsli)).toBe(false);
    expect(lenovo.has(b.kunciAsli)).toBe(false);
    expect(gudangR2.has(b.kunciAsli)).toBe(false);
  });

  it("Lenovo mati saat menghapus: dititipkan, lalu diulang sampai benar-benar terhapus", async () => {
    const f = await fotoTerarsip("hanya-lenovo");
    lenovoMati = true;
    try {
      const r = await hapusFotoCepatAction({}, fd({ photoId: f.id }));
      // Membuang foto tidak boleh tertahan oleh mesin arsip yang sedang mati.
      expect(r.error).toBeUndefined();
    } finally {
      lenovoMati = false;
    }
    expect(await db.photo.count({ where: { id: f.id } })).toBe(0);
    expect(lenovo.has(f.kunciAsli), "belum boleh hilang – Lenovo tadi mati").toBe(true);
    const titipan = await db.berkasPindah.findUnique({ where: { kunci: f.kunciAsli } });
    expect(titipan?.kategori, "tanpa titipan tidak ada lagi yang tahu salinan ini ada").toBe("dihapus");

    const galat: string[] = [];
    await berkas.ulangiHapusLenovo(setelanDingin()!, galat);
    expect(galat).toEqual([]);
    expect(lenovo.has(f.kunciAsli)).toBe(false);
    expect(await db.berkasPindah.count({ where: { kunci: f.kunciAsli } })).toBe(0);
  });
});
