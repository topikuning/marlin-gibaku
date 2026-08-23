// PAPARAN MINGGUAN KKP — SNAPSHOT & GENERATE (DECISIONS 416).
//
// Yang dijaga adalah kebenaran ANGKA dan pagar aksesnya:
//  - agregat paket TERTIMBANG nilai RAB, bukan rata-rata sederhana;
//  - minggu lampau dihitung `asOf` akhir minggu itu — laporan sesudahnya
//    tidak ikut;
//  - capaian minggu = realisasi akhir minggu − akhir minggu sebelumnya;
//  - lokasi tanpa baseline TIDAK dianggap target 0;
//  - minggu depan / tanpa SPMK / akses parsial DITOLAK;
//  - generate → draft v1; regenerate → v2 tanpa menimpa; AI mati → narasi
//    deterministik dengan limitation yang mengatakannya.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "marlin.uji", "x-forwarded-proto": "https" }),
}));

const { db } = await import("@/lib/db");
const { muatPaketPaparan, PaparanAksesError } = await import("@/lib/paparan/akses");
const { buatSnapshotPaparan, PaparanSnapshotError } = await import("@/lib/paparan/snapshot");
const { generatePaparan } = await import("@/lib/paparan/generate");
const { parsePaparanContent } = await import("@/lib/paparan/susun");
const { getOrCreateDraft, upsertItem, submitReport, approveReport } = await import(
  "@/lib/daily-report/service"
);
import type { SessionUser } from "@/lib/auth/session";

const suffix = `pp${Date.now().toString(36)}`;
/** SPMK Senin 1 Juni 2026; "sekarang" = 22 Agustus 2026 (minggu ke-12 berjalan). */
const SPMK = new Date("2026-06-01T00:00:00.000Z");
const NOW = new Date("2026-08-22T05:00:00.000Z");

let orgId = "";
let orgLainId = "";
let packageId = "";
let mandorId = "";
let pmId = "";
// Lokasi A: RAB 12 M (berkurva) · Lokasi B: RAB 3 M (berkurva) · Lokasi C: tanpa RAB/baseline.
let locA = "";
let locB = "";
let locC = "";
let itemA = "";
let itemB = "";

const admin = (): SessionUser => ({
  id: pmId,
  orgId,
  fullName: "Admin",
  username: "admin",
  email: null,
  role: "super_admin",
  mustChangePassword: false,
});

async function lokasi(nama: string, slug: string) {
  return (
    await db.location.create({
      data: {
        packageId,
        name: nama,
        slug: `${slug}-${suffix}`,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
        status: "berjalan",
        isActive: true,
      },
      select: { id: true },
    })
  ).id;
}

/** RAB satu item + baseline linier 20 minggu — kurva dari jadwal verbatim tidak dibutuhkan
 *  di sini; yang diuji agregasi, bukan bentuk S. */
async function pasangRabDanBaseline(locationId: string, total: bigint) {
  const rev = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo: 1,
      source: "hps_awal",
      status: "aktif",
      totalValue: total,
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
    },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "kategori",
      code: "I",
      name: "PEKERJAAN",
      amount: total,
      lineageKey: "I",
      sortOrder: 1,
    },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      parentId: kat.id,
      kind: "item",
      code: "1",
      name: "Pasangan batu",
      volume: 100,
      unit: "m3",
      unitPrice: Number(total / 100n),
      amount: total,
      lineageKey: "I#1",
      sortOrder: 2,
    },
    select: { id: true },
  });
  await db.baseline.create({
    data: {
      locationId,
      baselineNo: 1,
      source: "manual",
      status: "aktif",
      rabRevisionId: rev.id,
      contractDays: 140,
      // Kurva linier 5%/minggu (kumulatif) — cukup utk menguji "rencana ikut asOf".
      points: {
        create: Array.from({ length: 20 }, (_, i) => ({ weekNumber: i + 1, plannedPct: (i + 1) * 5 })),
      },
    },
  });
  return item.id;
}

/** Laporan harian TERHITUNG (disetujui) satu hari dengan volume tertentu. */
async function laporan(locationId: string, rabNodeId: string, dateKey: string, volume: number) {
  const lap = await getOrCreateDraft(locationId, dateKey, mandorId);
  await upsertItem(lap.id, { rabNodeId, volumeDone: volume }, mandorId);
  await submitReport(lap.id, mandorId);
  await approveReport(lap.id, pmId);
  return lap.id;
}

beforeAll(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const org = await db.organization.create({ data: { name: `Org PP ${suffix}`, slug: `opp-${suffix}` } });
  orgId = org.id;
  orgLainId = (
    await db.organization.create({ data: { name: `Org Lain ${suffix}`, slug: `opl-${suffix}` } })
  ).id;
  mandorId = (
    await db.user.create({
      data: { orgId, username: `mandor-${suffix}`, fullName: "Mandor", passwordHash: "x", role: "site_manager" },
      select: { id: true },
    })
  ).id;
  pmId = (
    await db.user.create({
      data: { orgId, username: `pm-${suffix}`, fullName: "PM", passwordHash: "x", role: "project_manager" },
      select: { id: true },
    })
  ).id;

  const vendor = await db.vendor.create({ data: { orgId, name: `PT PP ${suffix}` } });
  const pkg = await db.package.create({
    data: { orgId, name: `Paket PP ${suffix}`, stage: "pelaksanaan" },
    select: { id: true },
  });
  packageId = pkg.id;
  await db.contract.create({
    data: {
      packageId,
      vendorId: vendor.id,
      contractNumber: `SPK-PP-${suffix}`,
      contractValue: 15_000_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 140,
      startDate: SPMK,
      endDate: new Date("2026-10-18"),
      workTitle: "Pembangunan Uji Paparan",
    },
  });

  locA = await lokasi("Lokasi A", "pp-a");
  locB = await lokasi("Lokasi B", "pp-b");
  locC = await lokasi("Lokasi C", "pp-c"); // sengaja TANPA RAB & baseline

  itemA = await pasangRabDanBaseline(locA, 12_000_000_000n);
  itemB = await pasangRabDanBaseline(locB, 3_000_000_000n);

  /*
   * Minggu ke-1: A 4 m³ (4%), B 20 m³ (20%).
   * Minggu ke-2: A +6 (kumulatif 10%), B +30 (kumulatif 50%).
   * Minggu ke-3 (SESUDAH minggu target): A +50 — TIDAK boleh ikut minggu 2.
   */
  await laporan(locA, itemA, "2026-06-03", 4);
  await laporan(locB, itemB, "2026-06-03", 20);
  await laporan(locA, itemA, "2026-06-10", 6);
  await laporan(locB, itemB, "2026-06-10", 30);
  await laporan(locA, itemA, "2026-06-17", 50);
});

afterAll(async () => {
  vi.useRealTimers();
  await db.$disconnect();
});

describe("akses paket", () => {
  it("super admin / PD (lintas lokasi) boleh, dan seluruh lokasi aktif termuat", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    expect(pkg.locations).toHaveLength(3);
  });

  it("user dengan akses SEBAGIAN lokasi ditolak – paparan parsial tidak boleh menyamar lengkap", async () => {
    const sm: SessionUser = { ...admin(), id: mandorId, role: "site_manager" };
    await db.locationAssignment.create({ data: { userId: mandorId, locationId: locA } });
    await expect(muatPaketPaparan(sm, packageId)).rejects.toThrow(PaparanAksesError);
  });

  it("paket organisasi lain ditolak dengan pesan generik yang sama", async () => {
    const asing: SessionUser = { ...admin(), orgId: orgLainId };
    await expect(muatPaketPaparan(asing, packageId)).rejects.toThrow(/tidak ditemukan/i);
  });

  it("paket tanpa SPMK ditolak", async () => {
    const vendor = await db.vendor.findFirstOrThrow({ where: { orgId }, select: { id: true } });
    const p2 = await db.package.create({
      data: { orgId, name: `Paket TanpaSpmk ${suffix}`, stage: "kontrak" },
      select: { id: true },
    });
    await db.contract.create({
      data: {
        packageId: p2.id,
        vendorId: vendor.id,
        contractNumber: `SPK-NS-${suffix}`,
        contractValue: 1_000_000_000n,
        signedDate: new Date("2026-05-25"),
        durationDays: 90,
      },
    });
    await db.location.create({
      data: {
        packageId: p2.id,
        name: "Lok NS",
        slug: `ns-${suffix}`,
        village: "D",
        regency: "K",
        province: "P",
        status: "persiapan",
        isActive: true,
      },
    });
    await expect(muatPaketPaparan(admin(), p2.id)).rejects.toThrow(/SPMK/);
  });
});

/**
 * LINGKUP LOKASI (DECISIONS 420). Yang diuji bukan cuma "berhasil", melainkan
 * bahwa deck lokasi memuat SATU lokasi dan angkanya angka lokasi itu — deck
 * lokasi yang diam-diam membawa agregat paket adalah kebohongan yang paling
 * mudah lolos karena bentuknya normal.
 */
/**
 * SIMULASI yang diminta user 2026-08-23: *"padahal rencana mingguan sudah
 * dibuat, apa maksudnya?"* — deck menulis "Rencana minggu berikutnya belum
 * tersedia di MARLIN" walau rencananya ada.
 *
 * Uji ini membuktikan MINGGU MANA yang sebenarnya dicari deck, supaya
 * jawabannya bukan tebakan.
 */
describe("rencana mingguan: minggu mana yang dibaca deck", () => {
  it("rencana minggu N+1 TERBACA oleh deck minggu N", async () => {
    const node = await db.rabNode.findFirstOrThrow({
      where: { revision: { locationId: locA, status: "aktif" }, kind: "item" },
      select: { id: true },
    });
    const plan = await db.weeklyPlan.create({
      data: {
        locationId: locA,
        weekNumber: 3,
        weekStart: new Date("2026-06-15"),
        weekEnd: new Date("2026-06-21"),
        createdById: mandorId,
      },
      select: { id: true },
    });
    await db.weeklyPlanItem.create({
      data: { weeklyPlanId: plan.id, rabNodeId: node.id, targetVolume: 5 },
    });

    const pkg = await muatPaketPaparan(admin(), packageId);
    const deckM2 = await buatSnapshotPaparan(pkg, 2, NOW);
    expect(deckM2.rencanaMingguDepan, "deck minggu 2 harus membaca rencana minggu 3").not.toBeNull();
    expect(deckM2.limitations.some((l) => l.includes("Rencana minggu"))).toBe(false);
  });

  it("rencana minggu N SAJA: deck minggu N mengaku tidak punya rencana", async () => {
    /*
     * Inilah keadaan yang dilaporkan user. Rencana ADA — untuk minggu yang
     * sedang dipaparkan — tetapi deck hanya mencari minggu BERIKUTNYA, lalu
     * menulis kalimat yang terbaca seperti "tidak ada rencana sama sekali".
     */
    const pkg = await muatPaketPaparan(admin(), packageId);
    const deckM3 = await buatSnapshotPaparan(pkg, 3, NOW);
    expect(deckM3.rencanaMingguDepan).toBeNull();
    /*
     * Kalimatnya WAJIB menyebut minggu mana yang kosong DAN mengakui rencana
     * minggu yang dipaparkan memang ada. "Rencana minggu berikutnya belum
     * tersedia" saja terbaca sebagai "tidak ada rencana sama sekali", dan itu
     * keluhan yang memicu perbaikan ini.
     */
    const baris = deckM3.limitations.find((l) => l.includes("Rencana minggu"));
    expect(baris).toContain("minggu ke-4 belum diisi");
    expect(baris).toContain("rencana minggu ke-3");
  });

  it("tidak ada rencana sama sekali: kalimatnya tidak mengarang rencana minggu ini", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const deckM1 = await buatSnapshotPaparan(pkg, 1, NOW);
    const baris = deckM1.limitations.find((l) => l.includes("Rencana minggu"));
    expect(baris).toBe("Rencana minggu ke-2 belum diisi di MARLIN.");
  });
});

describe("lingkup lokasi", () => {
  it("hanya lokasi itu yang termuat, dan lingkupnya tercatat", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId, locA);
    expect(pkg.locations).toHaveLength(1);
    expect(pkg.locations[0].id).toBe(locA);
    expect(pkg.lingkup).toEqual({ jenis: "lokasi", locationId: locA, nama: pkg.locations[0].name });
    const s = await buatSnapshotPaparan(pkg, 2, NOW);
    expect(s.lingkup).toEqual(pkg.lingkup);
    expect(s.progres.lokasi).toHaveLength(1);
    // Lokasi A sendirian = 10%, BUKAN 18% (agregat paket tertimbang).
    expect(s.progres.paket.realisasiPct).toBeCloseTo(10, 5);
  });

  it("lingkup paket tetap menandai dirinya paket", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    expect(pkg.lingkup).toEqual({ jenis: "paket" });
    expect((await buatSnapshotPaparan(pkg, 2, NOW)).lingkup).toEqual({ jenis: "paket" });
  });

  it("user ber-akses SEBAGIAN boleh deck LOKASI penugasannya, tetap ditolak deck PAKET", async () => {
    const sm: SessionUser = { ...admin(), id: mandorId, role: "site_manager" };
    // Penugasan locA sudah dibuat di uji akses di atas; idempotenkan.
    await db.locationAssignment
      .create({ data: { userId: mandorId, locationId: locA } })
      .catch(() => undefined);
    const pkg = await muatPaketPaparan(sm, packageId, locA);
    expect(pkg.locations.map((l) => l.id)).toEqual([locA]);
    await expect(muatPaketPaparan(sm, packageId)).rejects.toThrow(PaparanAksesError);
  });

  it("lokasi di luar penugasan ditolak dengan pesan generik yang sama", async () => {
    const sm: SessionUser = { ...admin(), id: mandorId, role: "site_manager" };
    await expect(muatPaketPaparan(sm, packageId, locB)).rejects.toThrow(/tidak ditemukan/i);
  });

  it("lokasi milik paket LAIN ditolak, bukan diam-diam ikut dimuat", async () => {
    const lain = await db.location.findFirst({
      where: { packageId: { not: packageId } },
      select: { id: true },
    });
    if (!lain) return;
    await expect(muatPaketPaparan(admin(), packageId, lain.id)).rejects.toThrow(/tidak ditemukan/i);
  });
});

describe("snapshot minggu lampau (minggu ke-2: 8–14 Juni)", () => {
  it("agregat paket TERTIMBANG nilai RAB, bukan rata-rata sederhana", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 2, NOW);
    /*
     * Kumulatif s.d. 14 Juni: A 10% (bobot 12 M), B 50% (bobot 3 M).
     * Tertimbang = (10×12 + 50×3)/15 = 18%. Rata-rata biasa = 30% — SALAH.
     */
    expect(s.progres.paket.realisasiPct).toBeCloseTo(18, 5);
    expect(s.progres.paket.realisasiPct).not.toBeCloseTo(30, 1);
  });

  it("laporan SESUDAH akhir minggu tidak ikut (asOf, DECISIONS 357)", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 2, NOW);
    const a = s.progres.lokasi.find((l) => l.locationId === locA)!;
    // 4+6 = 10% — laporan 17 Juni (+50) TIDAK terhitung.
    expect(a.realisasiPct).toBeCloseTo(10, 5);
  });

  it("capaian minggu = akhir minggu ini − akhir minggu sebelumnya", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 2, NOW);
    const a = s.progres.lokasi.find((l) => l.locationId === locA)!;
    expect(a.realisasiSebelumPct).toBeCloseTo(4, 5);
    expect(a.kenaikanPp).toBeCloseTo(6, 5);
    // Paket: 18% − ((4×12+20×3)/15 = 7,2%) = 10,8 pp.
    expect(s.progres.paket.kenaikanPp).toBeCloseTo(10.8, 5);
  });

  it("minggu PERTAMA memakai titik awal 0", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 1, NOW);
    const a = s.progres.lokasi.find((l) => l.locationId === locA)!;
    expect(a.realisasiSebelumPct).toBe(0);
    expect(a.kenaikanPp).toBeCloseTo(4, 5);
  });

  it("lokasi tanpa baseline: target null (bukan 0) & keluar dari penyebut, tetap tampil", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 2, NOW);
    const c = s.progres.lokasi.find((l) => l.locationId === locC)!;
    expect(c.targetPct).toBeNull();
    expect(c.deviasiPp).toBeNull();
    expect(s.progres.paket.lokasiTanpaKurva).toBe(1);
    expect(s.progres.paket.lokasiDihitung).toBe(2);
    expect(s.limitations.some((l) => l.includes("kurva-S"))).toBe(true);
    // Rencana paket dihitung HANYA dari yang berkurva — C tidak menyeret target.
    expect(s.progres.paket.targetPct).toBeCloseTo(10, 5); // minggu ke-2 kurva 5%/minggu
  });

  it("kelengkapan laporan dihitung untuk SEMUA lokasi × 7 hari", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 2, NOW);
    expect(s.kelengkapan.diharapkan).toBe(21); // 3 lokasi × 7 hari
    expect(s.kelengkapan.diproses).toBe(2); // 2 laporan disetujui (10 Juni)
    expect(s.kelengkapan.lokasiTanpaLaporan).toContain("Lokasi C");
  });

  it("minggu BERJALAN diberi bendera belum genap + limitation", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 12, NOW); // 22 Agustus = minggu ke-12
    expect(s.periode.berjalan).toBe(true);
    expect(s.limitations.some((l) => l.includes("BERJALAN"))).toBe(true);
  });

  it("minggu yang BELUM terjadi ditolak", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    await expect(buatSnapshotPaparan(pkg, 13, NOW)).rejects.toThrow(PaparanSnapshotError);
    await expect(buatSnapshotPaparan(pkg, 0, NOW)).rejects.toThrow(PaparanSnapshotError);
  });

  it("status kendala minggu lampau diberi limitation status TERKINI bila ada kendala", async () => {
    await db.issue.create({
      data: { locationId: locA, title: `Lahan belum clear ${suffix}`, severity: "tinggi", status: "terbuka" },
    });
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 2, NOW);
    expect(s.kendala.terbukaSaatIni.length).toBeGreaterThan(0);
    expect(s.kendala.statusTerkini).toBe(true);
    expect(s.limitations.some((l) => l.includes("TERKINI"))).toBe(true);
  });
});

describe("generate artefak", () => {
  it("generate pertama → draft v1 dengan narasi deterministik (AI tidak dikonfigurasi) + limitation", async () => {
    const hasil = await generatePaparan(admin(), { packageId, weekNumber: 2 }, NOW);
    expect(hasil.versi).toBe(1);
    expect(hasil.narasiSumber).toBe("deterministik");
    const a = await db.aiArtifact.findUniqueOrThrow({
      where: { id: hasil.artifactId },
      select: { status: true, kind: true, packageId: true, structuredContent: true, run: { select: { runKind: true, scopeType: true, scopeIds: true } } },
    });
    expect(a.status).toBe("draft");
    expect(a.kind).toBe("paparan");
    expect(a.packageId).toBe(packageId);
    expect(a.run?.runKind).toBe("paparan");
    expect(a.run?.scopeType).toBe("package");
    expect((a.run?.scopeIds as string[]).sort()).toEqual([locA, locB, locC].sort());
    const content = parsePaparanContent(a.structuredContent);
    expect(content.weekNumber).toBe(2);
    expect(content.narasi.limitations.some((l) => l.includes("Narasi AI tidak tersedia"))).toBe(true);
  });

  it("regenerate → versi 2, versi 1 TIDAK tertimpa", async () => {
    // Di luar jendela anti double-click (90 detik) — pakai waktu maju.
    const nanti = new Date(NOW.getTime() + 10 * 60_000);
    const hasil = await generatePaparan(admin(), { packageId, weekNumber: 2 }, nanti);
    expect(hasil.versi).toBe(2);
    const semua = await db.aiArtifact.findMany({
      where: { kind: "paparan", packageId },
      select: { version: true },
      orderBy: { version: "asc" },
    });
    expect(semua.map((x) => x.version)).toEqual([1, 2]);
  });

  it("double-click dalam 90 detik → artefak yang SAMA, bukan run kedua", async () => {
    /*
     * `createdAt` diisi Prisma dari jam JS — di uji ini jam palsu, jadi jamnya
     * DIMAJUKAN eksplisit supaya jendela 90 detiknya nyata, bukan kebetulan.
     */
    const t = new Date(NOW.getTime() + 20 * 60_000);
    vi.setSystemTime(t);
    const h1 = await generatePaparan(admin(), { packageId, weekNumber: 1 }, t);
    vi.setSystemTime(new Date(t.getTime() + 5_000));
    const h2 = await generatePaparan(admin(), { packageId, weekNumber: 1 }, new Date(t.getTime() + 5_000));
    expect(h2.artifactId).toBe(h1.artifactId);
    vi.setSystemTime(NOW);
  });
});

describe("snapshot gaya Mataram (kurva, durasi, kategori)", () => {
  it("kurva paket: rencana tertimbang dari deret kanonik lokasi + jendela realisasi", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 2, NOW);
    expect(s.kurva).not.toBeNull();
    // Kedua lokasi berkurva linier 5%/minggu → gabungan tertimbangnya juga
    // 5%/minggu; minggu ke-2 = 10%.
    expect(s.kurva!.planPct[1]).toBeCloseTo(10, 5);
    // Kurva wajib berakhir 100% (properti DECISIONS 052 tetap terjaga di gabungan).
    expect(s.kurva!.planPct[s.kurva!.planPct.length - 1]).toBeCloseTo(100, 5);
    // Jendela realisasi berakhir di minggu paparan dengan angka rekap yang sama.
    const akhir = s.kurva!.jendela[s.kurva!.jendela.length - 1];
    expect(akhir.minggu).toBe(2);
    expect(akhir.realisasiPct).toBeCloseTo(s.progres.paket.realisasiPct, 5);
    expect(akhir.kenaikanPp).toBeCloseTo(10.8, 5);
  });

  it("durasi pelaksanaan dari kontrak", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 2, NOW);
    expect(s.durasi?.totalHari).toBe(140);
    expect((s.durasi?.hariBerjalan ?? 0) + (s.durasi?.sisaHari ?? 0)).toBe(140);
  });

  it("status kategori: realisasi per kategori RAB pada asOf minggu paparan", async () => {
    const pkg = await muatPaketPaparan(admin(), packageId);
    const s = await buatSnapshotPaparan(pkg, 2, NOW);
    const katA = s.kategori?.find((k) => k.locationId === locA);
    // Lokasi A: satu kategori berisi satu item 100 m³; s.d. minggu 2 tercatat
    // 10 m³ → 10%. Laporan minggu ke-3 (+50) TIDAK boleh ikut.
    expect(katA?.kelompok[0]?.realisasiPct).toBeCloseTo(10, 5);
    // Lokasi C tanpa RAB aktif → tidak menyumbang baris kategori.
    expect(s.kategori?.some((k) => k.locationId === locC)).toBe(false);
  });
});
