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
// 5. semua penolakan: beda satuan, sisa volume, satu laporan memuat keduanya,
//    laporan belum dikirim, usulan ganda, revisi aktif berganti, baris yang
//    sudah diubah orang, peran yang tidak berhak.
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
const {
  ajukanPadananAktif,
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
    `TRUNCATE TABLE audit_logs, rab_padanan_aktif_setuju, rab_padanan_aktif, photos, daily_report_items, daily_reports, rab_nodes, rab_revisions, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("yang belum dipasangkan sesudah aktivasi disebut, dengan calon yang sah saja", () => {
  it("I#1 hilang (7 m3) dan I#2 dinolkan (2 m3 dari jejak aktivasi); calon hanya I#3 – I#4 beda satuan, II#9 beda kategori", async () => {
    const L = await siapkan();
    // Prasyarat dari aktivasi sungguhan: I#2 memang diturunkan ke 0.
    expect(Number((await db.dailyReportItem.findUniqueOrThrow({ where: { id: L.barisI2 } })).volumeDone)).toBe(0);

    const d = await dataPadananAktif(L.locationId);
    expect(d.belum.map((b) => [b.lineageKey, b.jenis, b.volume, b.jumlahLaporan])).toEqual([
      ["I#1", "hilang", 7, 2],
      ["I#2", "dinolkan", 2, 1],
    ]);
    for (const b of d.belum) {
      expect(b.calon.map((c) => [c.lineageKey, c.sisa])).toEqual([["I#3", 7]]);
      expect(b.terhalang).toBeNull();
    }
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

  it("angka yang sudah berubah sejak aktivasi tidak ditimpa – diajukan pun ditolak dengan tanggalnya", async () => {
    const L = await siapkan();
    await db.dailyReportItem.update({ where: { id: L.barisI2 }, data: { volumeDone: 0.5 } });
    await gagalDengan(ajukan(L, "I#2", "I#3"), /tanggal 1 Oktober 2026 sudah berubah sejak diturunkan/);
    const d = await dataPadananAktif(L.locationId);
    expect(d.belum.find((b) => b.lineageKey === "I#2")?.terhalang).toMatch(/sudah berubah sejak aktivasi/);
  });
});

describe("penolakan", () => {
  it("beda satuan, item yang tidak ada di RAB aktif, dan item yang masih bervolume", async () => {
    const L = await siapkan();
    await gagalDengan(ajukan(L, "I#1", "I#4"), /Beda satuan/);
    await gagalDengan(ajukan(L, "I#1", "I#9"), /tidak ada di RAB aktif/);
    await gagalDengan(ajukan(L, "I#3", "I#3"), /masih ada di RAB aktif dan bervolume/);
  });

  it("sisa volume item tujuan tidak cukup – angkanya disebut", async () => {
    const L = await siapkan();
    await L.lapor(6, [{ node: L.node.d3, lineageKey: "I#3", vol: 1.5 }]);
    await gagalDengan(ajukan(L, "I#1", "I#3"), /Sisa volume "Pondasi batu belah" tidak cukup.*lebih 1,5 m3/);
    // Di menu: calonnya tidak ditawarkan, dan jumlah yang disembunyikan disebut.
    const b = (await dataPadananAktif(L.locationId)).belum.find((x) => x.lineageKey === "I#1")!;
    expect([b.calon.length, b.calonSisaKurang]).toEqual([0, 1]);
  });

  it("satu laporan yang memuat keduanya, dan laporan item lama yang belum dikirim", async () => {
    const L = await siapkan();
    await L.lapor(7, [
      { node: L.node.a1, lineageKey: "I#1", vol: 0.5 },
      { node: L.node.d3, lineageKey: "I#3", vol: 0.5 },
    ]);
    await gagalDengan(ajukan(L, "I#1", "I#3"), /8 Oktober 2026 memuat "Tapak beton menerus" DAN "Pondasi batu belah"/);

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

  it("keadaan berubah di antara diajukan dan disetujui: diperiksa ulang, suara terakhir ikut batal", async () => {
    const L = await siapkan();
    const { id } = await ajukan(L, "I#1", "I#3");
    await setujui(id, U.sm);
    // Sesudah diajukan, I#3 dilaporkan lagi sehingga sisanya tidak cukup.
    await L.lapor(9, [{ node: L.node.d3, lineageKey: "I#3", vol: 1.5 }]);
    await gagalDengan(setujui(id, U.pd), /Sisa volume/);
    const u = (await dataPadananAktif(L.locationId)).usulan.find((x) => x.id === id)!;
    expect([u.keadaan, u.suara.map((s) => s.role)]).toEqual(["diajukan", ["site_manager"]]);
    expect(await kumulatif(L, "I#3")).toBe(2.5);
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
