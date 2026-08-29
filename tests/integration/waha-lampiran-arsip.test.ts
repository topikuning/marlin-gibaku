// KE MANA BERKAS LAMPIRAN WA DISIMPAN, DAN BERAPA LAMA.
//
// Dua keluhan user yang berlawanan arah, dan aturan di bawah ini jalan tengahnya
// (ketetapan user 2026-08-29, DECISIONS 472):
//
//   "berkasnya hilang saat deploy"     → jangan andalkan disk kontainer;
//   "R2 akan kebanjiran, layar penuh"  → jangan arsipkan semua yang lewat grup.
//
// Aturannya:
//   • tangkap  → tulis ke disk LOKAL saja. Di production disk itu awet (Volume
//     Railway); di dev memang boleh hilang.
//   • R2       → HANYA yang sudah ditetapkan orang sebagai surat/dokumen.
//   • retensi  → foto 3 hari, berkas lain 14 hari. Lewat itu berkasnya dihapus,
//     barisnya jadi `kedaluwarsa` dan keluar dari daftar tunggu.
//   • yang sudah ditetapkan TIDAK pernah kedaluwarsa.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/*
 * Unduhan diganti di `globalThis.fetch` — itulah yang dipakai `unduhBerkas`.
 *
 * Isinya unik per JALANNYA uji dan per unduhan: sidik jari dihitung dari isi,
 * jadi berkas ber-isi sama dari jalan sebelumnya akan dikenali sebagai kembaran
 * — lengkap dengan `local_path` milik kontainer yang sudah tidak ada.
 */
const JALANAN = Math.random().toString(36).slice(2);
let nomorUnduh = 0;
const fetchAsli = globalThis.fetch;
globalThis.fetch = (async () => {
  nomorUnduh += 1;
  return new Response(new Uint8Array(Buffer.from(`%PDF-1.4 uji simpan ${JALANAN} ${nomorUnduh}\n`)), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}) as typeof fetch;

/** R2 palsu: catat apa yang ditulis dan apa yang dihapus. */
const ditulis: string[] = [];
const dihapus: string[] = [];
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async (key: string) => {
    ditulis.push(key);
  },
  r2Delete: async (key: string) => {
    dihapus.push(key);
  },
  r2GetBuffer: async () => Buffer.from(""),
}));

const { db } = await import("@/lib/db");
const { tangkapLampiran, arsipkanLampiran, arsipkanYangTertinggal, kedaluwarsakanLampiran } =
  await import("@/lib/waha/lampiran-tangkap");

const suffix = `ar${Date.now().toString(36)}`;
const HARI_MS = 24 * 60 * 60 * 1000;
let orgId = "";
let packageId = "";
let chatId = "";

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
  dihapus.length = 0;
});

afterAll(async () => {
  globalThis.fetch = fetchAsli;
  await db.organization.delete({ where: { id: orgId } }).catch(() => {});
  await db.$disconnect();
});

/** Tangkap satu lampiran. `foto` memakai nama berkas kamera → kelas foto_lapangan. */
async function tangkap(nomor: number, opts: { foto?: boolean } = {}) {
  const messageId = await pesanBaru(nomor);
  const hasil = await tangkapLampiran({
    messageId,
    packageId,
    mediaUrl: "https://waha.example/media/berkas",
    mimeType: opts.foto ? "image/jpeg" : "application/pdf",
    fileName: opts.foto ? `IMG-20260829-WA00${nomor}.jpg` : `Surat-${nomor}.pdf`,
    caption: opts.foto ? "" : "mohon diperiksa",
  });
  expect(hasil.ok).toBe(true);
  return (hasil as { attachmentId: string }).attachmentId;
}

/** Mundurkan umur baris supaya retensi bisa diuji tanpa menunggu berhari-hari. */
async function tuakan(id: string, hari: number) {
  await db.waAttachment.update({
    where: { id },
    data: { createdAt: new Date(Date.now() - hari * HARI_MS) },
  });
}

describe("tangkap lampiran: disk dulu, R2 belakangan", () => {
  it("TIDAK langsung naik R2 – yang belum ditetapkan cukup di disk", async () => {
    const id = await tangkap(1);
    const a = await db.waAttachment.findUnique({
      where: { id },
      select: { r2Key: true, localPath: true, status: true, decision: true },
    });
    expect(a?.status).toBe("tertangkap");
    expect(a?.localPath).toBeTruthy();
    expect(a?.decision).toBe("belum");
    expect(a?.r2Key).toBeNull();
    expect(ditulis).toHaveLength(0);
  });

  it("naik R2 begitu DITETAPKAN berguna", async () => {
    const id = await tangkap(2);
    const arsip = await arsipkanLampiran(id);
    expect(arsip.ok).toBe(true);
    expect(ditulis).toHaveLength(1);
    const a = await db.waAttachment.findUnique({ where: { id }, select: { r2Key: true } });
    expect(a?.r2Key).toBeTruthy();
  });

  it("penyapu hanya mengejar yang SUDAH ditetapkan, bukan seluruh isi grup", async () => {
    const belum = await tangkap(3);
    const sudah = await tangkap(4);
    await db.waAttachment.update({ where: { id: sudah }, data: { decision: "jadi_surat" } });

    await arsipkanYangTertinggal();

    const a = await db.waAttachment.findUnique({ where: { id: belum }, select: { r2Key: true } });
    const b = await db.waAttachment.findUnique({ where: { id: sudah }, select: { r2Key: true } });
    expect(a?.r2Key).toBeNull();
    expect(b?.r2Key).toBeTruthy();
  });
});

describe("retensi", () => {
  it("foto lewat 3 hari kedaluwarsa, berkasnya dihapus", async () => {
    const id = await tangkap(5, { foto: true });
    expect(
      (await db.waAttachment.findUnique({ where: { id }, select: { saranKind: true } }))?.saranKind,
    ).toBe("foto_lapangan");
    await tuakan(id, 4);

    await kedaluwarsakanLampiran();
    const a = await db.waAttachment.findUnique({
      where: { id },
      select: { status: true, localPath: true, failReason: true },
    });
    expect(a?.status).toBe("kedaluwarsa");
    expect(a?.localPath).toBeNull();
    expect(a?.failReason).toMatch(/3 hari/);
  });

  it("BERKAS umur 4 hari belum kedaluwarsa – jatahnya 14 hari", async () => {
    const id = await tangkap(6);
    await tuakan(id, 4);

    await kedaluwarsakanLampiran();
    expect(
      (await db.waAttachment.findUnique({ where: { id }, select: { status: true } }))?.status,
    ).toBe("tertangkap");
  });

  it("berkas lewat 14 hari kedaluwarsa", async () => {
    const id = await tangkap(7);
    await tuakan(id, 15);

    await kedaluwarsakanLampiran();
    expect(
      (await db.waAttachment.findUnique({ where: { id }, select: { status: true } }))?.status,
    ).toBe("kedaluwarsa");
  });

  it("yang SUDAH ditetapkan tidak pernah kedaluwarsa, setua apa pun", async () => {
    const id = await tangkap(8);
    await db.waAttachment.update({ where: { id }, data: { decision: "jadi_surat" } });
    await tuakan(id, 400);

    await kedaluwarsakanLampiran();
    expect(
      (await db.waAttachment.findUnique({ where: { id }, select: { status: true } }))?.status,
    ).toBe("tertangkap");
  });

  it("yang ditandai BUKAN BAHAN KERJA ikut kedaluwarsa pada jadwalnya", async () => {
    const id = await tangkap(10);
    await db.waAttachment.update({ where: { id }, data: { decision: "bukan_apa_apa" } });
    await tuakan(id, 15);

    await kedaluwarsakanLampiran();
    expect(
      (await db.waAttachment.findUnique({ where: { id }, select: { status: true } }))?.status,
    ).toBe("kedaluwarsa");
  });

  it("objek R2 milik baris kedaluwarsa ikut dihapus – tidak menumpuk diam-diam", async () => {
    // Keadaan warisan: sempat naik R2 pada hari-hari ketika semua diarsipkan.
    const id = await tangkap(9, { foto: true });
    await arsipkanLampiran(id);
    const kunci = (await db.waAttachment.findUnique({ where: { id }, select: { r2Key: true } }))!
      .r2Key!;
    await tuakan(id, 5);

    await kedaluwarsakanLampiran();
    expect(dihapus).toContain(kunci);
    const a = await db.waAttachment.findUnique({ where: { id }, select: { r2Key: true } });
    expect(a?.r2Key).toBeNull();
  });
});
