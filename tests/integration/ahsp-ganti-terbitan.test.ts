// MENGGANTI TERBITAN AHSP TIDAK BOLEH MENGHAPUS PEMETAAN MANUSIA (DECISIONS 323).
//
// Temuan user 2026-08-16 dari layar RAPL sungguhan: *"954 baris sudah dinyatakan
// memang tidak punya analisa AHSP"* — padahal tidak ada yang pernah menyatakan
// itu. Yang terjadi: impor ulang basis AHSP menghapus `AhspSource` (cascade ke
// `ahsp_entries`), dan `ahsp_padanan.entry_id` ber-ON DELETE SET NULL. Seluruh
// padanan yang sudah disetujui berubah jadi baris tanpa tautan, lalu dibaca
// sebagai "manusia menyatakan tidak ada padanan".
//
// Cacatnya SENYAP dan MEMBURUK SENDIRI: baris begitu masuk kelompok "sudah
// diputuskan", jadi hilang dari daftar pekerjaan; dan `petakanLokasi` melewatinya
// karena barisnya memang ada — cuma isinya kosong. Sekali terjadi, ia macet
// selamanya tanpa ada yang tahu.
//
// Jalankan: DATABASE_URL=...marlin_test APP_ENV=test pnpm vitest run tests/integration
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { imporAhspDariSeed, AHSP_SOURCE_CODE } = await import("@/lib/ahsp/import");
const { keadaanPadanan, koreksiPadanan, petakanLokasi, setujuiPadanan, tandaMenunggu } =
  await import("@/lib/ahsp/padanan");
const { simulasiRapl } = await import("@/lib/ahsp/rapl");
const { tandaItem } = await import("@/lib/ahsp/cocok");

const suffix = Date.now().toString(36);
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);

const ITEM: [kode: string, nama: string, unit: string, amount: bigint][] = [
  ["1", "Pekerjaan Beton Mutu Rendah fc 10 Mpa", "m³", 800_000_000n],
  ["2", "Pekerjaan Galian Tanah Biasa", "m³", 300_000_000n],
  ["3", "Sewa Rumah untuk Direksi Keet dan Gudang", "bln", 100_000_000n],
];
const GRAND = ITEM.reduce((a, [, , , amt]) => a + amt, 0n);

let orgId: string;
let userId: string;
let pkgId: string;
let vendorId: string;
let lokasiId: string;

beforeAll(async () => {
  if (!(await db.ahspSource.findUnique({ where: { code: AHSP_SOURCE_CODE } }))) {
    await imporAhspDariSeed(null);
  }

  const org = await db.organization.create({
    data: { name: `Org T ${suffix}`, slug: `orgt-${suffix}` },
  });
  orgId = org.id;
  userId = (
    await db.user.create({
      data: {
        orgId,
        username: `terbitan-${suffix}`,
        fullName: "Penguji Terbitan",
        passwordHash: "x",
        role: "super_admin",
      },
    })
  ).id;
  pkgId = (await db.package.create({ data: { orgId, name: `Paket T ${suffix}` } })).id;
  vendorId = (await db.vendor.create({ data: { orgId, name: `PT Uji T ${suffix}` } })).id;
  await db.contract.create({
    data: {
      packageId: pkgId,
      vendorId,
      contractNumber: `KTR-T-${suffix}`,
      contractValue: GRAND,
      signedDate: d("2026-01-05"),
      durationDays: 90,
      startDate: d("2026-01-05"),
      endDate: d("2026-04-04"),
    },
  });

  const loc = await db.location.create({
    data: {
      packageId: pkgId,
      name: "Lokasi Terbitan",
      slug: `terbitan-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      isActive: true,
      status: "berjalan",
    },
  });
  lokasiId = loc.id;
  const rev = await db.rabRevision.create({
    data: {
      locationId: loc.id,
      revisionNo: 1,
      source: "hps_awal",
      status: "aktif",
      totalValue: GRAND,
    },
  });
  const kategori = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "kategori",
      code: "I",
      name: "PEKERJAAN UTAMA",
      amount: GRAND,
      lineageKey: "I",
      sortOrder: 0,
    },
  });
  let sort = 1;
  for (const [kode, nama, unit, amount] of ITEM) {
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kategori.id,
        kind: "item",
        code: kode,
        name: nama,
        unit,
        volume: "100",
        amount,
        lineageKey: `I#${kode}`,
        sortOrder: sort++,
      },
    });
  }
}, 300000);

afterAll(async () => {
  await db.ahspPadanan.deleteMany({
    where: { tanda: { in: ITEM.map(([, nama, unit]) => tandaItem(nama, unit)) } },
  });
  await db.rabRevision.deleteMany({ where: { locationId: lokasiId } });
  await db.location.deleteMany({ where: { id: lokasiId } });
  await db.contract.deleteMany({ where: { packageId: pkgId } });
  await db.package.deleteMany({ where: { id: pkgId } });
  await db.vendor.deleteMany({ where: { id: vendorId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.$disconnect();
});

/** Paksa jalur "ganti utuh" pada impor berikutnya. */
async function paksaGantiTerbitan(): Promise<void> {
  await db.ahspSource.update({
    where: { code: AHSP_SOURCE_CODE },
    data: { fileSha256: `beda-${Date.now()}` },
  });
}

describe("mengganti terbitan basis AHSP", () => {
  it("padanan yang sudah disetujui TETAP tersambung setelah impor ulang", async () => {
    await petakanLokasi(lokasiId, userId);
    await setujuiPadanan({ tanda: await tandaMenunggu(lokasiId), userId });

    const sebelum = await keadaanPadanan(lokasiId);
    expect(sebelum.cakupan.disetujui).toBeGreaterThan(0);
    const disetujuiSebelum = sebelum.cakupan.disetujui;

    await paksaGantiTerbitan();
    const h = await imporAhspDariSeed(userId);
    expect(h.takBerubah).toBe(false);
    // Berkas yang sama diimpor ulang: SEMUA padanan harus tersambung kembali.
    expect(h.padananTersambung).toBeGreaterThan(0);
    expect(h.padananPutus).toBe(0);

    const sesudah = await keadaanPadanan(lokasiId);
    expect(sesudah.cakupan.disetujui).toBe(disetujuiSebelum);
    // Inilah angka yang dilaporkan user: 954 baris "dinyatakan tidak ada" yang
    // tidak pernah dinyatakan siapa pun. Harus NOL.
    expect(sesudah.cakupan.dinyatakanTidakAda).toBe(0);
    expect(sesudah.cakupan.putus).toBe(0);
  }, 600000);

  it("simulasi RAPL tidak kehilangan angkanya setelah ganti terbitan", async () => {
    // Kalau tautannya putus, kebutuhan bahan lenyap tanpa ada yang mengubah RAB
    // maupun mencabut persetujuan — laporan yang kemarin benar jadi kosong.
    const r = await simulasiRapl(lokasiId);
    expect(r.kebutuhan.length).toBeGreaterThan(0);
    expect(r.dipakai.baris).toBeGreaterThan(0);
  }, 300000);

  it('pernyataan manusia "memang tidak ada" TIDAK ikut tersapu', async () => {
    const [kode, nama, unit] = ITEM[2];
    await koreksiPadanan({
      tanda: tandaItem(nama, unit),
      uraianContoh: nama,
      satuan: unit,
      entryId: null,
      userId,
    });

    await paksaGantiTerbitan();
    await imporAhspDariSeed(userId);

    const { baris } = await keadaanPadanan(lokasiId);
    const sewa = baris.find((b) => b.code === kode)!;
    // Dibedakan dari "putus" karena disimpan POSITIF (`tidakAda`), bukan
    // disimpulkan dari entryId yang kosong.
    expect(sewa.keadaan).toBe("tidak_ada");
  }, 600000);

  it("baris yang TAUTANNYA PUTUS bisa dipetakan ulang, tidak macet selamanya", async () => {
    /*
     * Bagian yang membuat cacat ini memburuk sendiri: `petakanLokasi` melewati
     * tanda yang barisnya sudah ada. Baris putus PUNYA baris — cuma kosong —
     * jadi tanpa pengecualian, satu penggantian terbitan mengunci ribuan baris
     * selamanya dan tombol "Petakan otomatis" tidak berbuat apa-apa.
     */
    const tanda = tandaItem(ITEM[0][1], ITEM[0][2]);
    await db.ahspPadanan.update({ where: { tanda }, data: { entryId: null, tidakAda: false } });

    const rusak = await keadaanPadanan(lokasiId);
    expect(rusak.baris.find((b) => b.code === ITEM[0][0])!.keadaan).toBe("putus");
    expect(rusak.cakupan.putus).toBe(1);

    const h = await petakanLokasi(lokasiId, userId);
    expect(h.dipulihkan).toBe(1);

    const pulih = await keadaanPadanan(lokasiId);
    expect(pulih.cakupan.putus).toBe(0);
    expect(pulih.baris.find((b) => b.code === ITEM[0][0])!.ahsp).not.toBeNull();
  }, 300000);
});
