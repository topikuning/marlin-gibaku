// FOTO MENYUSUL untuk item laporan harian yang sudah tersimpan (DECISIONS 226).
//
// Permintaan user 2026-08-02: "jika pekerjaan berhasil disimpan, tapi foto belum
// ada, saat ini belum ada kejelasan bagaimana edit/menambahkan foto yang
// ketinggalan". Foto memang OPSIONAL saat menyimpan, jadi ketinggalan foto itu
// keadaan wajar — bukan kasus tepi.
//
// Yang dijaga uji ini: menambah foto TIDAK boleh menyentuh volume/catatan (jalan
// memutar sebelumnya memaksa mengetik ulang volume yang sudah benar — satu salah
// ketik di situ mengubah angka progres), dan capnya harus sama persis dengan cap
// foto yang menyertai itemnya.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/r2", () => ({ isR2Configured: () => false, r2Delete: async () => {} }));

/** Panggilan `savePhotoForItem` yang tercatat — R2 tidak ada di lingkungan uji. */
type PanggilanFoto = Parameters<typeof import("@/lib/photos").savePhotoForItem>[0];
const panggilan: PanggilanFoto[] = [];
let gagalkanFoto: string | null = null;

vi.mock("@/lib/photos", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/photos")>();
  return {
    ...asli,
    savePhotoForItem: async (input: PanggilanFoto) => {
      panggilan.push(input);
      if (gagalkanFoto) throw new asli.PhotoError(gagalkanFoto);
      return { id: `foto-${panggilan.length}` };
    },
  };
});

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
const { addItemPhotosAction } = await import("@/lib/daily-report/actions");

const suffix = `fm${Date.now().toString(36)}`;
let locationId: string;
let reportId: string;
let itemId: string;
let nodeId: string;
let mandorId: string;

async function pengguna(id: string) {
  return db.user.findUniqueOrThrow({
    where: { id },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

const VOLUME_AWAL = "7.5";
const CATATAN_AWAL = "cor kolom L2 utara";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org FM ${suffix}`, slug: `org-${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket FM ${suffix}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi FM",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  locationId = loc.id;

  mandorId = (
    await db.user.create({
      data: { orgId: org.id, username: `mandor-${suffix}`, fullName: "Mandor FM", passwordHash: "x", role: "field_supervisor" },
    })
  ).id;
  sesi = mandorId;

  // RAB minimal: satu kategori (bangunan) + satu item di bawahnya, supaya cap
  // foto bisa menyebut bangunan DAN nama pekerjaannya.
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, status: "aktif", source: "hps_awal", totalValue: 1500000n, createdById: mandorId },
  });
  const kategori = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "kategori",
      code: "V",
      name: "PEKERJAAN SHELTER",
      lineageKey: "V",
      sortOrder: 1,
    },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      parentId: kategori.id,
      kind: "item",
      code: "V.1",
      name: "Pembesian Besi Beton D13",
      unit: "kg",
      volume: "100",
      unitPrice: "15000",
      amount: 1500000n,
      lineageKey: "V#1",
      sortOrder: 2,
    },
  });
  nodeId = item.id;

  const report = await db.dailyReport.create({
    data: { locationId, reportDate: new Date("2026-07-01T00:00:00Z"), status: "draft", createdById: mandorId },
  });
  reportId = report.id;

  itemId = (
    await db.dailyReportItem.create({
      data: {
        reportId,
        rabNodeId: nodeId,
        lineageKey: item.lineageKey,
        volumeDone: VOLUME_AWAL,
        valueDone: 112500n,
        notes: CATATAN_AWAL,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(async () => {
  panggilan.length = 0;
  gagalkanFoto = null;
  await db.dailyReport.update({ where: { id: reportId }, data: { status: "draft" } });
});

function berkas(nama = "a.jpg", isi = "xx") {
  return new File([isi], nama, { type: "image/jpeg" });
}

async function tambah(files: File[], extra: Record<string, string> = {}, id = itemId) {
  const fd = new FormData();
  fd.set("reportId", reportId);
  fd.set("itemId", id);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  for (const f of files) fd.append("photos", f);
  return addItemPhotosAction(undefined, fd);
}

/** Volume + catatan item, apa adanya dari DB. */
async function isiItem() {
  const it = await db.dailyReportItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { volumeDone: true, notes: true },
  });
  return { volume: it.volumeDone.toString(), notes: it.notes };
}

describe("KASUS INTI: menambah foto tidak menyentuh angka", () => {
  it("foto masuk, volume & catatan tetap seperti semula", async () => {
    const sebelum = await isiItem();
    const hasil = await tambah([berkas("a.jpg"), berkas("b.jpg", "yy")]);
    expect(hasil?.success).toBe("2 foto ditambahkan.");
    expect(hasil?.error).toBeUndefined();
    expect(panggilan).toHaveLength(2);
    expect(await isiItem()).toEqual(sebelum);
    expect(sebelum.volume).toBe(VOLUME_AWAL);
  });

  it("cap foto menyebut BANGUNAN + nama pekerjaan, sama dengan jalur simpan item", async () => {
    await tambah([berkas()]);
    expect(panggilan).toHaveLength(1);
    expect(panggilan[0]?.stamp?.categoryName).toBe("V. PEKERJAAN SHELTER");
    expect(panggilan[0]?.stamp?.workName).toBe("Pembesian Besi Beton D13");
    // Tanggal kerja item, bukan tanggal unggah — foto susulan tetap milik hari
    // laporannya.
    expect(panggilan[0]?.dateKey).toBe("2026-07-01");
    expect(panggilan[0]?.reportItemId).toBe(itemId);
  });

  it("jawaban 'sedang di lokasi' diteruskan ke cap", async () => {
    await tambah([berkas()], { photoSource: "gallery", galleryAtSite: "1" });
    expect(panggilan).toHaveLength(1);
    expect(panggilan[0]?.stamp?.source).toBe("gallery");
    expect(panggilan[0]?.stamp?.atSite).toBe(true);
  });
});

describe("gerbang & penolakan", () => {
  it("laporan DIKIRIM: ditolak — bukti sudah jadi dasar verifikasi", async () => {
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "dikirim" } });
    const hasil = await tambah([berkas()]);
    expect(hasil?.error).toMatch(/sudah dikirim/i);
    expect(panggilan).toHaveLength(0);
  });

  it("PERLU KOREKSI: boleh — memang untuk diperbaiki", async () => {
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "perlu_koreksi" } });
    expect((await tambah([berkas()]))?.success).toBeTruthy();
  });

  it("tanpa berkas: ditolak dengan jelas, bukan diam-diam 'berhasil'", async () => {
    const hasil = await tambah([]);
    expect(hasil?.error).toBe("Belum ada foto yang dipilih.");
  });

  it("item milik laporan lain tidak bisa dititipi foto", async () => {
    const lain = await db.dailyReport.create({
      data: { locationId, reportDate: new Date("2026-07-02T00:00:00Z"), status: "draft", createdById: mandorId },
    });
    const itemLain = await db.dailyReportItem.create({
      data: {
        reportId: lain.id,
        rabNodeId: nodeId,
        lineageKey: "V#1",
        volumeDone: "1",
        valueDone: 15000n,
      },
    });
    const hasil = await tambah([berkas()], {}, itemLain.id);
    expect(hasil?.error).toMatch(/tidak ditemukan/i);
    expect(panggilan).toHaveLength(0);
  });

  it("error TAK TERDUGA dari satu foto tidak menjatuhkan seluruh aksi", async () => {
    // Produksi 2026-08-03: EXIF cacat membuat Prisma menolak koordinat "NaN"
    // dengan PrismaClientValidationError — BUKAN PhotoError. Dulu error seperti
    // itu dilempar ulang dan melewati semua penanganan: volume tersimpan, foto
    // lain batal, pelapor cuma melihat halaman error. DECISIONS 231.
    const asli = gagalkanFoto;
    gagalkanFoto = null;
    const sebelum = await isiItem();
    let n = 0;
    const patch = vi.spyOn(await import("@/lib/photos"), "savePhotoForItem");
    patch.mockImplementation(async (input) => {
      panggilan.push(input);
      if (++n === 1) throw new TypeError("kolom Decimal menolak NaN");
      return { id: "ok" } as never;
    });
    const hasil = await tambah([berkas("rusak.jpg"), berkas("baik.jpg", "zz")]);
    patch.mockRestore();
    gagalkanFoto = asli;

    // Yang sehat tetap masuk, yang rusak dilaporkan — bukan seluruhnya batal.
    expect(hasil?.success).toBe("1 foto ditambahkan.");
    expect(hasil?.warning).toMatch(/rusak\.jpg/);
    expect(await isiItem(), "volume & catatan tidak ikut terseret").toEqual(sebelum);
  });

  it("semua foto gagal = GAGAL, bukan 'sukses sebagian'", async () => {
    gagalkanFoto = "Format tidak didukung";
    const hasil = await tambah([berkas()]);
    expect(hasil?.success).toBeUndefined();
    expect(hasil?.error).toMatch(/Format tidak didukung/);
  });
});
