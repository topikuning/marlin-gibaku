// PINDAHKAN LOKASI KE PAKET LAIN — super admin saja.
//
// Kebutuhan user 2026-09-15. Yang diuji di sini bukan "kolom packageId
// berubah" — itu yang paling mudah dan paling tidak penting. Yang diuji:
//
//  1. KALENDER IKUT MENYESUAIKAN. SPMK, durasi, dan mode minggu milik PAKET.
//     Rentang tanggal rencana mingguan dan grid kurva-S harus dihitung ulang
//     ke kalender paket tujuan; tanpa itu blanko harian mencari rencana lewat
//     weekStart<=tanggal<=weekEnd dan menemukan minggu yang salah, sementara
//     kurva-S punya jumlah kolom yang tidak sama dengan laporan periodiknya.
//  2. RIWAYAT CCO TIDAK IKUT PINDAH. Perubahan lingkup lahir dari adendum SATU
//     kontrak. Dibawa serta, ia akan menandai lokasi yang baru datang itu
//     "dicabut adendum" di paket barunya atas CCO yang bukan miliknya.
//  3. DUA JALUR DIBEDAKAN. `paksa` hanya untuk salah input; lokasi yang punya
//     riwayat lingkup kontraktual wajib lewat jalur CCO.
//  4. PAGAR ORGANISASI. Satu UUID yang terbaca dari dokumen mana pun tidak
//     cukup untuk memindahkan lokasi organisasi lain.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { db } = await import("@/lib/db");
const { pindahkanLokasi, PindahLokasiError } = await import("@/lib/package/pindah-lokasi");
const { lingkupLokasi } = await import("@/lib/package/lingkup-lokasi");

const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
const kunci = (t: Date) => t.toISOString().slice(0, 10);

/*
 * Dua kontrak yang kalendernya SENGAJA berbeda di tiga sumbu sekaligus:
 * tanggal SPMK, durasi, dan mode minggu. Inilah yang membuat "pindah paket"
 * bukan sekadar mengganti satu kolom.
 */
const ASAL = { start: "2026-03-02", end: "2026-04-27", hari: 56, mode: "tujuh_hari" } as const; // Senin
const TUJUAN = { start: "2026-03-05", end: "2026-05-07", hari: 63, mode: "senin_minggu" } as const; // Kamis

let suffix = "";
let orgId = "";
let actorId = "";
let pkgAsal = "";
let pkgTujuan = "";
let locationId = "";
let amendmentId = "";

async function buatPaket(nama: string, k: { start: string; end: string; hari: number; mode: "tujuh_hari" | "senin_minggu" } | null) {
  const vendor = await db.vendor.create({ data: { orgId, name: `PT ${nama}-${suffix}` } });
  const pkg = await db.package.create({
    data: { orgId, name: `Paket ${nama} ${suffix}`, stage: k ? "pelaksanaan" : "prospek" },
    select: { id: true },
  });
  if (!k) return { id: pkg.id, contractId: null as string | null };
  const c = await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `KTR-${nama}-${suffix}`,
      contractValue: 100_000_000n, signedDate: d(k.start), durationDays: k.hari,
      startDate: d(k.start), endDate: d(k.end), weekMode: k.mode,
    },
    select: { id: true },
  });
  return { id: pkg.id, contractId: c.id };
}

async function pasang() {
  suffix = `pl${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  orgId = org.id;
  const actor = await db.user.create({
    data: { orgId, username: `sa-${suffix}`, fullName: "Super Admin", passwordHash: "x", role: "super_admin" },
    select: { id: true },
  });
  actorId = actor.id;

  const asal = await buatPaket("Asal", ASAL);
  const tujuan = await buatPaket("Tujuan", TUJUAN);
  pkgAsal = asal.id;
  pkgTujuan = tujuan.id;

  const loc = await db.location.create({
    data: {
      packageId: pkgAsal, name: "Lokasi Pindah", slug: `lok-${suffix}`,
      village: "Desa", regency: "Kab", province: "Prov", status: "berjalan", isActive: true,
    },
    select: { id: true },
  });
  locationId = loc.id;

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
    select: { id: true },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI",
      amount: 100_000_000n, lineageKey: "I", sortOrder: 1,
    },
    select: { id: true },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan batu",
      volume: 100, unit: "m3", unitPrice: 1_000_000, amount: 100_000_000n, lineageKey: "I#1", sortOrder: 2,
    },
    select: { id: true },
  });

  // Baseline 8 kolom, grid paket ASAL (SPMK Senin, tujuh_hari, 56 hari).
  const baseline = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "manual", status: "aktif", rabRevisionId: rev.id, contractDays: 56 },
    select: { id: true },
  });
  await db.baselinePoint.createMany({
    data: Array.from({ length: 8 }, (_, i) => ({
      baselineId: baseline.id, weekNumber: i + 1, plannedPct: ((i + 1) / 8) * 100,
    })),
  });
  await db.baselineScheduleItem.create({
    data: {
      baselineId: baseline.id, lineageKey: "I", name: "PEKERJAAN UJI", weightPct: 100,
      weekly: Array.from({ length: 8 }, () => 12.5),
    },
  });

  // Rencana minggu ke-2 dengan rentang grid paket ASAL: 9/3 – 15/3.
  const plan = await db.weeklyPlan.create({
    data: {
      locationId, weekNumber: 2, weekStart: d("2026-03-09"), weekEnd: d("2026-03-15"),
      createdById: actorId,
    },
    select: { id: true },
  });
  await db.weeklyPlanItem.create({
    data: { weeklyPlanId: plan.id, rabNodeId: item.id, targetVolume: 10, priority: 1 },
  });

  // Satu dokumen berlokasi — pembawa packageId kedua yang harus ikut pindah.
  await db.document.create({
    data: {
      orgId, packageId: pkgAsal, locationId, phase: "pelaksanaan", type: "lainnya",
      title: `Dokumen ${suffix}`, r2Key: `doc/${suffix}.pdf`, fileName: "d.pdf",
      mimeType: "application/pdf", bytes: 10, sha256: `sha-${suffix}`, uploadedById: actorId,
    },
  });

  const am = await db.contractAmendment.create({
    data: {
      contractId: asal.contractId!, ccoNumber: `CCO-01/${suffix}`, valueDelta: 0n,
      endDateDelta: 0, effectiveDate: d("2026-03-20"), reason: "Uji",
    },
    select: { id: true },
  });
  amendmentId = am.id;
}

beforeEach(pasang);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

const aktor = () => ({ id: actorId, orgId });

describe("pindah paksa – koreksi salah input paket", () => {
  it("kalender lokasi menyesuaikan kalender paket tujuan", async () => {
    const hasil = await pindahkanLokasi(
      { locationId, tujuanPackageId: pkgTujuan, mode: "paksa", alasan: "salah paket saat pendataan awal" },
      aktor(),
      null,
    );

    expect((await db.location.findUniqueOrThrow({ where: { id: locationId } })).packageId).toBe(pkgTujuan);

    /*
     * Paket tujuan: SPMK Kamis 5/3, mode senin_minggu ⇒ M2 = Senin 9/3 – Minggu
     * 15/3. Kebetulan sama dengan rentang lama di sini, jadi yang benar-benar
     * membuktikan penyesuaian adalah MINGGU 1 yang pendek — diuji di bawah.
     */
    expect(hasil.rencanaDihitungUlang).toBe(1);
    const plan = await db.weeklyPlan.findUniqueOrThrow({
      where: { locationId_weekNumber: { locationId, weekNumber: 2 } },
      select: { weekStart: true, weekEnd: true },
    });
    expect(kunci(plan.weekStart)).toBe("2026-03-09");
    expect(kunci(plan.weekEnd)).toBe("2026-03-15");

    // Grid paket tujuan (SPMK Kamis, senin_minggu, s/d 7/5) = 10 kolom, bukan 8.
    expect(hasil.baseline).toBe("dikonversi");
    const baru = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { points: true, contractDays: true, scheduleItems: { select: { weekly: true, weightPct: true } } },
    });
    expect(baru.points).toHaveLength(10);
    // Masa pelaksanaan milik KONTRAK – ikut kontrak paket tujuan, bukan warisan.
    expect(baru.contractDays).toBe(TUJUAN.hari);
    expect(Number(baru.points[baru.points.length - 1].plannedPct)).toBeCloseTo(100, 3);
    // Bobot kategori UTUH — konversi grid tidak boleh menelan rupiah.
    for (const s of baru.scheduleItems) {
      const w = s.weekly as number[];
      expect(w).toHaveLength(10);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(Number(s.weightPct), 3);
    }
  });

  it("minggu 1 paket tujuan yang PENDEK ikut dipakai rencana mingguan", async () => {
    await db.weeklyPlan.create({
      data: { locationId, weekNumber: 1, weekStart: d("2026-03-02"), weekEnd: d("2026-03-08"), createdById: actorId },
    });
    await pindahkanLokasi(
      { locationId, tujuanPackageId: pkgTujuan, mode: "paksa", alasan: "salah paket saat pendataan awal" },
      aktor(),
      null,
    );
    const m1 = await db.weeklyPlan.findUniqueOrThrow({
      where: { locationId_weekNumber: { locationId, weekNumber: 1 } },
      select: { weekStart: true, weekEnd: true },
    });
    // SPMK Kamis 5/3 pada grid senin_minggu ⇒ M1 = Kamis 5/3 – Minggu 8/3.
    expect(kunci(m1.weekStart)).toBe("2026-03-05");
    expect(kunci(m1.weekEnd)).toBe("2026-03-08");
  });

  it("dokumen berlokasi ikut pindah, dan KEDUA paket dapat catatan histori", async () => {
    const hasil = await pindahkanLokasi(
      { locationId, tujuanPackageId: pkgTujuan, mode: "paksa", alasan: "salah paket saat pendataan awal" },
      aktor(),
      null,
    );
    expect(hasil.barisIkut).toBeGreaterThanOrEqual(1);
    expect(await db.document.count({ where: { locationId, packageId: pkgTujuan } })).toBe(1);

    for (const [pkgId, kata] of [
      [pkgAsal, "DIPINDAH KE"],
      [pkgTujuan, "DITERIMA DARI"],
    ] as const) {
      const h = await db.packageStageHistory.findFirst({
        where: { packageId: pkgId },
        orderBy: { changedAt: "desc" },
        select: { note: true, fromStage: true, toStage: true },
      });
      expect(h?.note, `histori paket ${pkgId}`).toContain(kata);
      // Stage TIDAK berubah — ini koreksi data, bukan transisi lifecycle.
      expect(h?.fromStage).toBe(h?.toStage);
    }
  });

  it("DITOLAK bila lokasinya punya riwayat lingkup kontraktual", async () => {
    await db.locationScopeChange.create({
      data: {
        locationId, amendmentId, kind: "cabut", effectiveDate: d("2026-03-20"),
        status: "aktif", reason: "Dicabut lewat CCO",
      },
    });
    await expect(
      pindahkanLokasi(
        { locationId, tujuanPackageId: pkgTujuan, mode: "paksa", alasan: "salah paket saat pendataan awal" },
        aktor(),
        null,
      ),
    ).rejects.toThrow(/riwayat lingkup kontraktual|jalur CCO/i);
  });
});

describe("jalur CCO – perpindahan kontraktual", () => {
  it("riwayat CCO TETAP di paket lama dan tidak menandai lokasi di paket baru", async () => {
    await db.locationScopeChange.create({
      data: {
        locationId, amendmentId, kind: "cabut", effectiveDate: d("2026-03-20"),
        status: "aktif", reason: "Dicabut lewat CCO",
      },
    });
    // Sebelum pindah: lokasi ini memang tercatat DICABUT di paket asalnya.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T09:00:00+07:00"));
    try {
      expect((await lingkupLokasi([locationId])).dicabut.has(locationId)).toBe(true);

      await pindahkanLokasi(
        {
          locationId, tujuanPackageId: pkgTujuan, mode: "cco",
          ccoNumber: `CCO-01/${suffix}`, alasan: "dipindah lewat adendum paket tujuan",
        },
        aktor(),
        null,
      );

      /*
       * Sesudah pindah: barisnya TETAP ADA (riwayat kontrak paket lama), tetapi
       * tidak lagi menandai lokasi ini — CCO itu bicara tentang lingkup paket
       * lama, bukan paket yang baru menerimanya.
       */
      expect(await db.locationScopeChange.count({ where: { locationId } })).toBe(1);
      expect((await lingkupLokasi([locationId])).dicabut.has(locationId)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("nomor CCO wajib", async () => {
    await expect(
      pindahkanLokasi(
        { locationId, tujuanPackageId: pkgTujuan, mode: "cco", alasan: "dipindah lewat adendum" },
        aktor(),
        null,
      ),
    ).rejects.toThrow(/Nomor CCO wajib/i);
  });
});

describe("pagar", () => {
  it("lokasi organisasi LAIN tidak bisa dipindah walau UUID-nya diketahui", async () => {
    const lain = await db.organization.create({ data: { name: `Org lain ${suffix}`, slug: `lain-${suffix}` } });
    const penyusup = await db.user.create({
      data: { orgId: lain.id, username: `sa2-${suffix}`, fullName: "SA Lain", passwordHash: "x", role: "super_admin" },
      select: { id: true },
    });
    await expect(
      pindahkanLokasi(
        { locationId, tujuanPackageId: pkgTujuan, mode: "paksa", alasan: "mencoba lintas organisasi" },
        { id: penyusup.id, orgId: lain.id },
        null,
      ),
    ).rejects.toThrow(PindahLokasiError);
    expect((await db.location.findUniqueOrThrow({ where: { id: locationId } })).packageId).toBe(pkgAsal);
  });

  it("paket tujuan TANPA SPMK ditolak bila lokasinya sudah punya kurva-S", async () => {
    const pra = await buatPaket("Pra", null);
    await expect(
      pindahkanLokasi(
        { locationId, tujuanPackageId: pra.id, mode: "paksa", alasan: "paket tujuan belum berkontrak" },
        aktor(),
        null,
      ),
    ).rejects.toThrow(/belum punya SPMK/i);
  });

  it("pindah ke paketnya sendiri ditolak", async () => {
    await expect(
      pindahkanLokasi(
        { locationId, tujuanPackageId: pkgAsal, mode: "paksa", alasan: "tidak ke mana-mana" },
        aktor(),
        null,
      ),
    ).rejects.toThrow(/sudah ada di paket itu/i);
  });
});
