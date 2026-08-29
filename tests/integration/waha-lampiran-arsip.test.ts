// LAMPIRAN WA HARUS SELAMAT DARI DEPLOY ULANG.
//
// Keluhan user 2026-08-29, dengan tangkapan layar: membuka lampiran yang baru
// masuk menghasilkan
//   "Berkas tidak ada lagi di simpanan sementara (biasanya hilang saat aplikasi
//    di-deploy ulang) dan belum sempat diarsipkan."
//
// Sebabnya ketetapan lama (2026-08-25): berkas hanya naik ke R2 SETELAH orang
// menetapkannya sebagai surat/dokumen. Di Railway disk kontainer bersifat
// sementara, dan selama pengembangan masih padat, deploy terjadi beberapa kali
// sehari — jauh lebih cepat daripada orang sempat menetapkan. Akibatnya kartu
// lampirannya ada, berkasnya tidak.
//
// Yang diuji di sini: berkas diarsipkan SAAT DITANGKAP, dan kalau R2 sedang
// bermasalah, penyapu menjaringnya kembali TANPA menunggu keputusan siapa pun.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/*
 * Unduhan diganti di `globalThis.fetch` — itulah yang dipakai `unduhBerkas`.
 * Uji ini tentang KE MANA berkasnya disimpan, bukan tentang HTTP.
 */
/*
 * Isi berkas dibuat BERBEDA tiap unduhan. Kalau isinya sama, sidik jari
 * (sha256) pun sama, dan baris kedua mewarisi `r2Key` milik kembarannya —
 * perilaku produksi yang benar, tapi ia menyembunyikan persis apa yang diuji
 * di sini: apa yang terjadi pada berkas yang BELUM punya arsip.
 */
let nomorUnduh = 0;
const fetchAsli = globalThis.fetch;
globalThis.fetch = (async () => {
  nomorUnduh += 1;
  return new Response(new Uint8Array(Buffer.from(`%PDF-1.4 surat uji arsip ${nomorUnduh}\n`)), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}) as typeof fetch;

/** R2 palsu: catat kunci yang ditulis, dan bisa dibuat gagal sesuka uji. */
const ditulis: string[] = [];
let r2Hidup = true;
let r2Gagal = false;
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => r2Hidup,
  r2Put: async (key: string) => {
    if (r2Gagal) throw new Error("R2 sedang mati");
    ditulis.push(key);
  },
  r2GetBuffer: async () => Buffer.from(""),
  r2Delete: async () => {},
}));

const { db } = await import("@/lib/db");
const { tangkapLampiran, arsipkanYangTertinggal } = await import("@/lib/waha/lampiran-tangkap");

const suffix = `ar${Date.now().toString(36)}`;
let orgId = "";
let packageId = "";
let chatId = "";

/** Satu pesan WA baru – tiap uji perlu induk sendiri (satu pesan satu lampiran). */
async function pesanBaru(nomor: number): Promise<string> {
  const m = await db.waMessage.create({
    data: {
      chatId,
      packageId,
      waMessageId: `wamid.${suffix}.${nomor}`,
      body: "surat",
      hasMedia: true,
      mediaType: "document",
      timestamp: new Date(),
      fromName: "Pengirim Uji",
    },
    select: { id: true },
  });
  return m.id;
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org AR ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const pkg = await db.package.create({
    data: { orgId, name: `Paket AR ${suffix}`, stage: "pelaksanaan", waGroupId: `${suffix}@g.us` },
    select: { id: true },
  });
  packageId = pkg.id;
  chatId = `${suffix}@g.us`;
});

beforeEach(() => {
  ditulis.length = 0;
  r2Hidup = true;
  r2Gagal = false;
});

afterAll(async () => {
  globalThis.fetch = fetchAsli;
  await db.organization.delete({ where: { id: orgId } }).catch(() => {});
  await db.$disconnect();
});

async function tangkap(nomor: number) {
  const messageId = await pesanBaru(nomor);
  const hasil = await tangkapLampiran({
    messageId,
    packageId,
    mediaUrl: "https://waha.example/media/surat.pdf",
    mimeType: "application/pdf",
    fileName: `Surat-${nomor}.pdf`,
    caption: "mohon diperiksa",
  });
  expect(hasil.ok).toBe(true);
  return (hasil as { attachmentId: string }).attachmentId;
}

describe("arsip lampiran WA", () => {
  it("diarsipkan ke R2 SAAT DITANGKAP, bukan menunggu ditetapkan orang", async () => {
    const id = await tangkap(1);
    const a = await db.waAttachment.findUnique({
      where: { id },
      select: { r2Key: true, decision: true },
    });
    // Belum ada yang menetapkan apa pun – dan justru itu intinya.
    expect(a?.decision).toBe("belum");
    expect(a?.r2Key).toBeTruthy();
    expect(ditulis).toHaveLength(1);
  });

  it("R2 sedang mati: penangkapan tetap berhasil, berkasnya tidak hilang dari daftar", async () => {
    r2Gagal = true;
    const id = await tangkap(2);
    const a = await db.waAttachment.findUnique({
      where: { id },
      select: { r2Key: true, status: true, localPath: true },
    });
    expect(a?.status).toBe("tertangkap");
    expect(a?.r2Key).toBeNull();
    expect(a?.localPath).toBeTruthy();
  });

  it("penyapu menjaring yang belum terarsip TANPA menunggu keputusan", async () => {
    r2Gagal = true;
    const id = await tangkap(3);
    r2Gagal = false;

    const hasil = await arsipkanYangTertinggal();
    expect(hasil.dipindah).toBeGreaterThanOrEqual(1);
    const a = await db.waAttachment.findUnique({ where: { id }, select: { r2Key: true } });
    expect(a?.r2Key).toBeTruthy();
  });

  it("R2 belum dikonfigurasi: penangkapan tidak gagal karenanya", async () => {
    r2Hidup = false;
    const id = await tangkap(4);
    const a = await db.waAttachment.findUnique({
      where: { id },
      select: { status: true, r2Key: true },
    });
    expect(a?.status).toBe("tertangkap");
    expect(a?.r2Key).toBeNull();
    expect(ditulis).toHaveLength(0);
  });
});
