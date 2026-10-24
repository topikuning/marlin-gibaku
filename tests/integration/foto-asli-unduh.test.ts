/*
 * UNDUH FOTO ASLI DARI MANA PUN BERKASNYA BERADA (DECISIONS 702).
 *
 * Laporan user 2026-10-24: tautan "Unduh foto asli" sebuah foto 19 Oktober
 * menjawab "berkas tidak ada". Sebabnya: route ini memakai `alamatBerkas`,
 * yang hanya mengenal berkas pindahan `berkas_pindah` – berkas ASLI foto
 * diarsipkan `arsip-asli/` dengan kolomnya sendiri. Begitu salinan R2-nya
 * dibuang sesudah masa tenggang (`originalR2PurgedAt`), route tetap
 * menandatangani alamat R2 untuk berkas yang sudah tidak ada di sana.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

let aktor: { id: string; orgId: string; role: string; mustChangePassword: boolean } | null = null;
vi.mock("@/lib/auth/session", async (asli) => ({
  ...(await asli<typeof import("@/lib/auth/session")>()),
  getCurrentUser: async () => aktor,
  hasLocationAccess: async () => true,
}));

const gudangR2 = new Map<string, Buffer>();
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2GetBuffer: async (k: string) => {
    const o = gudangR2.get(k);
    if (!o) throw new Error(`R2 tiruan: ${k} tidak ada`);
    return o;
  },
  r2GetDenganJenis: async (k: string) => {
    const o = gudangR2.get(k);
    if (!o) throw new Error(`R2 tiruan: ${k} tidak ada`);
    return { isi: o, jenis: null };
  },
  r2PresignGet: async (k: string) => `https://r2.tiruan/${k}`,
  r2Delete: async (k: string) => {
    gudangR2.delete(k);
  },
  r2HapusBanyak: async () => ({ terhapus: 0, gagal: [] }),
}));

/** Mesin arsip Lenovo tiruan – hanya GET yang dipakai unduhan. */
const lenovo = new Map<string, Buffer>();
let lenovoMati = false;
const server: Server = createServer((req, res) => {
  if (lenovoMati) {
    res.writeHead(502);
    return res.end();
  }
  const kunci = Buffer.from((req.url ?? "").slice("/v1/objects/".length), "base64url").toString("utf8");
  if (req.headers.authorization !== "Bearer rahasia-uji") {
    res.writeHead(401);
    return res.end();
  }
  const b = lenovo.get(kunci);
  if (!b) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-length": String(b.length) });
  res.end(b);
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
process.env.ORIGINAL_ARCHIVE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.ORIGINAL_ARCHIVE_TOKEN = "rahasia-uji";

const { db } = await import("@/lib/db");
const { GET } = await import("@/app/api/foto-asli/[id]/route");

const suffix = `fa${Date.now().toString(36)}`;
let orgId = "";
let locationId = "";
const foto: Record<"r2" | "lenovo" | "dihapus", { id: string; kunci: string }> = {} as never;
const ISI_LENOVO = Buffer.from("isi-asli-png-dari-lenovo");

const unduh = (id: string) => GET(new Request(`http://uji/api/foto-asli/${id}`), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org FA ${suffix}`, slug: `fa-${suffix}` } });
  orgId = org.id;
  const u = await db.user.create({
    data: { orgId, username: `fa-${suffix}`, fullName: "Uji", passwordHash: "x", role: "super_admin" },
  });
  aktor = { id: u.id, orgId, role: "super_admin", mustChangePassword: false };
  const pkg = await db.package.create({ data: { orgId, name: `Paket FA ${suffix}`, stage: "pelaksanaan" } });
  const lok = await db.location.create({
    data: { packageId: pkg.id, name: "Matabulu", slug: `matabulu-${suffix}`, village: "Desa", regency: "Kab", province: "Prov" },
  });
  locationId = lok.id;
  const buat = async (nama: "r2" | "lenovo" | "dihapus", data: Record<string, unknown>) => {
    const kunci = `photos/matabulu-${suffix}/2026-10-19/${nama}-${suffix}.asli.png`;
    const p = await db.photo.create({
      data: {
        locationId,
        r2Key: `photos/matabulu-${suffix}/2026-10-19/${nama}-${suffix}.webp`,
        sha256: `${nama}-${suffix}`,
        bytes: 10,
        originalKey: kunci,
        originalBytes: 10,
        uploadedById: u.id,
        ...data,
      },
      select: { id: true },
    });
    foto[nama] = { id: p.id, kunci };
  };
  await buat("r2", {});
  await buat("lenovo", { originalArchivedAt: new Date("2026-10-19"), originalR2PurgedAt: new Date("2026-10-22") });
  // Hapus permanen mengosongkan originalKey (photo-restamp/actions.ts) – dulu
  // dijawab "diunggah sebelum arsip dinyalakan", yang tidak benar.
  await buat("dihapus", { originalKey: null, originalPurgedAt: new Date("2026-10-23") });
  gudangR2.set(foto.r2.kunci, Buffer.from("isi-r2"));
  lenovo.set(foto.lenovo.kunci, ISI_LENOVO);
}, 60_000);

afterAll(async () => {
  // Pola uji integrasi lain (fileParallelism: false). DELETE per organisasi
  // gagal diam-diam oleh kunci asing `users`, dan fotonya lalu ikut diproses
  // uji lain – mis. putaran arsip asli.
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
  await new Promise<void>((ok) => server.close(() => ok()));
});

describe("unduh foto asli", () => {
  it("masih di R2: dialihkan ke alamat R2 seperti biasa", async () => {
    const r = await unduh(foto.r2.id);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`https://r2.tiruan/${foto.r2.kunci}`);
  });

  it("salinan R2 sudah dibuang: isinya diambil dari arsip Lenovo, bukan alamat R2 yang mati", async () => {
    const r = await unduh(foto.lenovo.id);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("content-disposition")).toMatch(/\.asli\.png/);
    expect(Buffer.from(await r.arrayBuffer())).toEqual(ISI_LENOVO);
  });

  it("arsip Lenovo tidak bisa dihubungi: 503 dengan sebab yang terbaca, bukan alamat mati", async () => {
    lenovoMati = true;
    try {
      const r = await unduh(foto.lenovo.id);
      expect(r.status).toBe(503);
      expect((await r.json()).error).toMatch(/arsip/i);
    } finally {
      lenovoMati = false;
    }
  });

  it("berkas asli yang sudah dihapus permanen disebut begitu, bukan 'diunggah sebelum arsip ada'", async () => {
    const r = await unduh(foto.dihapus.id);
    expect(r.status).toBe(410);
    expect((await r.json()).error).toMatch(/dihapus/);
  });
});
