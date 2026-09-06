// KATALOG LOKASI: IMPOR KNMP + SUNTING DI TEMPAT.
//
// Permintaan user 2026-09-06: *"lengkapi data lokasi sekalian… ambil hanya yang
// aktif saja. tidak perlu ambil data perusahaan. di super admin halaman katalog
// lokasi, bisa edit langsung untuk koordinat, nama, dsb. kalau sudah dipakai
// kasih warning saja."*
//
// Uji unit sudah mengunci PARSER-nya. Yang dikunci di sini adalah akibatnya di
// database, karena di situlah kerugiannya nyata:
//
//   1. impor tidak membuat Vendor apa pun — "tidak perlu data perusahaan" itu
//      soal apa yang MASUK, bukan soal apa yang tampil;
//   2. impor ulang berkas yang koordinatnya kosong tidak MENGHAPUS koordinat
//      yang sudah susah payah dilengkapi orang di layar;
//   3. lokasi yang sudah dipakai proyek tetap boleh disunting — yang muncul
//      peringatan, bukan gembok — dan lokasi proyeknya TIDAK ikut berubah;
//   4. mengubah kunci alami ke baris yang sudah ada ditolak dengan kalimat yang
//      bisa dibaca orang, bukan galat unique constraint mentah;
//   5. tanpa izin `package.bypass`, tidak ada yang tersunting.
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tidak punya izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
    accessibleLocationIds: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
  };
});

const { db } = await import("@/lib/db");
const { commitMasterImportAction, ubahLokasiMasterAction } = await import(
  "@/lib/master-location/actions"
);

const suffix = `mk${Date.now().toString(36)}`;
let orgId = "";

const KOLOM = [
  "ID Lokasi",
  "Provinsi",
  "Kabupaten/Kota",
  "Kecamatan",
  "Desa/Kelurahan",
  "Kampung Nelayan",
  "Wilayah",
  "Klaster",
  "Hasil Pleno",
  "Latitude",
  "Longitude",
  "Status Koordinat",
  "Nama Perusahaan",
  "Nomor Kontak",
  "Kode Status Lokasi",
  "Status Lokasi",
  "Tahap",
  "Luas Lahan (Ha)",
  "Jumlah Nelayan",
  "Kapal Tanpa Mesin",
  "Kapal Dengan Mesin",
  "Total Kapal",
  "Nilai EE",
];

/** Berkas MASTER DATA tiruan → FormData berisi File, seperti unggahan layar. */
async function berkasImpor(rows: (string | number | null)[][]): Promise<FormData> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("MASTER DATA");
  ws.addRow(KOLOM);
  for (const r of rows) ws.addRow(r);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(buf)], "master.xlsx"), "master.xlsx");
  return fd;
}

function baris(o: {
  desa: string;
  kode?: string;
  lat?: number | null;
  lng?: number | null;
  status?: string;
  label?: string;
}): (string | number | null)[] {
  return [
    o.kode ?? "KNMP-730",
    "Jawa Tengah",
    "Rembang",
    "Rembang",
    o.desa,
    o.desa,
    "Jawa",
    "Klaster A",
    "Hub",
    o.lat ?? null,
    o.lng ?? null,
    o.lat == null ? "" : "VALID",
    "CV. Kalembo Ade Nautama",
    "085126880019",
    o.status ?? "SL-AKT",
    o.label ?? "Aktif",
    "Tahap II 146",
    0.6,
    484,
    44,
    140,
    184,
    2838404000,
  ];
}

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const cariKatalog = (village: string) =>
  db.masterLocation.findFirst({ where: { orgId, village } });

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  sessionOrgId = orgId;
  const u = await db.user.create({
    data: {
      orgId,
      username: `su-${suffix}`,
      fullName: "Super",
      role: "super_admin" as never,
      passwordHash: "x",
    },
  });
  sessionUserId = u.id;
});

afterAll(async () => {
  // audit_logs append-only (trigger DB): barisnya tidak bisa dihapus, jadi user
  // + organisasi uji ini SENGAJA ditinggal — menghapusnya akan memutus jejak
  // audit yang justru sedang kita uji keberadaannya.
  await db.masterLocation.deleteMany({ where: { orgId } });
  await db.location.deleteMany({ where: { package: { orgId } } });
  await db.package.deleteMany({ where: { orgId } });
  await db.vendor.deleteMany({ where: { orgId } });
  await db.$disconnect();
});

beforeEach(async () => {
  role = "super_admin";
  await db.masterLocation.updateMany({ where: { orgId }, data: { assignedLocationId: null } });
  await db.location.deleteMany({ where: { package: { orgId } } });
  await db.package.deleteMany({ where: { orgId } });
  await db.masterLocation.deleteMany({ where: { orgId } });
  await db.vendor.deleteMany({ where: { orgId } });
});

describe("impor katalog dari MASTER DATA", () => {
  it("menyimpan lokasi aktif dengan bidang KNMP-nya, melewati yang batal", async () => {
    const hasil = await commitMasterImportAction(
      undefined,
      await berkasImpor([
        baris({ desa: `Pasar Banggi ${suffix}`, lat: -6.6893, lng: 111.4123 }),
        baris({
          desa: `Desa Batal ${suffix}`,
          kode: "KNMP-999",
          status: "SL-BTL",
          label: "Lokasi Batal",
        }),
      ]),
    );

    expect(hasil?.error).toBeUndefined();
    expect(hasil?.success).toContain("1 lokasi baru");
    expect(hasil?.success).toContain("1 lokasi tidak aktif");

    expect(await cariKatalog(`Desa Batal ${suffix}`)).toBeNull();
    const row = await cariKatalog(`Pasar Banggi ${suffix}`);
    expect(row).toMatchObject({
      province: "Jawa Tengah",
      regency: "Rembang",
      district: "Rembang",
      name: `Pasar Banggi ${suffix}`,
    });
    expect(Number(row!.latitude)).toBeCloseTo(-6.6893, 4);
    expect(Number(row!.longitude)).toBeCloseTo(111.4123, 4);
    // Kolom KNMP lain di berkas (klaster, hasil pleno, tahap, luas lahan,
    // nelayan, kapal, nilai EE, ID lokasi) TIDAK disimpan – MARLIN tidak
    // memakainya (ketetapan user 2026-09-06). Katalog yang menyimpan data tak
    // terpakai hanya jadi salinan kedua yang segera basi.
    const kolom = Object.keys(row!);
    for (const k of [
      "sourceCode",
      "cluster",
      "plenoResult",
      "sourceBatch",
      "landAreaHa",
      "fishermenCount",
      "boatsTotal",
      "eeValue",
      "statusLabel",
      "coordinateStatus",
    ])
      expect(kolom).not.toContain(k);
  });

  it("tidak membuat satu pun Vendor – katalog ini data lokasi, bukan data perusahaan", async () => {
    await commitMasterImportAction(
      undefined,
      await berkasImpor([baris({ desa: `Tanpa Vendor ${suffix}`, lat: -6.7, lng: 111.4 })]),
    );
    expect(await db.vendor.count({ where: { orgId } })).toBe(0);
    const row = await cariKatalog(`Tanpa Vendor ${suffix}`);
    expect(row!.candidateVendor).toBeNull();
  });

  it("impor ulang berkas tanpa koordinat tidak menghapus koordinat yang sudah ada", async () => {
    const desa = `Ulang ${suffix}`;
    await commitMasterImportAction(
      undefined,
      await berkasImpor([baris({ desa, lat: -6.6893, lng: 111.4123 })]),
    );
    const hasil = await commitMasterImportAction(
      undefined,
      await berkasImpor([baris({ desa, lat: null, lng: null })]),
    );

    expect(hasil?.success).toContain("1 diperbarui");
    const row = await cariKatalog(desa);
    expect(Number(row!.latitude)).toBeCloseTo(-6.6893, 4);
    expect(Number(row!.longitude)).toBeCloseTo(111.4123, 4);
  });
});

describe("sunting katalog di tempat", () => {
  /** Katalog + (opsional) lokasi proyek yang memakainya. */
  async function siapkan(desa: string, dipakai: boolean) {
    const master = await db.masterLocation.create({
      data: {
        orgId,
        province: "Jawa Tengah",
        regency: "Rembang",
        district: "Rembang",
        village: desa,
        latitude: "-6.6893000",
        longitude: "111.4123000",
        name: desa,
      },
    });
    if (!dipakai) return { master, lokasi: null };

    const pkg = await db.package.create({
      data: { orgId, name: `Paket ${desa}`, stage: "pelaksanaan" as never },
    });
    const lokasi = await db.location.create({
      data: {
        packageId: pkg.id,
        name: desa,
        slug: desa.toLowerCase().replace(/\s+/g, "-"),
        province: "Jawa Tengah",
        regency: "Rembang",
        district: "Rembang",
        village: desa,
        gpsLat: "-6.6893000",
        gpsLng: "111.4123000",
      },
    });
    await db.masterLocation.update({
      where: { id: master.id },
      data: { assignedLocationId: lokasi.id },
    });
    return { master, lokasi };
  }

  it("lokasi yang SUDAH dipakai tetap bisa disunting – peringatan, bukan gembok", async () => {
    const desa = `Dipakai ${suffix}`;
    const { master, lokasi } = await siapkan(desa, true);

    const hasil = await ubahLokasiMasterAction(
      undefined,
      fd({
        id: master.id,
        province: "Jawa Tengah",
        regency: "Rembang",
        district: "Rembang",
        village: desa,
        name: "Kampung Nelayan Baru",
        latitude: "-6.7000000",
        longitude: "111.5000000",
      }),
    );

    expect(hasil?.error).toBeUndefined();
    // Peringatannya wajib menyebut apa yang TIDAK ikut berubah.
    expect(hasil?.success).toContain("TIDAK ikut berubah");

    const sesudah = await db.masterLocation.findUnique({ where: { id: master.id } });
    expect(sesudah!.name).toBe("Kampung Nelayan Baru");
    expect(Number(sesudah!.latitude)).toBeCloseTo(-6.7, 4);

    // Lokasi proyeknya sendiri tidak tersentuh — itu punya layar & wewenangnya sendiri.
    const lokasiSesudah = await db.location.findUnique({ where: { id: lokasi!.id } });
    expect(lokasiSesudah!.name).toBe(desa);
    expect(Number(lokasiSesudah!.gpsLat)).toBeCloseTo(-6.6893, 4);

    const jejak = await db.auditLog.findFirst({
      where: { action: "master_location.update", resourceId: master.id },
      orderBy: { createdAt: "desc" },
    });
    expect(jejak).not.toBeNull();
    // Jejaknya menyebut keadaan SEBELUM dan SESUDAH — audit yang cuma bilang
    // "diubah" tidak menolong siapa pun saat koordinat dipertanyakan.
    const isi = JSON.stringify(jejak!.payload);
    expect(isi).toContain("sudahDipakai");
    expect(isi).toContain("-6.6893");
    expect(isi).toContain("Kampung Nelayan Baru");
  });

  it("kunci alami yang menabrak baris lain ditolak dengan kalimat yang bisa dibaca", async () => {
    const a = await siapkan(`Bentrok A ${suffix}`, false);
    const b = await siapkan(`Bentrok B ${suffix}`, false);

    const hasil = await ubahLokasiMasterAction(
      undefined,
      fd({
        id: b.master.id,
        province: "Jawa Tengah",
        regency: "Rembang",
        district: "Rembang",
        village: a.master.village, // menabrak baris A
        latitude: "",
        longitude: "",
      }),
    );

    expect(hasil?.error).toContain("Sudah ada baris katalog");
    expect(hasil?.error).not.toMatch(/unique|constraint|P2002/i);
    // Tidak ada yang berubah, dan tidak ada baris kembar yang terlanjur dibuat.
    const sesudah = await db.masterLocation.findUnique({ where: { id: b.master.id } });
    expect(sesudah!.village).toBe(b.master.village);
    expect(await db.masterLocation.count({ where: { orgId, village: a.master.village } })).toBe(1);
  });

  it("koordinat setengah (lintang tanpa bujur) ditolak – titik separuh bukan titik", async () => {
    const { master } = await siapkan(`Separuh ${suffix}`, false);
    const hasil = await ubahLokasiMasterAction(
      undefined,
      fd({
        id: master.id,
        province: "Jawa Tengah",
        regency: "Rembang",
        district: "Rembang",
        village: master.village,
        latitude: "-6.7",
        longitude: "",
      }),
    );
    expect(hasil?.error).toBeTruthy();
    const sesudah = await db.masterLocation.findUnique({ where: { id: master.id } });
    expect(Number(sesudah!.latitude)).toBeCloseTo(-6.6893, 4);
  });

  it("tanpa izin katalog, tidak ada yang tersunting", async () => {
    const { master } = await siapkan(`Tanpa Izin ${suffix}`, false);
    role = "site_manager";

    const hasil = await ubahLokasiMasterAction(
      undefined,
      fd({
        id: master.id,
        province: "Jawa Tengah",
        regency: "Rembang",
        district: "Rembang",
        village: master.village,
        name: "Diubah diam-diam",
      }),
    );

    expect(hasil?.error).toContain("izin");
    const sesudah = await db.masterLocation.findUnique({ where: { id: master.id } });
    expect(sesudah!.name).toBe(master.village);
  });
});
