// IMPOR REKAP HARIAN (sheet "REKAP HARIAN", matriks pekerjaan × tanggal) –
// DECISIONS 782 – terhadap DATABASE ASLI.
//
// Permintaan user 2026-11-25: *"ada dua mode, apend dan overwrite, jika di
// tanggal yang sama itu tinggal penyesuaian, tapi jika ada tanggal yang tidak
// sama antara di excel dan di marlin, lalu bentrok jumlahnya, ini juga perlu
// dimitigasi, yang utama foto eksisting tidak boleh hilang dan harus aman."*
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth/session", () => ({ requestIp: async () => null }));

const { db } = await import("@/lib/db");
const { pratinjauImporRekap, terapkanImporRekap, ImporRekapError } = await import("@/lib/daily-report/rekap-matriks/impor");
const { masukanRencana } = await import("@/lib/daily-report/rekap-matriks/masukan");
const { susunRencana } = await import("@/lib/daily-report/rekap-matriks/rencana");
const { cumulativeVolumeByLineage } = await import("@/lib/progress");

const suffix = `irh${Date.now().toString(36)}`;
let orgId = "";
let userId = "";
let n = 0;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const SM = { ubahTerkirim: true, ubahFinal: false };
const SA = { ubahTerkirim: true, ubahFinal: true };

/** Berkas REKAP HARIAN: kolom O = 28 Okt, P = 29 Okt (disembunyikan), Q = 30 Okt, R = 31 Okt. */
async function berkas(isi: { nama: string; sat: string | null; sel?: Record<string, number> }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("MC-0");
  const ws = wb.addWorksheet("REKAP HARIAN");
  ws.getCell("C19").value = "NO";
  ws.getCell("D19").value = "Uraian Pekerjaan";
  ws.getCell("H19").value = "Sat";
  ws.getCell("I19").value = "Volume Kontrak";
  const kol: Record<string, number> = { "2026-10-28": 15, "2026-10-29": 16, "2026-10-30": 17, "2026-10-31": 18 };
  for (const [t, c] of Object.entries(kol)) ws.getRow(19).getCell(c).value = D(t);
  ws.getColumn(16).hidden = true;
  isi.forEach((x, i) => {
    const r = 21 + i;
    ws.getCell(`E${r}`).value = x.nama;
    if (x.sat) ws.getCell(`H${r}`).value = x.sat;
    for (const [t, v] of Object.entries(x.sel ?? {})) ws.getRow(r).getCell(kol[t]!).value = v;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

type Lokasi = { locationId: string; node: Record<string, string>; laporan: Record<string, string>; baris: Record<string, string>; foto: string[] };

/*
 * RAB aktif:  A GEDUNG A: A#1 Galian Tanah (m3, 100) · A#2 Beton (m3, 50)
 *             B GEDUNG B: B#1 Galian Tanah (m3, 100)
 * Laporan:    28 Okt FINAL – B#1 25 m3, dua foto · 30 Okt DIKIRIM – A#2 5 m3
 */
async function siapkan(): Promise<Lokasi> {
  n++;
  const pkg = await db.package.create({ data: { orgId, name: `Paket ${suffix}-${n}` } });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: `Lokasi ${n}`, slug: `lok-${suffix}-${n}`, village: "Desa", regency: "Kab", province: "Prov", isActive: true },
  });
  const rev = await db.rabRevision.create({ data: { locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 0n } });
  const node: Record<string, string> = {};
  const buat = async (lineageKey: string, kind: "kategori" | "item", name: string, parent: string | null, sortOrder: number, unit: string | null = null, volume: number | null = null) => {
    const x = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: parent ? node[parent]! : null,
        kind,
        code: lineageKey.split("#").pop()!,
        name,
        unit,
        volume,
        unitPrice: volume == null ? null : 100_000,
        amount: volume == null ? 0n : BigInt(volume * 100_000),
        lineageKey,
        sortOrder,
      },
    });
    node[lineageKey] = x.id;
  };
  await buat("A", "kategori", "GEDUNG A", null, 0);
  await buat("A#1", "item", "Galian Tanah", "A", 1, "m3", 100);
  await buat("A#2", "item", "Beton", "A", 2, "m3", 50);
  await buat("B", "kategori", "GEDUNG B", null, 3);
  await buat("B#1", "item", "Galian Tanah", "B", 4, "m3", 100);
  const laporan: Record<string, string> = {};
  const baris: Record<string, string> = {};
  const lapor = async (t: string, status: "final" | "dikirim", isi: [string, number][]) => {
    const r = await db.dailyReport.create({ data: { locationId: loc.id, reportDate: D(t), status, createdById: userId, weather: "cerah" } });
    laporan[t] = r.id;
    for (const [k, v] of isi) {
      const row = await db.dailyReportItem.create({
        data: { reportId: r.id, rabNodeId: node[k]!, lineageKey: k, basis: "aktif", volumeDone: v, valueDone: BigInt(v * 100_000) },
      });
      baris[`${k}@${t}`] = row.id;
    }
  };
  await lapor("2026-10-28", "final", [["B#1", 25]]);
  await lapor("2026-10-30", "dikirim", [["A#2", 5]]);
  const foto: string[] = [];
  for (let i = 0; i < 2; i++) {
    const f = await db.photo.create({
      data: {
        locationId: loc.id,
        reportId: laporan["2026-10-28"]!,
        reportItemId: baris["B#1@2026-10-28"]!,
        r2Key: `uji/${suffix}/${n}-${i}.webp`,
        sha256: `${suffix}-${n}-${i}`,
        bytes: 10,
      },
    });
    foto.push(f.id);
  }
  return { locationId: loc.id, node, laporan, baris, foto };
}

const BERKAS = () =>
  berkas([
    { nama: "GEDUNG A", sat: null },
    { nama: "Galian Tanah", sat: "m3", sel: { "2026-10-30": 10, "2026-10-29": 99, "2026-10-31": 3 } },
    { nama: "Beton", sat: "m3", sel: { "2026-10-30": 8 } },
    { nama: "GEDUNG B", sat: null },
    { nama: "Galian Tanah", sat: "m3", sel: { "2026-10-30": 25 } },
  ]);

async function simpan(L: Lokasi, buf: Buffer, izin: typeof SM, mode: "tambah" | "timpa", pilihan: Record<string, "lewati" | "excel" | "jumlahkan" | "potong"> = {}) {
  const bahan = await pratinjauImporRekap(L.locationId, buf, izin);
  const p = { mode, tujuan: {}, pilihan };
  const rencana = susunRencana(masukanRencana(bahan, p));
  const hasil = await terapkanImporRekap({ locationId: L.locationId, buf, userId, izin, pilihan: p, sidik: rencana.sidik });
  return { bahan, rencana, hasil };
}

const volume = async (L: Lokasi) =>
  Object.fromEntries(
    (await db.dailyReportItem.findMany({ where: { report: { locationId: L.locationId } }, select: { lineageKey: true, volumeDone: true, report: { select: { reportDate: true } } } })).map(
      (r) => [`${r.lineageKey}@${r.report.reportDate.toISOString().slice(0, 10)}`, Number(r.volumeDone)],
    ),
  );
const fotoAman = async (L: Lokasi) => {
  const f = await db.photo.findMany({ where: { id: { in: L.foto } }, select: { reportItemId: true } });
  return f.length === 2 && f.every((x) => x.reportItemId === L.baris["B#1@2026-10-28"]);
};

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  userId = (await db.user.create({ data: { orgId, username: `sm-${suffix}`, fullName: "SM Uji", role: "site_manager", passwordHash: "x" } })).id;
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE audit_logs, photos, daily_report_status_history, daily_report_items, daily_reports, rab_nodes, rab_revisions, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("pratinjau", () => {
  it("nama yang sama di dua gedung jatuh ke gedungnya; kolom tersembunyi tidak dibaca tetapi disebut", async () => {
    const L = await siapkan();
    const b = await pratinjauImporRekap(L.locationId, await BERKAS(), SM);
    expect(b.baris.map((x) => [x.nama, b.cocok[x.excelRow]])).toEqual([
      ["Galian Tanah", { lineageKey: "A#1", cara: "urutan" }],
      ["Beton", { lineageKey: "A#2", cara: "urutan" }],
      ["Galian Tanah", { lineageKey: "B#1", cara: "urutan" }],
    ]);
    expect(b.tersembunyi).toEqual([{ tanggal: "2026-10-29", sel: 1 }]);
    expect(b.baris[0]!.sel.map((s) => s.tanggal)).toEqual(["2026-10-30", "2026-10-31"]);
  });
});

describe("mode tambah (Site Manager)", () => {
  it("tanggal sama disesuaikan, tanggal baru ditambah (laporan baru dikirim); bentrok beda tanggal dilewati; foto aman", async () => {
    const L = await siapkan();
    const { rencana, hasil } = await simpan(L, await BERKAS(), SM, "tambah");
    expect(rencana.item.find((i) => i.lineageKey === "B#1")).toMatchObject({ bentrok: ["beda_tanggal"], pilihan: "lewati" });
    expect(hasil).toMatchObject({ tambah: 2, ubah: 1, nolkan: 0, laporanBaru: 1, laporanBaruTetapDraft: [] });
    expect(await volume(L)).toEqual({
      "B#1@2026-10-28": 25,
      "A#2@2026-10-30": 8,
      "A#1@2026-10-30": 10,
      "A#1@2026-10-31": 3,
    });
    const baru = await db.dailyReport.findFirstOrThrow({ where: { locationId: L.locationId, reportDate: D("2026-10-31") } });
    expect(baru.status).toBe("dikirim");
    expect((await cumulativeVolumeByLineage(L.locationId)).get("A#1")).toBe(13);
    expect(await fotoAman(L)).toBe(true);
    const jejak = await db.auditLog.count({ where: { action: "daily_report.impor_rekap_harian", resourceId: L.locationId } });
    expect(jejak).toBe(2);
  });

  it("bentrok dipilih 'ikuti Excel' tapi 28 Okt laporan FINAL: Site Manager tidak boleh → seluruh item ditahan, tidak ada yang dipindah", async () => {
    const L = await siapkan();
    const { rencana } = await simpan(L, await BERKAS(), SM, "tambah", { "B#1": "excel" });
    expect(rencana.item.find((i) => i.lineageKey === "B#1")!.ditahanSemua).toMatch(/tidak terhitung dua kali/);
    expect((await volume(L))["B#1@2026-10-28"]).toBe(25);
    expect((await volume(L))["B#1@2026-10-30"]).toBeUndefined();
  });
});

describe("mode timpa (super admin)", () => {
  it("28 Okt (final) dinolkan – barisnya tetap dan dua fotonya tetap menempel; 30 Okt ditambah; blanko final dibangun ulang", async () => {
    const L = await siapkan();
    const { hasil } = await simpan(L, await BERKAS(), SA, "timpa");
    expect(hasil).toMatchObject({ nolkan: 1 });
    expect(hasil.blankoDibangunUlang).toBeGreaterThan(0);
    const v = await volume(L);
    expect([v["B#1@2026-10-28"], v["B#1@2026-10-30"]]).toEqual([0, 25]);
    expect(await db.dailyReportItem.count({ where: { id: L.baris["B#1@2026-10-28"]! } })).toBe(1);
    expect(await fotoAman(L)).toBe(true);
    expect((await cumulativeVolumeByLineage(L.locationId)).get("B#1")).toBe(25);
  });
});

describe("pengaman", () => {
  it("data berubah sejak pratinjau → tidak ada yang ditulis", async () => {
    const L = await siapkan();
    const buf = await BERKAS();
    const bahan = await pratinjauImporRekap(L.locationId, buf, SM);
    const p = { mode: "tambah" as const, tujuan: {}, pilihan: {} };
    const sidik = susunRencana(masukanRencana(bahan, p)).sidik;
    await db.dailyReportItem.update({ where: { id: L.baris["A#2@2026-10-30"]! }, data: { volumeDone: 6 } });
    const janji = terapkanImporRekap({ locationId: L.locationId, buf, userId, izin: SM, pilihan: p, sidik });
    await expect(janji).rejects.toBeInstanceOf(ImporRekapError);
    await expect(janji).rejects.toThrow(/berubah sejak pratinjau/);
    expect(await volume(L)).toEqual({ "B#1@2026-10-28": 25, "A#2@2026-10-30": 6 });
  });

  it("baris Excel yang dipilih orang untuk dilewati tidak ditulis", async () => {
    const L = await siapkan();
    const buf = await BERKAS();
    const bahan = await pratinjauImporRekap(L.locationId, buf, SM);
    const p = { mode: "tambah" as const, tujuan: { [bahan.baris[0]!.excelRow]: "lewati" }, pilihan: {} };
    const sidik = susunRencana(masukanRencana(bahan, p)).sidik;
    await terapkanImporRekap({ locationId: L.locationId, buf, userId, izin: SM, pilihan: p, sidik });
    const v = await volume(L);
    expect([v["A#1@2026-10-30"], v["A#2@2026-10-30"]]).toEqual([undefined, 8]);
  });
});
