// LENOVO MELAYANI PERAMBAN LANGSUNG, ALAMAT TETAP MARLIN (DECISIONS 768) – terhadap
// DATABASE ASLI dan penerima arsip SUNGGUHAN (`arsip-dingin/server.mjs`).
//
// Permintaan user 2026-11-15: *"kenapa tidak kita buat di lenovo sama dengan r2
// konsepnya … hanya, yg dilihat user di awal harus alamat marlin, karena kalau ada
// perubahan link yang lama harus tetap bisa mengambil data meskipun filenya di r2
// maupun di lenovo"*.
//
// Yang dijaga:
// 1. bawaan MATI: berkas Lenovo tetap dikirim lewat MARLIN seperti sebelumnya;
// 2. nyala: alamat MARLIN yang sama (`/api/berkas/<token>`, `/api/foto-asli/<id>`)
//    mengalihkan ke link Lenovo bertanda tangan, dan link itu memberi isi yang
//    persis – tanpa token pembawa, tanpa lewat MARLIN;
// 3. berkas yang masih di R2 tidak pernah dialihkan ke Lenovo;
// 4. uji sambungan sebelum menyalakan membedakan gateway lama, Cloudflare Access
//    yang masih menghadang, dan gateway yang siap.
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) }));

let aktor: { id: string; orgId: string; role: string; mustChangePassword: boolean } | null = null;
vi.mock("@/lib/auth/session", async (asli) => ({
  ...(await asli<typeof import("@/lib/auth/session")>()),
  getCurrentUser: async () => aktor,
  hasLocationAccess: async () => true,
  requireCapability: async () => aktor,
}));

const TOKEN = "rahasia-uji-lenovo-langsung-cukup-panjang";
const dir = await mkdtemp(join(tmpdir(), "arsip-langsung-"));
const anak: ChildProcess = spawn(process.execPath, [new URL("../../arsip-dingin/server.mjs", import.meta.url).pathname], {
  env: { ...process.env, ARSIP_DIR: dir, ARSIP_TOKEN: TOKEN, ARSIP_PORT: "0", ARSIP_HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const PORT = await new Promise<number>((ok, gagal) => {
  const jam = setTimeout(() => gagal(new Error("penerima arsip tidak kunjung siap")), 20_000);
  anak.stdout!.on("data", (b: Buffer) => {
    const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(b.toString());
    if (m) {
      clearTimeout(jam);
      ok(Number(m[1]));
    }
  });
});
const URL_ARSIP = `http://127.0.0.1:${PORT}`;
// Dipasang SEBELUM modul MARLIN dimuat (env.ts membaca sekali), dan dikembalikan
// sesudahnya supaya tidak terbawa ke berkas uji lain.
const envLama = { url: process.env.ORIGINAL_ARCHIVE_URL, token: process.env.ORIGINAL_ARCHIVE_TOKEN };
process.env.ORIGINAL_ARCHIVE_URL = URL_ARSIP;
process.env.ORIGINAL_ARCHIVE_TOKEN = TOKEN;

const { db } = await import("@/lib/db");
const { kirimDingin, setelanDingin } = await import("@/lib/arsip-asli/dingin");
const { alamatBerkas, alamatLenovoLangsung } = await import("@/lib/penyimpanan/berkas");
const { LENOVO_LANGSUNG_KEY, lenovoLangsung, simpanLenovoLangsung } = await import("@/lib/penyimpanan/setelan");
const { ujiUnduhLangsung } = await import("@/lib/penyimpanan/uji-langsung");
const { GET: lewatBerkas } = await import("@/app/api/berkas/[token]/route");
const { GET: lewatBerkasBernama } = await import("@/app/api/berkas/[token]/[nama]/route");
const { GET: fotoAsli } = await import("@/app/api/foto-asli/[id]/route");
const { setLenovoLangsungAction } = await import("@/lib/system/actions");

const suffix = Date.now().toString(36);
const KUNCI = `photos/uji-langsung-${suffix}/2026-10-01/foto-${suffix}.webp`;
const KUNCI_DINGIN = `photos/pindahan/2026-10-01/${createHash("sha256").update(KUNCI).digest("hex").slice(0, 32)}`;
const ISI = Buffer.from(`FOTO-CAP-${"z".repeat(4000)}`);
const ASLI_KUNCI = `photos/uji-langsung-${suffix}/2026-10-01/foto-${suffix}.asli.jpg`;
const ISI_ASLI = Buffer.from(`ASLI-${"q".repeat(6000)}`);
let fotoId = "";

const token = async (kunci: string) => (await alamatBerkas(kunci, 600)).split("/api/berkas/")[1].split("/")[0];
const minta = (u: string) => new Request(`http://marlin.uji${u}`);

beforeAll(async () => {
  const s = setelanDingin()!;
  await kirimDingin(s, KUNCI_DINGIN, ISI);
  await kirimDingin(s, ASLI_KUNCI, ISI_ASLI);
  const sekarang = new Date();
  await db.berkasPindah.create({
    data: {
      kunci: KUNCI,
      kunciDingin: KUNCI_DINGIN,
      kategori: "foto",
      bytes: ISI.length,
      sha256: createHash("sha256").update(ISI).digest("hex"),
      contentType: "image/webp",
      dipindahAt: sekarang,
      r2DibuangAt: sekarang,
    },
  });
  const org = await db.organization.create({ data: { name: `Org LL ${suffix}`, slug: `org-ll-${suffix}` } });
  const u = await db.user.create({
    data: { orgId: org.id, username: `ll-${suffix}`, fullName: "Uji Langsung", passwordHash: "x", role: "super_admin" },
  });
  aktor = { id: u.id, orgId: org.id, role: "super_admin", mustChangePassword: false };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket LL ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "Lokasi LL", slug: `ll-${suffix}`, village: "D", regency: "K", province: "P" },
  });
  fotoId = (
    await db.photo.create({
      data: {
        locationId: loc.id,
        r2Key: KUNCI,
        sha256: createHash("sha256").update(ISI).digest("hex"),
        bytes: ISI.length,
        originalKey: ASLI_KUNCI,
        originalR2PurgedAt: sekarang,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: LENOVO_LANGSUNG_KEY } });
  await db.photo.deleteMany({ where: { id: fotoId } });
  await db.berkasPindah.deleteMany({ where: { kunci: KUNCI } });
  await db.$disconnect();
  anak.kill();
  await rm(dir, { recursive: true, force: true });
  if (envLama.url === undefined) delete process.env.ORIGINAL_ARCHIVE_URL;
  else process.env.ORIGINAL_ARCHIVE_URL = envLama.url;
  if (envLama.token === undefined) delete process.env.ORIGINAL_ARCHIVE_TOKEN;
  else process.env.ORIGINAL_ARCHIVE_TOKEN = envLama.token;
});

describe("bawaan MATI – berkas Lenovo tetap dikirim lewat MARLIN", () => {
  it("sakelar belum pernah disimpan → mati", async () => {
    await db.appSetting.deleteMany({ where: { key: LENOVO_LANGSUNG_KEY } });
    expect(await lenovoLangsung()).toBe(false);
    expect(await alamatLenovoLangsung(KUNCI, { nama: null })).toBeNull();
  });

  it("/api/berkas/<token> menyerahkan isinya sendiri", async () => {
    const t = await token(KUNCI);
    const r = await lewatBerkas(minta(`/api/berkas/${t}`), { params: Promise.resolve({ token: t }) });
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer()).equals(ISI)).toBe(true);
  });
});

describe("nyala – alamat MARLIN yang sama mengalihkan ke Lenovo", () => {
  beforeAll(async () => {
    await simpanLenovoLangsung(true);
  });

  it("/api/berkas/<token> → 302 ke link Lenovo bertanda tangan; isinya persis, tanpa token pembawa", async () => {
    const t = await token(KUNCI);
    const r = await lewatBerkas(minta(`/api/berkas/${t}`), { params: Promise.resolve({ token: t }) });
    expect(r.status).toBe(302);
    const ke = r.headers.get("location")!;
    expect(ke.startsWith(`${URL_ARSIP}/v1/unduh/`)).toBe(true);
    // Tidak ada isi berkas yang lewat MARLIN.
    expect((await r.arrayBuffer()).byteLength).toBe(0);
    const isi = await fetch(ke);
    expect(isi.status).toBe(200);
    expect(Buffer.from(await isi.arrayBuffer()).equals(ISI)).toBe(true);
    expect(isi.headers.get("content-type")).toBe("image/webp");
  });

  it("alamat bernama membawa nama ke Lenovo – di ruas alamat dan di Content-Disposition", async () => {
    const t = await token(KUNCI);
    const r = await lewatBerkasBernama(minta(`/api/berkas/${t}/Foto%20Galian.webp`), {
      params: Promise.resolve({ token: t, nama: "Foto%20Galian.webp" }),
    });
    expect(r.status).toBe(302);
    const ke = r.headers.get("location")!;
    expect(new URL(ke).pathname.endsWith("/Foto%20Galian.webp")).toBe(true);
    const isi = await fetch(ke);
    expect(isi.headers.get("content-disposition")).toContain(`filename="Foto Galian.webp"`);
  });

  it("token MARLIN palsu tetap ditolak MARLIN – tidak pernah dialihkan", async () => {
    const r = await lewatBerkas(minta("/api/berkas/palsu.x.y"), { params: Promise.resolve({ token: "palsu.x.y" }) });
    expect(r.status).toBe(404);
  });

  it("berkas yang masih di R2 tidak pernah dialihkan ke Lenovo", async () => {
    expect(await alamatLenovoLangsung(`photos/uji-langsung-${suffix}/2026-10-01/masih-r2.webp`, { nama: null })).toBeNull();
  });

  it("foto asli di Lenovo → 302 ke Lenovo, diunduh dengan namanya", async () => {
    const r = await fotoAsli(minta(`/api/foto-asli/${fotoId}`), { params: Promise.resolve({ id: fotoId }) });
    expect(r.status).toBe(302);
    const isi = await fetch(r.headers.get("location")!);
    expect(isi.status).toBe(200);
    expect(Buffer.from(await isi.arrayBuffer()).equals(ISI_ASLI)).toBe(true);
    expect(isi.headers.get("content-disposition")).toMatch(/^attachment|^inline/);
  });

  it("dimatikan lagi → kembali lewat MARLIN", async () => {
    await simpanLenovoLangsung(false);
    const t = await token(KUNCI);
    const r = await lewatBerkas(minta(`/api/berkas/${t}`), { params: Promise.resolve({ token: t }) });
    expect(r.status).toBe(200);
    const asli = await fotoAsli(minta(`/api/foto-asli/${fotoId}`), { params: Promise.resolve({ id: fotoId }) });
    expect(asli.status).toBe(200);
  });
});

describe("uji sambungan sebelum menyalakan", () => {
  /** Server tiruan yang menjawab jalur unduh dengan kode tertentu. */
  async function tiruan(jawab: (url: string) => { status: number; lokasi?: string }): Promise<{ url: string; tutup: () => void }> {
    const srv: Server = createServer((req, res) => {
      const j = jawab(req.url ?? "");
      res.writeHead(j.status, j.lokasi ? { location: j.lokasi } : undefined);
      res.end();
    });
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, tutup: () => srv.close() };
  }

  it("gateway sungguhan yang sudah diperbarui → siap", async () => {
    const h = await ujiUnduhLangsung(setelanDingin()!);
    expect(h).toEqual({ siap: true });
  });

  it("gateway lama (belum kenal jalur unduh, menuntut token) → disebut belum diperbarui", async () => {
    const t = await tiruan(() => ({ status: 401 }));
    try {
      const h = await ujiUnduhLangsung({ url: t.url, token: TOKEN });
      expect(h.siap).toBe(false);
      if (!h.siap) expect(h.sebab).toMatch(/belum diperbarui/);
    } finally {
      t.tutup();
    }
  });

  it("Cloudflare Access masih menghadang (alih ke halaman masuk / 403) → disebut Access", async () => {
    for (const j of [{ status: 302, lokasi: "https://tim.cloudflareaccess.com/cdn-cgi/access/login" }, { status: 403 }]) {
      const t = await tiruan(() => j);
      try {
        const h = await ujiUnduhLangsung({ url: t.url, token: TOKEN });
        expect(h.siap, String(j.status)).toBe(false);
        if (!h.siap) expect(h.sebab).toMatch(/Cloudflare Access/);
      } finally {
        t.tutup();
      }
    }
  });
});

describe("tombol di Sistem", () => {
  const kirim = (aktif: "0" | "1") => {
    const f = new FormData();
    f.set("aktif", aktif);
    return setLenovoLangsungAction(undefined, f);
  };

  it("Uji & nyalakan: lolos uji sambungan → nyala, tercatat di audit", async () => {
    const r = await kirim("1");
    expect(r?.success).toBe("Foto lama sekarang diambil langsung dari Lenovo.");
    expect(await lenovoLangsung()).toBe(true);
    const log = await db.auditLog.findFirst({
      where: { action: "system.lenovo_langsung", userId: aktor!.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.payload).toMatchObject({ sesudah: true });
  });

  it("Matikan → mati tanpa uji", async () => {
    const r = await kirim("0");
    expect(r?.success).toBe("Foto lama kembali dikirim lewat MARLIN.");
    expect(await lenovoLangsung()).toBe(false);
  });
});
