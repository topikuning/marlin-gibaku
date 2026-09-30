/*
 * LOGO & GAMBAR IDENTITAS (DECISIONS 634).
 *
 * Laporan user 2026-09-30: *"saat memasukkan logo ke master perusahaan, logo
 * hilang saat dibuka lagi"* – disusul *"sepertinya semua bermasalah terkait
 * logo, cek ulang total"*.
 *
 * Yang dijaga:
 *  1. setiap unggahan logo/kop/stempel perusahaan dan gambar kontrak menulis
 *     berkas BARU – tidak menimpa berkas yang sudah dibekukan laporan final,
 *     dan cache mana pun tidak bisa menyajikan gambar lama;
 *  2. logo cap foto yang gagal dimuat sekali tidak "terkunci" kosong sampai
 *     server dinyalakan ulang;
 *  3. audit penyimpanan menyebut logo/kop/stempel/tanda tangan yang berkasnya
 *     hilang dari R2 – dulu hanya foto & dokumen yang diperiksa.
 */
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const rak = new Map<string, Buffer>();
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async (key: string, body: Buffer) => {
    rak.set(key, Buffer.from(body));
  },
  r2GetBuffer: async (key: string) => {
    const b = rak.get(key);
    if (!b) throw new Error(`tidak ada ${key}`);
    return b;
  },
  r2List: async () => ({
    obyek: [...rak.entries()].map(([key, b]) => ({ key, bytes: b.length, diubah: new Date() })),
    terpotong: false,
  }),
  r2PresignGet: async (key: string) => `https://contoh/${key}`,
  r2Delete: async (key: string) => {
    rak.delete(key);
  },
}));

const suffix = `lg${Date.now().toString(36)}`;
let aktor = { id: "", orgId: "", role: "super_admin" as const };
vi.mock("@/lib/auth/session", () => ({
  requireCapability: async () => aktor,
  requireUser: async () => aktor,
  requireLocationAccess: async () => {},
  requestIp: async () => null,
}));

const { db } = await import("@/lib/db");
const { updateVendorAction } = await import("@/lib/vendor/actions");
const { updateContractSignatureImages } = await import("@/lib/package/actions");
const { logoPerusahaanDataUri } = await import("@/lib/photo-stamp/logo-perusahaan");
const { auditR2 } = await import("@/lib/r2-audit");

let vendorId = "";
let contractId = "";

async function png(warna: string): Promise<File> {
  const buf = await sharp({ create: { width: 40, height: 20, channels: 4, background: warna } })
    .png()
    .toBuffer();
  return new File([buf], "logo.png", { type: "image/png" });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  const u = await db.user.create({
    data: { orgId: org.id, username: `u-${suffix}`, fullName: "Admin", passwordHash: "x", role: "super_admin" },
  });
  aktor = { id: u.id, orgId: org.id, role: "super_admin" };
  vendorId = (await db.vendor.create({ data: { orgId: org.id, name: `CV Uji ${suffix}` } })).id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}` } });
  contractId = (
    await db.contract.create({
      data: {
        packageId: pkg.id,
        vendorId,
        contractNumber: `K-${suffix}`,
        contractValue: 1_000_000n,
        signedDate: new Date("2026-08-01"),
      },
    })
  ).id;
});

async function simpanLogo(file: File) {
  const fd = new FormData();
  fd.set("id", vendorId);
  fd.set("name", `CV Uji ${suffix}`);
  fd.set("logo", file);
  const r = await updateVendorAction(undefined, fd);
  expect(r?.error).toBeUndefined();
  return (await db.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { logoKey: true } })).logoKey!;
}

describe("logo & gambar identitas", () => {
  it("logo perusahaan tersimpan, dan unggahan kedua menulis berkas BARU", async () => {
    const pertama = await simpanLogo(await png("#ff0000"));
    expect(rak.has(pertama)).toBe(true);
    const kedua = await simpanLogo(await png("#0000ff"));
    expect(kedua).not.toBe(pertama);
    expect(rak.has(kedua)).toBe(true);
    // Berkas lama tetap ada: laporan final yang membekukannya tidak ikut berubah.
    expect(rak.has(pertama)).toBe(true);
  });

  it("gambar kontrak (logo pengawas) juga tidak menimpa berkas lama", async () => {
    const simpan = async (warna: string) => {
      const fd = new FormData();
      fd.set("contractId", contractId);
      fd.set("supervisorLogoKey", await png(warna));
      const r = await updateContractSignatureImages(undefined, fd);
      expect(r?.error).toBeUndefined();
      return (await db.contract.findUniqueOrThrow({ where: { id: contractId } })).supervisorLogoKey!;
    };
    const a = await simpan("#00ff00");
    const b = await simpan("#ff00ff");
    expect(b).not.toBe(a);
    expect(rak.has(a) && rak.has(b)).toBe(true);
  });

  it("logo cap foto yang gagal dimuat sekali tidak terkunci kosong", async () => {
    const key = `vendors/${vendorId}/uji-telat.webp`;
    expect(await logoPerusahaanDataUri(key)).toBeNull();
    rak.set(key, await sharp({ create: { width: 10, height: 10, channels: 3, background: "#123456" } }).webp().toBuffer());
    expect(await logoPerusahaanDataUri(key)).toMatch(/^data:image\/png;base64,/);
  });

  it("audit penyimpanan menyebut logo perusahaan yang berkasnya hilang", async () => {
    const { logoKey } = await db.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { logoKey: true } });
    rak.delete(logoKey!);
    const hasil = await auditR2();
    const baris = hasil.rujukanHilang.find((r) => r.label === "Logo perusahaan");
    expect(baris?.contoh).toContain(logoKey);
  });
});
