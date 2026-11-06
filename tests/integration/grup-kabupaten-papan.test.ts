/*
 * GRUP KABUPATEN TERBACA DI PAPAN DAN DAFTAR – bukan hanya di jalur kirim
 * (DECISIONS 747).
 *
 * Laporan user 2026-11-06 dengan tangkapan layar Status Laporan Harian:
 * delapan lokasi bertanda "Tanpa grup" padahal grup kabupatennya terpasang.
 * Jalur kirimnya sudah benar sejak 596/609; yang salah layar yang menjawab
 * sendiri dari `package.waGroupId`. Kelas yang sama ditemukan di tiga tempat
 * lain saat disapu: daftar paket ("Grup WA: Belum"), Chat Grup (paket ber-grup
 * kabupaten saja tidak muncul), dan uji penerimaan WAHA di Sistem.
 *
 * Keadaan yang diuji meniru laporannya: paket TANPA grup paket, satu lokasi
 * dipasang ke grup kabupaten, satu lokasi tidak.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getStatusHarian } = await import("@/lib/daily-report/status-harian");
const { cakupanGrupPaket } = await import("@/lib/waha/grup");
const { PAKET_PUNYA_GRUP_WA, ringkasGrupWaPaket, CAKUPAN_KOSONG } = await import("@/lib/waha/grup-tujuan");

const suffix = `gk${Date.now().toString(36)}`;
const HARI = "2026-11-05";
const GRUP_KAB = `1203634${Date.now().toString().slice(-9)}1@g.us`;
const GRUP_PAKET = `1203634${Date.now().toString().slice(-9)}2@g.us`;

let orgId = "";
let userId = "";
let paketKab = "";
let paketBiasa = "";
let paketKosong = "";
let lokIkut = "";
let lokTidak = "";
let lokPaket = "";

async function lokasi(packageId: string, nama: string, regency: string) {
  const l = await db.location.create({
    data: {
      packageId,
      name: nama,
      slug: `${nama.toLowerCase().replace(/\s+/g, "-")}-${suffix}`,
      village: nama,
      regency,
      province: "Sulawesi Utara",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true },
  });
  return l.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  userId = (
    await db.user.create({
      data: { orgId, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
      select: { id: true },
    })
  ).id;

  // Paket seperti di laporan: TANPA grup paket, hanya grup kabupaten.
  paketKab = (
    await db.package.create({ data: { orgId, name: `Paket Sulut ${suffix}`, stage: "pelaksanaan" }, select: { id: true } })
  ).id;
  lokIkut = await lokasi(paketKab, "Bentenan Satu", "Minahasa Tenggara");
  lokTidak = await lokasi(paketKab, "Botuliodu", "Bolaang Mongondow Utara");
  const g = await db.waGroup.create({
    data: { orgId, packageId: paketKab, waGroupId: GRUP_KAB, waGroupName: "KNMP Minahasa Tenggara", regency: "Minahasa Tenggara" },
    select: { id: true },
  });
  await db.location.update({ where: { id: lokIkut }, data: { waGroupRefId: g.id } });

  paketBiasa = (
    await db.package.create({
      data: { orgId, name: `Paket Biasa ${suffix}`, stage: "pelaksanaan", waGroupId: GRUP_PAKET, waGroupName: "KNMP Biasa" },
      select: { id: true },
    })
  ).id;
  lokPaket = await lokasi(paketBiasa, "Tandurusa", "Kota Bitung");

  paketKosong = (
    await db.package.create({ data: { orgId, name: `Paket Kosong ${suffix}`, stage: "pelaksanaan" }, select: { id: true } })
  ).id;
  await lokasi(paketKosong, "Sepi", "Minahasa Utara");
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("papan Status Laporan Harian", () => {
  it("lokasi ber-grup KABUPATEN tidak lagi terbaca 'tanpa grup' walau paketnya tanpa grup paket", async () => {
    const s = await getStatusHarian({ id: userId, orgId, role: "super_admin" } as never, null, HARI);
    const baris = new Map(s!.rows.map((r) => [r.locationId, r.grupWaLabel]));
    expect(baris.get(lokIkut)).toBe("grup WhatsApp kabupaten Minahasa Tenggara");
    // Tetangganya di paket yang sama TIDAK dipasang dan paketnya tanpa grup:
    // ia memang tanpa tujuan, dan papan wajib tetap mengatakannya.
    expect(baris.get(lokTidak)).toBeNull();
    expect(baris.get(lokPaket)).toBe("grup WhatsApp paket");
  });
});

describe("daftar paket – kolom Grup WA", () => {
  it("cakupan menghitung lokasi aktif ber-grup kabupaten per paket", async () => {
    const c = await cakupanGrupPaket([paketKab, paketBiasa, paketKosong]);
    expect(c.get(paketKab)).toEqual({ lokasiAktif: 2, lokasiBerGrupKabupaten: 1, grupKabupaten: 1 });
    expect(c.get(paketBiasa)).toEqual({ lokasiAktif: 1, lokasiBerGrupKabupaten: 0, grupKabupaten: 0 });
  });

  it("paket ber-grup kabupaten saja: 'sebagian', bukan 'Belum'", async () => {
    const c = await cakupanGrupPaket([paketKab]);
    const r = ringkasGrupWaPaket({ waGroupId: null, waGroupName: null }, c.get(paketKab) ?? CAKUPAN_KOSONG);
    expect(r.keadaan).toBe("sebagian");
    expect(r.teks).toBe("1 grup kabupaten");
    expect(r.keterangan).toContain("1 dari 2 lokasi belum punya grup");
  });

  it("semua lokasi lewat grup kabupaten → lengkap walau tanpa grup paket", () => {
    const r = ringkasGrupWaPaket(
      { waGroupId: null, waGroupName: null },
      { lokasiAktif: 3, lokasiBerGrupKabupaten: 3, grupKabupaten: 2 },
    );
    expect(r).toMatchObject({ keadaan: "lengkap", teks: "2 grup kabupaten" });
  });

  it("tanpa grup apa pun tetap 'Belum'", () => {
    expect(ringkasGrupWaPaket({ waGroupId: null, waGroupName: null }, CAKUPAN_KOSONG).keadaan).toBe("belum");
  });
});

describe("Chat Grup – paket yang muncul", () => {
  it("paket ber-grup kabupaten saja ikut muncul; paket tanpa grup apa pun tidak", async () => {
    const ids = (
      await db.package.findMany({ where: { AND: [{ orgId }, PAKET_PUNYA_GRUP_WA] }, select: { id: true } })
    ).map((p) => p.id);
    expect(ids).toContain(paketKab);
    expect(ids).toContain(paketBiasa);
    expect(ids).not.toContain(paketKosong);
  });
});
