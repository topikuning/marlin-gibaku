// FORMULIR RENCANA KERJA MINGGUAN (DECISIONS 258).
//
// Yang dikunci berkas ini adalah bagian yang TIDAK terlihat salah di layar:
//
//  1. PPC minggu lalu memakai realisasi SELAMA minggu itu, bukan kumulatif.
//     Kalau kumulatif dipakai, pekerjaan bertahun-tahun sebelumnya dihitung
//     sebagai pemenuhan janji minggu lalu — dan PPC-nya justru bagus untuk
//     minggu yang tidak mengerjakan apa pun. Tidak ada galat, tidak ada tanda,
//     cuma angka yang membanggakan dan salah.
//  2. Laporan yang belum terhitung (draft / perlu_koreksi) tidak boleh
//     memenuhi komitmen. Ini basis yang sama dengan blanko KKP (DECISIONS 210).
//  3. Angka pokok formulir = angka calculation layer, bukan hitungan sendiri.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { getRencanaMingguan } = await import("@/lib/plan/rencana-mingguan");
const { buildRencanaKkpPdf } = await import("@/lib/pdf/rencana-kkp");
const { getLocationProgress } = await import("@/lib/progress");
const { getOrCreateDraft, upsertItem, submitReport } = await import("@/lib/daily-report/service");

const suffix = `rm${Date.now().toString(36)}`;
let locationId: string;
let userId: string;
let batuId: string;
let galianId: string;

/** Kontrak mulai 2026-06-01 → minggu 1 = 1–7 Juni, minggu 2 = 8–14, minggu 3 = 15–21 Juni. */
beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org RM ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: {
      orgId: org.id,
      username: `rm-${suffix}`,
      fullName: "Penyusun Rencana",
      passwordHash: "x",
      role: "super_admin",
    },
  });
  userId = user.id;
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket RM ${suffix}`, stage: "pelaksanaan" },
  });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor RM ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 200_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 21,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-21"),
      ppkName: "PPK Uji",
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi RM",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      // Location.isActive default FALSE — tanpa baris ini lokasi tak terpakai.
      isActive: true,
    },
  });
  locationId = loc.id;

  // RAB aktif: grandTotal = Σ amount KATEGORI = 125 juta.
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 125_000_000n },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI",
      amount: 125_000_000n, lineageKey: "I", sortOrder: 1,
    },
  });
  const batu = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan batu",
      volume: 100, unit: "m3", unitPrice: 1_000_000, amount: 100_000_000n, lineageKey: "I#1", sortOrder: 2,
    },
  });
  batuId = batu.id;
  const galian = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "2", name: "Galian tanah",
      volume: 50, unit: "m3", unitPrice: 500_000, amount: 25_000_000n, lineageKey: "I#2", sortOrder: 3,
    },
  });
  galianId = galian.id;

  const baseline = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "auto", status: "aktif", rabRevisionId: rev.id, contractDays: 21 },
  });
  await db.baselinePoint.createMany({
    data: [
      { baselineId: baseline.id, weekNumber: 1, plannedPct: 30 },
      { baselineId: baseline.id, weekNumber: 2, plannedPct: 70 },
      { baselineId: baseline.id, weekNumber: 3, plannedPct: 100 },
    ],
  });

  // ── Realisasi ──
  // Minggu 1 (1–7 Juni): batu 40 m3 — SEBELUM minggu yang dijanjikan.
  const w1 = await getOrCreateDraft(locationId, "2026-06-03", userId);
  await upsertItem(w1.id, { rabNodeId: batuId, volumeDone: 40 }, userId);
  await submitReport(w1.id, userId);

  // Minggu 2 (8–14 Juni): batu 10 m3 terhitung + 25 m3 masih DRAFT (tak terhitung).
  const w2 = await getOrCreateDraft(locationId, "2026-06-09", userId);
  await upsertItem(w2.id, { rabNodeId: batuId, volumeDone: 10 }, userId);
  await submitReport(w2.id, userId);
  const w2draft = await getOrCreateDraft(locationId, "2026-06-11", userId);
  await upsertItem(w2draft.id, { rabNodeId: batuId, volumeDone: 25 }, userId); // sengaja TIDAK dikirim

  // Rencana minggu 2 = komitmen yang akan dinilai oleh PPC di formulir minggu 3.
  const plan2 = await db.weeklyPlan.create({
    data: {
      locationId,
      weekNumber: 2,
      weekStart: new Date("2026-06-08"),
      weekEnd: new Date("2026-06-14"),
      createdById: userId,
    },
  });
  await db.weeklyPlanItem.createMany({
    data: [
      { weeklyPlanId: plan2.id, rabNodeId: batuId, targetVolume: 30, priority: 1 },
      { weeklyPlanId: plan2.id, rabNodeId: galianId, targetVolume: 20, priority: 2 },
    ],
  });

  // Rencana minggu 3 = komitmen yang disusun formulirnya.
  const plan3 = await db.weeklyPlan.create({
    data: {
      locationId,
      weekNumber: 3,
      weekStart: new Date("2026-06-15"),
      weekEnd: new Date("2026-06-21"),
      note: "Butuh tambahan alat.",
      createdById: userId,
    },
  });
  await db.weeklyPlanItem.createMany({
    data: [
      { weeklyPlanId: plan3.id, rabNodeId: batuId, targetVolume: 25, priority: 1, picName: "Sarno" },
      { weeklyPlanId: plan3.id, rabNodeId: galianId, targetVolume: 10, priority: 2 },
    ],
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("formulir rencana mingguan", () => {
  it("PPC memakai realisasi SELAMA minggu lalu, bukan kumulatif", async () => {
    const r = await getRencanaMingguan(locationId, 3);
    expect(r).not.toBeNull();
    // Batu: kumulatif 50 m3, TAPI hanya 10 m3 dikerjakan dalam minggu 2 — target
    // 30 tidak terpenuhi. Kalau kumulatif yang dipakai, 50 ≥ 30 dan komitmen ini
    // akan dinyatakan tuntas berkat pekerjaan minggu SEBELUMNYA.
    expect(r!.ppc.jumlah).toBe(2);
    expect(r!.ppc.tuntas).toBe(0);
    expect(r!.ppc.pct).toBe(0);
    // Volume: min(10,30) + min(0,20) = 10 dari 50 → 20%.
    expect(r!.ppc.volumePct).toBe(20);
  });

  it("komitmen yang tidak tuntas disebut satu per satu dengan kekurangannya", async () => {
    const r = await getRencanaMingguan(locationId, 3);
    const batu = r!.tidakTuntas.find((t) => t.code === "1");
    expect(batu).toMatchObject({ target: 30, realisasi: 10 });
    const galian = r!.tidakTuntas.find((t) => t.code === "2");
    expect(galian).toMatchObject({ target: 20, realisasi: 0 });
  });

  it("laporan DRAFT tidak boleh memenuhi komitmen", async () => {
    // 25 m3 batu tanggal 11 Juni ada di database tapi laporannya masih draft.
    // Kalau ia ikut dihitung, realisasi minggu 2 jadi 35 ≥ 30 dan PPC melompat
    // ke 50% karena laporan yang belum diperiksa siapa pun.
    const r = await getRencanaMingguan(locationId, 3);
    expect(r!.tidakTuntas.find((t) => t.code === "1")!.realisasi).toBe(10);
    expect(r!.ppc.pct).toBe(0);
  });

  it("angka pokok formulir SAMA dengan calculation layer", async () => {
    const r = await getRencanaMingguan(locationId, 3);
    const p = await getLocationProgress(locationId);
    // Realisasi: batu 50/100 × bobot 80 = 40%. Tidak dihitung ulang di formulir.
    expect(r!.actualPct).toBeCloseTo(p.realizedPct, 10);
    expect(r!.actualPct).toBeCloseTo(40, 6);
    // Kurva-S minggu 3 = 100% → deviasi −60.
    expect(r!.targetPct).toBe(100);
    expect(r!.deviationPct).toBeCloseTo(-60, 6);
    expect(r!.status).toBe("kritis");
  });

  it("proyeksi = realisasi + bobot komitmen, dan menandai rencana yang belum cukup", async () => {
    const r = await getRencanaMingguan(locationId, 3);
    // Nilai komitmen = 25×1jt + 10×500rb = 30jt; bobot = 30/125 = 24 poin.
    expect(r!.totalNilai).toBe(30_000_000);
    expect(r!.totalBobot).toBeCloseTo(24, 6);
    expect(r!.proyeksi.proyeksiPct).toBeCloseTo(64, 6);
    // 64 < 100 → rencana ini saja belum mengejar kurva-S. Inilah angka yang
    // membuat formulir bisa dinilai SEBELUM ditandatangani.
    expect(r!.proyeksi.masihTertinggal).toBe(true);
    expect(r!.proyeksi.selisihPct).toBeCloseTo(-36, 6);
  });

  it("baris komitmen memuat posisi volume, bukan target saja", async () => {
    const r = await getRencanaMingguan(locationId, 3);
    const batu = r!.baris.find((b) => b.code === "1")!;
    expect(batu).toMatchObject({ volumeKontrak: 100, realisasi: 50, sisa: 50, target: 25 });
    expect(batu.bobotTarget).toBeCloseTo(20, 6); // 25jt / 125jt
    expect(batu.picName).toBe("Sarno");
    expect(r!.catatan).toBe("Butuh tambahan alat.");
  });

  it("minggu 1 tidak punya minggu sebelumnya → PPC null, BUKAN 0", async () => {
    const r = await getRencanaMingguan(locationId, 1);
    expect(r!.ppc.pct).toBeNull();
  });

  it("minggu di luar masa kontrak ditolak, tidak dikarang", async () => {
    expect(await getRencanaMingguan(locationId, 99)).toBeNull();
    expect(await getRencanaMingguan(locationId, 0)).toBeNull();
  });

  // PDF hanya gagal saat DIRENDER, tidak saat typecheck: kolom yang jumlahnya
  // tak cocok, span melebihi kolom, atau teks yang tak muat membuat pdfkit
  // melempar — dan itu baru ketahuan saat seseorang menekan "Kirim ke WhatsApp".
  it("PDF formulir benar-benar terbentuk (bukan cuma lolos typecheck)", async () => {
    const r = await getRencanaMingguan(locationId, 3);
    const buf = await buildRencanaKkpPdf(r!, "MARLIN");
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5_000);
  });

  it("PDF tetap terbentuk untuk minggu tanpa komitmen & tanpa PPC", async () => {
    // Jalur kosong justru yang paling sering dilewatkan: tabel tanpa baris,
    // catatan null, PPC null. Semuanya harus tetap menghasilkan formulir.
    const r = await getRencanaMingguan(locationId, 1);
    expect(r!.baris).toHaveLength(0);
    const buf = await buildRencanaKkpPdf(r!, "MARLIN");
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
