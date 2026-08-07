// MEMAKAI FOTO KANTONG — jalur server di balik dua layar sekaligus.
//
// Keluhan user 2026-08-06: *"di sisi inputan laporan harian maupun kegiatan
// lapangan pun, perlu untuk bisa mengambil dari hasil foto cepat ini, kalau
// tidak, akan percuma fitur ini."* Jalur baliknya kini dipasang di editor
// laporan harian dan di panel foto kegiatan lapangan, tapi keduanya memakai
// `pakaiFotoAction` yang SAMA — bukan penautan kedua.
//
// Justru karena satu action dipakai tiga layar, pagarnya harus dikunci di sini:
// begitu ada yang longgar, ia longgar di semua tempat sekaligus, dan yang
// bocor adalah lokasi bukti lapangan. Yang paling penting: foto yang lokasinya
// BELUM ketahuan tidak boleh ikut tertaut, karena menautkannya ke laporan
// lokasi X sama saja MENETAPKAN lokasinya ke X secara diam-diam — padahal
// deteksi geotag tadi justru menolak menebak (DECISIONS 254).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// R2 "terkonfigurasi" supaya action tidak berhenti di gerbang penyimpanan;
// tidak ada berkas yang benar-benar disentuh di uji ini.
vi.mock("@/lib/r2", () => ({ isR2Configured: () => true, r2Delete: async () => {} }));

vi.mock("@/lib/photos", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/photos")>();
  return {
    ...asli,
    // Presign R2 tidak tersedia di lingkungan uji; yang diuji di sini adalah
    // foto MANA yang dikembalikan, bukan URL-nya.
    buildPhotoViews: async (rows: { id: string }[]) => rows.map((r) => ({ id: r.id })),
  };
});

// `konteksFoto` mengembalikan null → pelengkapan cap dilewati. Cap sudah punya
// ujinya sendiri (perbaikan-cap); di sini yang diuji penautannya.
vi.mock("@/lib/photo-restamp/service", () => ({ konteksFoto: async () => null }));

let sesi = "";

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => pengguna(sesi),
    requireCapability: async () => pengguna(sesi),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { muatKantongLokasiAction, pakaiFotoAction, tetapkanLokasiAction } = await import(
  "@/lib/foto-cepat/actions"
);
const { saveItemAction } = await import("@/lib/daily-report/actions");

const suffix = `fcp${Date.now().toString(36)}`;
let orgId: string;
let locA: string;
let locB: string;
let mandorId: string;
let reportItemId: string;
let nodeId: string;
let kegiatanId: string;

async function pengguna(id: string) {
  return db.user.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      orgId: true,
      username: true,
      email: true,
      fullName: true,
      role: true,
      mustChangePassword: true,
    },
  });
}

/** Semua foto uji ini berbagi awalan kunci R2 — dipakai untuk membersihkan. */
const PREFIX = `k/${suffix}/`;

/** Foto kantong: tanpa induk (reportId & activityId null). */
async function buatFoto(locationId: string | null, tandaUnik: string) {
  const f = await db.photo.create({
    data: {
      locationId,
      uploadedById: mandorId,
      r2Key: `${PREFIX}${tandaUnik}.jpg`,
      thumbnailKey: `${PREFIX}${tandaUnik}-t.jpg`,
      sha256: `${suffix}${tandaUnik}`.padEnd(64, "0").slice(0, 64),
      bytes: 1024,
      gpsSource: locationId ? "device" : "none",
    },
    select: { id: true },
  });
  return f.id;
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org FCP ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket FCP ${suffix}` } });

  const a = await db.location.create({
    data: { packageId: pkg.id, name: `Lokasi A ${suffix}`, slug: `lok-a-${suffix}`, village: "Desa A", regency: "Kab. Uji", province: "Jawa Timur", isActive: true },
  });
  const b = await db.location.create({
    data: { packageId: pkg.id, name: `Lokasi B ${suffix}`, slug: `lok-b-${suffix}`, village: "Desa B", regency: "Kab. Uji", province: "Jawa Timur", isActive: true },
  });
  locA = a.id;
  locB = b.id;

  const mandor = await db.user.create({
    data: {
      orgId,
      username: `mandor-${suffix}`,
      email: `mandor-${suffix}@contoh.id`,
      fullName: "Mandor Uji",
      role: "field_supervisor",
      passwordHash: "x",
    },
    select: { id: true },
  });
  mandorId = mandor.id;
  sesi = mandorId;

  // Pelaksana adalah peran TERIKAT LOKASI: tanpa penugasan, scope-nya kosong
  // dan kantong akan selalu terlihat kosong — bukan karena aturannya, melainkan
  // karena datanya tak pernah terjangkau. Penugasannya nyata, bukan di-mock.
  await db.locationAssignment.createMany({
    data: [
      { userId: mandorId, locationId: locA },
      { userId: mandorId, locationId: locB },
    ],
  });

  // Satu item laporan harian yang masih draft → sah menerima foto.
  const rab = await db.rabRevision.create({
    data: { locationId: locA, revisionNo: 1, status: "aktif", source: "hps_awal", totalValue: 0n },
    select: { id: true },
  });
  const node = await db.rabNode.create({
    data: {
      revisionId: rab.id,
      kind: "item",
      lineageKey: `ln-${suffix}`,
      code: "1.1",
      name: "Pekerjaan Uji",
      sortOrder: 1,
      unit: "m3",
    },
    select: { id: true },
  });
  nodeId = node.id;
  const report = await db.dailyReport.create({
    data: { locationId: locA, reportDate: new Date("2026-08-06"), status: "draft", createdById: mandorId },
    select: { id: true },
  });
  const item = await db.dailyReportItem.create({
    data: {
      reportId: report.id,
      rabNodeId: node.id,
      lineageKey: `ln-${suffix}`,
      volumeDone: 1,
      valueDone: 0n,
    },
    select: { id: true },
  });
  reportItemId = item.id;

  const keg = await db.fieldActivity.create({
    data: {
      locationId: locA,
      title: `Kegiatan ${suffix}`,
      activityDate: new Date("2026-08-06"),
      status: "draft",
      type: "lainnya",
      createdById: mandorId,
    },
    select: { id: true },
  });
  kegiatanId = keg.id;
});

beforeEach(async () => {
  await db.photo.deleteMany({ where: { r2Key: { startsWith: PREFIX } } });
});

afterAll(async () => {
  // TRUNCATE global — konvensi berkas integrasi di repo ini (vitest.config.ts
  // menjalankan file secara serial justru supaya ini aman). Hapus baris demi
  // baris tidak bisa: `audit_logs` append-only dan menolak DELETE.
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

const fd = (isi: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) {
    for (const satu of Array.isArray(v) ? v : [v]) f.append(k, satu);
  }
  return f;
};

describe("muatKantongLokasiAction — pemuat kantong dari layar laporan/kegiatan", () => {
  it("hanya mengembalikan foto lokasi yang diminta", async () => {
    const diA = await buatFoto(locA, "a1");
    await buatFoto(locB, "b1");
    const hasil = await muatKantongLokasiAction(locA);
    expect("error" in hasil).toBe(false);
    if ("error" in hasil) return;
    expect(hasil.fotos.map((f) => f.id)).toEqual([diA]);
  });

  it("TIDAK menawarkan foto yang lokasinya belum ketahuan", async () => {
    // Kalau ditawarkan di layar laporan lokasi A, memakainya sama saja
    // menetapkan lokasinya ke A tanpa ada yang memutuskan itu. Penetapan lokasi
    // tetap kerja sadar di menu Foto Cepat.
    await buatFoto(null, "n1");
    const hasil = await muatKantongLokasiAction(locA);
    expect("error" in hasil).toBe(false);
    if ("error" in hasil) return;
    expect(hasil.fotos).toHaveLength(0);
  });

  it("foto yang sudah dipakai tidak muncul lagi di kantong", async () => {
    const id = await buatFoto(locA, "a2");
    await pakaiFotoAction({}, fd({ photoIds: id, tujuan: "kegiatan", kegiatanId }));
    const hasil = await muatKantongLokasiAction(locA);
    expect("error" in hasil).toBe(false);
    if ("error" in hasil) return;
    expect(hasil.fotos).toHaveLength(0);
  });

  it("id lokasi ngawur ditolak, bukan mengembalikan daftar kosong yang menyesatkan", async () => {
    expect(await muatKantongLokasiAction("bukan-uuid")).toEqual({ error: "Lokasi tidak dikenali." });
  });
});

describe("pakaiFotoAction — dari layar laporan harian & kegiatan lapangan", () => {
  it("menautkan foto terpilih ke item laporan harian", async () => {
    const satu = await buatFoto(locA, "a3");
    const dua = await buatFoto(locA, "a4");
    const hasil = await pakaiFotoAction(
      {},
      fd({ photoIds: [satu, dua], tujuan: "laporan", reportItemId }),
    );
    expect(hasil.error).toBeUndefined();
    const tertaut = await db.photo.findMany({
      where: { id: { in: [satu, dua] } },
      select: { reportItemId: true, activityId: true },
    });
    expect(tertaut.every((p) => p.reportItemId === reportItemId)).toBe(true);
    expect(tertaut.every((p) => p.activityId === null)).toBe(true);
  });

  it("menautkan foto terpilih ke kegiatan lapangan draft", async () => {
    const id = await buatFoto(locA, "a5");
    const hasil = await pakaiFotoAction({}, fd({ photoIds: id, tujuan: "kegiatan", kegiatanId }));
    expect(hasil.error).toBeUndefined();
    const p = await db.photo.findUniqueOrThrow({
      where: { id },
      select: { activityId: true, reportId: true },
    });
    expect(p.activityId).toBe(kegiatanId);
    expect(p.reportId).toBeNull();
  });

  it("MENOLAK foto dari lokasi lain — dan menyebut sebabnya", async () => {
    const asing = await buatFoto(locB, "b2");
    const hasil = await pakaiFotoAction(
      {},
      fd({ photoIds: asing, tujuan: "laporan", reportItemId }),
    );
    expect(hasil.error).toMatch(/lokasi lain/i);
    const p = await db.photo.findUniqueOrThrow({
      where: { id: asing },
      select: { reportItemId: true },
    });
    expect(p.reportItemId).toBeNull();
  });

  it("MENOLAK foto yang lokasinya belum ketahuan (DECISIONS 254)", async () => {
    // Pagar terpenting: tanpa ini, penautan menjadi mesin penetapan lokasi
    // diam-diam — persis yang dihindari saat deteksi geotag memilih tidak
    // menebak.
    const buta = await buatFoto(null, "n2");
    const hasil = await pakaiFotoAction({}, fd({ photoIds: buta, tujuan: "laporan", reportItemId }));
    expect(hasil.error).toMatch(/belum ketahuan lokasinya/i);
    const p = await db.photo.findUniqueOrThrow({
      where: { id: buta },
      select: { locationId: true, reportItemId: true },
    });
    expect(p.locationId).toBeNull();
    expect(p.reportItemId).toBeNull();
  });

  it("tujuan tanpa item pekerjaan ditolak", async () => {
    const id = await buatFoto(locA, "a6");
    const hasil = await pakaiFotoAction({}, fd({ photoIds: id, tujuan: "laporan" }));
    expect(hasil.error).toBeTruthy();
  });
});

describe("tetapkanLokasiAction — hanya menyentuh foto yang dipilih", () => {
  it("foto lain yang sama-sama belum berlokasi TIDAK ikut terbawa", async () => {
    // Keluhan user 2026-08-06: *"terlalu memaksakan untuk beberapa foto yang
    // diambil diberi tag lokasi yang sama."* Satu perjalanan lapangan lazim
    // melewati beberapa desa; kalau satu jawaban memborong semuanya, penetapan
    // yang benar mustahil.
    const dipilih = await buatFoto(null, "n3");
    const lain = await buatFoto(null, "n4");

    const hasil = await tetapkanLokasiAction({}, fd({ photoIds: dipilih, locationId: locA }));
    expect(hasil.error).toBeUndefined();

    const a = await db.photo.findUniqueOrThrow({
      where: { id: dipilih },
      select: { locationId: true },
    });
    const b = await db.photo.findUniqueOrThrow({
      where: { id: lain },
      select: { locationId: true },
    });
    expect(a.locationId).toBe(locA);
    expect(b.locationId).toBeNull();
  });

  it("dua kelompok bisa diberi lokasi BERBEDA", async () => {
    const keA = await buatFoto(null, "n5");
    const keB = await buatFoto(null, "n6");
    await tetapkanLokasiAction({}, fd({ photoIds: keA, locationId: locA }));
    await tetapkanLokasiAction({}, fd({ photoIds: keB, locationId: locB }));
    expect(
      (await db.photo.findUniqueOrThrow({ where: { id: keA }, select: { locationId: true } }))
        .locationId,
    ).toBe(locA);
    expect(
      (await db.photo.findUniqueOrThrow({ where: { id: keB }, select: { locationId: true } }))
        .locationId,
    ).toBe(locB);
  });
});

describe("saveItemAction — foto kantong dipilih SEBELUM itemnya ada", () => {
  // Permintaan user 2026-08-07: *"seharusnya di tampilan utama pilih pekerjaan,
  // selain kamera, galeri, kantong harusnya langsung bisa dipilih sebelum
  // simpan item. atau ini tidak memungkinkan karena item belum tersimpan?"*
  //
  // Menautkan lebih dulu memang mustahil — penautan butuh id item. Yang
  // dilakukan: memilih dulu, menautkan tepat sesudah itemnya tersimpan. Karena
  // penautannya terjadi DI DALAM aksi simpan, pagar lokasinya tidak lagi
  // terlihat oleh pemakai — jadi harus dikunci di sini.

  it("foto kantong ikut tertaut ke item yang baru tersimpan", async () => {
    const id = await buatFoto(locA, "s1");
    const hasil = await saveItemAction(
      undefined,
      fd({
        locationId: locA,
        dateKey: "2026-08-03",
        rabNodeId: nodeId,
        volumeDone: "2",
        kantongPhotoIds: id,
      }),
    );
    expect(hasil?.error).toBeUndefined();
    expect(hasil?.success).toBeTruthy();

    const foto = await db.photo.findUniqueOrThrow({
      where: { id },
      select: { reportItemId: true, reportId: true },
    });
    expect(foto.reportItemId).not.toBeNull();
    expect(foto.reportId).not.toBeNull();
  });

  it("foto dari lokasi LAIN ditolak — tapi progresnya tetap tersimpan, dan penolakannya DISEBUT", async () => {
    // Dua hal yang sama pentingnya. Membatalkan simpan karena satu lampiran
    // bermasalah akan menghapus volume yang sudah benar — angka yang masuk ke
    // kurva-S — demi foto yang statusnya opsional. Sebaliknya, menelan
    // kegagalannya diam-diam membuat pelapor mengira fotonya sudah terlampir.
    const asing = await buatFoto(locB, "s2");
    const hasil = await saveItemAction(
      undefined,
      fd({
        locationId: locA,
        dateKey: "2026-08-04",
        rabNodeId: nodeId,
        volumeDone: "3",
        kantongPhotoIds: asing,
      }),
    );
    expect(hasil?.success).toBeTruthy();
    expect(hasil?.warning).toContain("lokasi lain");

    const foto = await db.photo.findUniqueOrThrow({
      where: { id: asing },
      select: { reportItemId: true },
    });
    expect(foto.reportItemId).toBeNull();

    // Progresnya benar-benar ada, bukan sekadar pesan sukses.
    const item = await db.dailyReportItem.findFirst({
      where: { report: { locationId: locA, reportDate: new Date("2026-08-04") } },
      select: { volumeDone: true },
    });
    expect(Number(item?.volumeDone)).toBe(3);
  });

  it("foto TANPA lokasi tidak bisa diselundupkan lewat jalur simpan item", async () => {
    // Pagar DECISIONS 254 harus berlaku sama di jalur baru ini: menautkannya
    // ke laporan lokasi A sama saja menetapkan lokasinya ke A diam-diam.
    const buta = await buatFoto(null, "s3");
    const hasil = await saveItemAction(
      undefined,
      fd({
        locationId: locA,
        dateKey: "2026-08-05",
        rabNodeId: nodeId,
        volumeDone: "1",
        kantongPhotoIds: buta,
      }),
    );
    expect(hasil?.success).toBeTruthy();
    expect(hasil?.warning).toContain("belum ketahuan lokasinya");
    const foto = await db.photo.findUniqueOrThrow({
      where: { id: buta },
      select: { reportItemId: true, locationId: true },
    });
    expect(foto.reportItemId).toBeNull();
    expect(foto.locationId).toBeNull();
  });
});
