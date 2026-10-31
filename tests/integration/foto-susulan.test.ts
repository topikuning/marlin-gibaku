// FOTO SUSULAN di laporan yang sudah dikirim (DECISIONS 696), basis data sungguhan.
//
// Permintaan user 2026-10-22: pekerjaan yang memang belum diisi foto bisa diberi
// foto walau laporannya sudah final. Pilihan user: status dikirim/disetujui/final,
// semua pelapor lokasi boleh menambah, foto susulan yang salah tempel boleh
// dihapus pengunggahnya, Site Manager, atau Super Admin.
//
// Yang dijaga:
// - hanya pekerjaan TANPA foto; yang sudah berfoto tetap terkunci;
// - fotonya ditandai susulan, di dua jalur (unggah langsung & Foto Cepat);
// - foto ASLI laporan yang sudah dikirim tetap tidak bisa dihapus siapa pun;
// - bukti yang sudah ditautkan ke temuan tidak bisa dihapus;
// - salinan Drive foto yang dihapus dibuang, kecuali berkasnya sudah memuat foto lain.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/r2", () => ({ isR2Configured: () => true, r2Delete: async () => {} }));
vi.mock("@/lib/penyimpanan/berkas", async (importAsli) => ({
  ...(await importAsli<typeof import("@/lib/penyimpanan/berkas")>()),
  hapusBerkas: async () => {},
}));
vi.mock("@/lib/photo-restamp/service", () => ({ konteksFoto: async () => null }));

/** Berkas Drive yang dibuang ke Sampah. */
const dibuangDrive: string[] = [];
/** Keterangan berkas di Drive tiruan; bawaan = buatan MARLIN, baru dibuat, tidak diubah orang. */
const metaDrive = new Map<string, { createdTime: Date; terbitanMarlin: boolean; diubahOrangLain: boolean }>();
vi.mock("@/lib/gdrive/client", async (importAsli) => ({
  ...(await importAsli<typeof import("@/lib/gdrive/client")>()),
  buangPintasan: async (id: string) => {
    dibuangDrive.push(id);
  },
  metaBerkas: async (id: string) => ({
    id,
    // Bawaan: dibuat sesaat sebelum jejak unggahnya (jejak uji ditulis 10 menit lalu).
    ...(metaDrive.get(id) ?? { createdTime: new Date(Date.now() - 11 * 60_000), terbitanMarlin: true, diubahOrangLain: false }),
  }),
}));

let nomor = 0;
// R2 tidak ada di lingkungan uji: `savePhotoForItem` menulis baris Photo-nya
// saja, persis dengan kolom yang diteruskan aksi.
vi.mock("@/lib/photos", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/photos")>();
  const { db: dbUji } = await import("@/lib/db");
  return {
    ...asli,
    savePhotoForItem: async (input: Parameters<typeof asli.savePhotoForItem>[0]) =>
      dbUji.photo.create({
        data: {
          locationId: input.locationId,
          reportId: input.reportId ?? null,
          reportItemId: input.reportItemId ?? null,
          uploadedById: input.userId,
          addedAfterSubmitAt: input.susulanAt ?? null,
          r2Key: `uji/susulan/${Date.now()}-${++nomor}.webp`,
          sha256: `susulan-${Date.now()}-${nomor}`,
          bytes: 10,
        },
      }),
  };
});

let sesi = "";
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  return {
    ...asli,
    requireUser: async () => pengguna(sesi),
    requireCapability: async (cap: Parameters<typeof can>[1]) => {
      const u = await pengguna(sesi);
      if (!can(u.role, cap)) throw new asli.ForbiddenError();
      return u;
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { addItemPhotosAction, removeReportPhotoAction } = await import("@/lib/daily-report/actions");
const { pakaiFotoAction } = await import("@/lib/foto-cepat/actions");
const { getTujuan } = await import("@/lib/foto-cepat/queries");

async function pengguna(id: string) {
  return db.user.findUniqueOrThrow({
    where: { id },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

const suffix = `fs${Date.now().toString(36)}`;
const orang = { mandor: "", mandorLain: "", sm: "" };
let orgId = "";
let packageId = "";
let locationId = "";
let reportId = "";
/** Pekerjaan TANPA foto. */
let itemKosong = "";
/** Pekerjaan yang sudah punya foto bukti asli. */
let itemBerfoto = "";
let fotoAsli = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  for (const [k, role] of [
    ["mandor", "field_supervisor"],
    ["mandorLain", "field_supervisor"],
    ["sm", "site_manager"],
  ] as const) {
    orang[k] = (
      await db.user.create({ data: { orgId, username: `${k}-${suffix}`, fullName: k, passwordHash: "x", role } })
    ).id;
  }
  packageId = (await db.package.create({ data: { orgId, name: `Paket ${suffix}`, driveFolderId: `folder-${suffix}` } })).id;
  locationId = (
    await db.location.create({
      data: { packageId, name: "Lokasi FS", slug: `lokasi-${suffix}`, village: "Desa", regency: "Kab", province: "Prov" },
    })
  ).id;
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, status: "aktif", source: "hps_awal", totalValue: 3_000_000n },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN DERMAGA", lineageKey: "I", sortOrder: 1 },
  });
  const node = async (kode: string, nama: string, urut: number) =>
    db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        code: kode,
        name: nama,
        unit: "m3",
        volume: "10",
        unitPrice: "150000",
        amount: 1_500_000n,
        lineageKey: `I#${kode}`,
        sortOrder: urut,
      },
    });
  const n1 = await node("1", "Galian", 2);
  const n2 = await node("2", "Urugan", 3);
  reportId = (
    await db.dailyReport.create({
      data: {
        locationId,
        reportDate: new Date("2026-10-01T00:00:00Z"),
        status: "final",
        createdById: orang.mandor,
        submittedAt: new Date("2026-10-01T10:00:00Z"),
      },
    })
  ).id;
  const item = (nodeId: string, lineageKey: string) =>
    db.dailyReportItem.create({
      data: { reportId, rabNodeId: nodeId, lineageKey, volumeDone: "1", valueDone: 150_000n, reportedById: orang.mandor },
    });
  itemKosong = (await item(n1.id, "I#1")).id;
  itemBerfoto = (await item(n2.id, "I#2")).id;
  fotoAsli = (
    await db.photo.create({
      data: {
        locationId,
        reportId,
        reportItemId: itemBerfoto,
        uploadedById: orang.mandor,
        r2Key: `uji/${suffix}/asli.webp`,
        sha256: `${suffix}-asli`,
        bytes: 10,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.$executeRawUnsafe(`DELETE FROM "organizations" WHERE slug = 'org-${suffix}'`).catch(() => null);
  await db.$disconnect();
});

beforeEach(async () => {
  sesi = orang.mandor;
  dibuangDrive.length = 0;
  await db.photo.deleteMany({ where: { reportItemId: itemKosong } });
  await db.dailyReport.update({ where: { id: reportId }, data: { status: "final" } });
});

function berkas(nama = "a.jpg") {
  return new File(["xx"], nama, { type: "image/jpeg" });
}

async function tambah(itemId: string, files = [berkas()]) {
  const fd = new FormData();
  fd.set("reportId", reportId);
  fd.set("itemId", itemId);
  for (const f of files) fd.append("photos", f);
  return addItemPhotosAction(undefined, fd);
}

async function hapus(photoId: string) {
  const fd = new FormData();
  fd.set("photoId", photoId);
  return removeReportPhotoAction(undefined, fd);
}

async function fotoKantong(tag: string) {
  return (
    await db.photo.create({
      data: { locationId, uploadedById: orang.mandor, r2Key: `uji/${suffix}/${tag}.webp`, sha256: `${suffix}-${tag}`, bytes: 10 },
    })
  ).id;
}

const fotoItem = (itemId: string) =>
  db.photo.findMany({ where: { reportItemId: itemId }, select: { id: true, addedAfterSubmitAt: true } });

describe("menambah foto susulan", () => {
  it.each(["dikirim", "disetujui", "final"] as const)(
    "laporan %s: pekerjaan tanpa foto boleh diberi foto, ditandai susulan",
    async (status) => {
      await db.dailyReport.update({ where: { id: reportId }, data: { status } });
      const hasil = await tambah(itemKosong, [berkas("a.jpg"), berkas("b.jpg")]);
      expect(hasil?.success).toBe("2 foto susulan ditambahkan.");
      const foto = await fotoItem(itemKosong);
      expect(foto).toHaveLength(2);
      expect(foto.every((f) => f.addedAfterSubmitAt instanceof Date)).toBe(true);
    },
  );

  it("pekerjaan yang SUDAH berfoto tetap terkunci – juga sesudah satu foto susulan masuk", async () => {
    expect((await tambah(itemBerfoto))?.error).toMatch(/sudah punya foto/);
    await tambah(itemKosong);
    expect((await tambah(itemKosong))?.error).toMatch(/sudah punya foto/);
    expect(await fotoItem(itemKosong)).toHaveLength(1);
  });

  it("volume pekerjaan tidak tersentuh dan penambahan tercatat di audit", async () => {
    await tambah(itemKosong);
    const it = await db.dailyReportItem.findUniqueOrThrow({ where: { id: itemKosong }, select: { volumeDone: true } });
    expect(it.volumeDone.toString()).toBe("1");
    const jejak = await db.auditLog.findFirst({
      where: { action: "daily_report.photo_late_add", resourceId: reportId },
      orderBy: { createdAt: "desc" },
    });
    expect(jejak?.payload).toMatchObject({ itemId: itemKosong, jumlah: 1, status: "final" });
  });

  it("laporan FINAL di paket ber-Drive: unggahan Drive diantre ulang supaya fotonya ikut", async () => {
    await db.gDriveJob.deleteMany({ where: { packageId } });
    await tambah(itemKosong);
    const job = await db.gDriveJob.findFirst({ where: { packageId, kind: "laporan_harian" } });
    expect(job?.status).toBe("menunggu");
  });

  it("draft tetap memakai aturan lama: foto biasa, tanpa tanda susulan", async () => {
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "draft" } });
    expect((await tambah(itemKosong))?.success).toBe("1 foto ditambahkan.");
    expect((await fotoItem(itemKosong))[0]?.addedAfterSubmitAt).toBeNull();
  });
});

describe("Foto Cepat ke laporan yang sudah dikirim", () => {
  it("daftar tujuan hanya menawarkan pekerjaan yang belum berfoto, dengan keterangan", async () => {
    const { laporan } = await getTujuan(locationId);
    const ini = laporan.find((l) => l.id === reportId);
    expect(ini?.label).toMatch(/sudah dikirim, foto susulan/);
    expect(ini?.items.map((i) => i.id)).toEqual([itemKosong]);
  });

  it("foto kantong yang dipakai ditandai susulan; pekerjaan berfoto menolak", async () => {
    const satu = await fotoKantong("k1");
    const fd = (photoId: string, reportItemId: string) => {
      const f = new FormData();
      f.append("photoIds", photoId);
      f.set("tujuan", "laporan");
      f.set("reportItemId", reportItemId);
      return f;
    };
    const ok = await pakaiFotoAction({}, fd(satu, itemKosong));
    expect(ok.error).toBeUndefined();
    expect(ok.ok ?? ok.warning).toMatch(/sebagai foto susulan/);
    const row = await db.photo.findUniqueOrThrow({ where: { id: satu }, select: { reportItemId: true, addedAfterSubmitAt: true } });
    expect(row.reportItemId).toBe(itemKosong);
    expect(row.addedAfterSubmitAt).toBeInstanceOf(Date);

    const dua = await fotoKantong("k2");
    expect((await pakaiFotoAction({}, fd(dua, itemBerfoto))).error).toMatch(/sudah punya foto/);
  });
});

describe("menghapus foto di laporan yang sudah dikirim", () => {
  async function susulanMilik(userId: string) {
    sesi = userId;
    await tambah(itemKosong);
    return (await fotoItem(itemKosong))[0]!.id;
  }

  it("foto ASLI laporan final tidak bisa dihapus siapa pun", async () => {
    sesi = orang.sm;
    expect((await hapus(fotoAsli))?.error).toMatch(/hanya foto susulan/);
    expect(await db.photo.count({ where: { id: fotoAsli } })).toBe(1);
  });

  it("foto susulan: pengunggahnya boleh, mandor lain tidak, Site Manager boleh", async () => {
    const milikMandor = await susulanMilik(orang.mandor);
    sesi = orang.mandorLain;
    expect((await hapus(milikMandor))?.error).toMatch(/pengunggah foto/);
    sesi = orang.mandor;
    expect((await hapus(milikMandor))?.success).toBe("Foto susulan dihapus.");

    const lagi = await susulanMilik(orang.mandor);
    sesi = orang.sm;
    expect((await hapus(lagi))?.success).toBe("Foto susulan dihapus.");
  });

  it("foto susulan yang sudah jadi bukti temuan tidak bisa dihapus", async () => {
    const foto = await susulanMilik(orang.mandor);
    const temuan = await db.finding.create({
      data: { locationId, title: "Uji bukti", findingDate: new Date("2026-10-02"), raisedById: orang.sm },
    });
    await db.evidenceLink.create({ data: { findingId: temuan.id, photoId: foto, addedById: orang.sm } });
    expect((await hapus(foto))?.error).toMatch(/bukti temuan/);
    expect(await db.photo.count({ where: { id: foto } })).toBe(1);
    await db.evidenceLink.deleteMany({ where: { photoId: foto } });
    await db.finding.delete({ where: { id: temuan.id } });
  });

  it("salinan Drive dibuang – kecuali berkasnya sudah memuat foto lain", async () => {
    const foto = await susulanMilik(orang.mandor);
    const log = (fileId: string, photoId: string | null, menit: number) =>
      db.gDriveUpload.create({
        data: {
          packageId,
          locationId,
          kind: "laporan_harian",
          refKey: `uji-${suffix}`,
          fileName: `${fileId}.jpg`,
          fileId,
          status: "sukses",
          photoId,
          createdAt: new Date(Date.now() - menit * 60_000),
        },
      });
    // file-A: terakhir memuat foto ini → dibuang.
    await log(`file-A-${suffix}`, foto, 10);
    // file-B: dulu foto ini, lalu ditimpa foto asli (nama berkas ikut urutan) → dibiarkan.
    await log(`file-B-${suffix}`, foto, 20);
    await log(`file-B-${suffix}`, fotoAsli, 5);
    await db.gDrivePintasanFoto.create({
      data: { photoId: foto, reportId, locationId, shortcutId: `pintasan-${suffix}`, bangunan: "I", nama: "x" },
    });

    // file-C & file-D: jejak MARLIN menunjuknya, tapi berkasnya buatan orang
    // (sudah ada sebelum MARLIN mengunggah) atau sudah diubah orang → tidak
    // pernah dibuang (DECISIONS 723).
    await log(`file-C-${suffix}`, foto, 10);
    metaDrive.set(`file-C-${suffix}`, { createdTime: new Date(Date.now() - 86_400_000), terbitanMarlin: true, diubahOrangLain: false });
    await log(`file-D-${suffix}`, foto, 10);
    metaDrive.set(`file-D-${suffix}`, { createdTime: new Date(Date.now() - 30 * 60_000), terbitanMarlin: true, diubahOrangLain: true });

    expect((await hapus(foto))?.success).toBe("Foto susulan dihapus.");
    expect(dibuangDrive.sort()).toEqual([`file-A-${suffix}`, `pintasan-${suffix}`].sort());
    expect(await db.gDrivePintasanFoto.count({ where: { photoId: foto } })).toBe(0);
  });
});
