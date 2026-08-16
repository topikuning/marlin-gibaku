// Pemetaan item RAB → analisa AHSP yang TERSIMPAN (DECISIONS 319).
//
// Yang diuji di sini bukan seberapa pintar pencocoknya (itu di
// tests/unit/ahsp-cocok.test.ts), melainkan JANJI-JANJI penyimpanannya:
//
//  1. Dijalankan dua kali, yang kedua tidak menulis apa pun.
//  2. Koreksi manusia tidak pernah ditimpa pemetaan ulang.
//  3. Satu koreksi berlaku untuk semua lokasi yang uraiannya persis sama.
//  4. Mesin tidak pernah menulis "tidak ada padanan" — kalau ragu ia diam,
//     dan barisnya tetap terlihat sebagai lubang.
//  5. Cakupan dilaporkan dalam nilai rupiah, bukan cuma cacah baris.
//
// Berjalan terhadap basis AHSP SUNGGUHAN dari seed-data/.
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

/**
 * Item RAB uji. Dua yang pertama punya padanan jelas di SE DJBK 47/2026; yang
 * ketiga sengaja pekerjaan yang TIDAK dianalisa AHSP (sewa rumah direksi) —
 * itulah baris yang harus tetap kosong, bukan diisi padanan asal-asalan.
 */
const ITEM: [kode: string, nama: string, unit: string, amount: bigint][] = [
  ["1", "Pekerjaan Galian Tanah Biasa", "m³", 300_000_000n],
  ["2", "Pekerjaan Pembesian dengan besi beton polos", "kg", 600_000_000n],
  ["3", "Sewa Rumah untuk Direksi Keet dan Gudang", "bln", 100_000_000n],
  // Satuannya sengaja m³ dan padanannya beranalisa "1 m3 Beton…": inilah baris
  // yang benar-benar bisa diturunkan jadi kebutuhan bahan setelah disetujui.
  ["4", "Pekerjaan Beton Mutu Rendah fc 10 Mpa", "m³", 800_000_000n],
];
const GRAND = ITEM.reduce((a, [, , , amt]) => a + amt, 0n);

let orgId: string;
let userId: string;
let lokasiA: string;
let lokasiB: string;
let pkgId: string;
let vendorId: string;

async function buatLokasi(nama: string, slug: string, packageId: string): Promise<string> {
  const loc = await db.location.create({
    data: {
      packageId,
      name: nama,
      slug,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      isActive: true,
      status: "berjalan",
    },
  });
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
  for (const [kode, nama2, unit, amount] of ITEM) {
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kategori.id,
        kind: "item",
        code: kode,
        name: nama2,
        unit,
        volume: "100",
        amount,
        lineageKey: `I#${kode}`,
        sortOrder: sort++,
      },
    });
  }
  return loc.id;
}

beforeAll(async () => {
  const ada = await db.ahspSource.findUnique({ where: { code: AHSP_SOURCE_CODE } });
  if (!ada) await imporAhspDariSeed(null);

  const org = await db.organization.create({
    data: { name: `Org P ${suffix}`, slug: `orgp-${suffix}` },
  });
  orgId = org.id;
  const user = await db.user.create({
    data: {
      orgId,
      username: `padanan-${suffix}`,
      fullName: "Penguji Padanan",
      passwordHash: "x",
      role: "super_admin",
    },
  });
  userId = user.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket P ${suffix}` } });
  pkgId = pkg.id;
  vendorId = (await db.vendor.create({ data: { orgId, name: `PT Uji P ${suffix}` } })).id;
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId,
      contractNumber: `KTR-P-${suffix}`,
      contractValue: GRAND,
      signedDate: d("2026-01-05"),
      durationDays: 90,
      startDate: d("2026-01-05"),
      endDate: d("2026-04-04"),
    },
  });

  lokasiA = await buatLokasi("Lokasi Padanan A", `padanan-a-${suffix}`, pkg.id);
  lokasiB = await buatLokasi("Lokasi Padanan B", `padanan-b-${suffix}`, pkg.id);
}, 300000);

afterAll(async () => {
  await db.ahspPadanan.deleteMany({
    where: { tanda: { in: ITEM.map(([, nama, unit]) => tandaItem(nama, unit)) } },
  });
  const lokasi = [lokasiA, lokasiB].filter(Boolean);
  await db.rabRevision.deleteMany({ where: { locationId: { in: lokasi } } });
  await db.location.deleteMany({ where: { id: { in: lokasi } } });
  await db.contract.deleteMany({ where: { packageId: pkgId } });
  await db.package.deleteMany({ where: { id: pkgId } });
  await db.vendor.deleteMany({ where: { id: vendorId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.$disconnect();
});

describe("pemetaan otomatis RAB → AHSP", () => {
  it("memetakan yang jelas, DIAM pada yang tidak ada analisanya", async () => {
    const h = await petakanLokasi(lokasiA, userId);
    expect(h.itemRab).toBe(ITEM.length);
    expect(h.tandaUnik).toBe(ITEM.length);
    expect(h.baru).toBeGreaterThan(0);
    // "Sewa Rumah untuk Direksi Keet" memang tidak dianalisa AHSP. Kalau angka
    // ini 0, artinya mesin memaksakan padanan pada baris yang tidak punya —
    // persis yang bikin tabel kebutuhan bahan tampak lengkap padahal karangan.
    expect(h.belumKetemu).toBeGreaterThan(0);
    expect(h.baru + h.belumKetemu).toBe(ITEM.length);

    const { baris } = await keadaanPadanan(lokasiA);
    const sewa = baris.find((b) => b.code === "3")!;
    expect(sewa.keadaan).toBe("belum");
    expect(sewa.ahsp).toBeNull();
  }, 120000);

  it("dijalankan lagi tidak menulis apa pun — idempoten", async () => {
    const h = await petakanLokasi(lokasiA, userId);
    expect(h.baru).toBe(0);
    // Yang belum ketemu TIDAK dihitung ulang sebagai lubang baru: lubangnya
    // sama, bukan bertambah setiap kali tombolnya ditekan.
    expect(h.sudahAda).toBeGreaterThan(0);
  }, 120000);

  it("cakupan dilaporkan dalam NILAI, bukan cuma cacah baris", async () => {
    const { cakupan } = await keadaanPadanan(lokasiA);
    expect(cakupan.item).toBe(ITEM.length);
    expect(cakupan.nilaiTotal).toBe(GRAND);
    // Baris yang belum terpetakan (sewa direksi, Rp100 jt) harus muncul di
    // nilaiBelum. "2 dari 3 baris" saja menyembunyikan seberapa besar lubangnya.
    expect(cakupan.nilaiTerpetakan + cakupan.nilaiBelum).toBe(GRAND);
    expect(cakupan.nilaiBelum).toBeGreaterThanOrEqual(100_000_000n);
  });
});

describe("koreksi manusia", () => {
  it("menang atas mesin dan tidak ditimpa pemetaan ulang", async () => {
    const [kode, nama, unit] = ITEM[0];
    const tanda = tandaItem(nama, unit);
    // Analisa yang sengaja BUKAN pilihan mesin — supaya kalau ia ditimpa,
    // ujinya memerah dan bukan kebetulan lolos.
    const lain = await db.ahspEntry.findFirstOrThrow({
      where: { uraian: { contains: "Pengecatan", mode: "insensitive" } },
      select: { id: true },
    });

    await koreksiPadanan({
      tanda,
      uraianContoh: nama,
      satuan: unit,
      entryId: lain.id,
      userId,
    });
    await petakanLokasi(lokasiA, userId);

    const { baris } = await keadaanPadanan(lokasiA);
    const galian = baris.find((b) => b.code === kode)!;
    expect(galian.keadaan).toBe("koreksi");
    expect(galian.ahsp?.id).toBe(lain.id);
  }, 120000);

  it("berlaku untuk lokasi LAIN yang uraiannya persis sama", async () => {
    // Inti dari kunci global: 83 lokasi KNMP memakai templat RAB yang sama.
    // Kalau koreksi berhenti di satu lokasi, orang harus mengulanginya 83 kali.
    const { baris } = await keadaanPadanan(lokasiB);
    const galian = baris.find((b) => b.code === ITEM[0][0])!;
    expect(galian.keadaan).toBe("koreksi");
  }, 120000);

  it('"tidak ada padanan" tercatat sebagai keputusan, bukan sebagai lubang', async () => {
    const [kode, nama, unit] = ITEM[2];
    const hasil = await koreksiPadanan({
      tanda: tandaItem(nama, unit),
      uraianContoh: nama,
      satuan: unit,
      entryId: null,
      userId,
    });
    // Dua lokasi memakai uraian ini — dilaporkan supaya jelas keputusannya
    // tidak berhenti di layar yang sedang dibuka.
    expect(hasil.lokasiKena).toBe(2);
    expect(hasil.barisKena).toBe(2);

    const { baris, cakupan } = await keadaanPadanan(lokasiA);
    const sewa = baris.find((b) => b.code === kode)!;
    expect(sewa.keadaan).toBe("tidak_ada");
    expect(cakupan.dinyatakanTidakAda).toBe(1);
    // Keputusan "memang tidak ada" mengeluarkannya dari daftar yang belum
    // diperiksa — tapi TIDAK dari nilai yang belum tertutup analisa: uangnya
    // tetap tidak punya rincian bahan/upah.
    expect(baris.filter((b) => b.keadaan === "belum")).toHaveLength(cakupan.belum);
    expect(cakupan.belum).toBe(baris.length - cakupan.terpetakan - 1);
    expect(cakupan.nilaiBelum).toBeGreaterThanOrEqual(100_000_000n);
  }, 120000);
});

describe("baris judul", () => {
  it("baris tanpa satuan, tanpa volume, bernilai nol TIDAK dipetakan", async () => {
    /*
     * RAB lapangan memuat baris seperti "Fasilitas Sarana Kesehatan, terdiri
     * atas :" — tersimpan sebagai daun karena begitulah berkas asalnya. Diukur
     * pada RAB Kedung Mutih: 37 dari 1.657 baris. Sebelum dijaga, baris itu
     * menang MEYAKINKAN 50% ke analisa bernama "Fasilitas" — pekerjaan yang
     * tidak ada, ikut menghitung cakupan.
     */
    const rev = await db.rabRevision.findFirstOrThrow({
      where: { locationId: lokasiB, status: "aktif" },
      select: { id: true, nodes: { where: { kind: "kategori" }, select: { id: true } } },
    });
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: rev.nodes[0].id,
        kind: "item",
        code: "9",
        name: "Fasilitas Sarana Kesehatan, terdiri atas :",
        unit: null,
        volume: null,
        amount: 0n,
        lineageKey: "I#9",
        sortOrder: 99,
      },
    });

    const { baris, cakupan } = await keadaanPadanan(lokasiB);
    expect(baris.some((b) => b.code === "9")).toBe(false);
    expect(cakupan.item).toBe(ITEM.length);
  }, 120000);
});

describe("persetujuan borongan → simulasi RAPL", () => {
  it("usulan mesin TIDAK dipakai simulasi sebelum ada yang menyetujui", async () => {
    /*
     * Batas terpenting seluruh jalur RAPL. Usulan mesin boleh salah — 3 dari 4
     * padanan otomatis di data nyata berstatus "beda tipis". Kalau usulan ikut
     * dihitung, angka kebutuhan bahan lahir dari tebakan yang belum dilihat
     * siapa pun, dan tabelnya tetap terlihat rapi.
     */
    const menunggu = await tandaMenunggu(lokasiB);
    expect(menunggu.length).toBeGreaterThan(0);

    const sebelum = await simulasiRapl(lokasiB);
    // Baris beton (kode 4) SUDAH punya padanan otomatis beranalisa lengkap dan
    // satuannya sepadan — satu-satunya alasan ia tidak menghasilkan kebutuhan
    // adalah karena belum ada yang menyetujuinya. Menguji lewat "ada baris
    // ber-alasan belum_disetujui" saja TIDAK cukup: baris "Sewa Rumah" yang
    // memang tak berpadanan juga ber-alasan sama, sehingga ujinya lolos walau
    // pagarnya dicabut. Karena itu yang dikunci di sini keluarannya: sebelum
    // disetujui, tidak boleh ada SATU pun angka kebutuhan.
    expect(sebelum.kebutuhan).toEqual([]);
    expect(sebelum.dipakai.baris).toBe(0);
    expect(sebelum.dilewat.some((d) => d.code === "4" && d.alasan === "belum_disetujui")).toBe(
      true,
    );
  }, 120000);

  it("menyetujui borongan membuat kebutuhan bahan muncul", async () => {
    const menunggu = await tandaMenunggu(lokasiB);
    const h = await setujuiPadanan({ tanda: menunggu, userId });
    expect(h.disetujui).toBe(menunggu.length);

    const { cakupan } = await keadaanPadanan(lokasiB);
    expect(cakupan.menunggu).toBe(0);
    expect(cakupan.disetujui).toBeGreaterThan(0);
    expect(cakupan.nilaiDisetujui).toBeGreaterThan(0n);

    const sesudah = await simulasiRapl(lokasiB);
    expect(sesudah.kebutuhan.length).toBeGreaterThan(0);
    expect(sesudah.dipakai.baris).toBeGreaterThan(0);
    // Kebutuhan yang muncul harus punya satuan dan jumlah, bukan baris kosong.
    for (const k of sesudah.kebutuhan) {
      expect(k.jumlah).toBeGreaterThan(0);
      expect(["upah", "bahan", "alat"]).toContain(k.kategori);
    }
    // Tidak ada nilai yang menguap.
    const totalLewat = Object.values(sesudah.nilaiDilewat).reduce((a, b) => a + b, 0n);
    expect(sesudah.dipakai.nilai + totalLewat).toBe(sesudah.nilaiRab);
  }, 120000);

  it("persetujuan TIDAK menimpa koreksi manusia", async () => {
    // lokasiA sudah punya koreksi pada ITEM[0] (dipasang uji sebelumnya).
    const sebelum = await keadaanPadanan(lokasiA);
    const galianSebelum = sebelum.baris.find((b) => b.code === ITEM[0][0])!;
    expect(galianSebelum.keadaan).toBe("koreksi");

    await setujuiPadanan({ tanda: [galianSebelum.tanda], userId });

    const sesudah = await keadaanPadanan(lokasiA);
    const galian = sesudah.baris.find((b) => b.code === ITEM[0][0])!;
    expect(galian.keadaan).toBe("koreksi");
    expect(galian.ahsp?.id).toBe(galianSebelum.ahsp?.id);
  }, 120000);

  it("menyetujui ulang tidak menambah apa-apa — idempoten", async () => {
    const h = await setujuiPadanan({ tanda: await tandaMenunggu(lokasiB), userId });
    expect(h.disetujui).toBe(0);
  }, 120000);
});
