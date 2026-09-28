/*
 * LAPORAN MINGGUAN UNTUK PAKET YANG HANYA PUNYA GRUP KABUPATEN.
 *
 * Pengirimnya (`kirimLaporanMingguan`) sudah membagi kiriman per grup
 * kabupaten sejak DECISIONS 596. Yang tertinggal dua pagar yang masih membaca
 * `Package.waGroupId` sendiri – pola yang sama dengan DECISIONS 609:
 *
 * - penjadwal hanya mengambil paket ber-`waGroupId`, jadi paket yang semua
 *   lokasinya dipasang ke grup kabupaten TIDAK PERNAH menerima kiriman otomatis;
 * - tombol manual di halaman paket mati dengan status "Butuh grup".
 *
 * Keduanya sekarang bertanya ke `PUNYA_TUJUAN_MINGGUAN`/`adaTujuanMingguan`,
 * satu syarat yang sama dengan tujuan yang benar-benar dipakai pengirim.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const terkirim: { chatId: string; text: string }[] = [];
vi.mock("@/lib/waha/client", () => ({
  isWahaConfigured: async () => true,
  getSessionStatus: async () => ({ name: "default", status: "WORKING" }),
}));
vi.mock("@/lib/waha/kirim", () => ({
  sendText: async (chatId: string, text: string) => {
    terkirim.push({ chatId, text });
    return `wamid.${terkirim.length}`;
  },
}));

const { db } = await import("@/lib/db");
const { adaTujuanMingguan } = await import("@/lib/mingguan/kirim");
const { kirimLaporanMingguanTerjadwal } = await import("@/lib/mingguan/penjadwal");
const { setMingguanAktif } = await import("@/lib/mingguan/setelan");

const suffix = `mgk${Date.now().toString(36)}`;
/**
 * SPMK Selasa 7 Juli 2026, minggu tujuh-hari → akhir minggu ke-1 = Senin
 * 13 Juli. Sengaja tidak sama dengan `laporan-mingguan-wa.test.ts` (akhir
 * minggu Minggu 12/19/26 Juli): penjadwal memeriksa SEMUA paket di basis data
 * uji, dan hitungan di berkas itu global.
 */
const SPMK = new Date("2026-07-07T00:00:00.000Z");
const GRUP_KAB = `62811${Date.now().toString().slice(-8)}@g.us`;
let paketKabupaten = "";
let paketTanpaGrup = "";

async function buatPaket(orgId: string, vendorId: string, nama: string): Promise<{ pkg: string; lokasi: string }> {
  const pkg = await db.package.create({
    data: { orgId, name: `${nama} ${suffix}`, stage: "pelaksanaan" },
    select: { id: true },
  });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId,
      contractNumber: `SPK-${nama}-${suffix}`,
      contractValue: 1_000_000_000n,
      signedDate: new Date("2026-07-01"),
      durationDays: 140,
      startDate: SPMK,
      endDate: new Date("2026-11-23"),
      weekMode: "tujuh_hari",
    },
  });
  const l = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Desa ${nama}`,
      slug: `desa-${nama.toLowerCase()}-${suffix}`,
      village: `Desa ${nama}`,
      regency: "Demak",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true },
  });
  return { pkg: pkg.id, lokasi: l.id };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: "CV. UJI KABUPATEN" }, select: { id: true } });

  const a = await buatPaket(org.id, vendor.id, "Kabupaten");
  paketKabupaten = a.pkg;
  const g = await db.waGroup.create({
    data: {
      orgId: org.id,
      packageId: a.pkg,
      waGroupId: GRUP_KAB,
      waGroupName: "KNMP Demak",
      regency: "Demak",
      province: "Jawa Tengah",
    },
    select: { id: true },
  });
  await db.location.update({ where: { id: a.lokasi }, data: { waGroupRefId: g.id } });

  paketTanpaGrup = (await buatPaket(org.id, vendor.id, "Tanpa")).pkg;
  await setMingguanAktif(true);
});

describe("paket yang hanya punya grup kabupaten", () => {
  it("penjadwal MENGIRIM ke grup kabupatennya di akhir minggu kontrak", async () => {
    const h = await kirimLaporanMingguanTerjadwal(new Date("2026-07-13T09:00:00Z"));
    const ke = terkirim.filter((t) => t.chatId === GRUP_KAB);
    expect(ke, JSON.stringify(h.rincian)).toHaveLength(1);
    expect(ke[0]!.text).toContain("Nama Desa/KNMP : Desa Kabupaten");
  });

  it("tombol manual di halaman paket menyala", async () => {
    expect(await adaTujuanMingguan(paketKabupaten)).toBe(true);
  });

  it("paket tanpa grup apa pun tetap tidak punya tujuan – dan tidak diperiksa penjadwal", async () => {
    expect(await adaTujuanMingguan(paketTanpaGrup)).toBe(false);
    const h = await kirimLaporanMingguanTerjadwal(new Date("2026-07-20T09:00:00Z"));
    expect(h.rincian.some((r) => r.paket.includes(`Tanpa ${suffix}`))).toBe(false);
  });
});
