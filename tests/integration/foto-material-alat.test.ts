// FOTO MATERIAL & ALAT TIDAK BOLEH HILANG SAAT PELENGKAP DISIMPAN ULANG.
//
// Kebutuhan lapangan user 2026-08-08: laporan harian bukan cuma item pekerjaan
// — ada material masuk dan alat, dan masing-masing perlu fotonya sendiri.
//
// Yang paling berbahaya di sini BUKAN fiturnya, tapi fondasinya. Sebelum
// DECISIONS 304, `setEnrichment` memakai hapus-semua lalu buat-ulang untuk
// material & alat, jadi ID barisnya berganti SETIAP KALI form pelengkap
// disimpan — bahkan saat yang diubah cuma cuaca atau jam kerja. Dengan foto
// tertaut ke ID itu, polanya akan melepas bukti pada penyimpanan berikutnya.
//
// Cacatnya SENYAP dan tertunda: saat diuji tangan semuanya benar — lampirkan
// foto, buka laporan, fotonya ada. Hilangnya baru terjadi besok, saat orang
// menyunting hal lain yang sama sekali tidak berhubungan. Uji ini menyimpan
// pelengkap DUA KALI dan menuntut fotonya masih menempel di baris yang sama.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "marlin.uji", "x-forwarded-proto": "https" }),
}));

const { db } = await import("@/lib/db");
const { getOrCreateDraft, setEnrichment, upsertItem, submitReport } = await import(
  "@/lib/daily-report/service"
);

const suffix = `fm${Date.now().toString(36)}`;
const HARI = "2026-06-10";

let orgId = "";
let userId = "";
let locationId = "";
let slug = "";
let reportId = "";
let batuId = "";

/** Pelengkap minimal — hanya bagian yang sedang diuji yang berubah. */
function pelengkap(
  materials: { id?: string | null; name: string; unit: string | null; qty: number | null }[],
  equipment: { id?: string | null; name: string; count: number }[],
  over: { notes?: string | null } = {},
) {
  return {
    weather: undefined,
    workStart: "07:30",
    workEnd: "16:30",
    notes: over.notes ?? null,
    workers: [],
    materials,
    equipment,
  };
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org FM ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  userId = (
    await db.user.create({
      data: {
        orgId,
        username: `fm-${suffix}`,
        fullName: "Admin FM",
        passwordHash: "x",
        role: "super_admin",
      },
      select: { id: true },
    })
  ).id;

  const vendor = await db.vendor.create({ data: { orgId, name: `Vendor FM ${suffix}` } });
  const pkg = await db.package.create({
    data: { orgId, name: `Paket FM ${suffix}`, stage: "pelaksanaan" },
  });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-FM-${suffix}`,
      contractValue: 100_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 21,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-21"),
      workTitle: "Pembangunan Uji Material",
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi FM",
      slug: `fm-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true, slug: true },
  });
  locationId = loc.id;
  slug = loc.slug;

  const rev = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo: 1,
      source: "hps_awal",
      status: "aktif",
      totalValue: 100_000_000n,
      createdAt: new Date("2026-05-26"),
    },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "kategori",
      code: "I",
      name: "PEKERJAAN UJI",
      amount: 100_000_000n,
      lineageKey: "I",
      sortOrder: 1,
    },
  });
  batuId = (
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        code: "1",
        name: "Pasangan batu",
        volume: 100,
        unit: "m3",
        unitPrice: 1_000_000,
        amount: 100_000_000n,
        lineageKey: "I#1",
        sortOrder: 2,
      },
      select: { id: true },
    })
  ).id;

  const lap = await getOrCreateDraft(locationId, HARI, userId);
  reportId = lap.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("KASUS INTI: identitas baris material & alat bertahan", () => {
  it("menyimpan pelengkap DUA KALI tidak mengganti ID barisnya", async () => {
    await setEnrichment(
      reportId,
      pelengkap(
        [{ name: "Semen PCC 50kg", unit: "zak", qty: 40 }],
        [{ name: "Concrete mixer", count: 1 }],
      ),
      userId,
    );
    const m1 = await db.dailyReportMaterial.findFirstOrThrow({ where: { reportId } });
    const e1 = await db.dailyReportEquipment.findFirstOrThrow({ where: { reportId } });

    // Simpan lagi dengan MENGIRIM id-nya — meniru form yang membawa id per baris.
    await setEnrichment(
      reportId,
      pelengkap(
        [{ id: m1.id, name: "Semen PCC 50kg", unit: "zak", qty: 40 }],
        [{ id: e1.id, name: "Concrete mixer", count: 1 }],
        { notes: "cuma catatan yang berubah" },
      ),
      userId,
    );

    const m2 = await db.dailyReportMaterial.findFirstOrThrow({ where: { reportId } });
    const e2 = await db.dailyReportEquipment.findFirstOrThrow({ where: { reportId } });
    expect(m2.id).toBe(m1.id);
    expect(e2.id).toBe(e1.id);
  });

  it("FOTO yang menempel TETAP ADA sesudah pelengkap disimpan ulang", async () => {
    // Inti seluruh perubahan fondasi ini. Sebelum DECISIONS 304, foto ini
    // ikut terhapus (cascade dari baris yang dibuat ulang) tanpa pesan apa pun.
    const m = await db.dailyReportMaterial.findFirstOrThrow({ where: { reportId } });
    const foto = await db.photo.create({
      data: {
        locationId,
        reportId,
        reportMaterialId: m.id,
        r2Key: `photos/${suffix}/material-1.webp`,
        sha256: `sha-${suffix}-m1`,
        bytes: 111,
        uploadedById: userId,
      },
      select: { id: true },
    });

    await setEnrichment(
      reportId,
      pelengkap(
        [{ id: m.id, name: "Semen PCC 50kg", unit: "zak", qty: 60 }],
        [],
        { notes: "qty dikoreksi" },
      ),
      userId,
    );

    const sesudah = await db.photo.findUnique({
      where: { id: foto.id },
      select: { reportMaterialId: true },
    });
    expect(sesudah, "fotonya hilang sama sekali").not.toBeNull();
    expect(sesudah!.reportMaterialId, "foto terlepas dari barisnya").toBe(m.id);
  });

  it("baris yang DIBUANG memang hilang — bukan menumpuk diam-diam", async () => {
    // Batas sebaliknya: mempertahankan id tidak boleh berubah jadi tidak pernah
    // bisa menghapus. Material yang tidak lagi dikirim harus benar-benar pergi.
    await setEnrichment(reportId, pelengkap([], []), userId);
    expect(await db.dailyReportMaterial.count({ where: { reportId } })).toBe(0);
    expect(await db.dailyReportEquipment.count({ where: { reportId } })).toBe(0);
  });

  it("foto BERTAHAN sebagai yatim saat barisnya dihapus — bukti tidak lenyap", async () => {
    // Uji sebelumnya baru saja menghapus barisnya. Fotonya harus masih ada,
    // dengan tautan dilepas, supaya bisa dilihat & dibersihkan — bukan raib.
    const foto = await db.photo.findFirst({
      where: { reportId, r2Key: `photos/${suffix}/material-1.webp` },
      select: { id: true, reportMaterialId: true },
    });
    expect(foto, "foto ikut terhapus bersama barisnya").not.toBeNull();
    expect(foto!.reportMaterialId).toBeNull();
  });

  it("ID asing dari form diperlakukan sebagai baris BARU, bukan dibuang", async () => {
    // Mengabaikan id yang tidak dikenal akan membuang isian orang tanpa sepatah
    // kata pun. Dan id milik laporan LAIN tidak boleh bisa ditimpa dari sini.
    const asing = "00000000-0000-4000-8000-000000000000";
    await setEnrichment(
      reportId,
      pelengkap([{ id: asing, name: "Besi D13", unit: "btg", qty: 25 }], []),
      userId,
    );
    const rows = await db.dailyReportMaterial.findMany({ where: { reportId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Besi D13");
    expect(rows[0].id).not.toBe(asing);
  });
});

// HARI TANPA PEKERJAAN, TAPI ADA MATERIAL MASUK.
//
// Kebutuhan user 2026-08-08: "kadang ada hari dimana tidak ada kegiatan yang
// berhubungan dengan item pekerjaan (RAB), tapi ada material masuk. saat ini
// kondisi tersebut tidak bisa diinput."
describe("syarat kirim laporan", () => {
  it("laporan dengan MATERIAL SAJA (tanpa item pekerjaan) bisa dikirim", async () => {
    const lain = await getOrCreateDraft(locationId, "2026-06-11", userId);
    await setEnrichment(
      lain.id,
      pelengkap([{ name: "Pasir beton", unit: "m3", qty: 8 }], []),
      userId,
    );
    expect(await db.dailyReportItem.count({ where: { reportId: lain.id } })).toBe(0);
    const hasil = await submitReport(lain.id, userId);
    expect(hasil.status).toBe("dikirim");
  });

  it("laporan dengan ALAT SAJA juga bisa dikirim", async () => {
    const lain = await getOrCreateDraft(locationId, "2026-06-12", userId);
    await setEnrichment(lain.id, pelengkap([], [{ name: "Vibrator", count: 2 }]), userId);
    const hasil = await submitReport(lain.id, userId);
    expect(hasil.status).toBe("dikirim");
  });

  it("laporan yang BENAR-BENAR kosong tetap DITOLAK", async () => {
    // Batas yang menahan seluruh pelonggaran ini: tanpa pagar apa pun, laporan
    // hampa bisa masuk antrean verifikasi dan memakan waktu orang.
    const kosong = await getOrCreateDraft(locationId, "2026-06-13", userId);
    await expect(submitReport(kosong.id, userId)).rejects.toThrow(/item pekerjaan|material|alat/i);
  });

  it("laporan dengan item pekerjaan tetap bisa dikirim seperti biasa", async () => {
    const biasa = await getOrCreateDraft(locationId, "2026-06-14", userId);
    await upsertItem(biasa.id, { rabNodeId: batuId, volumeDone: 5 }, userId);
    const hasil = await submitReport(biasa.id, userId);
    expect(hasil.status).toBe("dikirim");
  });
});
