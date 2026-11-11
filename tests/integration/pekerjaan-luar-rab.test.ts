// PEKERJAAN DI LUAR RAB (DECISIONS 738).
//
// Ketetapan user 2026-11-04: pelaksana mencatat pekerjaan yang itemnya belum
// ada di RAB maupun draft adendum (uraian, satuan, volume, foto, tanpa harga).
// Site Manager memadankannya ke item draft adendum; hasilnya baris laporan
// ber-basis draft pada TANGGAL ASLINYA, juga bila laporannya sudah final.
// Yang dibuktikan dengan DB sungguhan:
//  - catatan hanya bisa ditulis selama laporan masih bisa diisi; hari yang
//    berisi catatan tidak bisa dinyatakan nihil dan bisa dikirim;
//  - padanan ke laporan FINAL menulis baris draft tanpa menggerakkan angka
//    resmi, statusnya tetap final, snapshot-nya ikut menghitung baris draft;
//  - dua catatan sehari untuk item yang sama jadi satu baris;
//  - melebihi sisa draft dan bentrok dengan isian langsung DITAHAN;
//  - lepas padanan, batalkan (tetap tersimpan + foto), aktifkan lagi, hapus;
//  - draft dibuang / diganti tanpa item itu: catatan kembali menunggu, tidak
//    menahan, tidak hilang;
//  - aktivasi adendum menaikkan barisnya jadi resmi dan menutup jalan lepas.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision, discardDraft, gantiDraftLama } = await import("@/lib/rab/import");
const { getOrCreateDraft, upsertItem, setHariNihil, submitReport, buildFinalSnapshot } = await import(
  "@/lib/daily-report/service"
);
const { getLocationProgress } = await import("@/lib/progress");
const svc = await import("@/lib/luar-rab/service");
import type { FlatNode } from "@/lib/rab/flatten";
import type { Prisma } from "@/generated/prisma/client";

const suffix = `lr${Date.now().toString(36)}`;
let userId: string;
let locationId: string;
let draftId: string;

const item = (code: string, name: string, volume: number, unit: string, unitPrice: number, sortOrder: number): FlatNode => ({
  kind: "item",
  code,
  name,
  volume,
  unit,
  unitPrice,
  amount: BigInt(Math.round(volume * unitPrice)),
  lineageKey: `I#${code}`,
  parentLineageKey: "I",
  sortOrder,
  excelRow: null,
});
const kategori = (anak: FlatNode[]): FlatNode => ({
  kind: "kategori",
  code: "I",
  name: "PEKERJAAN TALUD",
  volume: null,
  unit: null,
  unitPrice: null,
  amount: anak.reduce((t, n) => t + n.amount, 0n),
  lineageKey: "I",
  parentLineageKey: null,
  sortOrder: 0,
  excelRow: null,
});

const GALIAN = item("1", "Galian Tanah Biasa", 100, "m3", 50_000, 1);
const URUGAN = item("2", "Urugan Pasir Bawah Pondasi", 30, "m3", 80_000, 2);
const BATU = item("3", "Pasangan Batu Kali Talud", 10, "m3", 900_000, 3);
const PLESTER = item("4", "Plesteran Dinding Talud", 50, "m2", 60_000, 4);

async function buatDraft(isi: FlatNode[]) {
  const r = await createRevisionFromNodes(locationId, [kategori(isi), ...isi], { source: "adendum", userId, note: "draft" });
  return r.revisionId;
}
const nodeDraft = (revisionId: string, code: string) =>
  db.rabNode.findFirstOrThrow({ where: { revisionId, code, kind: "item" }, select: { id: true, lineageKey: true } });

let nomorFoto = 0;
async function fotoUntuk(reportId: string, luarRabId: string) {
  nomorFoto++;
  return db.photo.create({
    data: { locationId, reportId, luarRabId, r2Key: `uji/${suffix}/${nomorFoto}.jpg`, sha256: `${suffix}-${nomorFoto}`, bytes: 1 },
  });
}

async function finalkan(reportId: string) {
  await db.dailyReport.update({ where: { id: reportId }, data: { status: "final" } });
  const snap = await buildFinalSnapshot(reportId);
  await db.dailyReport.update({
    where: { id: reportId },
    data: { finalSnapshot: snap as unknown as Prisma.InputJsonValue },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org LR ${suffix}`, slug: `org-${suffix}` } });
  userId = (
    await db.user.create({ data: { orgId: org.id, username: `lr-${suffix}`, fullName: "Penguji", passwordHash: "x", role: "super_admin" } })
  ).id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket LR ${suffix}`, stage: "pelaksanaan" } });
  locationId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Talud", slug: `talud-${suffix}`, village: "Talud", regency: "Rembang", province: "Jateng", status: "berjalan", isActive: true },
    })
  ).id;
  const aktif = await createRevisionFromNodes(locationId, [kategori([GALIAN, URUGAN]), GALIAN, URUGAN], {
    source: "hps_awal",
    userId,
    note: "kontrak",
  });
  await activateRevision(aktif.revisionId, userId);
  draftId = await buatDraft([GALIAN, URUGAN, BATU, PLESTER]);
}, 120_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("mencatat (pelaksana)", () => {
  it("hanya selama laporan bisa diisi; isian dirapikan; hari bercatatan tidak bisa nihil tapi bisa dikirim", async () => {
    const lap = await getOrCreateDraft(locationId, "2026-10-01", userId);
    const c = await svc.catatLuarRab(lap.id, { uraian: "  Pasangan   batu kali talud ", satuan: " m3 ", volume: 1.23456 }, userId);
    expect([c.uraian, c.satuan, Number(c.volume)]).toEqual(["Pasangan batu kali talud", "m3", 1.235]);

    await expect(svc.catatLuarRab(lap.id, { uraian: "ab", satuan: "m3", volume: 1 }, userId)).rejects.toThrow(/minimal 3 huruf/);
    await expect(svc.catatLuarRab(lap.id, { uraian: "Bongkar pagar", satuan: "m", volume: 0 }, userId)).rejects.toThrow(/lebih dari 0/);
    await expect(setHariNihil(lap.id, { nihil: true, alasan: "hujan" }, userId)).rejects.toThrow(/catatan pekerjaan di luar RAB/);

    // Satu-satunya isi laporan adalah catatan → tetap bisa dikirim.
    await fotoUntuk(lap.id, c.id);
    const terkirim = await submitReport(lap.id, userId);
    expect(terkirim.status).toBe("dikirim");
    await expect(svc.catatLuarRab(lap.id, { uraian: "Bongkar pagar", satuan: "m", volume: 2 }, userId)).rejects.toThrow(
      /Draft atau Perlu Koreksi/,
    );
    await expect(svc.hapusLuarRab(lap.id, c.id, userId)).rejects.toThrow(/Draft atau Perlu Koreksi/);
  });

  it("hapus selama draft: catatan hilang, fotonya tetap di laporan (jadi foto tanpa pekerjaan)", async () => {
    const lap = await getOrCreateDraft(locationId, "2026-10-02", userId);
    const c = await svc.catatLuarRab(lap.id, { uraian: "Bongkar pagar lama", satuan: "m", volume: 12 }, userId);
    const f = await fotoUntuk(lap.id, c.id);
    await svc.hapusLuarRab(lap.id, c.id, userId);
    expect(await db.pekerjaanLuarRab.findUnique({ where: { id: c.id } })).toBeNull();
    const foto = await db.photo.findUniqueOrThrow({ where: { id: f.id } });
    expect([foto.reportId, foto.luarRabId, foto.reportItemId]).toEqual([lap.id, null, null]);
  });

  it("catatan tanpa satu pun foto tersimpan dibuang lagi", async () => {
    const lap = await getOrCreateDraft(locationId, "2026-10-02", userId);
    const c = await svc.catatLuarRab(lap.id, { uraian: "Saluran tambahan", satuan: "m", volume: 4 }, userId);
    expect(await svc.buangCatatanGagal(c.id, userId)).toBe(true);
    expect(await db.pekerjaanLuarRab.findUnique({ where: { id: c.id } })).toBeNull();
    const d = await svc.catatLuarRab(lap.id, { uraian: "Saluran tambahan", satuan: "m", volume: 4 }, userId);
    await fotoUntuk(lap.id, d.id);
    expect(await svc.buangCatatanGagal(d.id, userId)).toBe(false);
    await svc.hapusLuarRab(lap.id, d.id, userId);
  });
});

describe("padanan ke draft adendum", () => {
  let lapFinal: string;
  let c1: string;
  let c2: string;
  let foto1: string;

  it("usulan otomatis menunjuk item draft yang jelas cocok", async () => {
    const lap = await getOrCreateDraft(locationId, "2026-10-05", userId);
    lapFinal = lap.id;
    c1 = (await svc.catatLuarRab(lap.id, { uraian: "Pasangan batu kali talud", satuan: "m³", volume: 2 }, userId)).id;
    c2 = (await svc.catatLuarRab(lap.id, { uraian: "Pasangan batu kali talud sisi timur", satuan: "m3", volume: 1.5 }, userId)).id;
    foto1 = (await fotoUntuk(lap.id, c1)).id;
    await fotoUntuk(lap.id, c2);
    await finalkan(lap.id);

    const d = await svc.dataPadanan(locationId);
    const batu = await nodeDraft(draftId, "3");
    expect(d.draft?.id).toBe(draftId);
    expect(d.usulan[c1]?.kandidatId).toBe(batu.id);
    expect(d.kandidat.find((k) => k.id === batu.id)).toMatchObject({ sisa: 10, baru: true });
  });

  it("gabung ke laporan FINAL: satu baris draft di tanggal aslinya, angka resmi tetap, status tetap final", async () => {
    const batu = await nodeDraft(draftId, "3");
    const sebelum = await getLocationProgress(locationId);
    const snapLama = (await db.dailyReport.findUniqueOrThrow({ where: { id: lapFinal } })).finalSnapshot as { itemsDraftAdendum?: number };
    expect(snapLama.itemsDraftAdendum ?? 0).toBe(0);

    const h = await svc.gabungkanLuarRab(
      locationId,
      [
        { catatanId: c1, kandidatId: batu.id, terimaSatuanBeda: false },
        { catatanId: c2, kandidatId: batu.id, terimaSatuanBeda: false },
      ],
      userId,
    );
    expect(h).toEqual({ baris: 1, catatan: 2, ditahan: [], laporanFinal: 1 });

    const baris = await db.dailyReportItem.findMany({ where: { reportId: lapFinal } });
    expect(baris).toHaveLength(1);
    expect(baris[0]).toMatchObject({ basis: "draft_adendum", rabNodeId: batu.id, lineageKey: batu.lineageKey });
    expect(Number(baris[0]!.volumeDone)).toBe(3.5);
    expect(baris[0]!.valueDone).toBe(3_150_000n);

    const lap = await db.dailyReport.findUniqueOrThrow({ where: { id: lapFinal } });
    expect(lap.status).toBe("final");
    expect((lap.finalSnapshot as { itemsDraftAdendum?: number }).itemsDraftAdendum).toBe(1);

    const sesudah = await getLocationProgress(locationId);
    expect(sesudah.realizedValue).toBe(sebelum.realizedValue);
    expect(sesudah.grandTotal).toBe(sebelum.grandTotal);

    const catatan = await db.pekerjaanLuarRab.findMany({ where: { id: { in: [c1, c2] } } });
    expect(catatan.map((c) => c.reportItemId)).toEqual([baris[0]!.id, baris[0]!.id]);
    expect(catatan.every((c) => c.dipadankanById === userId && c.dipadankanAt)).toBe(true);
    const f = await db.photo.findUniqueOrThrow({ where: { id: foto1 } });
    expect([f.reportItemId, f.luarRabId]).toEqual([baris[0]!.id, c1]);
    // Catatan yang sudah dipadankan tidak lagi menunggu.
    expect((await svc.dataPadanan(locationId)).catatan.map((c) => c.id)).not.toContain(c1);
  });

  it("melebihi sisa draft dan bentrok dengan isian langsung DITAHAN, tidak ada yang ditulis", async () => {
    const batu = await nodeDraft(draftId, "3");
    const plester = await nodeDraft(draftId, "4");
    const lap = await getOrCreateDraft(locationId, "2026-10-06", userId);
    // Sisa batu = 10 − 3,5 = 6,5.
    const lebih = (await svc.catatLuarRab(lap.id, { uraian: "Pasangan batu kali", satuan: "m3", volume: 7 }, userId)).id;
    await upsertItem(lap.id, { rabNodeId: plester.id, volumeDone: 4 }, userId);
    const tabrak = (await svc.catatLuarRab(lap.id, { uraian: "Plesteran talud", satuan: "m2", volume: 3 }, userId)).id;
    const h = await svc.gabungkanLuarRab(
      locationId,
      [
        { catatanId: lebih, kandidatId: batu.id, terimaSatuanBeda: false },
        { catatanId: tabrak, kandidatId: plester.id, terimaSatuanBeda: false },
      ],
      userId,
    );
    expect(h.baris).toBe(0);
    expect(h.ditahan.map((d) => d.status).sort()).toEqual(["bentrok", "melebihi"]);
    const rows = await db.dailyReportItem.findMany({ where: { reportId: lap.id } });
    expect(rows.map((r) => Number(r.volumeDone))).toEqual([4]);
    expect(await db.pekerjaanLuarRab.count({ where: { id: { in: [lebih, tabrak] }, reportItemId: { not: null } } })).toBe(0);
    await svc.hapusLuarRab(lap.id, lebih, userId);
    await svc.hapusLuarRab(lap.id, tabrak, userId);
  });

  it("lepas padanan: baris berkurang, lalu hilang; catatan dan fotonya kembali menunggu", async () => {
    await svc.lepasPadanan(c2, userId);
    const baris = await db.dailyReportItem.findMany({ where: { reportId: lapFinal } });
    expect(baris.map((b) => Number(b.volumeDone))).toEqual([2]);
    await svc.lepasPadanan(c1, userId);
    expect(await db.dailyReportItem.count({ where: { reportId: lapFinal } })).toBe(0);
    const f = await db.photo.findUniqueOrThrow({ where: { id: foto1 } });
    expect([f.reportItemId, f.luarRabId]).toEqual([null, c1]);
    const d = await svc.dataPadanan(locationId);
    expect(d.catatan.map((c) => c.id)).toEqual(expect.arrayContaining([c1, c2]));
    const snap = (await db.dailyReport.findUniqueOrThrow({ where: { id: lapFinal } })).finalSnapshot as { itemsDraftAdendum?: number };
    expect(snap.itemsDraftAdendum).toBe(0);
  });

  it("draft diganti berkas tanpa item itu: impor TIDAK ditahan, catatan kembali menunggu", async () => {
    const batu = await nodeDraft(draftId, "3");
    await svc.gabungkanLuarRab(locationId, [{ catatanId: c1, kandidatId: batu.id, terimaSatuanBeda: false }], userId);
    // Baris draft yang diketik langsung DAN punya padanan tetap pindah seperti biasa.
    const tanpaBatu = await buatDraft([GALIAN, URUGAN, PLESTER]);
    const h = await gantiDraftLama(draftId, tanpaBatu, userId);
    expect(h.catatanLuarRabDilepas).toBe(1);
    expect(h.dipindah).toBe(1); // baris plester 2026-10-06
    draftId = tanpaBatu;
    const c = await db.pekerjaanLuarRab.findUniqueOrThrow({ where: { id: c1 } });
    expect(c.reportItemId).toBeNull();
    expect(await db.dailyReportItem.count({ where: { reportId: lapFinal } })).toBe(0);
  });

  it("baris campuran (catatan + isian langsung) yang itemnya hilang: catatan lama kembali menunggu, sisanya jadi catatan berasal-draft (DECISIONS 755)", async () => {
    const denganBatu = await buatDraft([GALIAN, URUGAN, BATU, PLESTER]);
    await gantiDraftLama(draftId, denganBatu, userId);
    draftId = denganBatu;
    const batu = await nodeDraft(draftId, "3");
    await svc.gabungkanLuarRab(locationId, [{ catatanId: c1, kandidatId: batu.id, terimaSatuanBeda: false }], userId);
    const row = await db.dailyReportItem.findFirstOrThrow({ where: { reportId: lapFinal, rabNodeId: batu.id } });
    // Volumenya ditambah langsung, bukan dari catatan: baris tidak lagi murni catatan.
    await db.dailyReportItem.update({ where: { id: row.id }, data: { volumeDone: Number(row.volumeDone) + 1.25 } });
    const noLama = (await db.rabRevision.findUniqueOrThrow({ where: { id: draftId } })).revisionNo;

    const tanpaBatu = await buatDraft([GALIAN, URUGAN, PLESTER]);
    const h = await gantiDraftLama(draftId, tanpaBatu, userId);
    draftId = tanpaBatu;
    expect(h.jadiCatatan.map((r) => r.nama)).toEqual(["Pasangan Batu Kali Talud"]);
    expect(await db.dailyReportItem.findUnique({ where: { id: row.id } })).toBeNull();
    expect((await db.pekerjaanLuarRab.findUniqueOrThrow({ where: { id: c1 } })).reportItemId).toBeNull();
    const baru = await db.pekerjaanLuarRab.findFirstOrThrow({ where: { reportId: lapFinal, asalDraftNo: noLama } });
    expect([baru.uraian, baru.satuan, Number(baru.volume), baru.reportItemId]).toEqual(["Pasangan Batu Kali Talud", "m3", 1.25, null]);
    const f = await db.photo.findUniqueOrThrow({ where: { id: foto1 } });
    expect([f.reportItemId, f.luarRabId]).toEqual([null, c1]);
    // Snapshot laporan final dibangun ulang: baris draft-nya sudah tidak ada.
    const snap = (await db.dailyReport.findUniqueOrThrow({ where: { id: lapFinal } })).finalSnapshot as { itemsDraftAdendum?: number };
    expect(snap.itemsDraftAdendum).toBe(0);
    // Bersihkan catatan baru supaya uji rekap di bawah tetap berdiri sendiri.
    await db.pekerjaanLuarRab.delete({ where: { id: baru.id } });
  });

  it("draft dibuang: baris dari catatan dilepas, baris isian langsung jadi catatan berasal-draft (DECISIONS 759)", async () => {
    const baruLagi = await buatDraft([GALIAN, URUGAN, BATU, PLESTER]);
    await gantiDraftLama(draftId, baruLagi, userId);
    draftId = baruLagi;
    const batu = await nodeDraft(draftId, "3");
    await svc.gabungkanLuarRab(locationId, [{ catatanId: c1, kandidatId: batu.id, terimaSatuanBeda: false }], userId);
    const noDraft = (await db.rabRevision.findUniqueOrThrow({ where: { id: draftId } })).revisionNo;
    // Baris plester isian langsung masih menunjuk draft ini – tidak lagi menahan.
    const lap = await db.dailyReport.findFirstOrThrow({ where: { locationId, reportDate: new Date("2026-10-06") } });
    const hasil = await discardDraft(draftId, userId);
    expect([hasil.catatanLuarRabDilepas, hasil.jadiCatatan]).toEqual([1, 1]);
    expect((await db.pekerjaanLuarRab.findUniqueOrThrow({ where: { id: c1 } })).reportItemId).toBeNull();
    expect(await db.dailyReportItem.count({ where: { reportId: lap.id } })).toBe(0);
    const plester = await db.pekerjaanLuarRab.findFirstOrThrow({ where: { reportId: lap.id, asalDraftNo: noDraft } });
    expect([plester.uraian, plester.satuan, Number(plester.volume)]).toEqual(["Plesteran Dinding Talud", "m2", 4]);
    // Bersihkan catatan berasal-draft supaya uji rekap di bawah tetap berdiri sendiri.
    await db.pekerjaanLuarRab.delete({ where: { id: plester.id } });
    draftId = await buatDraft([GALIAN, URUGAN, BATU, PLESTER]);
  });

  it("batalkan dengan alasan: keluar dari daftar tunggu tapi tetap tersimpan berikut fotonya; bisa diaktifkan lagi", async () => {
    await expect(svc.batalkanLuarRab(c2, "  ", userId)).rejects.toThrow(/alasan/);
    await svc.batalkanLuarRab(c2, "Sudah termasuk item galian", userId);
    expect((await svc.dataPadanan(locationId)).catatan.map((c) => c.id)).not.toContain(c2);
    const c = await db.pekerjaanLuarRab.findUniqueOrThrow({ where: { id: c2 }, include: { photos: true } });
    expect(c.alasanBatal).toBe("Sudah termasuk item galian");
    expect(c.photos).toHaveLength(1);
    const batu = await nodeDraft(draftId, "3");
    const h = await svc.gabungkanLuarRab(locationId, [{ catatanId: c2, kandidatId: batu.id, terimaSatuanBeda: false }], userId);
    expect(h.baris).toBe(0);
    const rekapBatal = await svc.rekapLuarRab(locationId, (await svc.dataPadanan(locationId)).catatan);
    expect(rekapBatal.dibatalkan.map((c) => [c.id, c.alasan, c.oleh])).toEqual([[c2, "Sudah termasuk item galian", "Penguji"]]);
    await svc.aktifkanLagiLuarRab(c2, userId);
    expect((await svc.dataPadanan(locationId)).catatan.map((c) => c.id)).toContain(c2);
  });

  it("rekap bahan CCO: yang menunggu dikelompokkan per uraian + satuan, dijumlahkan", async () => {
    const lap = await getOrCreateDraft(locationId, "2026-10-08", userId);
    await svc.catatLuarRab(lap.id, { uraian: "Pasangan batu kali talud sisi timur", satuan: "M3", volume: 0.5 }, userId);
    const d = await svc.dataPadanan(locationId);
    const r = await svc.rekapLuarRab(locationId, d.catatan);
    const g = r.kelompok.find((k) => k.uraian.toLowerCase().includes("sisi timur"));
    expect(g).toMatchObject({ volume: 2, jumlahCatatan: 2, tanggalAwal: "2026-10-05", tanggalAkhir: "2026-10-08" });
  });

  it("aktivasi adendum: barisnya naik jadi resmi dan tidak bisa dilepas lagi dari sini", async () => {
    const batu = await nodeDraft(draftId, "3");
    await svc.gabungkanLuarRab(locationId, [{ catatanId: c1, kandidatId: batu.id, terimaSatuanBeda: false }], userId);
    const sebelum = await getLocationProgress(locationId);
    await activateRevision(draftId, userId);
    const baris = await db.dailyReportItem.findFirstOrThrow({ where: { reportId: lapFinal } });
    expect(baris.basis).toBe("aktif");
    const sesudah = await getLocationProgress(locationId);
    expect(sesudah.realizedValue).toBeGreaterThan(sebelum.realizedValue);
    await expect(svc.lepasPadanan(c1, userId)).rejects.toThrow(/sudah diaktifkan/);
  });
});
