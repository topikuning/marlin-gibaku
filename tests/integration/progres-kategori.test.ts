// Halaman "LAPORAN PROGRES MINGGUAN" per kategori & sub-kategori – format
// Lampiran Termin (DECISIONS 670), dengan basis data sungguhan.
//
// Yang dijaga: sub-kategori ditemukan lewat pohon RAB (termasuk item yang
// tingkatnya lebih dalam), jumlah sub-kategori = baris kategorinya, jumlah
// kategori = JUMLAH = angka blanko rincian di laporan yang sama.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getPeriodReport } = await import("@/lib/periodic-report");

const suffix = `pk${Date.now().toString(36)}`;
const START = "2026-01-05";
const WEEKS = 8;
const DAY = 24 * 3600 * 1000;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
const plusDays = (key: string, n: number) => new Date(d(key).getTime() + n * DAY);
let locationId = "";

/*
 * Bentuk RAB sungguhan (data Kedung Mutih): sub-kategori berjenis `sub`
 * (III.1, V.1, …), kelompok item bernomor berjenis `grup`.
 *
 * I   PERSIAPAN                       – item langsung + grup "6 SMK3K" (BUKAN sub-kategori)
 * III TAMBATAN PERAHU
 *     III.1 Perancah (sub)           – 2 item
 *     III.2 Struktur (sub)
 *           a Beton (grup)           – 1 item, satu tingkat lebih dalam
 *     III.3 Deep Well (sub)          – tanpa item (rinciannya di sub saudara) → judul saja
 *     (item langsung di bawah III)   – ikut baris III saja, tanpa baris sendiri
 */
type Simpul = { key: string; kind: "kategori" | "sub" | "grup" | "item"; code: string; name: string; parent?: string; vol?: number; price?: number };
const POHON: Simpul[] = [
  { key: "I", kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN" },
  { key: "I#1", kind: "item", code: "1", name: "Mobilisasi", parent: "I", vol: 1, price: 30_000_000 },
  { key: "I#2", kind: "item", code: "2", name: "Direksi keet", parent: "I", vol: 20, price: 1_250_000 },
  { key: "I#6", kind: "grup", code: "6", name: "Pekerjaan Pengadaan SMK3K", parent: "I" },
  { key: "I#6#1", kind: "item", code: "1", name: "APD", parent: "I#6", vol: 10, price: 500_000 },
  { key: "III", kind: "kategori", code: "III", name: "PEKERJAAN TAMBATAN PERAHU" },
  { key: "III#1", kind: "sub", code: "III.1.", name: "Pekerjaan Perancah Dan Bongkaran", parent: "III" },
  { key: "III#1#1", kind: "item", code: "1", name: "Perancah", parent: "III#1", vol: 100, price: 150_000 },
  { key: "III#1#2", kind: "item", code: "2", name: "Bongkaran", parent: "III#1", vol: 40, price: 90_000 },
  { key: "III#2", kind: "sub", code: "III.2.", name: "Pekerjaan Struktur", parent: "III" },
  { key: "III#2#a", kind: "grup", code: "a", name: "Beton", parent: "III#2" },
  { key: "III#2#a#1", kind: "item", code: "1", name: "Beton K-300", parent: "III#2#a", vol: 50, price: 1_400_000 },
  { key: "III#3", kind: "sub", code: "III.3.", name: "Pekerjaan Deep Well", parent: "III" },
  { key: "III#9", kind: "item", code: "9", name: "Uji beton", parent: "III", vol: 4, price: 2_500_000 },
];
const amt = (s: Simpul) => BigInt((s.vol ?? 0) * (s.price ?? 0));
const totalDi = (root: string) =>
  POHON.filter((s) => s.kind === "item" && (s.key === root || s.key.startsWith(`${root}#`))).reduce((a, s) => a + amt(s), 0n);

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT Uji ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}` } });
  const grand = totalDi("I") + totalDi("III");
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `KTR-${suffix}`, contractValue: grand,
      signedDate: d("2025-12-20"), durationDays: WEEKS * 7, startDate: d(START), endDate: plusDays(START, WEEKS * 7 - 1),
    },
  });
  locationId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Lokasi PK", slug: `lokasi-${suffix}`, village: "Desa", regency: "Kab", province: "Prov" },
    })
  ).id;
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: grand },
  });
  const idOf = new Map<string, string>();
  let sort = 0;
  for (const s of POHON) {
    const isItem = s.kind === "item";
    const n = await db.rabNode.create({
      data: {
        revisionId: rev.id, parentId: s.parent ? idOf.get(s.parent) : null, kind: s.kind, code: s.code, name: s.name,
        amount: isItem ? amt(s) : totalDi(s.key), lineageKey: s.key, sortOrder: sort++,
        ...(isItem ? { volume: s.vol, unit: "m3", unitPrice: s.price } : {}),
      },
      select: { id: true },
    });
    idOf.set(s.key, n.id);
  }
  const baseline = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "auto", status: "aktif", rabRevisionId: rev.id, contractDays: WEEKS * 7 },
  });
  await db.baselinePoint.createMany({
    data: Array.from({ length: WEEKS }, (_, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: ((i + 1) / WEEKS) * 100 })),
  });
  // Minggu 1 dan 2 – "lalu" dan "ini" untuk laporan minggu ke-2.
  for (const [hari, vols] of [
    [1, { "I#1": 1, "III#1#1": 30 }],
    [8, { "I#2": 10, "III#1#1": 20, "III#2#a#1": 5, "III#9": 1 }],
  ] as [number, Record<string, number>][]) {
    const rep = await db.dailyReport.create({
      data: { locationId, reportDate: plusDays(START, hari), status: "final", createdById: user.id, weather: "cerah" },
    });
    for (const [k, v] of Object.entries(vols)) {
      const s = POHON.find((x) => x.key === k)!;
      await db.dailyReportItem.create({
        data: {
          reportId: rep.id, rabNodeId: idOf.get(k)!, lineageKey: k, basis: "aktif",
          volumeDone: v, valueDone: BigInt(v * (s.price ?? 0)), reportedById: user.id,
        },
      });
    }
  }
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

const dekat = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe("halaman progres per kategori & sub-kategori", () => {
  it("baris: kategori lalu sub-kategori berjenis `sub` saja – grup bernomor dan item langsung tidak diberi baris", async () => {
    const r = (await getPeriodReport(locationId, "mingguan", 2))!;
    expect(r.progresKategori.map((b) => [b.tingkat, b.code, b.name])).toEqual([
      [1, "I", "PEKERJAAN PERSIAPAN"],
      [1, "III", "PEKERJAAN TAMBATAN PERAHU"],
      [2, "III.1.", "Pekerjaan Perancah Dan Bongkaran"],
      [2, "III.2.", "Pekerjaan Struktur"],
      [2, "III.3.", "Pekerjaan Deep Well"],
    ]);
    // Sub tanpa item = judul saja (angka kosong di contoh), bukan "sisa 100%".
    expect(r.progresKategori.map((b) => b.judulSaja ?? false)).toEqual([false, false, false, false, true]);
    expect(r.header.contractSignedDate?.toISOString().slice(0, 10)).toBe("2025-12-20");
  });

  it("item yang lebih dalam masuk ke sub-kategori tingkat 2-nya; item di luar sub tetap terhitung di kategorinya", async () => {
    const r = (await getPeriodReport(locationId, "mingguan", 2))!;
    const [i, iii, s1, s2] = r.progresKategori;
    expect(s1.nilai).toBe(Number(totalDi("III#1")));
    expect(s2.nilai).toBe(Number(totalDi("III#2")));
    expect(iii.nilai).toBe(Number(totalDi("III")));
    expect(i.nilai).toBe(Number(totalDi("I")));
    // Item langsung di bawah III ("Uji beton") ada di baris III, tidak di sub mana pun.
    dekat(iii.nilai - s1.nilai - s2.nilai, Number(totalDi("III#9")));
  });

  it("JUMLAH = Σ kategori = angka blanko rincian; progres = bobot terealisasi ÷ bobot kelompok", async () => {
    const r = (await getPeriodReport(locationId, "mingguan", 2))!;
    const t = r.progresKategoriTotal;
    const kat = r.progresKategori.filter((b) => b.tingkat === 1);
    for (const k of ["bobotLalu", "bobotIni", "bobotSd", "bobotRencana"] as const) {
      dekat(kat.reduce((s, b) => s + b[k], 0), t[k]);
      dekat(t[k], r.totals[k]);
    }
    dekat(t.bobot, 100);
    // Perancah 50 dari 100 m3 (separuh dari 15 jt) + Bongkaran 0 dari 40 (3,6 jt) → 7,5/18,6.
    const s1 = r.progresKategori[2];
    dekat(s1.progresSd, (7_500_000 / 18_600_000) * 100);
    dekat(s1.progresLalu + s1.progresIni, s1.progresSd);
    dekat(s1.sisaProgres, 100 - s1.progresSd);
    dekat(s1.sisaBobot, s1.bobot - s1.bobotSd);
  });
});
