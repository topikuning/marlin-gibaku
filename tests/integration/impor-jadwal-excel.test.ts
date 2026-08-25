// Impor Time Schedule Excel: angka user DIIKUTI apa adanya (DECISIONS 203).
//
// Keluhan user 2026-08-01: "jika user sudah upload jadwal versinya, apakah kamu
// tidak bisa mengikuti angka dari dia apa adanya? ini upload manual kamu harus
// mengikuti, kecuali orang tersebut meminta agar disesuaikan dengan sistem dari
// inputan dia. jadi kalau user tidak minta, maka manual yang jadi baselinenya".
//
// Uji ini menembus SELURUH jalur nyata: workbook xlsx → parser → pencocokan
// kategori → baseline tersimpan di DB, karena yang dikeluhkan adalah angka yang
// akhirnya TERSIMPAN, bukan hasil satu fungsi.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

let role = "project_manager";
let sessionUserId = "";
let sessionOrgId = "";

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { importJadwalAction, pratinjauJadwalAction } = await import(
  "@/app/(app)/lokasi/[slug]/rab/actions"
);

const suffix = `ij${Date.now().toString(36)}`;
let locId = "";
let revisionId = "";

/** Bobot RAB SENGAJA berbeda dari Excel supaya "diikuti" bisa dibuktikan. */
const KATEGORI = [
  { code: "I", name: "Pekerjaan Persiapan", amount: 5_000_000n }, // 5%
  { code: "II", name: "Pekerjaan Struktur", amount: 70_000_000n }, // 70%
  { code: "III", name: "Pekerjaan Finishing", amount: 25_000_000n }, // 25%
];

/**
 * Bangun workbook seperti hasil "Unduh Excel Jadwal" yang sudah disunting:
 * kolom A kode, B uraian, C bobot, D.. = M1..M4.
 */
async function workbook(baris: { code: string; name: string; weekly: number[] }[]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Time Schedule");
  ws.addRow(["Time Schedule", "", "", "", "", "", ""]);
  ws.addRow(["No", "Uraian Pekerjaan", "Bobot", "M1", "M2", "M3", "M4"]);
  for (const b of baris) {
    ws.addRow([b.code, b.name, b.weekly.reduce((s, v) => s + v, 0), ...b.weekly]);
  }
  ws.addRow(["", "Kumulatif Prestasi Rencana", "", 0, 0, 0, 0]);
  const buf = await wb.xlsx.writeBuffer();
  return new File([buf], "jadwal.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function fd(file: File, sesuaikanRab = false): FormData {
  const f = new FormData();
  f.set("locationId", locId);
  f.set("file", file);
  if (sesuaikanRab) f.set("sesuaikanRab", "1");
  return f;
}

/** Jadwal user: 10 / 60 / 30 — TIDAK sama dengan bobot RAB 5 / 70 / 25. */
const JADWAL_USER = [
  { code: "I", name: "Pekerjaan Persiapan", weekly: [10, 0, 0, 0] },
  { code: "II", name: "Pekerjaan Struktur", weekly: [0, 30, 30, 0] },
  { code: "III", name: "Pekerjaan Finishing", weekly: [0, 0, 10, 20] },
];

async function baselineAktif() {
  return db.baseline.findFirstOrThrow({
    where: { locationId: locId, status: "aktif" },
    include: {
      points: { orderBy: { weekNumber: "asc" }, select: { plannedPct: true } },
      scheduleItems: { select: { name: true, weightPct: true, weekly: true } },
    },
  });
}

const bobotOf = (b: Awaited<ReturnType<typeof baselineAktif>>, nama: string): number =>
  Number(b.scheduleItems.find((s) => s.name === nama)!.weightPct);

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  sessionOrgId = org.id;
  const user = await db.user.create({
    data: { orgId: org.id, username: `pm-${suffix}`, fullName: "PM", role: "project_manager", passwordHash: "x" },
  });
  sessionUserId = user.id;

  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "kontrak" } });
  await db.contract.create({
    data: {
      package: { connect: { id: pkg.id } },
      vendor: { connect: { id: vendor.id } },
      contractNumber: `K-${suffix}`,
      contractValue: 100_000_000n,
      signedDate: new Date("2026-01-01"),
      durationDays: 28, // → 4 minggu, cocok dengan M1..M4 di Excel
    },
  });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "Alfa", slug: `alfa-${suffix}`, village: "Alfa", regency: "K", province: "P" },
  });
  locId = loc.id;

  const rev = await db.rabRevision.create({
    data: {
      locationId: loc.id,
      revisionNo: 1,
      source: "hps_awal",
      status: "aktif",
      totalValue: 100_000_000n,
      createdById: sessionUserId,
    },
  });
  revisionId = rev.id;
  await db.rabNode.createMany({
    data: KATEGORI.map((k, i) => ({
      revisionId: rev.id,
      kind: "kategori" as const,
      code: k.code,
      name: k.name,
      amount: k.amount,
      lineageKey: `K${i + 1}`,
      sortOrder: i + 1,
    })),
  });
});

afterAll(async () => {
  if (!locId) {
    await db.$disconnect();
    return;
  }
  await db.baselinePoint.deleteMany({ where: { baseline: { locationId: locId } } });
  await db.baselineScheduleItem.deleteMany({ where: { baseline: { locationId: locId } } });
  await db.baseline.deleteMany({ where: { locationId: locId } });
  if (revisionId) await db.rabNode.deleteMany({ where: { revisionId } });
  await db.rabRevision.deleteMany({ where: { locationId: locId } });
  await db.location.deleteMany({ where: { id: locId } });
  await db.contract.deleteMany({ where: { package: { orgId: sessionOrgId } } });
  await db.package.deleteMany({ where: { orgId: sessionOrgId } });
  await db.vendor.deleteMany({ where: { orgId: sessionOrgId } });
  // audit_logs append-only (AUDIT-01) → user & organisasi sengaja dibiarkan.
  await db.$disconnect();
});

beforeEach(async () => {
  role = "project_manager";
  await db.baselinePoint.deleteMany({ where: { baseline: { locationId: locId } } });
  await db.baselineScheduleItem.deleteMany({ where: { baseline: { locationId: locId } } });
  await db.baseline.deleteMany({ where: { locationId: locId } });
});

describe("KASUS INTI: tanpa diminta apa pun, angka Excel yang jadi baseline", () => {
  it("bobot tersimpan = angka Excel (10/60/30), BUKAN bobot RAB (5/70/25)", async () => {
    const res = await importJadwalAction(undefined, fd(await workbook(JADWAL_USER)));
    expect(res?.error).toBeUndefined();

    const b = await baselineAktif();
    expect(bobotOf(b, "Pekerjaan Persiapan")).toBeCloseTo(10, 3);
    expect(bobotOf(b, "Pekerjaan Struktur")).toBeCloseTo(60, 3);
    expect(bobotOf(b, "Pekerjaan Finishing")).toBeCloseTo(30, 3);
  });

  it("kurva rencana persis mengikuti file: 10 / 40 / 80 / 100", async () => {
    await importJadwalAction(undefined, fd(await workbook(JADWAL_USER)));
    const b = await baselineAktif();
    expect(b.points.map((p) => Number(p.plannedPct))).toEqual([10, 40, 80, 100]);
  });

  it("jeda (sel kosong) tetap jeda – kurva mendatar di minggu itu", async () => {
    await importJadwalAction(
      undefined,
      fd(
        await workbook([
          { code: "I", name: "Pekerjaan Persiapan", weekly: [10, 0, 0, 0] },
          { code: "II", name: "Pekerjaan Struktur", weekly: [0, 60, 0, 0] },
          { code: "III", name: "Pekerjaan Finishing", weekly: [0, 0, 0, 30] },
        ]),
      ),
    );
    const b = await baselineAktif();
    expect(b.points.map((p) => Number(p.plannedPct))).toEqual([10, 70, 70, 100]);
  });

  it("banner menyebut selisihnya terhadap RAB – pilihan user, bukan angka diam-diam", async () => {
    const res = await importJadwalAction(undefined, fd(await workbook(JADWAL_USER)));
    expect(res?.success).toContain("apa adanya");
    expect(res?.success).toContain("Pekerjaan Persiapan 10,00% (RAB 5,00%)");
  });

  it("catatan baseline merekam bahwa ini versi 'apa adanya'", async () => {
    await importJadwalAction(undefined, fd(await workbook(JADWAL_USER)));
    const b = await baselineAktif();
    expect(b.note).toContain("apa adanya");
    expect(b.source).toBe("manual");
  });
});

describe("penyesuaian ke RAB HANYA kalau diminta", () => {
  it("dengan centang: bobot kembali ke RAB, bentuk & jeda dari Excel dipertahankan", async () => {
    const res = await importJadwalAction(undefined, fd(await workbook(JADWAL_USER), true));
    expect(res?.error).toBeUndefined();

    const b = await baselineAktif();
    expect(bobotOf(b, "Pekerjaan Persiapan")).toBeCloseTo(5, 3);
    expect(bobotOf(b, "Pekerjaan Struktur")).toBeCloseTo(70, 3);
    expect(bobotOf(b, "Pekerjaan Finishing")).toBeCloseTo(25, 3);
    // Minggu 1 tetap hanya Persiapan, minggu 4 tetap hanya Finishing.
    const persiapan = b.scheduleItems.find((s) => s.name === "Pekerjaan Persiapan")!.weekly as number[];
    expect(persiapan[1]).toBe(0);
    expect(b.note).toContain("disesuaikan ke RAB");
  });
});

describe("yang tidak bisa diikuti ditolak, bukan diam-diam diperbaiki", () => {
  it("total jauh dari 100% ditolak dan menyebut pekerjaan yang belum dijadwalkan", async () => {
    const res = await importJadwalAction(
      undefined,
      fd(
        await workbook([
          { code: "I", name: "Pekerjaan Persiapan", weekly: [10, 0, 0, 0] },
          { code: "II", name: "Pekerjaan Struktur", weekly: [0, 30, 30, 0] },
          // Finishing tidak diisi → total 70%.
        ]),
      ),
    );
    expect(res?.error).toContain("70,00%");
    expect(res?.error).toContain("Pekerjaan Finishing");
    // Tidak ada baseline yang terlanjur dibuat.
    expect(await db.baseline.count({ where: { locationId: locId } })).toBe(0);
  });

  it("nilai negatif ditolak dengan menyebut baris & minggunya", async () => {
    const res = await importJadwalAction(
      undefined,
      fd(
        await workbook([
          { code: "I", name: "Pekerjaan Persiapan", weekly: [10, 0, 0, 0] },
          { code: "II", name: "Pekerjaan Struktur", weekly: [0, 40, -5, 25] },
          { code: "III", name: "Pekerjaan Finishing", weekly: [0, 0, 10, 20] },
        ]),
      ),
    );
    expect(res?.error).toContain("Pekerjaan Struktur");
    expect(res?.error).toContain("minggu 3");
    expect(await db.baseline.count({ where: { locationId: locId } })).toBe(0);
  });

  it("selisih kecil (pembulatan spreadsheet) diterima & diskalakan seragam", async () => {
    const res = await importJadwalAction(
      undefined,
      fd(
        await workbook([
          { code: "I", name: "Pekerjaan Persiapan", weekly: [9.9, 0, 0, 0] },
          { code: "II", name: "Pekerjaan Struktur", weekly: [0, 29.7, 29.7, 0] },
          { code: "III", name: "Pekerjaan Finishing", weekly: [0, 0, 9.9, 19.8] },
        ]),
      ),
    );
    expect(res?.error).toBeUndefined();
    expect(res?.success).toContain("diskalakan seragam ke 100%");
    const b = await baselineAktif();
    // Perbandingan 10 : 60 : 30 dari file dipertahankan persis.
    expect(bobotOf(b, "Pekerjaan Persiapan")).toBeCloseTo(10, 3);
    expect(bobotOf(b, "Pekerjaan Struktur")).toBeCloseTo(60, 3);
    expect(b.points.at(-1)).toBeDefined();
    expect(Number(b.points.at(-1)!.plannedPct)).toBeCloseTo(100, 2);
  });
});

/*
 * PRATINJAU: menghitung, TIDAK menulis (DECISIONS 364).
 *
 * Langkah yang selama ini hilang dari alur "Perbarui Kurva-S". Dua sifatnya
 * yang benar-benar penting diuji di sini, karena keduanya gagal secara SENYAP:
 * pratinjau yang diam-diam menulis, dan pratinjau yang angkanya berbeda dari
 * yang akhirnya tersimpan.
 */
describe("pratinjau impor jadwal", () => {
  it("TIDAK membuat baseline baru", async () => {
    // Perlu ada baseline aktif dulu supaya "tidak berubah" bisa dibuktikan —
    // `beforeEach` mengosongkannya.
    await importJadwalAction(undefined, fd(await workbook(JADWAL_USER)));
    const sebelum = await baselineAktif();
    const jml = await db.baseline.count({ where: { locationId: locId } });

    // Jadwal yang BERBEDA dari yang aktif. Memakai berkas yang sama membuat
    // pratinjau-yang-diam-diam-menulis jadi no-op (hasilnya identik → tidak ada
    // baseline baru), sehingga ujinya hijau padahal cacatnya ada.
    const LAIN = [
      { code: "I", name: "Pekerjaan Persiapan", weekly: [20, 0, 0, 0] },
      { code: "II", name: "Pekerjaan Struktur", weekly: [0, 0, 50, 0] },
      { code: "III", name: "Pekerjaan Finishing", weekly: [0, 0, 0, 30] },
    ];
    const hasil = await pratinjauJadwalAction(undefined, fd(await workbook(LAIN)));
    expect(hasil?.error).toBeUndefined();
    expect(hasil?.data).toBeTruthy();

    expect(await db.baseline.count({ where: { locationId: locId } })).toBe(jml);
    const sesudah = await baselineAktif();
    expect(sesudah.id).toBe(sebelum.id);
    expect(sesudah.baselineNo).toBe(sebelum.baselineNo);
  });

  it("angkanya PERSIS sama dengan yang akhirnya tersimpan", async () => {
    // Inti pratinjau. Kalau ia menghitung lewat jalur sendiri, suatu saat ia
    // menampilkan angka yang berbeda dari hasil "Terapkan" — dan orang
    // mempercayainya tepat pada saat ia menekan tombol itu.
    const file = await workbook(JADWAL_USER);
    const pra = await pratinjauJadwalAction(undefined, fd(file));
    const diramal = new Map(pra!.data!.perubahan.map((r) => [r.minggu, r.baru]));
    expect(diramal.size).toBeGreaterThan(0);

    const terap = await importJadwalAction(undefined, fd(await workbook(JADWAL_USER)));
    expect(terap?.error).toBeUndefined();

    const b = await baselineAktif();
    for (const [minggu, nilai] of diramal) {
      expect(Number(b.points[minggu - 1].plannedPct), `minggu ${minggu}`).toBeCloseTo(nilai, 2);
    }
  });

  it("mode 'sesuaikan ke RAB' ikut diramalkan, bukan diabaikan", async () => {
    // Centangnya mengubah hasil secara drastis (bobot direnormalisasi ke RAB).
    // Pratinjau yang mengabaikannya menampilkan kurva yang bukan yang akan
    // diterapkan.
    const apaAdanya = await pratinjauJadwalAction(undefined, fd(await workbook(JADWAL_USER)));
    const keRab = await pratinjauJadwalAction(undefined, fd(await workbook(JADWAL_USER), true));
    const a = apaAdanya!.data!.perubahan.map((r) => r.baru);
    const r = keRab!.data!.perubahan.map((r) => r.baru);
    expect(a).not.toEqual(r);
  });

  it("berkas yang identik dengan baseline aktif ditandai 'tidak perlu diterapkan'", async () => {
    await importJadwalAction(undefined, fd(await workbook(JADWAL_USER)));
    const pra = await pratinjauJadwalAction(undefined, fd(await workbook(JADWAL_USER)));
    expect(pra?.data?.samaSaja).toBe(true);
    expect(pra?.data?.perubahan).toHaveLength(0);
  });

  it("perubahan KECIL tetap disebut, dan 'berubah' tak pernah kosong", async () => {
    /*
     * Ambang "berubah" di pratinjau harus sama dengan ambang yang dipakai
     * penerapan untuk memutuskan "tidak ada perubahan" (0,005 pp). Ambang yang
     * lebih longgar membuat pratinjau berkata "N minggu berubah" sambil
     * menampilkan tabel kosong — atau lebih buruk, menyembunyikan pergeseran
     * kecil yang justru sedang dicari orang.
     */
    await importJadwalAction(undefined, fd(await workbook(JADWAL_USER)));

    // Beda tipis: 1 poin dipindah dari Struktur ke Persiapan.
    const TIPIS = [
      { code: "I", name: "Pekerjaan Persiapan", weekly: [11, 0, 0, 0] },
      { code: "II", name: "Pekerjaan Struktur", weekly: [0, 29, 30, 0] },
      { code: "III", name: "Pekerjaan Finishing", weekly: [0, 0, 10, 20] },
    ];
    const pra = await pratinjauJadwalAction(undefined, fd(await workbook(TIPIS)));
    expect(pra?.data?.samaSaja).toBe(false);
    expect(pra!.data!.perubahan.length).toBeGreaterThan(0);
    expect(pra!.data!.jumlahMingguBerubah).toBe(pra!.data!.perubahan.length);

    // Dan pergeserannya memang kecil — bukti ambangnya rapat, bukan kebetulan
    // ada perubahan besar.
    const terbesar = Math.max(
      ...pra!.data!.perubahan.map((r) => (r.lama == null ? 99 : Math.abs(r.baru - r.lama))),
    );
    expect(terbesar).toBeLessThan(5);
  });

  it("berkas ngawur DITOLAK di pratinjau, sebelum apa pun tersimpan", async () => {
    const jml = await db.baseline.count({ where: { locationId: locId } });
    const bukanExcel = new File(["bukan excel"], "catatan.txt", { type: "text/plain" });
    const hasil = await pratinjauJadwalAction(undefined, fd(bukanExcel));
    expect(hasil?.error).toBeTruthy();
    expect(hasil?.data).toBeUndefined();
    expect(await db.baseline.count({ where: { locationId: locId } })).toBe(jml);
  });

  it("tanpa izin baseline.manage, pratinjau ditolak", async () => {
    const semula = role;
    role = "field_supervisor";
    try {
      const hasil = await pratinjauJadwalAction(undefined, fd(await workbook(JADWAL_USER)));
      expect(hasil?.error).toBeTruthy();
      expect(hasil?.data).toBeUndefined();
    } finally {
      role = semula;
    }
  });
});
