// Laporan progres terhadap DRAFT adendum (DECISIONS 210).
//
// Permintaan user 2026-08-02: "dalam realita di lapangan, seringkali pekerjaan
// itu dikerjakan dulu baru adendumnya dibuat … jadi kita bisa buat rab posisi
// draft tapi progress atas draft itu tetap bisa dibuat laporannya."
//
// Yang paling berbahaya dari fitur ini bukan angka draftnya, tapi ANGKA RESMI:
// kalau laporan terhadap adendum yang belum disetujui ikut menggerakkan
// progres resmi, termin bisa ditagih atas pekerjaan yang belum punya dasar
// kontrak. Karena itu uji pertama di sini menjaga hal itu.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
/*
 * WAJIB kalau berkas ini memeriksa AUDIT LOG.
 *
 * `audit()` memanggil `requestIp()` → `headers()`, yang hanya hidup di dalam
 * scope request. Di luar itu ia melempar, dan `audit()` MENELAN galatnya
 * (best-effort, by design) – jadi tidak ada satu baris pun yang tertulis dan
 * `findFirstOrThrow` di bawah tidak akan pernah menemukan apa pun. Bukan
 * cacat produk: `activateRevision` memang memanggil `audit()` dengan benar.
 * Pola yang sama dipakai belasan berkas integrasi lain (mis. `return-flow`).
 */
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const { db } = await import("@/lib/db");
const { upsertItem } = await import("@/lib/daily-report/service");
const { getLocationProgress, getProgresDraftAdendum, cumulativeVolumeByLineage } = await import(
  "@/lib/progress"
);
const { getScurveSeries } = await import("@/lib/baseline");

const suffix = `ba${Date.now().toString(36)}`;
let orgId = "";
let userId = "";
let locationId = "";
let reportId = "";
/** Item yang ADA di RAB aktif (volume 100) dan di draft dinaikkan jadi 150. */
let nodeAktifId = "";
let nodeDraftNaikId = "";
/** Item yang HANYA ada di draft — pekerjaan tambah yang belum ada dasarnya. */
let nodeDraftBaruId = "";

const LK_NAIK = "I#1";
const LK_BARU = "I#9";

async function buatRevisi(
  revisionNo: number,
  status: "aktif" | "draft",
  items: { lineageKey: string; code: string; volume: number; harga: number }[],
) {
  const totalNilai = items.reduce((t, i) => t + BigInt(Math.round(i.volume * i.harga)), 0n);
  const rev = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo,
      source: revisionNo === 1 ? "hps_awal" : "adendum",
      status,
      totalValue: totalNilai,
      createdById: userId,
    },
    select: { id: true },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "kategori",
      code: "I",
      name: "PEKERJAAN PERSIAPAN",
      amount: totalNilai,
      lineageKey: "I",
      sortOrder: 0,
    },
    select: { id: true },
  });
  const ids: Record<string, string> = {};
  let urut = 1;
  for (const i of items) {
    const n = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        code: i.code,
        name: `Pekerjaan ${i.code}`,
        volume: i.volume,
        unit: "m3",
        unitPrice: i.harga,
        amount: BigInt(Math.round(i.volume * i.harga)),
        lineageKey: i.lineageKey,
        sortOrder: urut++,
      },
      select: { id: true },
    });
    ids[i.lineageKey] = n.id;
  }
  return { revisionId: rev.id, ids };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  userId = (
    await db.user.create({
      data: { orgId, username: `u-${suffix}`, fullName: "Uji", role: "super_admin", passwordHash: "x" },
      select: { id: true },
    })
  ).id;
  const pkg = await db.package.create({
    data: { orgId, name: `Paket ${suffix}`, stage: "pelaksanaan" },
    select: { id: true },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Uji Basis",
      slug: `uji-basis-${suffix}`,
      village: "V",
      regency: "K",
      province: "P",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true },
  });
  locationId = loc.id;

  const aktif = await buatRevisi(1, "aktif", [{ lineageKey: LK_NAIK, code: "1", volume: 100, harga: 10_000 }]);
  nodeAktifId = aktif.ids[LK_NAIK];

  const draft = await buatRevisi(2, "draft", [
    { lineageKey: LK_NAIK, code: "1", volume: 150, harga: 10_000 },
    { lineageKey: LK_BARU, code: "9", volume: 50, harga: 10_000 },
  ]);
  nodeDraftNaikId = draft.ids[LK_NAIK];
  nodeDraftBaruId = draft.ids[LK_BARU];

  const rep = await db.dailyReport.create({
    data: {
      locationId,
      reportDate: new Date("2026-08-01T00:00:00.000Z"),
      status: "draft",
      createdById: userId,
    },
    select: { id: true },
  });
  reportId = rep.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("KASUS INTI: laporan atas adendum yang belum sah TIDAK menggerakkan angka resmi", () => {
  it("item yang hanya ada di draft bisa dilaporkan, dan bertanda draft_adendum", async () => {
    const item = await upsertItem(reportId, { rabNodeId: nodeDraftBaruId, volumeDone: 20 }, userId);
    expect(item.basis).toBe("draft_adendum");
    expect(item.lineageKey).toBe(LK_BARU);
  });

  it("volume di ATAS batas RAB aktif bisa dilaporkan lewat draft – itu memang inti masalahnya", async () => {
    // RAB aktif membatasi 100; draft menaikkan jadi 150. Lewat item draft,
    // 130 masih sah — dan itulah pekerjaan yang di lapangan sudah jalan.
    const item = await upsertItem(reportId, { rabNodeId: nodeDraftNaikId, volumeDone: 130 }, userId);
    expect(item.basis).toBe("draft_adendum");
    expect(Number(item.volumeDone)).toBe(130);
  });

  it("progres RESMI tidak ikut naik walau laporannya sudah dikirim", async () => {
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "dikirim" } });
    const resmi = await getLocationProgress(locationId);
    // Semua baris di laporan ini basis draft → nol yang masuk hitungan resmi.
    expect(resmi.realizedValue).toBe(0n);
    expect(resmi.realizedPct).toBe(0);
  });

  it("kumulatif volume default (untuk guard & sisa RAB) juga hanya basis aktif", async () => {
    expect((await cumulativeVolumeByLineage(locationId)).get(LK_NAIK) ?? 0).toBe(0);
    expect((await cumulativeVolumeByLineage(locationId, undefined, "semua")).get(LK_NAIK)).toBe(130);
  });
});

describe("laporan berbasis draft menunjukkan angkanya sendiri", () => {
  it("terpasang dihitung memakai RAB draft, mencakup kedua basis", async () => {
    const p = (await getProgresDraftAdendum(locationId))!;
    expect(p.revisionNo).toBe(2);
    // Draft: item naik 150×10.000 = 1.500.000; item baru 50×10.000 = 500.000.
    expect(p.grandTotal).toBe(2_000_000n);
    // Terpasang: 130/150 × 1.500.000 = 1.300.000 · 20/50 × 500.000 = 200.000.
    expect(p.realizedValue).toBe(1_500_000n);
    expect(p.barisBasisDraft).toBe(2);
    // Angka resmi ikut dibawa sebagai pembanding — supaya pembaca tidak
    // mengira ini menggantikan angka kontrak.
    expect(p.realizedValueResmi).toBe(0n);
  });

  it("lokasi tanpa draft → null, bukan angka nol yang menyesatkan", async () => {
    const lain = await db.location.create({
      data: {
        packageId: (await db.location.findUniqueOrThrow({ where: { id: locationId }, select: { packageId: true } }))
          .packageId,
        name: "Tanpa Draft",
        slug: `tanpa-draft-${suffix}`,
        village: "V",
        regency: "K",
        province: "P",
        status: "berjalan",
      },
      select: { id: true },
    });
    expect(await getProgresDraftAdendum(lain.id)).toBeNull();
  });
});

describe("pagar yang tetap berlaku", () => {
  it("item dari revisi yang SUDAH DIGANTIKAN tetap ditolak", async () => {
    const lama = await buatRevisi(3, "draft", [
      { lineageKey: "Z#1", code: "1", volume: 10, harga: 1_000 },
    ]);
    await db.rabRevision.update({ where: { id: lama.revisionId }, data: { status: "digantikan" } });
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "draft" } });
    await expect(
      upsertItem(reportId, { rabNodeId: lama.ids["Z#1"], volumeDone: 1 }, userId),
    ).rejects.toThrow(/digantikan/i);
  });

  it("lewat item AKTIF, batas volume kontrak tetap ditegakkan", async () => {
    await expect(
      upsertItem(reportId, { rabNodeId: nodeAktifId, volumeDone: 101 }, userId),
    ).rejects.toThrow(/melebihi sisa RAB/i);
  });

  it("lewat item DRAFT, batasnya volume draft – dan tetap ditegakkan", async () => {
    await expect(
      upsertItem(reportId, { rabNodeId: nodeDraftNaikId, volumeDone: 151 }, userId),
    ).rejects.toThrow(/melebihi sisa RAB/i);
  });
});

describe("dokumen resmi lain juga tidak ikut bergerak", () => {
  it("kurva-S realisasi tetap 0% – item yang lineage-nya ada di KEDUA revisi pun tak bocor", async () => {
    // LK_NAIK ada di RAB aktif DAN di draft. Menyaring lineage ke revisi aktif
    // saja tidak menutup kebocoran ini; yang menutup adalah filter basis.
    // Blok "pagar" mengembalikan laporan ke draft — dikirim lagi supaya baris
    // basis draft (130 unit) benar-benar ikut terhitung saat diuji.
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "dikirim" } });
    await db.baseline.create({
      data: {
        locationId,
        baselineNo: 1,
        source: "auto",
        status: "aktif",
        contractDays: 28,
        points: {
          create: [1, 2, 3, 4].map((w) => ({ weekNumber: w, plannedPct: w * 25 })),
        },
      },
    });
    const series = await getScurveSeries(locationId);
    expect(series.totalWeeks).toBe(4);
    // Realisasi terisi (bukan null) untuk minggu berjalan, tapi nilainya nol.
    const terisi = series.actualPct.filter((v): v is number => v != null);
    expect(terisi.length).toBeGreaterThan(0);
    expect(Math.max(...terisi)).toBe(0);
  });

  it("setelah dilaporkan lewat basis AKTIF, kurva realisasi baru bergerak", async () => {
    const lain = await db.dailyReport.create({
      data: {
        locationId,
        reportDate: new Date("2026-08-02T00:00:00.000Z"),
        status: "draft",
        createdById: userId,
      },
      select: { id: true },
    });
    // 40 dari volume RAB aktif 100 → 40% × bobot 100% = 40%.
    await upsertItem(lain.id, { rabNodeId: nodeAktifId, volumeDone: 40 }, userId);
    await db.dailyReport.update({ where: { id: lain.id }, data: { status: "dikirim" } });

    const series = await getScurveSeries(locationId);
    const terisi = series.actualPct.filter((v): v is number => v != null);
    expect(Math.max(...terisi)).toBeCloseTo(40, 1);

    // Angka resmi ikut naik — dan HANYA sebesar yang basis aktif.
    const resmi = await getLocationProgress(locationId);
    expect(resmi.realizedPct).toBeCloseTo(40, 1);
  });
});

// Blanko harian KKP = DOKUMEN RESMI (DECISIONS 215).
//
// Laporan user 2026-08-02: "aku input item yang di draft, tapi muncul di blanko
// harian kkp". Penyaringan basis sebelumnya hanya menyentuh angka AGREGAT
// (progres, kurva-S, laporan periodik); dokumen harian menampilkan baris
// laporan apa adanya, jadi pekerjaan yang belum punya dasar kontrak tercetak
// di blanko seolah sudah sah.
describe("KASUS INTI: baris basis draft tidak tercetak di blanko harian KKP", () => {
  it("item basis draft tidak muncul, dan jumlahnya DISEBUT (bukan hilang diam-diam)", async () => {
    const { getKkpDailyData } = await import("@/lib/daily-report/queries");
    const loc = await db.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { slug: true },
    });
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "dikirim" } });

    const d = await getKkpDailyData(loc.slug, "2026-08-01");
    expect(d).not.toBeNull();
    // Dua baris di laporan itu, dua-duanya basis draft.
    expect(d!.items).toHaveLength(0);
    expect(d!.draftItemCount).toBe(2);
  });

  it("laporan basis aktif tetap tercetak, lengkap dengan bangunan/kategorinya", async () => {
    const { getKkpDailyData } = await import("@/lib/daily-report/queries");
    const loc = await db.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { slug: true },
    });
    const d = await getKkpDailyData(loc.slug, "2026-08-02");
    expect(d!.items.map((i) => i.name)).toEqual(["Pekerjaan 1"]);
    expect(d!.draftItemCount).toBe(0);
    // Kategori diturunkan dari akar lineageKey ("I#1" → "I") — DECISIONS 214.
    expect(d!.items[0].categoryName).toBe("PEKERJAAN PERSIAPAN");
    expect(d!.items[0].categoryCode).toBe("I");
  });
});

/**
 * KEBALIKANNYA, dan ini yang selama ini hilang.
 *
 * Seluruh berkas ini menguji bahwa laporan atas adendum yang BELUM sah tidak
 * menggerakkan angka resmi. Tak satu pun menguji apa yang terjadi ketika
 * adendumnya AKHIRNYA sah – dan jawabannya dulu: tidak terjadi apa-apa.
 * `activateRevision` hanya membalik status revisi, sehingga pekerjaan yang
 * sudah dilaporkan tetap tidak terhitung SELAMANYA, tepat pada pekerjaan yang
 * adendum itu diadakan untuk melegalkannya.
 *
 * Koreksi user 2026-09-01: "kalau sudah diaktivasi dengan skema dua orang yang
 * sudah kita atur, ya otomatis aktif."
 */
describe("KASUS INTI: adendum yang SAH menaikkan laporannya menjadi resmi", () => {
  it("aktivasi menaikkan basis draft_adendum ke aktif – dan HANYA penandanya", async () => {
    const { activateRevision } = await import("@/lib/rab/import");
    const draftRev = await db.rabRevision.findFirstOrThrow({
      where: { locationId, status: "draft" },
      select: { id: true },
    });
    const sebelum = await db.dailyReportItem.findMany({
      where: { report: { locationId }, basis: "draft_adendum" },
      select: { id: true, lineageKey: true, volumeDone: true, valueDone: true },
      orderBy: { lineageKey: "asc" },
    });
    expect(sebelum.length).toBeGreaterThan(0);

    await activateRevision(draftRev.id, userId);

    const sesudah = await db.dailyReportItem.findMany({
      where: { id: { in: sebelum.map((r) => r.id) } },
      select: { id: true, basis: true, lineageKey: true, volumeDone: true, valueDone: true },
      orderBy: { lineageKey: "asc" },
    });
    expect(sesudah.map((r) => r.basis)).toEqual(sebelum.map(() => "aktif"));
    // Isi laporannya tidak disentuh: tidak ada histori yang berubah.
    expect(sesudah.map((r) => Number(r.volumeDone))).toEqual(sebelum.map((r) => Number(r.volumeDone)));
    expect(sesudah.map((r) => r.valueDone)).toEqual(sebelum.map((r) => r.valueDone));
  });

  it("pekerjaan itu kini terhitung di angka RESMI, bukan cuma di pantauan draft", async () => {
    // Cakupan bawaan `cumulativeVolumeByLineage` adalah basis AKTIF – dasar
    // yang dipakai progres, kurva-S, blanko KKP, dan kesiapan termin.
    const resmi = await cumulativeVolumeByLineage(locationId);
    expect(resmi.get(LK_BARU)).toBeGreaterThan(0);
  });

  /*
   * DIUJI LAGI. Kesimpulan sebelumnya – "audit tidak bisa diperiksa di uji
   * integrasi karena `headers()` selalu gagal" – benar sebabnya, tapi salah
   * kesimpulannya: yang kurang bukan kemampuan mengujinya, melainkan
   * `vi.mock("next/headers", …)` di kepala berkas ini. Belasan berkas integrasi
   * lain sudah memakainya (`return-flow`, `kendala-satu-pintu`, …). Dengan mock
   * itu `audit()` menulis seperti di produksi, dan asersi di bawah kembali
   * memeriksa hal yang memang perlu dijaga.
   *
   * Menghapus asersinya berarti membuang satu-satunya bukti bahwa angka yang
   * menjelaskan lompatan progres benar-benar tercatat.
   */
  it("audit menyebut berapa baris laporan yang ikut naik", async () => {
    const log = await db.auditLog.findFirstOrThrow({
      where: { action: "rab.revision_activate" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    // Angka inilah yang menjelaskan lompatan progres tepat pada saat aktivasi.
    expect((log.payload as { laporanDinaikkan?: number }).laporanDinaikkan).toBeGreaterThan(0);
  });
});
