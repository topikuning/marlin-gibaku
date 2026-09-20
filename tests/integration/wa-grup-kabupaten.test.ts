/*
 * GRUP WA KABUPATEN TIDAK PERNAH MELINTASI PAKET (DECISIONS 596).
 *
 * Keputusan user 2026-09-20, dengan kata-katanya sendiri: *"tidak boleh, karena
 * meskipun ada group kabupaten, group itu tetap hanya kabupaten di dalam paket
 * itu."*
 *
 * Aturan itu ditegakkan BASIS DATA, lewat FK komposit
 * `(wa_group_ref_id, package_id) → wa_groups (id, package_id)` — bukan lewat
 * pemeriksaan di service. Bedanya penting: pemeriksaan di service hanya berlaku
 * di jalur yang ingat memanggilnya, sementara migrasi 2026-08-19 sudah pernah
 * membuktikan apa yang terjadi kalau tautan grup dibiarkan longgar — data paket
 * A terkirim ke grup paket B, dan paket mana yang menjawab ditentukan urutan
 * baris (DECISIONS 370).
 *
 * Konsekuensi yang DISENGAJA dan ikut diuji di sini: kabupaten yang lokasinya
 * terbelah dua paket butuh DUA grup. Itu bukan kekurangan yang harus diakali —
 * itu aturannya.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

let ORG = "";

async function buatPaket(nama: string): Promise<string> {
  const p = await db.package.create({
    data: { orgId: ORG, name: nama, stage: "pelaksanaan", province: "Jawa Tengah" },
    select: { id: true },
  });
  return p.id;
}

async function buatLokasi(packageId: string, nama: string, regency: string): Promise<string> {
  const l = await db.location.create({
    data: {
      packageId,
      name: nama,
      slug: `${nama.toLowerCase().replace(/\s+/g, "-")}-${randomUUID().slice(0, 8)}`,
      village: nama,
      regency,
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true },
  });
  return l.id;
}

async function buatGrup(packageId: string, chatId: string, regency: string): Promise<string> {
  const g = await db.waGroup.create({
    data: { orgId: ORG, packageId, waGroupId: chatId, waGroupName: `KNMP ${regency}`, regency, province: "Jawa Tengah" },
    select: { id: true },
  });
  return g.id;
}

describe("grup kabupaten terkurung di dalam paketnya", () => {
  let paketA = "";
  let paketB = "";
  let grupA = "";
  let lokasiA1 = "";
  let lokasiB1 = "";

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
    ORG = org.id;
    paketA = await buatPaket("Paket KNMP Jepara – Karanggondang");
    paketB = await buatPaket("Paket KNMP Jepara – Ujungwatu");
    grupA = await buatGrup(paketA, `1203${randomUUID().slice(0, 12)}@g.us`, "Jepara");
    lokasiA1 = await buatLokasi(paketA, "Karanggondang", "Jepara");
    lokasiB1 = await buatLokasi(paketB, "Ujungwatu", "Jepara");
  });

  it("lokasi dari paket yang SAMA boleh dipasang ke grupnya", async () => {
    await db.location.update({ where: { id: lokasiA1 }, data: { waGroupRefId: grupA } });
    const l = await db.location.findUniqueOrThrow({
      where: { id: lokasiA1 },
      select: { waGroupRefId: true },
    });
    expect(l.waGroupRefId).toBe(grupA);
  });

  it("lokasi dari paket LAIN ditolak basis data, bukan oleh kode yang ingat memeriksa", async () => {
    // Inilah kasus Jepara: satu kabupaten, dua paket. Kalau ini lolos, pesan
    // grup paket A akan menjawab tentang lokasi paket B.
    await expect(
      db.location.update({ where: { id: lokasiB1 }, data: { waGroupRefId: grupA } }),
    ).rejects.toThrow();

    const l = await db.location.findUniqueOrThrow({
      where: { id: lokasiB1 },
      select: { waGroupRefId: true },
    });
    expect(l.waGroupRefId).toBeNull();
  });

  it("kabupaten terbelah dua paket memang butuh DUA grup – dan itu sah", async () => {
    const grupB = await buatGrup(paketB, `1203${randomUUID().slice(0, 12)}@g.us`, "Jepara");
    await db.location.update({ where: { id: lokasiB1 }, data: { waGroupRefId: grupB } });
    const l = await db.location.findUniqueOrThrow({
      where: { id: lokasiB1 },
      select: { waGroupRefId: true },
    });
    expect(l.waGroupRefId).toBe(grupB);
  });

  it("satu grup WhatsApp nyata tidak boleh punya dua baris", async () => {
    const chatId = `1203${randomUUID().slice(0, 12)}@g.us`;
    await buatGrup(paketA, chatId, "Demak");
    await expect(buatGrup(paketB, chatId, "Demak")).rejects.toThrow();
  });

  it("grup yang masih dipakai lokasi tidak bisa dihapus diam-diam", async () => {
    // Menghapusnya begitu saja akan meninggalkan lokasi tanpa tujuan kiriman
    // tanpa seorang pun tahu. Lepaskan anggotanya dulu.
    await expect(db.waGroup.delete({ where: { id: grupA } })).rejects.toThrow();

    await db.location.update({ where: { id: lokasiA1 }, data: { waGroupRefId: null } });
    await expect(db.waGroup.delete({ where: { id: grupA } })).resolves.toBeTruthy();
  });

  it("paket dihapus ⇒ grupnya ikut, tidak jadi baris yatim yang menahan chatId", async () => {
    const paketC = await buatPaket("Paket sementara");
    const chatId = `1203${randomUUID().slice(0, 12)}@g.us`;
    await buatGrup(paketC, chatId, "Rembang");
    await db.package.delete({ where: { id: paketC } });
    expect(await db.waGroup.findUnique({ where: { waGroupId: chatId } })).toBeNull();
  });
});
