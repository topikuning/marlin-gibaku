// PEMINDAHAN BERKAS R2 → LENOVO (DECISIONS 645), DIJALANKAN SUNGGUHAN.
//
// Arsip Lenovo-nya server HTTP sungguhan berdialek gateway yang berjalan
// (`/v1/objects/<kunci base64url>`), lengkap dengan pemeriksaan token DAN
// bentuk kunci – gateway itu hanya menerima kunci berbentuk foto. R2 ditiru.
//
// Yang dijaga:
//   1. yang tua dipindah, yang muda & thumbnail tidak; salinan R2 dibuang
//   2. sesudah pindah, isi dan alamatnya tetap bisa diambil – link tidak putus
//   3. di atas batas, yang lebih muda ikut dipindah (tapi tidak < 3 hari)
//   4. menghapus berkas yang sudah pindah ikut menghapus salinan Lenovo
//   5. Lenovo mati: galatnya jujur, bukan "tidak ditemukan"
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const HARI = 86_400_000;
type ObyekTiruan = { isi: Buffer; diubah: Date; jenis: string; bytesTercatat?: number };
const gudangR2 = new Map<string, ObyekTiruan>();
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2GetBuffer: async (k: string) => {
    const o = gudangR2.get(k);
    if (!o) throw new Error(`R2 tiruan: ${k} tidak ada`);
    return o.isi;
  },
  r2GetDenganJenis: async (k: string) => {
    const o = gudangR2.get(k);
    if (!o) throw new Error(`R2 tiruan: ${k} tidak ada`);
    return { isi: o.isi, jenis: o.jenis };
  },
  r2PresignGet: async (k: string) => `https://r2.tiruan/${k}`,
  r2Delete: async (k: string) => {
    gudangR2.delete(k);
  },
  r2HapusBanyak: async (ks: string[]) => {
    for (const k of ks) gudangR2.delete(k);
    return { terhapus: ks.length, gagal: [] };
  },
  r2List: async () => ({
    obyek: [...gudangR2.entries()].map(([key, o]) => ({ key, bytes: o.bytesTercatat ?? o.isi.length, diubah: o.diubah })),
    terpotong: false,
  }),
}));

/** Sama persis dengan BENTUK_KUNCI gateway (arsip-dingin/server.mjs). */
const BENTUK_GATEWAY = /^photos\/[A-Za-z0-9._-]+\/[0-9-]+\/[A-Za-z0-9._-]+$/;
const lenovo = new Map<string, Buffer>();
let lenovoMati = false;
const ditolakBentuk: string[] = [];

const server: Server = createServer(async (req, res) => {
  if (lenovoMati) {
    res.writeHead(502);
    return res.end();
  }
  if (req.url === "/v1/status") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ freeBytes: 500 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3 }));
  }
  const awalan = "/v1/objects/";
  const kunci = Buffer.from((req.url ?? "").slice(awalan.length), "base64url").toString("utf8");
  if (req.headers.authorization !== "Bearer rahasia-uji") {
    res.writeHead(401);
    return res.end();
  }
  if (!BENTUK_GATEWAY.test(kunci)) {
    ditolakBentuk.push(kunci);
    res.writeHead(400);
    return res.end();
  }
  const b = lenovo.get(kunci);
  if (req.method === "HEAD") {
    if (!b) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      "content-length": String(b.length),
      "x-content-sha256": createHash("sha256").update(b).digest("hex"),
    });
    return res.end();
  }
  if (req.method === "GET") {
    if (!b) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-length": String(b.length) });
    return res.end(b);
  }
  if (req.method === "PUT") {
    const bagian: Buffer[] = [];
    for await (const c of req) bagian.push(c as Buffer);
    lenovo.set(kunci, Buffer.concat(bagian));
    res.writeHead(201);
    return res.end();
  }
  if (req.method === "DELETE") {
    lenovo.delete(kunci);
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(405);
  res.end();
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
process.env.ORIGINAL_ARCHIVE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.ORIGINAL_ARCHIVE_TOKEN = "rahasia-uji";

const { db } = await import("@/lib/db");
const { jalankanPindahBerkas } = await import("@/lib/penyimpanan/pindah");
const { simpanSetelanPindah, PINDAH_AKTIF_KEY, PINDAH_BATAS_GB_KEY, PINDAH_UMUR_HARI_KEY, PINDAH_UKURAN_KEY } =
  await import("@/lib/penyimpanan/setelan");
const { ambilBerkas, alamatBerkas, hapusBerkas, BerkasTidakTerjangkau } = await import("@/lib/penyimpanan/berkas");
const { GET: ambilLewatRoute } = await import("@/app/api/berkas/[token]/route");

const AWALAN = "uji-pindah-lenovo";
const umur = (hari: number) => new Date(Date.now() - hari * HARI);

async function bersihkan() {
  await db.photo.deleteMany({ where: { r2Key: { startsWith: `photos/${AWALAN}/` } } });
  await db.document.deleteMany({ where: { r2Key: { startsWith: `documents/${AWALAN}/` } } });
  await db.berkasPindah.deleteMany({ where: { kunci: { contains: AWALAN } } });
  await db.appSetting.deleteMany({
    where: { key: { in: [PINDAH_AKTIF_KEY, PINDAH_BATAS_GB_KEY, PINDAH_UMUR_HARI_KEY, PINDAH_UKURAN_KEY] } },
  });
}

async function foto(nama: string, hari: number) {
  const r2Key = `photos/${AWALAN}/2026-08-01/${nama}.webp`;
  const thumbnailKey = `photos/${AWALAN}/2026-08-01/${nama}.thumb.webp`;
  const isi = Buffer.from(`FOTO-${nama}-${"x".repeat(2000)}`);
  gudangR2.set(r2Key, { isi, diubah: umur(hari), jenis: "image/webp" });
  gudangR2.set(thumbnailKey, { isi: Buffer.from(`THUMB-${nama}`), diubah: umur(hari), jenis: "image/webp" });
  await db.photo.create({
    data: {
      r2Key,
      thumbnailKey,
      sha256: createHash("sha256").update(isi).digest("hex"),
      bytes: isi.length,
    },
  });
  return { r2Key, thumbnailKey, isi };
}

/** Organisasi + pengunggah milik uji ini sendiri – tidak bergantung pada isi DB. */
let pengunggah: { id: string; orgId: string } | null = null;
async function milikUji() {
  if (pengunggah) return pengunggah;
  const suffix = Date.now().toString(36);
  const org = await db.organization.create({ data: { name: `Org PL ${suffix}`, slug: `org-pl-${suffix}` } });
  const u = await db.user.create({
    data: { orgId: org.id, username: `pl-${suffix}`, fullName: "Uji Pindah", passwordHash: "x", role: "field_supervisor" },
    select: { id: true, orgId: true },
  });
  pengunggah = u;
  return u;
}

async function dokumen(nama: string, hari: number) {
  const u = await milikUji();
  const r2Key = `documents/${AWALAN}/${nama} kontrak final.pdf`;
  const isi = Buffer.from(`%PDF-${nama}-${"y".repeat(3000)}`);
  gudangR2.set(r2Key, { isi, diubah: umur(hari), jenis: "application/pdf" });
  await db.document.create({
    data: {
      orgId: u.orgId,
      phase: "kontrak",
      type: "lainnya",
      title: nama,
      r2Key,
      fileName: `${nama}.pdf`,
      mimeType: "application/pdf",
      bytes: isi.length,
      sha256: createHash("sha256").update(isi).digest("hex"),
      uploadedById: u.id,
    },
  });
  return { r2Key, isi };
}

beforeEach(async () => {
  await bersihkan();
  gudangR2.clear();
  lenovo.clear();
  ditolakBentuk.length = 0;
  lenovoMati = false;
  await simpanSetelanPindah({ aktif: true, batasGb: 10, umurHari: 14 });
});

afterAll(async () => {
  await bersihkan();
  server.close();
});

describe("pemindahan berkas ke Lenovo", () => {
  it("yang tua dipindah, yang muda dan thumbnail tidak; salinan R2 dibuang", async () => {
    const tua = await foto("tua", 40);
    const muda = await foto("muda", 5);
    const dok = await dokumen("dok-tua", 60);

    const h = await jalankanPindahBerkas();
    expect(h.galat).toEqual([]);
    expect(h.dipindah).toBe(2);

    expect(gudangR2.has(tua.r2Key)).toBe(false);
    expect(gudangR2.has(dok.r2Key)).toBe(false);
    expect(gudangR2.has(muda.r2Key), "yang muda di bawah batas tidak dipindah").toBe(true);
    expect(gudangR2.has(tua.thumbnailKey), "thumbnail selalu tetap di R2").toBe(true);
    // Gateway hanya menerima kunci berbentuk foto – dokumen tidak boleh ditolak.
    expect(ditolakBentuk).toEqual([]);

    const baris = await db.berkasPindah.findUniqueOrThrow({ where: { kunci: dok.r2Key } });
    expect(baris.kategori).toBe("dokumen");
    expect(baris.kunciDingin).toMatch(BENTUK_GATEWAY);
    expect(baris.contentType).toBe("application/pdf");
    expect(baris.r2DibuangAt).not.toBeNull();
  });

  it("sesudah pindah: isi dan link tetap bisa dibuka", async () => {
    const dok = await dokumen("dok-link", 60);
    await jalankanPindahBerkas();

    expect(await ambilBerkas(dok.r2Key)).toEqual(dok.isi);

    const alamat = await alamatBerkas(dok.r2Key, 120, "dok-link.pdf");
    expect(alamat.startsWith("/api/berkas/")).toBe(true);
    const url = new URL(alamat, "https://marlin.uji");
    const token = url.pathname.split("/").pop()!;
    const res = await ambilLewatRoute(new Request(url), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(dok.isi);

    // Yang masih di R2 tetap dialamatkan ke R2.
    const muda = await foto("muda-link", 5);
    expect(await alamatBerkas(muda.r2Key)).toBe(`https://r2.tiruan/${muda.r2Key}`);
  });

  it("di atas batas: yang lebih muda ikut dipindah, tapi tidak yang < 3 hari", async () => {
    await simpanSetelanPindah({ aktif: true, batasGb: 1, umurHari: 14 });
    // Isi R2 lain (tidak dirujuk, tidak dipindah) yang membuat R2 di atas batas.
    gudangR2.set(`sampah/${AWALAN}/besar.bin`, {
      isi: Buffer.from("x"),
      bytesTercatat: 2_000_000_000,
      diubah: umur(1),
      jenis: "application/octet-stream",
    });
    const limaHari = await foto("lima-hari", 5);
    const duaHari = await foto("dua-hari", 2);

    const h = await jalankanPindahBerkas();
    expect(h.galat).toEqual([]);
    expect(gudangR2.has(limaHari.r2Key), "di atas batas: 5 hari ikut dipindah").toBe(false);
    expect(gudangR2.has(duaHari.r2Key), "< 3 hari tidak pernah dipindah").toBe(true);
  });

  it("menghapus berkas yang sudah pindah ikut menghapus salinan Lenovo", async () => {
    const dok = await dokumen("dok-hapus", 60);
    await jalankanPindahBerkas();
    const { kunciDingin } = await db.berkasPindah.findUniqueOrThrow({ where: { kunci: dok.r2Key } });
    expect(lenovo.has(kunciDingin)).toBe(true);

    await hapusBerkas(dok.r2Key);
    expect(lenovo.has(kunciDingin)).toBe(false);
    expect(await db.berkasPindah.findUnique({ where: { kunci: dok.r2Key } })).toBeNull();
  });

  it("Lenovo mati: galatnya menyebut arsip tidak terjangkau", async () => {
    const dok = await dokumen("dok-mati", 60);
    await jalankanPindahBerkas();
    lenovoMati = true;
    await expect(ambilBerkas(dok.r2Key)).rejects.toBeInstanceOf(BerkasTidakTerjangkau);
  });

  it("pemindahan mati = tidak ada yang dipindah", async () => {
    await simpanSetelanPindah({ aktif: false, batasGb: 10, umurHari: 14 });
    const tua = await foto("mati", 40);
    const h = await jalankanPindahBerkas();
    expect(h.dijalankan).toBe(false);
    expect(gudangR2.has(tua.r2Key)).toBe(true);
  });
});
