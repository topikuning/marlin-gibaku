// SNAPSHOT LAPORAN LENGKAP LOKASI — angkanya harus SAMA dengan calculation layer.
//
// Permintaan user 2026-09-19: "kalau aku minta kronologi atau kesimpulan atas
// satu lokasi, kamu akan tarik semua data dari database atas lokasi itu, lalu
// buatkan laporan lengkap". Laporan itu dibaca PPK lewat WhatsApp, PDF, dan
// layar — tiga permukaan, satu snapshot. Kalau snapshot-nya menghitung sendiri,
// ketiganya ikut salah bersama-sama dan tidak ada yang bisa membandingkan.
//
// Yang dikunci di sini:
//   1. progres snapshot === `getLocationProgress` (tanpa toleransi);
//   2. deret mingguan & kurva konsisten dengan baseline dan dengan angka utama;
//   3. `asOf` benar-benar memotong — laporan bertanggal sesudahnya TIDAK ikut,
//      termasuk pada garis realisasi kurva-S (cacat yang mudah lolos: deret
//      `getScurveSeries` dihitung sampai hari ini);
//   4. kelengkapan mengikuti aturan `sudahLapor` + DECISIONS 340;
//   5. `perhatian` = rule EWS kanonik yang memang terpicu, tidak lebih.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { buatLaporanLokasiLengkap } = await import("@/lib/lokasi-lengkap/snapshot");
const { getLocationProgress } = await import("@/lib/progress");
const { parseDateKey } = await import("@/lib/format");
import type { LaporanLokasiLengkap } from "@/lib/lokasi-lengkap/jenis";

const suffix = `lkl${Date.now().toString(36)}`;

/** Posisi laporan: tengah malam UTC supaya cast `::date` di SQL sepakat. */
const ASOF = new Date("2026-09-18T00:00:00.000Z");
const MULAI = new Date("2026-08-01T00:00:00.000Z");
const AKHIR = new Date("2026-11-28T00:00:00.000Z");

/** Rencana kumulatif 18 minggu; minggu ke-8 = 40% (dipakai menghitung deviasi). */
const KURVA = [2, 6, 11, 17, 24, 31, 36, 40, 46, 52, 58, 64, 70, 76, 82, 88, 94, 100];

let orgId = "";
let packageId = "";
let locationId = "";
let userId = "";
/** lineageKey item, dipakai menyusun laporan harian. */
let itemPersiapan = { id: "", lineage: "" };
let itemTanah = { id: "", lineage: "" };

const tgl = (key: string) => parseDateKey(key)!;

async function buatLaporan(
  key: string,
  status: "draft" | "dikirim" | "perlu_koreksi" | "disetujui" | "final",
  isi?: { item: { id: string; lineage: string }; volume: number; nilai: bigint },
  noActivity = false,
) {
  const r = await db.dailyReport.create({
    data: { locationId, reportDate: tgl(key), status, noActivity, createdById: userId },
    select: { id: true },
  });
  if (isi) {
    await db.dailyReportItem.create({
      data: {
        reportId: r.id,
        rabNodeId: isi.item.id,
        lineageKey: isi.item.lineage,
        basis: "aktif",
        volumeDone: isi.volume,
        valueDone: isi.nilai,
      },
    });
  }
  return r.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  orgId = org.id;
  userId = (
    await db.user.create({
      data: { orgId, username: `u-${suffix}`, fullName: "Tester Uji", passwordHash: "x", role: "super_admin" },
      select: { id: true },
    })
  ).id;
  const vendor = await db.vendor.create({ data: { orgId, name: `PT Uji ${suffix}` }, select: { id: true } });
  const pkg = await db.package.create({
    data: { orgId, name: `Paket Uji ${suffix}`, packageNumber: `PKT-${suffix}`, stage: "pelaksanaan" },
    select: { id: true },
  });
  packageId = pkg.id;
  await db.contract.create({
    data: {
      packageId,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      workTitle: "Pembangunan Kampung Nelayan Merah Putih Uji",
      contractValue: 4_000_000_000n,
      signedDate: new Date("2026-07-25T00:00:00.000Z"),
      durationDays: 120,
      startDate: MULAI,
      endDate: AKHIR,
      weekMode: "senin_minggu",
      ppkName: "Ir. PPK Uji",
    },
  });
  const loc = await db.location.create({
    data: {
      packageId,
      name: `Kemadang ${suffix}`,
      slug: `kemadang-${suffix}`,
      village: "Kemadang",
      district: "Tanjungsari",
      regency: "Gunungkidul",
      province: "DI Yogyakarta",
      status: "berjalan",
      isActive: true,
      pelaksanaName: "Budi Pelaksana",
      pelaksanaTitle: "Site Manager",
    },
    select: { id: true },
  });
  locationId = loc.id;

  /* RAB aktif: dua kategori, satu item masing-masing. Total 400 juta. */
  const rab = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 400_000_000n },
    select: { id: true },
  });
  const katI = await db.rabNode.create({
    data: { revisionId: rab.id, kind: "kategori", code: "I", name: "Pekerjaan Persiapan", lineageKey: "I", sortOrder: 1, amount: 100_000_000n },
    select: { id: true },
  });
  itemPersiapan = {
    lineage: "I#1",
    id: (
      await db.rabNode.create({
        data: { revisionId: rab.id, parentId: katI.id, kind: "item", code: "I.1", name: "Mobilisasi", lineageKey: "I#1", sortOrder: 2, unit: "ls", volume: 10, unitPrice: 10_000_000, amount: 100_000_000n },
        select: { id: true },
      })
    ).id,
  };
  const katII = await db.rabNode.create({
    data: { revisionId: rab.id, kind: "kategori", code: "II", name: "Pekerjaan Tanah", lineageKey: "II", sortOrder: 3, amount: 300_000_000n },
    select: { id: true },
  });
  itemTanah = {
    lineage: "II#1",
    id: (
      await db.rabNode.create({
        data: { revisionId: rab.id, parentId: katII.id, kind: "item", code: "II.1", name: "Galian tanah", lineageKey: "II#1", sortOrder: 4, unit: "m3", volume: 100, unitPrice: 3_000_000, amount: 300_000_000n },
        select: { id: true },
      })
    ).id,
  };

  /* Baseline aktif 18 minggu. */
  const baseline = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "auto", status: "aktif", contractDays: 120, rabRevisionId: rab.id },
    select: { id: true },
  });
  await db.baselinePoint.createMany({
    data: KURVA.map((p, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: p })),
  });

  /*
   * Laporan harian. Yang berlaporan (aturan `sudahLapor`: apa pun selain draf)
   * ada SEMBILAN hari; draf tidak dihitung, dan laporan bertanggal SESUDAH
   * `asOf` tidak boleh ikut ke mana pun.
   */
  await buatLaporan("2026-08-03", "final", { item: itemPersiapan, volume: 5, nilai: 50_000_000n });
  await buatLaporan("2026-08-04", "final");
  await buatLaporan("2026-08-05", "final");
  await buatLaporan("2026-08-06", "final");
  await buatLaporan("2026-08-07", "final");
  await buatLaporan("2026-08-10", "perlu_koreksi");
  await buatLaporan("2026-08-11", "final", undefined, true);
  await buatLaporan("2026-09-16", "dikirim", { item: itemTanah, volume: 20, nilai: 60_000_000n });
  await buatLaporan("2026-09-17", "dikirim");
  await buatLaporan("2026-09-15", "draft");
  // SESUDAH asOf – kalau ikut terhitung, realisasi melonjak ke 40%.
  await buatLaporan("2026-09-20", "final", { item: itemPersiapan, volume: 5, nilai: 50_000_000n });

  /* Kendala: dua terbuka (satu lewat tenggat, dibuka lebih dulu) + satu selesai. */
  await db.issue.create({
    data: {
      locationId,
      title: "Material batu belah terlambat",
      severity: "tinggi",
      status: "ditangani",
      source: "manual",
      createdAt: new Date("2026-08-05T02:00:00.000Z"),
      dueDate: tgl("2026-09-01"),
      picName: "Budi Pelaksana",
    },
  });
  await db.issue.create({
    data: {
      locationId,
      title: "Akses jalan tergenang saat pasang",
      severity: "sedang",
      status: "terbuka",
      source: "laporan_harian",
      createdAt: new Date("2026-09-10T02:00:00.000Z"),
    },
  });
  await db.issue.create({
    data: {
      locationId,
      title: "Pembersihan lahan tertunda",
      severity: "rendah",
      status: "selesai",
      source: "manual",
      createdAt: new Date("2026-08-02T02:00:00.000Z"),
      closedAt: new Date("2026-08-08T02:00:00.000Z"),
    },
  });

  /* Kegiatan lapangan final. */
  await db.fieldActivityKind.upsert({
    where: { key: `rapat-${suffix}` },
    create: { key: `rapat-${suffix}`, label: "Rapat koordinasi", sortOrder: 1 },
    update: {},
  });
  await db.fieldActivity.create({
    data: {
      locationId,
      activityDate: tgl("2026-09-05"),
      type: `rapat-${suffix}`,
      title: "Percepatan pondasi",
      status: "final",
      createdById: userId,
    },
  });

  /* Temuan: satu kritis terbuka & lewat tenggat, satu selesai. */
  await db.finding.create({
    data: {
      locationId,
      category: "mutu",
      severity: "kritis",
      title: "Mutu beton K-225 belum ada hasil uji",
      findingDate: tgl("2026-09-08"),
      dueDate: tgl("2026-09-10"),
      status: "ditindaklanjuti",
      assignedName: "Budi Pelaksana",
      raisedById: userId,
    },
  });
  await db.finding.create({
    data: {
      locationId,
      category: "k3",
      severity: "sedang",
      title: "Rambu K3 belum terpasang",
      findingDate: tgl("2026-08-20"),
      status: "selesai",
      raisedById: userId,
    },
  });
  await db.inspection.create({
    data: {
      locationId,
      inspectorId: userId,
      inspectionDate: tgl("2026-09-10"),
      title: "Inspeksi mutu beton",
      status: "final",
    },
  });

  /* Administrasi: milestone terlambat, dokumen kedaluwarsa, surat perlu balas. */
  await db.adminMilestone.createMany({
    data: [
      { packageId, templateKey: `m1-${suffix}`, name: "Terbit SPMK", phase: "mulai_kerja", sortOrder: 1, status: "selesai" },
      { packageId, templateKey: `m2-${suffix}`, name: "PCM", phase: "mulai_kerja", sortOrder: 2, status: "belum_dimulai", dueDate: tgl("2026-08-15") },
      { packageId, templateKey: `m3-${suffix}`, name: "Adendum", phase: "adendum", sortOrder: 3, status: "tidak_berlaku", dueDate: tgl("2026-08-15") },
    ],
  });
  await db.document.createMany({
    data: [
      {
        orgId, packageId, phase: "kontrak", type: "jaminan", title: "Jaminan Pelaksanaan",
        r2Key: `uji/${suffix}-1.pdf`, fileName: "jaminan.pdf", mimeType: "application/pdf", bytes: 100, sha256: `a${suffix}`,
        uploadedById: userId, expiryDate: tgl("2026-09-01"),
      },
      {
        orgId, packageId, phase: "kontrak", type: "kontrak", title: "Kontrak Induk",
        r2Key: `uji/${suffix}-2.pdf`, fileName: "kontrak.pdf", mimeType: "application/pdf", bytes: 100, sha256: `b${suffix}`,
        uploadedById: userId, expiryDate: tgl("2026-10-01"),
      },
    ],
  });
  await db.letter.create({
    data: {
      orgId, packageId, agendaNo: 1, agendaYear: 2026, direction: "masuk", party: "ppk",
      handledDate: tgl("2026-09-11"), subject: "Permintaan hasil uji beton",
      needsReply: true, status: "perlu_jawaban", replyDueDate: tgl("2026-09-01"), createdById: userId,
    },
  });

  /* Rencana minggu berikutnya (minggu ke-9). */
  const plan = await db.weeklyPlan.create({
    data: { locationId, weekNumber: 9, weekStart: tgl("2026-09-21"), weekEnd: tgl("2026-09-27"), note: "Fokus pondasi blok B", createdById: userId },
    select: { id: true },
  });
  await db.weeklyPlanItem.create({
    data: { weeklyPlanId: plan.id, rabNodeId: itemTanah.id, targetVolume: 42.5 },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE TABLE organizations CASCADE`);
  await db.$executeRawUnsafe(`DELETE FROM field_activity_kinds WHERE key = '${`rapat-${suffix}`}'`);
});

describe("buatLaporanLokasiLengkap", () => {
  let l: LaporanLokasiLengkap;

  beforeAll(async () => {
    l = (await buatLaporanLokasiLengkap(locationId, { asOf: ASOF }))!;
  });

  it("lokasi yang tidak ada → null, bukan laporan kosong", async () => {
    expect(await buatLaporanLokasiLengkap("00000000-0000-4000-8000-000000000999", { asOf: ASOF })).toBeNull();
  });

  it("identitas & posisi data dari kontrak yang sebenarnya", () => {
    expect(l.asOfKey).toBe("2026-09-18");
    expect(l.identitas.nama).toBe(`Kemadang ${suffix}`);
    expect(l.identitas.kabupaten).toBe("Gunungkidul");
    expect(l.identitas.kontrak?.nomor).toBe(`SPK-${suffix}`);
    expect(l.identitas.kontrak?.weekMode).toBe("senin_minggu");
    expect(l.identitas.pelaksana?.nama).toBe("Budi Pelaksana");
  });

  it("progres IDENTIK dengan calculation layer (bukan dihitung ulang)", async () => {
    const p = await getLocationProgress(locationId, { asOf: ASOF });
    expect(l.progres.realisasiPct).toBe(p.realizedPct);
    expect(l.progres.rencanaPct).toBe(p.planPct);
    expect(l.progres.deviasiPp).toBe(p.deviationPct);
    expect(l.progres.nilaiRab).toBe(p.grandTotal.toString());
    expect(l.progres.nilaiTerpasang).toBe(p.realizedValue.toString());
    // 110 juta dari 400 juta = 27,5% terhadap rencana 40% → deviasi -12,5 pp.
    expect(l.progres.realisasiPct).toBeCloseTo(27.5, 6);
    expect(l.progres.rencanaPct).toBeCloseTo(40, 6);
    expect(l.progres.deviasiPp).toBeCloseTo(-12.5, 6);
    expect(l.progres.punyaRab).toBe(true);
    expect(l.progres.punyaKurva).toBe(true);
  });

  it("asOf MEMOTONG: laporan bertanggal 2026-09-20 tidak ikut ke mana pun", async () => {
    const tanpaBatas = await getLocationProgress(locationId);
    // Tanpa asOf angkanya memang lebih besar – itu yang membuktikan saringannya bekerja.
    expect(tanpaBatas.realizedPct).toBeGreaterThan(l.progres.realisasiPct);
    // Termasuk pada GARIS REALISASI kurva-S: deret `getScurveSeries` dihitung
    // sampai hari ini, jadi titik minggu ke-8 mudah bocor kalau dipakai mentah.
    expect(l.kurva!.actualPct[7]).toBeCloseTo(l.progres.realisasiPct, 6);
  });

  it("minggu kontrak dari tanggal SPMK, bukan weekNumber yang di-clamp baseline", () => {
    // 2026-08-01 (Sabtu) s.d. 2026-09-18 pada mode senin_minggu = minggu ke-8.
    expect(l.progres.mingguKe).toBe(8);
    expect(l.progres.totalMinggu).toBe(18);
    expect(l.mingguan).toHaveLength(8);
    expect(l.mingguan[7].minggu).toBe(8);
  });

  it("mingguan konsisten dengan baseline dan dengan angka utama", () => {
    for (const m of l.mingguan) {
      expect(m.rencanaPct).toBeCloseTo(KURVA[m.minggu - 1], 6);
      expect(m.realisasiPct).not.toBeNull();
      expect(m.deviasiPp).toBeCloseTo(m.realisasiPct! - m.rencanaPct!, 6);
    }
    // Minggu berjalan = posisi laporan ini.
    expect(l.mingguan[7].realisasiPct).toBeCloseTo(l.progres.realisasiPct, 6);
    // Kenaikan pada minggu yang ada laporannya, datar pada minggu kosong.
    expect(l.mingguan[0].realisasiPct).toBeCloseTo(0, 6);
    expect(l.mingguan[1].realisasiPct).toBeCloseTo(12.5, 6);
    expect(l.mingguan[1].kenaikanPp).toBeCloseTo(12.5, 6);
    expect(l.mingguan[2].kenaikanPp).toBeCloseTo(0, 6);
    // Laporan terhitung: minggu 2 (3–9 Agu) berisi lima laporan final.
    expect(l.mingguan[1].laporanTerhitung).toBe(5);
  });

  it("kurva-S: rencana penuh 18 minggu, realisasi hanya sampai minggu berjalan", () => {
    expect(l.kurva!.totalMinggu).toBe(18);
    expect(l.kurva!.mingguBerjalan).toBe(8);
    expect(l.kurva!.planPct).toEqual(KURVA);
    expect(l.kurva!.actualPct.slice(0, 8).every((v) => v != null)).toBe(true);
    // Minggu yang belum tiba = null, BUKAN 0.
    expect(l.kurva!.actualPct.slice(8).every((v) => v === null)).toBe(true);
  });

  it("kategori RAB memakai formula kanonik; Σ (realisasi × bobot) = realisasi lokasi", () => {
    expect(l.kategori.map((k) => k.lineageKey)).toEqual(["I", "II"]);
    // Persiapan: 5 dari 10 = 50%. Tanah: 20 dari 100 = 20%.
    expect(l.kategori[0].realisasiPct).toBeCloseTo(50, 6);
    expect(l.kategori[1].realisasiPct).toBeCloseTo(20, 6);
    expect(l.kategori[0].bobotPct).toBeCloseTo(25, 6);
    expect(l.kategori[1].bobotPct).toBeCloseTo(75, 6);
    const gabungan = l.kategori.reduce((a, k) => a + (k.realisasiPct * k.bobotPct) / 100, 0);
    expect(gabungan).toBeCloseTo(l.progres.realisasiPct, 6);
  });

  it("kelengkapan mengikuti aturan sudahLapor + DECISIONS 340 (draf tidak dihitung melapor)", () => {
    const k = l.kelengkapan!;
    // 1 Agu s.d. 18 Sep = 49 hari dalam masa kontrak yang sudah lewat.
    expect(k.hariDiharapkan).toBe(49);
    expect(k.final).toBe(6);
    expect(k.dikirim).toBe(2);
    expect(k.draft).toBe(1);
    expect(k.perluKoreksi).toBe(1);
    expect(k.disetujui).toBe(0);
    expect(k.hariNihil).toBe(1);
    // Sembilan hari berlaporan non-draf → 49 − 9 = 40.
    expect(k.hariTanpaLaporan).toBe(40);
    expect(k.laporanTerakhirKey).toBe("2026-09-17");
    expect(k.hariSejakLaporanTerakhir).toBe(1);
  });

  it("kendala: terbuka terlama dulu, umur & lewat tenggat dihitung terhadap asOf", () => {
    expect(l.kendala.ringkas.terbuka).toBe(2);
    expect(l.kendala.ringkas.lewatTenggat).toBe(1);
    expect(l.kendala.ringkas.selesai).toBe(1);
    expect(l.kendala.terbuka.map((k) => k.dibukaKey)).toEqual(["2026-08-05", "2026-09-10"]);
    expect(l.kendala.terbuka[0].umurHari).toBe(44);
    expect(l.kendala.terbuka[0].lewatTenggat).toBe(true);
    expect(l.kendala.terbuka[0].pic).toBe("Budi Pelaksana");
    expect(l.kendala.terbuka[1].lewatTenggat).toBe(false);
    expect(l.kendala.ringkas.tertuaHari).toBe(44);
    // Yang selesai: umurnya dihitung sampai ditutup, bukan sampai hari ini.
    expect(l.kendala.selesaiTerbaru[0].umurHari).toBe(6);
  });

  it("kronologi dikelompokkan per bulan, terbaru dulu", () => {
    expect(l.kronologi.babak.length).toBeGreaterThan(0);
    const kunci = l.kronologi.babak.map((b) => b.bulanKey);
    expect([...kunci].sort((a, b) => b.localeCompare(a))).toEqual(kunci);
    expect(l.kronologi.babak[0].label).toMatch(/^September 2026$/);
  });

  it("temuan: kategori sudah berupa LABEL, bukan enum mentah", () => {
    expect(l.temuan.ringkas.total).toBe(2);
    expect(l.temuan.ringkas.terbuka).toBe(1);
    expect(l.temuan.ringkas.kritis).toBe(1);
    expect(l.temuan.ringkas.lewatTenggat).toBe(1);
    expect(l.temuan.ringkas.inspeksi).toBe(1);
    expect(l.temuan.ringkas.inspeksiTerakhirKey).toBe("2026-09-10");
    expect(l.temuan.terbuka[0].kategori).toBe("Mutu");
    expect(l.temuan.terbuka[0].statusLabel).toBe("Ditindaklanjuti");
    expect(l.temuan.terbuka[0].penanggungJawab).toBe("Budi Pelaksana");
  });

  it("administrasi: milestone/dokumen/surat, dengan keterbatasan yang disebut", () => {
    const a = l.administrasi;
    expect(a.milestone.find((m) => m.fase === "mulai_kerja")).toMatchObject({ total: 2, selesai: 1, terlambat: 1 });
    // `tidak_berlaku` yang lewat tenggat TIDAK dihitung terlambat.
    expect(a.milestone.find((m) => m.fase === "adendum")?.terlambat).toBe(0);
    expect(a.dokumen.total).toBe(2);
    expect(a.dokumen.kedaluwarsa).toBe(1);
    expect(a.dokumen.segeraKedaluwarsa).toBe(1);
    expect(a.surat.masuk).toBe(1);
    expect(a.surat.perluBalas).toBe(1);
    expect(a.surat.lewatTenggatBalas).toBe(1);
    expect(l.limitations.some((x) => x.includes("tingkat PAKET"))).toBe(true);
  });

  it("perhatian = rule EWS kanonik yang memang terpicu, tidak lebih", () => {
    const rule = l.perhatian.map((w) => w.ruleId);
    expect(rule).toContain("deviasi_kritis");
    expect(rule).toContain("temuan_kritis");
    expect(rule).toContain("temuan_lewat_tenggat");
    expect(rule).toContain("kendala_lewat_tenggat");
    expect(rule).toContain("dok_kadaluarsa");
    expect(rule).toContain("dok_segera_kadaluarsa");
    expect(rule).toContain("milestone_terlambat");
    // TIDAK terpicu: laporan terakhir baru kemarin, koreksi menggantung cuma 1.
    expect(rule).not.toContain("tanpa_laporan_tinggi");
    expect(rule).not.toContain("belum_pernah_lapor");
    expect(rule).not.toContain("laporan_menggantung");
    // Urutan: yang kritis lebih dulu.
    expect(l.perhatian[0].severity).toBe("kritis");
  });

  it("rencana minggu depan = minggu berjalan + 1", () => {
    expect(l.rencanaMingguDepan?.mingguKe).toBe(9);
    expect(l.rencanaMingguDepan?.item[0]).toMatchObject({ nama: "Galian tanah", unit: "m3", targetVolume: 42.5 });
  });

  it("kesimpulan deterministik menyebut nama lokasi dan angka yang sama", () => {
    expect(l.kesimpulan.length).toBeGreaterThanOrEqual(2);
    expect(l.kesimpulan[0]).toContain(`Kemadang ${suffix}`);
    expect(l.kesimpulan[0]).toContain("minggu ke-8 dari 18");
    expect(l.kesimpulan[0]).toContain("27,5%");
    expect(l.kesimpulan[0]).toContain("40,0%");
    expect(l.kesimpulan[0]).toContain("-12,5 pp");
    expect(l.kesimpulan[1]).toContain("2 kendala terbuka");
    expect(l.kesimpulan[1]).toContain("40 hari tanpa laporan");
  });

  it("tanpa asOf: posisi TERKINI, dan laporan 2026-09-20 ikut terhitung", async () => {
    const kini = (await buatLaporanLokasiLengkap(locationId))!;
    const p = await getLocationProgress(locationId);
    expect(kini.progres.realisasiPct).toBe(p.realizedPct);
    expect(kini.progres.realisasiPct).toBeGreaterThan(l.progres.realisasiPct);
  });

  it("sumber data ditulis per bagian, bukan satu rujukan gelondongan", () => {
    const id = l.sumber.map((s) => s.id);
    expect(id.some((x) => x.endsWith(":progress"))).toBe(true);
    expect(id.some((x) => x.endsWith(":laporan"))).toBe(true);
    expect(id.some((x) => x.endsWith(":kendala"))).toBe(true);
    expect(id.some((x) => x.endsWith(":administrasi"))).toBe(true);
  });
});
