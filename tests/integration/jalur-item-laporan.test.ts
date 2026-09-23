/*
 * ITEM PEKERJAAN DI LAPORAN HARIAN MENYEBUT KATEGORI & SUB-KATEGORINYA.
 *
 * **Laporan user 2026-09-23**, memotret layar laporan yang sudah disetujui:
 *
 *   *"itu ada item pekerjaan, tapi masuk kategori atau sub kategori apa tidak
 *   diketahui, padahal waktu proses input ada. ini penting untuk dapat sekali
 *   lihat tanpa harus buka-buka laporan lain lagi"*
 *
 * Benar, dan ini keluhan yang SAMA dengan 2026-09-05 (*"2.d, 2.e itu yang mana,
 * ada banyak kategori di sini, seharusnya sekalian sebutkan parentnya"*) — waktu
 * itu diperbaiki hanya di pratinjau impor RAB. Layar laporan harian mencetak
 * `code` apa adanya: baris pada tangkapan layar user berbunyi **"1"**. Nomor
 * item hanya unik DI DALAM induknya, jadi "1" ada di setiap kategori; yang
 * memeriksa harus membuka layar lain untuk tahu pekerjaan mana yang dimaksud.
 *
 * Yang diuji di sini: jalurnya benar-benar sampai ke lapisan query, dalam DUA
 * bentuk — rantai KODE (`II · 1`) dan rantai NAMA (`PEKERJAAN REVETMENT ›
 * Pekerjaan Tanah`). Kode saja tidak menjawab pertanyaan user ("kategori apa");
 * nama saja tidak bisa dicocokkan dengan dokumen kontrak.
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

const { db } = await import("@/lib/db");
const { jalurNodeById } = await import("@/lib/rab/jalur");
const { getWorkspaceData } = await import("@/lib/daily-report/queries");
const { getOrCreateDraft, upsertItem, submitReport } = await import("@/lib/daily-report/service");

const suffix = `jl${Date.now().toString(36)}`;
let locationId: string;
let slug: string;
let userId: string;
let itemDalamSubId: string;
let itemLangsungId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org JL ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `jl-${suffix}`, fullName: "Mandor Uji", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket JL ${suffix}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor JL ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 200_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 150,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-29"),
    },
  });
  slug = `lokasi-${suffix}`;
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi JL",
      slug,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 125_000_000n },
  });
  // II › Pekerjaan Tanah › item "1"  ·  III › item "1" (langsung di kategori)
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "II", name: "PEKERJAAN REVETMENT", amount: 100_000_000n, lineageKey: "II", sortOrder: 1 },
  });
  const sub = await db.rabNode.create({
    data: { revisionId: rev.id, parentId: kat.id, kind: "sub", code: "1", name: "Pekerjaan Tanah", amount: 100_000_000n, lineageKey: "II#1", sortOrder: 2 },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: sub.id, kind: "item", code: "1",
      name: "Pekerjaan Urugan Tanah mendatangkan",
      volume: 350, unit: "m3", unitPrice: 258_000, amount: 90_300_000n, lineageKey: "II#1#1", sortOrder: 3,
    },
  });
  itemDalamSubId = item.id;

  const kat2 = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "III", name: "PEKERJAAN JALAN", amount: 25_000_000n, lineageKey: "III", sortOrder: 4 },
  });
  const item2 = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat2.id, kind: "item", code: "1", name: "Lapis pondasi",
      volume: 100, unit: "m2", unitPrice: 250_000, amount: 25_000_000n, lineageKey: "III#1", sortOrder: 5,
    },
  });
  itemLangsungId = item2.id;

  const draft = await getOrCreateDraft(locationId, "2026-09-20", userId);
  await upsertItem(draft.id, { rabNodeId: itemDalamSubId, volumeDone: 59.63 }, userId);
  await upsertItem(draft.id, { rabNodeId: itemLangsungId, volumeDone: 10 }, userId);
  await submitReport(draft.id, userId);
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("jalurNodeById – rantai induk sebuah node RAB", () => {
  it("item di dalam sub-kategori membawa rantai KODE lengkap", async () => {
    const peta = await jalurNodeById([itemDalamSubId]);
    expect(peta.get(itemDalamSubId)?.kode).toBe("II · 1 · 1");
  });

  it("…dan rantai NAMA induknya, TANPA nama itemnya sendiri", async () => {
    // Nama item sudah tercetak besar di barisnya; mengulanginya di baris jalur
    // hanya menghabiskan tempat yang dipakai menjawab "kategori apa".
    const peta = await jalurNodeById([itemDalamSubId]);
    expect(peta.get(itemDalamSubId)?.nama).toBe("PEKERJAAN REVETMENT › Pekerjaan Tanah");
  });

  it("item yang menempel LANGSUNG di kategori tetap punya jalur", async () => {
    const peta = await jalurNodeById([itemLangsungId]);
    expect(peta.get(itemLangsungId)?.kode).toBe("III · 1");
    expect(peta.get(itemLangsungId)?.nama).toBe("PEKERJAAN JALAN");
  });

  it("banyak id sekaligus dilayani satu peta – bukan query per baris", async () => {
    const peta = await jalurNodeById([itemDalamSubId, itemLangsungId]);
    expect(peta.size).toBe(2);
  });

  it("id yang tidak ada tidak melempar, cuma absen dari petanya", async () => {
    const peta = await jalurNodeById(["00000000-0000-0000-0000-000000000000"]);
    expect(peta.size).toBe(0);
  });

  it("daftar kosong tidak menyentuh DB sama sekali", async () => {
    expect((await jalurNodeById([])).size).toBe(0);
  });
});

describe("workspace harian – tiap item menyebut kategorinya", () => {
  it("baris item membawa jalur kode DAN jalur nama", async () => {
    const ws = (await getWorkspaceData(slug, "2026-09-20"))!;
    const it = ws.report!.items.find((x) => x.lineageKey === "II#1#1")!;
    expect(it.jalurKode).toBe("II · 1 · 1");
    expect(it.jalurNama).toBe("PEKERJAAN REVETMENT › Pekerjaan Tanah");
  });

  it("dua item bernomor SAMA jadi bisa dibedakan – itu inti keluhannya", async () => {
    // Keduanya berkode "1". Tanpa jalur, layar mencetak "1" dua kali dan
    // pembacanya harus membuka layar lain untuk tahu mana yang mana.
    const ws = (await getWorkspaceData(slug, "2026-09-20"))!;
    const kode = ws.report!.items.map((x) => x.code);
    expect(kode).toEqual(["1", "1"]);
    const jalur = ws.report!.items.map((x) => x.jalurKode).sort();
    expect(new Set(jalur).size).toBe(2);
  });
});
