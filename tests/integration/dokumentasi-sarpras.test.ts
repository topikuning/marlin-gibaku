// DOKUMENTASI FOTO PER SARANA & PRASARANA (DECISIONS 683), basis data sungguhan.
//
// Yang dijaga: foto jatuh ke sarana lewat lineage pekerjaannya; hanya laporan
// berstatus terhitung; progres tiap foto SAMA dengan baris kategori "Progres
// per Kategori" laporan mingguan pada minggu yang sama (rekonsiliasi).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getPeriodReport } = await import("@/lib/periodic-report");
const { susunDokumentasiSarpras } = await import("@/lib/dokumentasi-sarpras/susun");

const suffix = `ds${Date.now().toString(36)}`;
const START = "2026-01-05";
const WEEKS = 8;
const DAY = 24 * 3600 * 1000;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
const plusDays = (key: string, n: number) => new Date(d(key).getTime() + n * DAY);
let locationId = "";
const reportIds: string[] = [];
let userId = "";
let nFoto = 0;
async function foto(rel: { reportId: string; reportItemId?: string; reportMaterialId?: string }) {
  nFoto++;
  return db.photo.create({
    data: { locationId, ...rel, r2Key: `uji/${suffix}/${nFoto}.webp`, sha256: `${suffix}-${nFoto}`, bytes: 10 },
  });
}

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
  userId = user.id;
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
    reportIds.push(rep.id);
    for (const [k, v] of Object.entries(vols)) {
      const s = POHON.find((x) => x.key === k)!;
      const item = await db.dailyReportItem.create({
        data: {
          reportId: rep.id, rabNodeId: idOf.get(k)!, lineageKey: k, basis: "aktif",
          volumeDone: v, valueDone: BigInt(v * (s.price ?? 0)), reportedById: user.id,
        },
      });
      await foto({ reportId: rep.id, reportItemId: item.id });
    }
  }
});

afterAll(async () => {
  await db.$executeRawUnsafe(`DELETE FROM "organizations" WHERE slug = 'org-${suffix}'`).catch(() => null);
  await db.$disconnect();
});

describe("dokumentasi foto per sarana & prasarana", () => {
  it("sarana = kategori tingkat 1 urut RAB; foto masuk lewat pekerjaannya", async () => {
    const dok = (await susunDokumentasiSarpras(locationId))!;
    expect(dok.sarpras.map((s) => [s.code, s.name, s.foto.length])).toEqual([
      ["I", "PEKERJAAN PERSIAPAN", 2],
      ["III", "PEKERJAAN TAMBATAN PERAHU", 4],
    ]);
    const iii = dok.sarpras[1];
    expect(iii.foto.map((f) => f.tanggal)).toEqual(["2026-01-06", "2026-01-13", "2026-01-13", "2026-01-13"]);
    expect(iii.foto.map((f) => f.minggu)).toEqual([1, 2, 2, 2]);
    expect(iii.pekerjaan.map((p) => p.label).sort()).toEqual(["1 Beton K-300", "1 Perancah", "9 Uji beton"].sort());
  });

  it("progres foto = progres kategori di laporan mingguan minggu yang sama", async () => {
    const dok = (await susunDokumentasiSarpras(locationId))!;
    for (const n of [1, 2]) {
      const r = (await getPeriodReport(locationId, "mingguan", n))!;
      for (const s of dok.sarpras) {
        const baris = r.progresKategori.find((b) => b.tingkat === 1 && b.code === s.code)!;
        for (const f of s.foto.filter((x) => x.minggu === n)) {
          expect(Math.abs(f.progres - baris.progresSd)).toBeLessThan(1e-9);
        }
      }
    }
    // Angka manual: III = perancah 15 jt + bongkaran 3,6 jt + beton 70 jt + uji 10 jt = 98,6 jt.
    // Minggu 1: perancah 30/100 → 0,3 × 15 jt ÷ 98,6 jt = 4,5639 %.
    const iii = dok.sarpras[1];
    expect(iii.foto[0].progres).toBeCloseTo(((0.3 * 15_000_000) / 98_600_000) * 100, 9);
    // Minggu 2: perancah 50/100, beton 5/50, uji 1/4 → (7,5 + 7 + 2,5) jt ÷ 98,6 jt = 17,2414 %.
    expect(iii.foto[1].progres).toBeCloseTo(((7_500_000 + 7_000_000 + 2_500_000) / 98_600_000) * 100, 9);
  });

  it("foto laporan draft tidak ikut; foto material disebut terpisah", async () => {
    const draft = await db.dailyReport.create({
      data: { locationId, reportDate: plusDays(START, 20), status: "draft", createdById: userId, weather: "cerah" },
    });
    const item = await db.dailyReportItem.findFirstOrThrow({ where: { reportId: reportIds[0] } });
    await foto({ reportId: draft.id, reportItemId: item.id });
    const material = await db.dailyReportMaterial.create({
      data: { reportId: reportIds[0], name: "Semen", unit: "zak", qtyReceived: 10 },
    });
    await foto({ reportId: reportIds[0], reportMaterialId: material.id });
    const dok = (await susunDokumentasiSarpras(locationId))!;
    expect(dok.sarpras.reduce((t, s) => t + s.foto.length, 0)).toBe(6);
    expect(dok.tanpaSarana).toEqual({ material: 1, alat: 0, umum: 0, tanpaKategori: 0 });
  });
});
