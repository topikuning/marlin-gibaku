/*
 * JALUR MASUK MENYEMPIT KE LOKASI GRUPNYA (DECISIONS 596).
 *
 * Sebelum ini `chatId` selalu dipetakan ke PAKET, dan pertanyaan tanpa nama
 * lokasi dijawab dengan cakupan seluruh lokasi paket. Di grup kabupaten itu
 * salah arah: orang di grup Jepara bertanya "progress berapa" dan menerima
 * angka yang sebagiannya milik Demak — paket yang sama, tetapi bukan urusan
 * grup itu, dan tidak ada satu pun tanda bahwa angkanya melebar.
 *
 * Yang dikunci di sini: pemetaan MASUK mendahulukan grup kabupaten, dan
 * jangkauannya hanya anggotanya. Grup paket tidak berubah sama sekali.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { db } = await import("@/lib/db");
const { lingkupGrup } = await import("@/lib/waha/grup");
const { ingestWaEvent } = await import("@/lib/waha/ingest");

const chat = () => `1203${randomUUID().replace(/-/g, "").slice(0, 16)}@g.us`;

let orgId = "";
let paketId = "";
let grupPaket = "";
let grupJepara = "";
let lokJepara = "";
let lokDemak = "";

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  orgId = org.id;

  grupPaket = chat();
  const pkg = await db.package.create({
    data: { orgId, name: `Paket ${suffix}`, stage: "pelaksanaan", waGroupId: grupPaket },
    select: { id: true },
  });
  paketId = pkg.id;

  grupJepara = chat();
  const g = await db.waGroup.create({
    data: { orgId, packageId: paketId, waGroupId: grupJepara, waGroupName: "KNMP Jepara", regency: "Jepara" },
    select: { id: true },
  });

  const buat = async (nama: string, regency: string, ref: string | null) =>
    (
      await db.location.create({
        data: {
          packageId: paketId,
          name: nama,
          slug: `${nama.toLowerCase()}-${randomUUID().slice(0, 8)}`,
          village: nama,
          regency,
          province: "Jawa Tengah",
          isActive: true,
          waGroupRefId: ref,
        },
        select: { id: true },
      })
    ).id;

  lokJepara = await buat("Karanggondang", "Jepara", g.id);
  lokDemak = await buat("Kedungmutih", "Demak", null);
});

describe("pesan dari grup kabupaten hanya menjangkau anggotanya", () => {
  it("lingkup grup kabupaten = anggotanya saja", async () => {
    const s = await lingkupGrup(grupJepara);
    expect(s?.lokasiIds).toEqual([lokJepara]);
    expect(s?.lokasiIds).not.toContain(lokDemak);
    expect(s?.packageId).toBe(paketId);
  });

  it("lingkup grup paket tidak berubah – tetap seluruh lokasi paket", async () => {
    const s = await lingkupGrup(grupPaket);
    expect([...(s?.lokasiIds ?? [])].sort()).toEqual([lokJepara, lokDemak].sort());
  });
});

describe("arsip pesan masuk mengenali grup kabupaten", () => {
  it("pesan dari grup kabupaten DISIMPAN, bukan dibuang", async () => {
    const hasil = await ingestWaEvent({
      event: "message",
      payload: {
        id: `uji-${randomUUID()}`,
        from: grupJepara,
        body: "halo dari grup kabupaten",
        timestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(hasil.stored).toBe(true);

    // Paketnya tidak pernah ambigu: grup kabupaten selalu milik satu paket.
    const row = await db.waMessage.findFirst({
      where: { chatId: grupJepara },
      select: { packageId: true },
    });
    expect(row?.packageId).toBe(paketId);
  });

  it("grup yang tidak tertaut ke mana pun tetap dibuang, dengan sebabnya", async () => {
    const hasil = await ingestWaEvent({
      event: "message",
      payload: {
        id: `uji-${randomUUID()}`,
        from: chat(),
        body: "grup asing",
        timestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(hasil.stored).toBe(false);
    expect(hasil.reason).toContain("tidak tertaut");
  });
});
