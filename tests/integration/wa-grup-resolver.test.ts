/*
 * RESOLVER GRUP: lokasi → grup, dan grup → lokasi (DECISIONS 596).
 *
 * Yang dikunci di sini bukan "fungsinya jalan", melainkan tiga keputusan yang
 * mudah sekali bergeser tanpa ketahuan:
 *
 * 1. **Grup kabupaten menang atas grup paket** untuk lokasi yang dipasang, dan
 *    lokasi yang TIDAK dipasang tetap ikut grup paket. Kalau urutannya terbalik,
 *    pemasangan kabupaten jadi tidak berpengaruh dan tidak ada yang tahu.
 *
 * 2. **Jangkauan grup PAKET tetap seluruh lokasi paket**, termasuk lokasi yang
 *    punya grup kabupaten sendiri. Mempersempitnya akan mengubah perilaku yang
 *    dipakai orang hari ini tanpa diminta; melebarkannya mustahil karena grup
 *    tidak pernah melintasi paket.
 *
 * 3. **Pengelompokan per grup**, yang dipakai penjadwal. Satu paket dengan dua
 *    kabupaten harus menghasilkan DUA tujuan – bukan satu, yang akan membuat
 *    kabupaten kedua tidak pernah dikirimi apa pun.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

const { grupUntukLokasi, lingkupGrup, kelompokkanPerGrup } = await import("@/lib/waha/grup");

const chat = () => `1203${randomUUID().replace(/-/g, "").slice(0, 16)}@g.us`;

let orgId = "";
let paketId = "";
let grupPaket = "";
let grupJepara = "";
let lokJepara1 = "";
let lokJepara2 = "";
let lokDemak = "";
let grupJeparaId = "";

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  orgId = org.id;

  grupPaket = chat();
  const pkg = await db.package.create({
    data: {
      orgId,
      name: `Paket ${suffix}`,
      stage: "pelaksanaan",
      waGroupId: grupPaket,
      waGroupName: "KNMP Paket",
    },
    select: { id: true },
  });
  paketId = pkg.id;

  grupJepara = chat();
  const g = await db.waGroup.create({
    data: {
      orgId,
      packageId: paketId,
      waGroupId: grupJepara,
      waGroupName: "KNMP Jepara",
      regency: "Jepara",
      province: "Jawa Tengah",
    },
    select: { id: true },
  });
  grupJeparaId = g.id;

  const buat = async (nama: string, regency: string, refId: string | null) => {
    const l = await db.location.create({
      data: {
        packageId: paketId,
        name: nama,
        slug: `${nama.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        village: nama,
        regency,
        province: "Jawa Tengah",
        isActive: true,
        waGroupRefId: refId,
      },
      select: { id: true },
    });
    return l.id;
  };

  lokJepara1 = await buat("Karanggondang", "Jepara", grupJeparaId);
  lokJepara2 = await buat("Ujungwatu", "Jepara", grupJeparaId);
  lokDemak = await buat("Kedungmutih", "Demak", null);
});

describe("grupUntukLokasi – kabupaten menang, sisanya ikut paket", () => {
  it("lokasi yang dipasang ke grup kabupaten memakai grup itu", async () => {
    const g = await grupUntukLokasi(lokJepara1);
    expect(g?.chatId).toBe(grupJepara);
    expect(g?.asal).toBe("kabupaten");
    expect(g?.label).toBe("grup WhatsApp kabupaten Jepara");
  });

  it("lokasi yang TIDAK dipasang tetap ikut grup paket", async () => {
    const g = await grupUntukLokasi(lokDemak);
    expect(g?.chatId).toBe(grupPaket);
    expect(g?.asal).toBe("paket");
  });

  it("lokasi tanpa tujuan apa pun mengembalikan null, bukan melempar", async () => {
    const suffix = randomUUID().slice(0, 8);
    const kosong = await db.package.create({
      data: { orgId, name: `Tanpa grup ${suffix}`, stage: "pelaksanaan" },
      select: { id: true },
    });
    const l = await db.location.create({
      data: {
        packageId: kosong.id,
        name: "Sepi",
        slug: `sepi-${suffix}`,
        village: "Sepi",
        regency: "Rembang",
        province: "Jawa Tengah",
        isActive: true,
      },
      select: { id: true },
    });
    expect(await grupUntukLokasi(l.id)).toBeNull();
  });
});

describe("lingkupGrup – siapa yang boleh dibicarakan di grup ini", () => {
  it("grup kabupaten hanya memuat anggotanya", async () => {
    const s = await lingkupGrup(grupJepara);
    expect(s?.asal).toBe("kabupaten");
    expect(s?.packageId).toBe(paketId);
    expect([...(s?.lokasiIds ?? [])].sort()).toEqual([lokJepara1, lokJepara2].sort());
    expect(s?.lokasiIds).not.toContain(lokDemak);
  });

  it("grup paket tetap memuat SELURUH lokasi paket – termasuk yang punya grup kabupaten", async () => {
    const s = await lingkupGrup(grupPaket);
    expect(s?.asal).toBe("paket");
    expect([...(s?.lokasiIds ?? [])].sort()).toEqual([lokJepara1, lokJepara2, lokDemak].sort());
  });

  it("chatId tak dikenal → null, bukan tebakan", async () => {
    expect(await lingkupGrup(chat())).toBeNull();
    expect(await lingkupGrup("")).toBeNull();
  });
});

describe("kelompokkanPerGrup – penjadwal tidak boleh kehilangan grup kedua", () => {
  it("satu paket dua kabupaten ⇒ DUA tujuan", async () => {
    const hasil = await kelompokkanPerGrup([lokJepara1, lokJepara2, lokDemak]);
    expect(hasil).toHaveLength(2);

    const jepara = hasil.find((h) => h.chatId === grupJepara);
    const paket = hasil.find((h) => h.chatId === grupPaket);
    expect([...(jepara?.lokasiIds ?? [])].sort()).toEqual([lokJepara1, lokJepara2].sort());
    expect(paket?.lokasiIds).toEqual([lokDemak]);
  });

  it("lokasi tanpa tujuan dilewati, tidak menggagalkan yang lain", async () => {
    const suffix = randomUUID().slice(0, 8);
    const kosong = await db.package.create({
      data: { orgId, name: `Tanpa grup ${suffix}`, stage: "pelaksanaan" },
      select: { id: true },
    });
    const yatim = await db.location.create({
      data: {
        packageId: kosong.id,
        name: "Yatim",
        slug: `yatim-${suffix}`,
        village: "Yatim",
        regency: "Rembang",
        province: "Jawa Tengah",
        isActive: true,
      },
      select: { id: true },
    });
    const hasil = await kelompokkanPerGrup([lokJepara1, yatim.id]);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].chatId).toBe(grupJepara);
  });

  it("daftar kosong ⇒ tidak ada tujuan, tanpa menyentuh basis data", async () => {
    expect(await kelompokkanPerGrup([])).toEqual([]);
  });
});
