// PEMASANGAN REALISASI SESUDAH AKTIVASI ADENDUM (DECISIONS 777) – terhadap
// DATABASE ASLI, dengan aktivasi sungguhan (`activateRevision`).
//
// Permintaan user 2026-11-25: *"buat bisa dipasangkan sesudah aktivasi, menu
// khusus. mitigasi semua resiko dan penanganannya"*.
//
// Yang dijaga:
// 1. item yang hilang dan yang dinolkan saat aktivasi DISEBUT, dengan calon
//    tujuan yang sah saja;
// 2. usulan baru berlaku sesudah DUA persetujuan (PD + AM/PM/SM); sebelum itu
//    angka resmi tidak bergerak sedikit pun;
// 3. berlaku = baris laporan item lama pindah ke item aktif (foto tetap),
//    volume yang dinolkan dipulihkan dari jejak aktivasi, progres menghitungnya;
// 4. Lepas mengembalikan keadaan persis seperti sesudah aktivasi;
// 5. penolakan yang tersisa: laporan belum dikirim, usulan ganda, revisi aktif
//    berganti, baris yang sudah diubah orang, peran yang tidak berhak, beda
//    satuan tanpa isian volume, isian di atas sisa.
// 6. (DECISIONS 780) sisa volume KURANG tidak menolak: kelebihannya dipotong
//    dibagi rata, Lepas mengembalikan angka aslinya;
// 7. (DECISIONS 780) catatan pekerjaan di luar RAB dipasangkan ke item RAB
//    aktif: jadi baris laporan pada tanggal aslinya (atau menumpang di baris
//    yang sudah ada), fotonya ikut, Lepas mengembalikan catatannya menunggu.
// 8. (DECISIONS 781) tujuannya SEMUA item pekerjaan RAB aktif: beda kategori
//    dan beda satuan boleh (satuan ikut item tujuan, volume diisi), sisa 0
//    hanya memetakan, laporan yang memuat keduanya ditampung baris item tujuan.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth/session", () => ({ requestIp: async () => null }));

const { db } = await import("@/lib/db");
const { activateRevision } = await import("@/lib/rab/import");
const { cumulativeVolumeByLineage, volumeTidakTerbobotByLineage } = await import("@/lib/progress");
const { lepasPadanan: lepasPadananDraft, batalkanLuarRab } = await import("@/lib/luar-rab/service");
const {
  ajukanPadananAktif,
  ajukanPadananLuarRab,
  dataPadananAktif,
  lepasPadananAktif,
  PadananAktifError,
  setujuiPadananAktif,
  tutupPadananAktif,
} = await import("@/lib/rab/padanan-aktif");

const suffix = `pa${Date.now().toString(36)}`;
let orgId = "";
const U: Record<"sm" | "pd" | "sa" | "pm", { id: string; role: "site_manager" | "program_director" | "super_admin" | "project_manager" }> = {
  sm: { id: "", role: "site_manager" },
  pd: { id: "", role: "program_director" },
  sa: { id: "", role: "super_admin" },
  pm: { id: "", role: "project_manager" },
};
let nLokasi = 0;
const DAY = 86_400_000;
const tgl = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * DAY);
const ALASAN = "Pekerjaan yang sama, namanya berubah di adendum.";

type Lokasi = {
  locationId: string;
  aktifId: string;
  node: Record<string, string>;
  /** Baris laporan I#1 (hari 0 dan 1) dan I#2 (hari 0). */
  barisI1: string[];
  barisI2: string;
  fotoId: string;
  lapor: (hari: number, isi: { node: string; lineageKey: string; vol: number }[], status?: "final" | "draft") => Promise<string[]>;
};

/*
 * Revisi 1 (aktif lalu digantikan):
 *   I  PEKERJAAN PONDASI   I#1 Tapak beton menerus (m3, 10) – terlapor 4 + 3
 *                          I#2 Urugan pasir (m3, 5)         – terlapor 2
 *   II PEKERJAAN DINDING   II#1 Pasangan bata (m2, 40)
 * Revisi 2 (adendum, diaktifkan sungguhan):
 *   I#1 DIHAPUS · I#2 volume 0 · I#3 BARU Pondasi batu belah (m3, 8)
 *   I#4 BARU Plester (m2) · II#1 tetap · II#9 BARU Beton kolom (m3)
 * Sesudah aktivasi: I#3 dilaporkan 1 m3.
 */
async function siapkan(): Promise<Lokasi> {
  nLokasi++;
  const pkg = await db.package.create({ data: { orgId, name: `Paket ${suffix}-${nLokasi}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${nLokasi}`,
      slug: `lok-${suffix}-${nLokasi}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      isActive: true,
    },
  });
  const rev = (no: number, status: "aktif" | "draft", source: "hps_awal" | "adendum") =>
    db.rabRevision.create({ data: { locationId: loc.id, revisionNo: no, source, status, totalValue: 0n } });
  const r1 = await rev(1, "aktif", "hps_awal");
  const r2 = await rev(2, "draft", "adendum");
  const node = (
    revisionId: string,
    lineageKey: string,
    kind: "kategori" | "item",
    name: string,
    parentId: string | null,
    sortOrder: number,
    unit: string | null = null,
    volume: number | null = null,
  ) =>
    db.rabNode.create({
      data: {
        revisionId,
        parentId,
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
  const aI = await node(r1.id, "I", "kategori", "PEKERJAAN PONDASI", null, 0);
  const a1 = await node(r1.id, "I#1", "item", "Tapak beton menerus", aI.id, 1, "m3", 10);
  const a2 = await node(r1.id, "I#2", "item", "Urugan pasir", aI.id, 2, "m3", 5);
  const aII = await node(r1.id, "II", "kategori", "PEKERJAAN DINDING", null, 3);
  await node(r1.id, "II#1", "item", "Pasangan bata", aII.id, 4, "m2", 40);

  const dI = await node(r2.id, "I", "kategori", "PEKERJAAN PONDASI", null, 0);
  await node(r2.id, "I#2", "item", "Urugan pasir", dI.id, 1, "m3", 0);
  const d3 = await node(r2.id, "I#3", "item", "Pondasi batu belah", dI.id, 2, "m3", 8);
  const d4 = await node(r2.id, "I#4", "item", "Plester", dI.id, 3, "m2", 12);
  const dII = await node(r2.id, "II", "kategori", "PEKERJAAN DINDING", null, 4);
  await node(r2.id, "II#1", "item", "Pasangan bata", dII.id, 5, "m2", 40);
  await node(r2.id, "II#9", "item", "Beton kolom", dII.id, 6, "m3", 3);

  const lapor: Lokasi["lapor"] = async (hari, isi, status = "final") => {
    const r = await db.dailyReport.create({
      data: { locationId: loc.id, reportDate: tgl(hari), status, createdById: U.sm.id, weather: "cerah" },
    });
    const ids: string[] = [];
    for (const i of isi) {
      const row = await db.dailyReportItem.create({
        data: {
          reportId: r.id,
          rabNodeId: i.node,
          lineageKey: i.lineageKey,
          basis: "aktif",
          volumeDone: i.vol,
          valueDone: BigInt(Math.round(i.vol * 100_000)),
        },
      });
      ids.push(row.id);
    }
    return ids;
  };
  const h0 = await lapor(0, [
    { node: a1.id, lineageKey: "I#1", vol: 4 },
    { node: a2.id, lineageKey: "I#2", vol: 2 },
  ]);
  const h1 = await lapor(1, [{ node: a1.id, lineageKey: "I#1", vol: 3 }]);
  const foto = await db.photo.create({
    data: {
      locationId: loc.id,
      reportId: (await db.dailyReportItem.findUniqueOrThrow({ where: { id: h0[0] } })).reportId,
      reportItemId: h0[0],
      r2Key: `uji/${suffix}/${nLokasi}.webp`,
      sha256: `${suffix}-${nLokasi}`,
      bytes: 10,
    },
  });

  // AKTIVASI SUNGGUHAN: I#1 hilang, laporan I#2 diturunkan 2 → 0 (berjejak audit).
  await activateRevision(r2.id, U.sm.id);
  await lapor(5, [{ node: d3.id, lineageKey: "I#3", vol: 1 }]);

  return {
    locationId: loc.id,
    aktifId: r2.id,
    node: { a1: a1.id, a2: a2.id, d3: d3.id, d4: d4.id },
    barisI1: [h0[0], h1[0]],
    barisI2: h0[1],
    fotoId: foto.id,
    lapor,
  };
}

const kumulatif = async (L: Lokasi, k: string) => (await cumulativeVolumeByLineage(L.locationId)).get(k) ?? 0;
const ajukan = (L: Lokasi, lama: string, baru: string, userId = U.sm.id) =>
  ajukanPadananAktif({ locationId: L.locationId, lineageLama: lama, lineageBaru: baru, alasan: ALASAN, userId });
const setujui = (id: string, u: { id: string; role: (typeof U)["sm"]["role"] }) => setujuiPadananAktif({ padananId: id, user: u });
const gagalDengan = async (p: Promise<unknown>, pola: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(PadananAktifError);
  await expect(p).rejects.toThrow(pola);
};

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  for (const k of Object.keys(U) as (keyof typeof U)[]) {
    const u = await db.user.create({
      data: { orgId, username: `${k}-${suffix}`, fullName: `${k.toUpperCase()} Uji`, role: U[k].role, passwordHash: "x" },
    });
    U[k].id = u.id;
  }
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE audit_logs, rab_padanan_aktif_setuju, rab_padanan_aktif, photos, pekerjaan_luar_rab, daily_report_items, daily_reports, rab_nodes, rab_revisions, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("yang belum dipasangkan sesudah aktivasi disebut; tujuannya semua item pekerjaan RAB aktif", () => {
  it("I#1 hilang (7 m3) dan I#2 dinolkan (2 m3 dari jejak aktivasi); semua item RAB aktif ditawarkan dengan sisanya", async () => {
    const L = await siapkan();
    // Prasyarat dari aktivasi sungguhan: I#2 memang diturunkan ke 0.
    expect(Number((await db.dailyReportItem.findUniqueOrThrow({ where: { id: L.barisI2 } })).volumeDone)).toBe(0);

    const d = await dataPadananAktif(L.locationId);
    expect(d.belum.map((b) => [b.lineageKey, b.jenis, b.volume, b.jumlahLaporan])).toEqual([
      ["I#1", "hilang", 7, 2],
      ["I#2", "dinolkan", 2, 1],
    ]);
    expect(d.belum.every((b) => b.terhalang === null)).toBe(true);
    // I#2 yang dinolkan bukan tujuan: item dinolkan tidak muncul di daftar pilihan (798).
    expect(d.calon.map((c) => [c.lineageKey, c.unit, c.sisa])).toEqual([
      ["I#3", "m3", 7],
      ["I#4", "m2", 12],
      ["II#1", "m2", 40],
      ["II#9", "m3", 3],
    ]);
  });
});

describe("item yang hilang: dua persetujuan, berlaku, lalu dilepas", () => {
  it("sebelum lengkap angka resmi tidak bergerak; sesudah lengkap baris pindah, fotonya tetap, progres menghitungnya", async () => {
    const L = await siapkan();
    const { id, ringkasan } = await ajukan(L, "I#1", "I#3");
    expect([ringkasan.volume, ringkasan.baris]).toEqual([7, 2]);

    // Satu kursi saja – juga bila orang yang sama menekan dua kali.
    expect(await setujui(id, U.sm)).toEqual({ berlaku: false, kurang: ["persetujuan Program Director"] });
    expect(await setujui(id, U.sm)).toEqual({ berlaku: false, kurang: ["persetujuan Program Director"] });
    expect(await kumulatif(L, "I#3")).toBe(1);
    expect((await volumeTidakTerbobotByLineage(L.locationId)).get("I#1")).toBe(7);

    const h = await setujui(id, U.pd);
    expect(h).toMatchObject({ berlaku: true, baris: 2, volume: 7, jenis: "hilang" });
    expect(await kumulatif(L, "I#3")).toBe(8);
    expect((await volumeTidakTerbobotByLineage(L.locationId)).has("I#1")).toBe(false);
    const rows = await db.dailyReportItem.findMany({ where: { id: { in: L.barisI1 } } });
    const perId = new Map(rows.map((r) => [r.id, r]));
    expect(L.barisI1.map((k) => perId.get(k)!).map((r) => [r.lineageKey, Number(r.volumeDone), r.padananAktifId, r.volumeSebelumPadanan])).toEqual([
      ["I#3", 4, id, null],
      ["I#3", 3, id, null],
    ]);
    // Node asal dan fotonya tidak disentuh.
    expect(rows.every((r) => r.rabNodeId === L.node.a1)).toBe(true);
    expect((await db.photo.findUniqueOrThrow({ where: { id: L.fotoId } })).reportItemId).toBe(L.barisI1[0]);
    const jejak = await db.auditLog.findFirst({ where: { action: "rab.padanan_aktif_berlaku", resourceId: id } });
    expect((jejak?.payload as { baris: unknown[] }).baris).toHaveLength(2);
    expect((await dataPadananAktif(L.locationId)).belum.map((b) => b.lineageKey)).toEqual(["I#2"]);

    // LEPAS: kembali persis seperti sesudah aktivasi.
    const l = await lepasPadananAktif({ padananId: id, userId: U.sm.id, alasan: "Salah pilih item tujuan." });
    expect(l.baris).toBe(2);
    expect(await kumulatif(L, "I#3")).toBe(1);
    expect((await volumeTidakTerbobotByLineage(L.locationId)).get("I#1")).toBe(7);
    const kembali = await db.dailyReportItem.findMany({ where: { id: { in: L.barisI1 } } });
    expect(kembali.every((r) => r.lineageKey === "I#1" && r.padananAktifId === null)).toBe(true);
    const u = (await dataPadananAktif(L.locationId)).usulan.find((x) => x.id === id)!;
    expect(u.keadaan).toBe("dilepas");
    // Sesudah dilepas boleh diajukan lagi.
    await expect(ajukan(L, "I#1", "I#3")).resolves.toMatchObject({ ringkasan: { volume: 7 } });
  });
});

describe("item yang dinolkan: volumenya dipulihkan dari jejak aktivasi", () => {
  it("berlaku: 0 → 2 di item tujuan; lepas: kembali 0 di item lamanya", async () => {
    const L = await siapkan();
    const { id } = await ajukan(L, "I#2", "I#3");
    await setujui(id, U.pd);
    expect(await setujui(id, U.pm)).toMatchObject({ berlaku: true, baris: 1, volume: 2, jenis: "dinolkan" });
    const r = await db.dailyReportItem.findUniqueOrThrow({ where: { id: L.barisI2 } });
    expect([r.lineageKey, Number(r.volumeDone), Number(r.volumeSebelumPadanan), Number(r.valueDone)]).toEqual(["I#3", 2, 0, 200_000]);
    expect(await kumulatif(L, "I#3")).toBe(3);

    await lepasPadananAktif({ padananId: id, userId: U.sm.id, alasan: "Batal, menunggu adendum berikutnya." });
    const k = await db.dailyReportItem.findUniqueOrThrow({ where: { id: L.barisI2 } });
    expect([k.lineageKey, Number(k.volumeDone), k.volumeSebelumPadanan, Number(k.valueDone)]).toEqual(["I#2", 0, null, 0]);
    expect(await kumulatif(L, "I#3")).toBe(1);
  });

  it("angka yang sudah diubah orang sesudah aktivasi dipakai apa adanya, tidak ditimpa angka lama", async () => {
    const L = await siapkan();
    await db.dailyReportItem.update({ where: { id: L.barisI2 }, data: { volumeDone: 0.5 } });
    const b = (await dataPadananAktif(L.locationId)).belum.find((x) => x.lineageKey === "I#2")!;
    expect([b.volume, b.terhalang]).toEqual([0.5, null]);
    await expect(ajukan(L, "I#2", "I#3")).resolves.toMatchObject({ ringkasan: { volume: 0.5, volumeAsal: 0.5 } });
  });
});

describe("penolakan", () => {
  it("item yang tidak ada di RAB aktif, dan item yang masih bervolume", async () => {
    const L = await siapkan();
    await gagalDengan(ajukan(L, "I#1", "I#9"), /tidak ada di RAB aktif/);
    await gagalDengan(ajukan(L, "I#3", "I#3"), /masih ada di RAB aktif dan bervolume/);
  });

  it("laporan item lama yang belum dikirim", async () => {
    const M = await siapkan();
    await M.lapor(8, [{ node: M.node.a1, lineageKey: "I#1", vol: 0.5 }], "draft");
    await gagalDengan(ajukan(M, "I#1", "I#3"), /9 Oktober 2026 .* belum dikirim/);
  });

  it("usulan ganda untuk item yang sama ditolak; ditolak PD dengan alasan → boleh diajukan lagi", async () => {
    const L = await siapkan();
    const { id } = await ajukan(L, "I#1", "I#3");
    await gagalDengan(ajukan(L, "I#1", "I#3"), /sudah diusulkan/);
    await tutupPadananAktif({ padananId: id, user: U.pd, cara: "tolak", alasan: "Item tujuan belum tepat, cek gambar." });
    expect((await dataPadananAktif(L.locationId)).usulan[0]).toMatchObject({ keadaan: "ditutup" });
    await expect(ajukan(L, "I#1", "I#3")).resolves.toBeTruthy();
  });

  it("super admin tidak bisa menyetujui; alasan terlalu pendek ditolak", async () => {
    const L = await siapkan();
    const { id } = await ajukan(L, "I#1", "I#3");
    await gagalDengan(setujui(id, U.sa), /tidak berhak/);
    await gagalDengan(
      ajukanPadananAktif({ locationId: L.locationId, lineageLama: "I#2", lineageBaru: "I#3", alasan: "ok", userId: U.sm.id }),
      /minimal 10 huruf/,
    );
  });

  it("sisa berkurang di antara diajukan dan disetujui: diperiksa ulang, volumenya dipotong ke sisa dan disebut", async () => {
    const L = await siapkan();
    const { id } = await ajukan(L, "I#1", "I#3");
    await setujui(id, U.sm);
    // Sesudah diajukan (7 m3), I#3 dilaporkan lagi 5 m3: sisanya tinggal 2.
    await L.lapor(9, [{ node: L.node.d3, lineageKey: "I#3", vol: 5 }]);
    expect(await setujui(id, U.pd)).toMatchObject({ berlaku: true, volume: 2, dipotong: 5 });
    expect(await kumulatif(L, "I#3")).toBe(8);
    const jejak = await db.auditLog.findFirst({ where: { action: "rab.padanan_aktif_berlaku", resourceId: id } });
    expect(jejak?.payload).toMatchObject({ volumeDiminta: 7, volume: 2, dipotong: 5 });
  });

  it("revisi aktif berganti: usulan tidak bisa berlaku dan pasangan tidak bisa dilepas", async () => {
    const L = await siapkan();
    const a = await ajukan(L, "I#1", "I#3");
    const b = await ajukan(L, "I#2", "I#3");
    await setujui(b.id, U.sm);
    await setujui(b.id, U.pd);
    await setujui(a.id, U.sm);
    // Adendum berikutnya diaktifkan (disederhanakan: status revisi diganti langsung).
    const r3 = await db.rabRevision.create({ data: { locationId: L.locationId, revisionNo: 3, source: "adendum", status: "draft", totalValue: 0n } });
    await db.rabRevision.update({ where: { id: L.aktifId }, data: { status: "digantikan", supersededAt: new Date() } });
    await db.rabRevision.update({ where: { id: r3.id }, data: { status: "aktif" } });
    await gagalDengan(setujui(a.id, U.pd), /RAB aktif sudah berganti/);
    await gagalDengan(
      lepasPadananAktif({ padananId: b.id, userId: U.sm.id, alasan: "Mau dikembalikan saja." }),
      /RAB aktif sudah berganti.*tidak bisa dilepas/,
    );
  });

  it("Lepas tidak menimpa baris yang sudah diubah orang sesudah dipasangkan", async () => {
    const L = await siapkan();
    const { id } = await ajukan(L, "I#1", "I#3");
    await setujui(id, U.sm);
    await setujui(id, U.pd);
    await db.$executeRaw`UPDATE daily_report_items SET volume_done = 3.5, updated_at = now() + interval '1 hour' WHERE id = ${L.barisI1[1]}::uuid`;
    await gagalDengan(
      lepasPadananAktif({ padananId: id, userId: U.sm.id, alasan: "Salah pilih item tujuan." }),
      /2 Oktober 2026 sudah diubah sesudah dipasangkan/,
    );
  });
});

/*
 * KELEBIHAN DIPOTONG, TIDAK DITOLAK (DECISIONS 780). Keluhan user 2026-11-25
 * dengan tangkapan layar "3 item cocok tetapi sisa volumenya kurang": *"apa
 * gunanya ini? gimana aku mau memasangkan ini ke rab aktif?"*.
 */
describe("sisa volume item tujuan kurang: kelebihannya dipotong dibagi rata, Lepas mengembalikan", () => {
  it("I#1 7 m3 → I#3 yang sisanya 5,5: masuk 5,5, dipotong 1,5; dilepas kembali 4 + 3", async () => {
    const L = await siapkan();
    await L.lapor(6, [{ node: L.node.d3, lineageKey: "I#3", vol: 1.5 }]);
    expect((await dataPadananAktif(L.locationId)).calon.find((c) => c.lineageKey === "I#3")?.sisa).toBe(5.5);

    const { id, ringkasan } = await ajukan(L, "I#1", "I#3");
    expect([ringkasan.volume, ringkasan.dipotong]).toEqual([5.5, 1.5]);
    await setujui(id, U.sm);
    expect(await setujui(id, U.pd)).toMatchObject({ berlaku: true, volume: 5.5, dipotong: 1.5 });
    const rows = new Map((await db.dailyReportItem.findMany({ where: { id: { in: L.barisI1 } } })).map((r) => [r.id, r]));
    expect(L.barisI1.map((k) => rows.get(k)!).map((r) => [Number(r.volumeDone), Number(r.volumeSebelumPadanan)])).toEqual([
      [3.143, 4],
      [2.357, 3],
    ]);
    expect(await kumulatif(L, "I#3")).toBe(8);

    await lepasPadananAktif({ padananId: id, userId: U.sm.id, alasan: "Tunggu adendum menaikkan volume." });
    const k = new Map((await db.dailyReportItem.findMany({ where: { id: { in: L.barisI1 } } })).map((r) => [r.id, r]));
    expect(L.barisI1.map((x) => k.get(x)!).map((r) => [r.lineageKey, Number(r.volumeDone), r.volumeSebelumPadanan])).toEqual([
      ["I#1", 4, null],
      ["I#1", 3, null],
    ]);
    expect(await kumulatif(L, "I#3")).toBe(2.5);
  });
});

/* ── Catatan pekerjaan di luar RAB → item RAB aktif (DECISIONS 780) ───── */

const laporan = async (L: Lokasi, hari: number, status: "final" | "dikirim" | "draft" = "final") =>
  (
    await db.dailyReport.create({
      data: { locationId: L.locationId, reportDate: tgl(hari), status, createdById: U.sm.id, weather: "cerah" },
    })
  ).id;
const catat = async (L: Lokasi, reportId: string, uraian: string, satuan: string, volume: number) =>
  (await db.pekerjaanLuarRab.create({ data: { locationId: L.locationId, reportId, uraian, satuan, volume, createdById: U.sm.id } })).id;
const ajukanLuar = (L: Lokasi, ids: string[], baru: string) =>
  ajukanPadananLuarRab({ locationId: L.locationId, luarRabIds: ids, lineageBaru: baru, alasan: ALASAN, userId: U.sm.id });

describe("catatan pekerjaan di luar RAB dipasangkan ke item RAB aktif", () => {
  it("dikelompokkan dan disarankan; berlaku jadi baris laporan pada tanggal aslinya dengan fotonya; Lepas mengembalikannya", async () => {
    const L = await siapkan();
    const r10 = await laporan(L, 10);
    const r11 = await laporan(L, 11, "dikirim");
    const r12 = await laporan(L, 12, "draft");
    const c1 = await catat(L, r10, "Pondasi batu belah tambahan", "m3", 2);
    const c2 = await catat(L, r10, "pondasi  batu belah tambahan", "M3", 1);
    const c3 = await catat(L, r11, "Pondasi batu belah tambahan", "m3", 1.5);
    await catat(L, r12, "Pondasi batu belah tambahan", "m3", 0.5);
    const foto = await db.photo.create({
      data: { locationId: L.locationId, reportId: r10, luarRabId: c1, r2Key: `uji/${suffix}/luar.webp`, sha256: `${suffix}-luar`, bytes: 10 },
    });

    const d = await dataPadananAktif(L.locationId);
    expect(d.luarRab).toHaveLength(1);
    const k = d.luarRab[0]!;
    expect([k.catatanIds.sort(), k.volume, k.jumlahLaporan, k.tertahan?.jumlah]).toEqual([[c1, c2, c3].sort(), 4.5, 2, 1]);
    expect(k.saran[0]).toBe("I#3");
    // Tujuan: semua item pekerjaan RAB aktif (781), kecuali yang dinolkan (798).
    expect(d.calon.map((c) => c.lineageKey)).toEqual(["I#3", "I#4", "II#1", "II#9"]);

    // Catatan di laporan yang belum dikirim tidak bisa ikut.
    const draftId = (await db.pekerjaanLuarRab.findFirstOrThrow({ where: { reportId: r12 } })).id;
    await gagalDengan(ajukanLuar(L, [c1, draftId], "I#3"), /belum dikirim/);

    const { id, ringkasan } = await ajukanLuar(L, [c1, c2, c3], "I#3");
    expect([ringkasan.volume, ringkasan.baris, ringkasan.catatan, ringkasan.dipotong]).toEqual([4.5, 2, 3, 0]);
    // Sedang diusulkan: hilang dari daftar menunggu, yang di laporan draft tetap disebut.
    expect((await dataPadananAktif(L.locationId)).luarRab.map((x) => [x.catatanIds.length, x.tertahan?.jumlah])).toEqual([[0, 1]]);
    await gagalDengan(ajukanLuar(L, [c3], "I#3"), /sudah diusulkan/);

    expect(await setujui(id, U.sm)).toMatchObject({ berlaku: false });
    expect(await kumulatif(L, "I#3")).toBe(1);
    expect(await setujui(id, U.pd)).toMatchObject({ berlaku: true, baris: 2, volume: 4.5, jenis: "luar_rab" });
    expect(await kumulatif(L, "I#3")).toBe(5.5);
    const baris = await db.dailyReportItem.findMany({ where: { padananAktifId: id }, orderBy: { volumeDone: "desc" } });
    expect(baris.map((b) => [b.reportId, b.lineageKey, b.basis, Number(b.volumeDone), Number(b.valueDone), b.volumeSebelumPadanan])).toEqual([
      [r10, "I#3", "aktif", 3, 300_000, null],
      [r11, "I#3", "aktif", 1.5, 150_000, null],
    ]);
    const catatan = new Map((await db.pekerjaanLuarRab.findMany({ where: { id: { in: [c1, c2, c3] } } })).map((c) => [c.id, c]));
    expect([c1, c2, c3].map((x) => catatan.get(x)!.reportItemId)).toEqual([baris[0]!.id, baris[0]!.id, baris[1]!.id]);
    expect((await db.photo.findUniqueOrThrow({ where: { id: foto.id } })).reportItemId).toBe(baris[0]!.id);
    // Lepas dari halaman Adendum (738) diarahkan ke menu ini.
    await expect(lepasPadananDraft(c1, U.sm.id)).rejects.toThrow(/Pasangkan realisasi/);
    expect((await dataPadananAktif(L.locationId)).usulan.find((u) => u.id === id)).toMatchObject({ keadaan: "berlaku", baris: 2 });

    await lepasPadananAktif({ padananId: id, userId: U.sm.id, alasan: "Salah pilih item tujuan." });
    expect(await db.dailyReportItem.count({ where: { id: { in: baris.map((b) => b.id) } } })).toBe(0);
    expect(await kumulatif(L, "I#3")).toBe(1);
    const kembali = await db.pekerjaanLuarRab.findMany({ where: { id: { in: [c1, c2, c3] } } });
    expect(kembali.every((c) => c.reportItemId === null && c.dipadankanAt === null)).toBe(true);
    expect(await db.photo.findUniqueOrThrow({ where: { id: foto.id } })).toMatchObject({ reportItemId: null, luarRabId: c1 });
    expect((await dataPadananAktif(L.locationId)).luarRab[0]!.catatanIds).toHaveLength(3);
  });

  it("laporan yang sudah punya baris item tujuan: catatannya ditambahkan ke baris itu; sisa kurang → dipotong; Lepas mengembalikan angkanya", async () => {
    const L = await siapkan();
    const [ada] = await L.lapor(13, [{ node: L.node.d3, lineageKey: "I#3", vol: 2 }]);
    const r13 = (await db.dailyReportItem.findUniqueOrThrow({ where: { id: ada! } })).reportId;
    const r14 = await laporan(L, 14);
    const c1 = await catat(L, r13, "Batu belah", "m3", 6);
    const c2 = await catat(L, r14, "Batu belah", "m3", 2);
    // I#3: volume 8, terlapor 1 + 2 = 3 → sisa 5. Catatan 8 → masuk 5, dipotong 3.
    const { id, ringkasan } = await ajukanLuar(L, [c1, c2], "I#3");
    expect([ringkasan.volume, ringkasan.dipotong]).toEqual([5, 3]);
    await setujui(id, U.pm);
    expect(await setujui(id, U.pd)).toMatchObject({ berlaku: true, volume: 5, dipotong: 3 });
    const a = await db.dailyReportItem.findUniqueOrThrow({ where: { id: ada! } });
    expect([Number(a.volumeDone), Number(a.volumeSebelumPadanan), a.padananAktifId]).toEqual([5.75, 2, id]);
    const baru = await db.dailyReportItem.findFirstOrThrow({ where: { reportId: r14, lineageKey: "I#3" } });
    expect(Number(baru.volumeDone)).toBe(1.25);
    expect(await kumulatif(L, "I#3")).toBe(8);

    await lepasPadananAktif({ padananId: id, userId: U.sm.id, alasan: "Volume menunggu adendum." });
    const a2 = await db.dailyReportItem.findUniqueOrThrow({ where: { id: ada! } });
    expect([Number(a2.volumeDone), a2.volumeSebelumPadanan, a2.padananAktifId, Number(a2.valueDone)]).toEqual([2, null, null, 200_000]);
    expect(await db.dailyReportItem.count({ where: { reportId: r14 } })).toBe(0);
    expect(await kumulatif(L, "I#3")).toBe(3);
  });

  it("baris hasil pemasangan dihapus lewat koreksi laporan: catatannya muncul lagi dan bisa dipasangkan ulang", async () => {
    const L = await siapkan();
    const r = await laporan(L, 17);
    const c = await catat(L, r, "Batu belah", "m3", 1);
    const { id } = await ajukanLuar(L, [c], "I#3");
    await setujui(id, U.sm);
    await setujui(id, U.pd);
    expect((await dataPadananAktif(L.locationId)).luarRab).toEqual([]);
    await db.dailyReportItem.deleteMany({ where: { padananAktifId: id } });
    expect((await dataPadananAktif(L.locationId)).luarRab.map((k) => k.catatanIds)).toEqual([[c]]);
    await expect(ajukanLuar(L, [c], "I#3")).resolves.toMatchObject({ ringkasan: { volume: 1 } });
  });

  it("penolakan: beda satuan tanpa isian volume, catatan yang dibatalkan di antara diajukan dan disetujui", async () => {
    const L = await siapkan();
    const r = await laporan(L, 15);
    const c = await catat(L, r, "Plesteran dinding", "m3", 1);
    await gagalDengan(ajukanLuar(L, [c], "I#4"), /Isi volume yang masuk dalam m2/);
    await gagalDengan(ajukanLuar(L, [c], "I#9"), /tidak ada di RAB aktif/);

    const { id } = await ajukanLuar(L, [c], "II#9");
    await setujui(id, U.sm);
    await batalkanLuarRab(c, "Ternyata dobel dengan laporan lain.", U.sm.id);
    await gagalDengan(setujui(id, U.pd), /sudah dibatalkan/);

  });
});

/* ── DECISIONS 781: semua item RAB aktif, satuan ikut tujuan, volume diisi ─ */

describe("tujuan = semua item pekerjaan RAB aktif; satuan ikut item tujuan, volume diisi paling banyak sebesar sisa", () => {
  it("beda satuan: tanpa isian ditolak, isian di atas sisa ditolak, isian sah dibagi ke laporan dan dilepas kembali", async () => {
    const L = await siapkan();
    // Harga item tujuan beda supaya nilai baris terbukti ikut item tujuan, lalu kembali saat dilepas.
    await db.rabNode.update({ where: { id: L.node.d4 }, data: { unitPrice: 50_000 } });
    await gagalDengan(ajukan(L, "I#1", "I#4"), /Satuan "Tapak beton menerus" \(m3\) berbeda dengan "Plester" \(m2\)\. Isi volume yang masuk dalam m2/);
    await gagalDengan(
      ajukanPadananAktif({ locationId: L.locationId, lineageLama: "I#1", lineageBaru: "I#4", volume: 13, alasan: ALASAN, userId: U.sm.id }),
      /Volume 13 m2 melebihi sisa "Plester" \(12 m2\)/,
    );
    const { id, ringkasan } = await ajukanPadananAktif({
      locationId: L.locationId,
      lineageLama: "I#1",
      lineageBaru: "I#4",
      volume: 10,
      alasan: ALASAN,
      userId: U.sm.id,
    });
    expect(ringkasan).toMatchObject({ volume: 10, unit: "m2", volumeAsal: 7, unitAsal: "m3", dipotong: 0 });
    await setujui(id, U.sm);
    expect(await setujui(id, U.pd)).toMatchObject({ berlaku: true, volume: 10 });
    const rows = new Map((await db.dailyReportItem.findMany({ where: { id: { in: L.barisI1 } } })).map((r) => [r.id, r]));
    expect(
      L.barisI1.map((k) => rows.get(k)!).map((r) => [r.lineageKey, Number(r.volumeDone), Number(r.volumeSebelumPadanan), Number(r.valueDone)]),
    ).toEqual([
      ["I#4", 5.714, 4, 285_700],
      ["I#4", 4.286, 3, 214_300],
    ]);
    expect(await kumulatif(L, "I#4")).toBe(10);

    await lepasPadananAktif({ padananId: id, userId: U.sm.id, alasan: "Salah pilih item tujuan." });
    const k = new Map((await db.dailyReportItem.findMany({ where: { id: { in: L.barisI1 } } })).map((r) => [r.id, r]));
    expect(L.barisI1.map((x) => k.get(x)!).map((r) => [r.lineageKey, Number(r.volumeDone), Number(r.valueDone)])).toEqual([
      ["I#1", 4, 400_000],
      ["I#1", 3, 300_000],
    ]);
  });

  it("beda kategori boleh: I#1 (I. PONDASI) → II#9 (II. DINDING), dibatasi sisa 3", async () => {
    const L = await siapkan();
    await expect(ajukan(L, "I#1", "II#9")).resolves.toMatchObject({ ringkasan: { volume: 3, dipotong: 4 } });
  });

  it("item tujuan yang sisanya 0: hanya dipetakan (volume 0), isian di atasnya ditolak", async () => {
    const L = await siapkan();
    await L.lapor(6, [{ node: L.node.d3, lineageKey: "I#3", vol: 7 }]);
    expect((await dataPadananAktif(L.locationId)).calon.find((c) => c.lineageKey === "I#3")?.sisa).toBe(0);
    await gagalDengan(
      ajukanPadananAktif({ locationId: L.locationId, lineageLama: "I#1", lineageBaru: "I#3", volume: 1, alasan: ALASAN, userId: U.sm.id }),
      /melebihi sisa "Pondasi batu belah" \(0 m3\)/,
    );
    const { id, ringkasan } = await ajukan(L, "I#1", "I#3");
    expect([ringkasan.volume, ringkasan.dipotong]).toEqual([0, 7]);
    await setujui(id, U.sm);
    await setujui(id, U.pd);
    expect(await kumulatif(L, "I#3")).toBe(8);
    expect((await volumeTidakTerbobotByLineage(L.locationId)).has("I#1")).toBe(false);
    const rows = await db.dailyReportItem.findMany({ where: { id: { in: L.barisI1 } } });
    expect(rows.every((r) => r.lineageKey === "I#3" && Number(r.volumeDone) === 0 && r.volumeSebelumPadanan != null)).toBe(true);
  });

  it("laporan yang memuat item lama DAN item tujuan: baris item tujuan menampung, baris lama jadi 0; Lepas mengembalikan keduanya", async () => {
    const L = await siapkan();
    const [lama7, tujuan7] = await L.lapor(7, [
      { node: L.node.a1, lineageKey: "I#1", vol: 0.5 },
      { node: L.node.d3, lineageKey: "I#3", vol: 0.5 },
    ]);
    // I#1: 4 + 3 + 0,5 = 7,5. I#3: volume 8, terlapor 1 + 0,5 → sisa 6,5.
    const { id, ringkasan } = await ajukan(L, "I#1", "I#3");
    expect([ringkasan.volume, ringkasan.dipotong, ringkasan.baris]).toEqual([6.5, 1, 3]);
    await setujui(id, U.sm);
    await setujui(id, U.pd);
    const r = new Map((await db.dailyReportItem.findMany({ where: { id: { in: [...L.barisI1, lama7!, tujuan7!] } } })).map((x) => [x.id, x]));
    const lihat = (x: string) => [r.get(x)!.lineageKey, Number(r.get(x)!.volumeDone), Number(r.get(x)!.volumeSebelumPadanan)];
    expect([lihat(L.barisI1[0]!), lihat(L.barisI1[1]!), lihat(lama7!), lihat(tujuan7!)]).toEqual([
      ["I#3", 3.467, 4],
      ["I#3", 2.6, 3],
      ["I#1", 0, 0.5],
      ["I#3", 0.933, 0.5],
    ]);
    expect(await kumulatif(L, "I#3")).toBe(8);
    expect((await dataPadananAktif(L.locationId)).usulan.find((u) => u.id === id)).toMatchObject({ keadaan: "berlaku", baris: 3 });

    expect((await lepasPadananAktif({ padananId: id, userId: U.sm.id, alasan: "Tunggu adendum berikutnya." })).baris).toBe(3);
    const k = new Map((await db.dailyReportItem.findMany({ where: { id: { in: [...L.barisI1, lama7!, tujuan7!] } } })).map((x) => [x.id, x]));
    const lihat2 = (x: string) => [k.get(x)!.lineageKey, Number(k.get(x)!.volumeDone), k.get(x)!.volumeSebelumPadanan, k.get(x)!.padananAktifId];
    expect([lihat2(L.barisI1[0]!), lihat2(L.barisI1[1]!), lihat2(lama7!), lihat2(tujuan7!)]).toEqual([
      ["I#1", 4, null, null],
      ["I#1", 3, null, null],
      ["I#1", 0.5, null, null],
      ["I#3", 0.5, null, null],
    ]);
    expect(await kumulatif(L, "I#3")).toBe(1.5);
  });

  it("catatan ber-satuan m → item ber-satuan m2: volume diisi, jadi baris item tujuan dengan volume itu", async () => {
    const L = await siapkan();
    const r = await laporan(L, 18);
    const c = await catat(L, r, "Pemasangan steakout area ruang genset", "m", 1);
    await gagalDengan(ajukanLuar(L, [c], "II#1"), /Isi volume yang masuk dalam m2/);
    const { id, ringkasan } = await ajukanPadananLuarRab({
      locationId: L.locationId,
      luarRabIds: [c],
      lineageBaru: "II#1",
      volume: 2.5,
      alasan: ALASAN,
      userId: U.sm.id,
    });
    expect(ringkasan).toMatchObject({ volume: 2.5, unit: "m2", volumeAsal: 1, unitAsal: "m", catatan: 1 });
    await setujui(id, U.sm);
    await setujui(id, U.pd);
    const b = await db.dailyReportItem.findFirstOrThrow({ where: { reportId: r, lineageKey: "II#1" } });
    expect([Number(b.volumeDone), b.basis, b.padananAktifId]).toEqual([2.5, "aktif", id]);
    expect(await kumulatif(L, "II#1")).toBe(2.5);
  });
});
