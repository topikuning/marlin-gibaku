/*
 * PENGINGAT HARIAN DIKIRIM PER GRUP, BUKAN PER PAKET (DECISIONS 596).
 *
 * Kegagalan yang ditutup di sini SENYAP, dan itulah yang membuatnya berbahaya.
 * Kunci anti-duplikat lama `(package_id, date_key)` berarti satu paket hanya
 * boleh punya SATU giliran per hari. Begitu paket itu punya dua grup kabupaten,
 * grup pertama dikirimi dan grup kedua **tidak pernah menerima apa pun** —
 * bukan galat, bukan baris gagal, bukan apa-apa. Pesan yang tidak datang tidak
 * meninggalkan jejak, jadi tidak ada yang akan melaporkannya sebagai bug.
 *
 * Kuncinya kini `(date_key, target_chat_id)`: satu pengingat per GRUP per hari.
 * Itu menyatakan aturan yang sebenarnya, dan sekaligus menutup arah sebaliknya
 * (dua pesan ke satu grup dalam sehari).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { db } = await import("@/lib/db");
const { tagihanPerGrup } = await import("@/lib/harian/belum-lapor");

const chat = () => `1203${randomUUID().replace(/-/g, "").slice(0, 16)}@g.us`;
const HARI = new Date("2026-09-20T05:00:00.000Z"); // 12:00 WIB

let orgId = "";
let paketId = "";
let grupPaketChat = "";
let grupJeparaChat = "";
let grupDemakChat = "";
let lokJepara = "";
let lokDemak = "";
let lokIkutPaket = "";
let userId = "";

beforeEach(async () => {
  const suffix = randomUUID().slice(0, 8);
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  orgId = org.id;

  const vendor = await db.vendor.create({
    data: { orgId, name: `PT Uji ${suffix}` },
    select: { id: true },
  });
  const u = await db.user.create({
    data: { orgId, username: `u-${suffix}`, fullName: "Uji", passwordHash: "x", role: "super_admin" },
    select: { id: true },
  });
  userId = u.id;

  grupPaketChat = chat();
  const pkg = await db.package.create({
    data: {
      orgId,
      name: `Paket ${suffix}`,
      stage: "pelaksanaan",
      waGroupId: grupPaketChat,
      waGroupName: "Grup paket",
    },
    select: { id: true },
  });
  paketId = pkg.id;

  await db.contract.create({
    data: {
      packageId: paketId,
      contractNumber: `SPK-${suffix}`,
      vendorId: vendor.id,
      signedDate: new Date("2026-07-25T00:00:00.000Z"),
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      endDate: new Date("2026-12-01T00:00:00.000Z"),
      contractValue: 1000n,
    },
  });

  const buatGrup = async (regency: string) => {
    const c = chat();
    await db.waGroup.create({
      data: { orgId, packageId: paketId, waGroupId: c, waGroupName: `KNMP ${regency}`, regency },
    });
    return c;
  };
  grupJeparaChat = await buatGrup("Jepara");
  grupDemakChat = await buatGrup("Demak");

  const refFor = async (c: string) =>
    (await db.waGroup.findUniqueOrThrow({ where: { waGroupId: c }, select: { id: true } })).id;

  const buatLokasi = async (nama: string, regency: string, ref: string | null) => {
    const l = await db.location.create({
      data: {
        packageId: paketId,
        name: nama,
        slug: `${nama.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        village: nama,
        regency,
        province: "Jawa Tengah",
        isActive: true,
        status: "berjalan",
        waGroupRefId: ref,
      },
      select: { id: true },
    });
    return l.id;
  };

  lokJepara = await buatLokasi("Karanggondang", "Jepara", await refFor(grupJeparaChat));
  lokDemak = await buatLokasi("Kedungmutih", "Demak", await refFor(grupDemakChat));
  lokIkutPaket = await buatLokasi("Tanpa kabupaten", "Rembang", null);
});

describe("tagihanPerGrup – satu tagihan per grup, bukan per paket", () => {
  it("satu paket dengan dua kabupaten menghasilkan TIGA tagihan, bukan satu", async () => {
    const tagihan = await tagihanPerGrup(HARI, { packageId: paketId });
    expect(tagihan).toHaveLength(3);

    const perChat = new Map(tagihan.map((t) => [t.chatId, t]));
    expect([...perChat.keys()].sort()).toEqual(
      [grupJeparaChat, grupDemakChat, grupPaketChat].sort(),
    );
  });

  it("tiap tagihan hanya memuat lokasi grupnya sendiri", async () => {
    const tagihan = await tagihanPerGrup(HARI, { packageId: paketId });
    const jepara = tagihan.find((t) => t.chatId === grupJeparaChat)!;
    const demak = tagihan.find((t) => t.chatId === grupDemakChat)!;
    const paket = tagihan.find((t) => t.chatId === grupPaketChat)!;

    expect(jepara.belum.map((b) => b.locationId)).toEqual([lokJepara]);
    expect(demak.belum.map((b) => b.locationId)).toEqual([lokDemak]);
    expect(paket.belum.map((b) => b.locationId)).toEqual([lokIkutPaket]);
  });

  it("grup kabupaten membawa nama kabupatennya, grup paket tidak", async () => {
    const tagihan = await tagihanPerGrup(HARI, { packageId: paketId });
    expect(tagihan.find((t) => t.chatId === grupJeparaChat)?.kabupaten).toBe("Jepara");
    expect(tagihan.find((t) => t.chatId === grupPaketChat)?.kabupaten).toBeNull();
  });

  it("lokasi yang sudah melapor tidak ditagih, dan grup yang tuntas hilang dari daftar", async () => {
    await db.dailyReport.create({
      data: {
        locationId: lokJepara,
        reportDate: new Date("2026-09-20T00:00:00.000Z"),
        status: "dikirim",
        createdById: userId,
      },
    });
    const tagihan = await tagihanPerGrup(HARI, { packageId: paketId });
    const jepara = tagihan.find((t) => t.chatId === grupJeparaChat);
    expect(jepara?.belum).toEqual([]);
    expect(jepara?.sudah).toBe(1);
  });

  it("paket tanpa grup sama sekali tidak menghasilkan tagihan", async () => {
    const suffix = randomUUID().slice(0, 8);
    const sepi = await db.package.create({
      data: { orgId, name: `Sepi ${suffix}`, stage: "pelaksanaan" },
      select: { id: true },
    });
    const v2 = await db.vendor.create({ data: { orgId, name: `PT Sepi ${suffix}` }, select: { id: true } });
    await db.contract.create({
      data: {
        packageId: sepi.id,
        contractNumber: `SPK-${suffix}`,
        vendorId: v2.id,
        signedDate: new Date("2026-07-25T00:00:00.000Z"),
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-12-01T00:00:00.000Z"),
        contractValue: 1000n,
      },
    });
    await db.location.create({
      data: {
        packageId: sepi.id,
        name: "Sunyi",
        slug: `sunyi-${suffix}`,
        village: "Sunyi",
        regency: "Rembang",
        province: "Jawa Tengah",
        isActive: true,
        status: "berjalan",
      },
    });
    expect(await tagihanPerGrup(HARI, { packageId: sepi.id })).toEqual([]);
  });
});
