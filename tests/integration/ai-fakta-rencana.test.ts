// ASK MARLIN HARUS PUNYA FAKTA TENTANG YANG AKAN DIKERJAKAN (DECISIONS 458).
//
// Tangkapan layar user 2026-08-28: *"pekerjaan apa yang perlu dilakukan untuk
// mengejar progress?"* dijawab **"Saya tidak punya angka bersumber untuk
// menjawab itu"**, dengan penanda merah "tanpa sumber terverifikasi" — padahal
// tepat di bawahnya terpampang progres, laporan harian, dan kendala.
//
// Penolakannya JUJUR, dan itu yang menjadikannya cacat serius: seluruh fakta
// yang dirakit `buildPortfolioPulse` melaporkan apa yang SUDAH terjadi. Tidak
// satu pun menyebut apa yang direncanakan. Model yang dipagari agar tidak
// mengarang memang tidak punya pilihan selain menolak — dan penanya membaca
// penolakan itu sebagai "MARLIN tidak tahu apa-apa".
//
// Datanya sudah ada sejak lama (`WeeklyPlan`), dipakai formulir rencana
// mingguan, PDF, Excel, dan siaran WhatsApp. Yang tidak ada cuma sambungannya.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { buildPortfolioPulse } = await import("@/lib/ai-hub/source");
const { parseDateKey } = await import("@/lib/format");
import type { SessionUser } from "@/lib/auth/session";

const suffix = `afr${Date.now().toString(36)}`;
let locId = "";
let user: SessionUser;

/** Kontrak mulai 1 Juni 2026 → 24 Agustus 2026 jatuh di minggu ke-13. */
const MULAI = "2026-06-01";
const MINGGU_BERJALAN = 13;
const PERIODE_MULAI = "2026-08-24";
const PERIODE_AKHIR = "2026-08-28";

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org AFR ${suffix}`, slug: `org-${suffix}` },
  });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket AFR ${suffix}`, stage: "pelaksanaan" },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Pesisir ${suffix}`,
      slug: `pesisir-${suffix}`,
      village: "Pesisir",
      regency: "Tegal",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true },
  });
  locId = loc.id;

  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV AFR ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 100_000_000n,
      ppnPercent: 11,
      signedDate: parseDateKey("2026-05-20")!,
      durationDays: 140,
      startDate: parseDateKey(MULAI)!,
      endDate: parseDateKey("2026-10-19")!,
    },
  });

  const rab = await db.rabRevision.create({
    data: { locationId: locId, revisionNo: 1, status: "aktif", source: "hps_awal", totalValue: 0n },
    select: { id: true },
  });
  const kategori = await db.rabNode.create({
    data: {
      revisionId: rab.id,
      kind: "kategori",
      lineageKey: `kat-${suffix}`,
      code: "1",
      name: "Pekerjaan Struktur",
      sortOrder: 1,
      amount: 100_000_000n,
    },
    select: { id: true },
  });
  const buatItem = async (kode: string, nama: string, urut: number) =>
    db.rabNode.create({
      data: {
        revisionId: rab.id,
        parentId: kategori.id,
        kind: "item",
        lineageKey: `itm-${kode}-${suffix}`,
        code: kode,
        name: nama,
        sortOrder: urut,
        unit: "m3",
        volume: 50,
        unitPrice: 1_000_000,
        amount: 50_000_000n,
      },
      select: { id: true, lineageKey: true },
    });
  const pondasi = await buatItem("1.1", "Pondasi Batu Belah 1 : 5", 2);
  const urugan = await buatItem("1.2", "Urugan Tanah", 3);

  const baseline = await db.baseline.create({
    data: { locationId: locId, baselineNo: 1, source: "auto", status: "aktif", contractDays: 140 },
    select: { id: true },
  });
  await db.baselinePoint.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      baselineId: baseline.id,
      weekNumber: i + 1,
      plannedPct: (i + 1) * 5,
    })),
  });

  const pm = await db.user.create({
    data: {
      orgId: org.id,
      username: `pm-${suffix}`,
      fullName: "PM AFR",
      role: "project_manager",
      passwordHash: "x",
    },
    select: { id: true, orgId: true, fullName: true, username: true, email: true, role: true },
  });
  user = { ...pm, mustChangePassword: false };

  /*
   * Rencana pekan BERJALAN (13): dua item.
   * Rencana pekan LALU (12): satu item bertarget 20 m³ yang realisasinya baru
   * 5 m³ — itulah "komitmen belum tuntas", bahan pertama untuk mengejar.
   */
  const buatRencana = async (
    weekNumber: number,
    items: { rabNodeId: string; target: number }[],
  ) => {
    const mulai = new Date(parseDateKey(MULAI)!.getTime() + (weekNumber - 1) * 7 * 86_400_000);
    await db.weeklyPlan.create({
      data: {
        locationId: locId,
        weekNumber,
        weekStart: mulai,
        weekEnd: new Date(mulai.getTime() + 6 * 86_400_000),
        createdById: pm.id,
        items: {
          create: items.map((i, n) => ({
            rabNodeId: i.rabNodeId,
            targetVolume: i.target,
            priority: n + 1,
          })),
        },
      },
    });
  };
  await buatRencana(MINGGU_BERJALAN - 1, [{ rabNodeId: urugan.id, target: 20 }]);
  await buatRencana(MINGGU_BERJALAN, [
    { rabNodeId: pondasi.id, target: 12 },
    { rabNodeId: urugan.id, target: 8 },
  ]);

  // Realisasi 5 m³ Urugan — di bawah target pekan lalu (20).
  const lap = await db.dailyReport.create({
    data: {
      locationId: locId,
      reportDate: parseDateKey("2026-08-20")!,
      status: "dikirim",
      createdById: pm.id,
    },
    select: { id: true },
  });
  await db.dailyReportItem.create({
    data: {
      reportId: lap.id,
      rabNodeId: urugan.id,
      lineageKey: urugan.lineageKey,
      basis: "aktif",
      volumeDone: 5,
      valueDone: 5_000_000n,
    },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE weekly_plan_items, weekly_plans, daily_report_items, daily_reports, baseline_points, baselines, rab_nodes, rab_revisions, contracts, vendors, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("fakta rencana ikut ke Ask MARLIN", () => {
  it("REGRESI: ada fakta tentang yang AKAN dikerjakan, bukan hanya yang sudah", async () => {
    const p = await buildPortfolioPulse(user, [locId], PERIODE_MULAI, PERIODE_AKHIR);
    const row = p.rows.find((r) => r.locationId === locId);
    expect(row?.currentWeek).toBe(MINGGU_BERJALAN);
    expect(row?.plannedItemsThisWeek).toBe(2);
    expect(row?.plannedItemNames).toContain("Pondasi Batu Belah 1 : 5");
  });

  it("komitmen pekan lalu yang belum tuntas ikut terhitung", async () => {
    // 20 m³ dikomitmenkan, 5 m³ terealisasi → satu item belum tuntas. Inilah
    // jawaban paling langsung atas "apa yang perlu dikerjakan untuk mengejar".
    const p = await buildPortfolioPulse(user, [locId], PERIODE_MULAI, PERIODE_AKHIR);
    expect(p.rows.find((r) => r.locationId === locId)?.unfinishedLastWeek).toBe(1);
  });

  it("REGRESI: sitasinya ADA, jadi jawabannya tidak lagi 'tanpa sumber'", async () => {
    /*
     * Yang membuat balasan lama berbunyi "Saya tidak punya angka bersumber"
     * bukan pagar yang terlalu ketat, melainkan tidak adanya sumber untuk
     * dipagari. Sitasi inilah yang hilang.
     */
    const p = await buildPortfolioPulse(user, [locId], PERIODE_MULAI, PERIODE_AKHIR);
    const ref = p.sourceRefs.find((r) => r.id.endsWith(":rencana"));
    expect(ref, "sitasi rencana wajib ada").toBeTruthy();
    expect(ref?.label).toContain(`minggu ${MINGGU_BERJALAN}`);
    expect(ref?.value).toContain("2 item direncanakan");
    expect(ref?.value).toContain("1 komitmen pekan lalu belum tuntas");
  });

  it("REGRESI: faktanya BOLEH DIKLAIM, bukan cuma tampil di drawer", async () => {
    /*
     * Pagar klaim menolak angka yang tidak ada di daftar "FAKTA YANG BOLEH
     * DIKLAIM". Menaruh rencana di sitasi saja tanpa mendaftarkannya sebagai
     * fakta akan mengulang cacat yang sama dari sisi lain: angkanya terlihat,
     * tetapi setiap kalimat yang menyebutnya ditolak validator, keyakinannya
     * jatuh, dan penanya tetap menerima "tidak punya angka bersumber".
     */
    const { faktaResmi } = await import("@/lib/ai-hub/schemas");
    const { buildPulsePayload } = await import("@/lib/ai-hub/prompt");
    const p = await buildPortfolioPulse(user, [locId], PERIODE_MULAI, PERIODE_AKHIR);
    const metrik = [...faktaResmi(p).values()]
      .filter((f) => f.locationId === locId)
      .map((f) => f.metric);
    expect(metrik).toContain("rencana_item_pekan_ini");
    expect(metrik).toContain("komitmen_belum_tuntas");
    // Dan benar-benar sampai ke prompt, bukan berhenti di struktur data.
    expect(buildPulsePayload(p)).toContain("rencana_item_pekan_ini=2");
  });

  it("rencana yang BELUM disusun tetap bersitasi, dengan kalimatnya sendiri", async () => {
    /*
     * Justru keadaan ini yang paling perlu bersumber: "belum disusun" adalah
     * jawaban yang benar dan bisa ditindaklanjuti, sedangkan menolak menjawab
     * membuat penanya mengira MARLIN buta.
     */
    await db.weeklyPlan.deleteMany({ where: { locationId: locId, weekNumber: MINGGU_BERJALAN } });
    const p = await buildPortfolioPulse(user, [locId], PERIODE_MULAI, PERIODE_AKHIR);
    const ref = p.sourceRefs.find((r) => r.id.endsWith(":rencana"));
    expect(ref?.value).toContain("belum disusun");
    expect(p.rows.find((r) => r.locationId === locId)?.plannedItemsThisWeek).toBe(0);
  });
});
