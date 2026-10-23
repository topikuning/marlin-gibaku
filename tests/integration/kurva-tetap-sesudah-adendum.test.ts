/*
 * KURVA-S TIDAK DIATUR ULANG SAAT ADENDUM DIAKTIFKAN (DECISIONS 698).
 *
 * Laporan user 2026-10-22: *"kurva s setelah aktivasi rab adendum, seharusnya
 * tidak berubah bobot mingguannya dari sebelumnya. yang saat ini terjadi
 * begitu diaktivasi kurva s langsung kamu atur ulang"*.
 *
 * Dulu ketiga pintu aktivasi adendum (tombol Aktifkan di lokasi, impor
 * "jadikan RAB aktif", aktivasi CCO di paket) memanggil `regenerateBaseline`:
 * jadwal yang diimpor atau disusun orang dibuang dan diganti hasil generator.
 * Sekarang baseline yang berlaku DIBAWA ke revisi baru apa adanya – titik
 * kurva dan matriks mingguan per pekerjaan sama persis. Pekerjaan yang baru
 * lahir dari adendum mendapat baris nol (belum dijadwalkan) supaya tabel KKP
 * dan editor tetap membaca jadwal yang sama dengan kurvanya.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
const suffix = `kt${Date.now().toString(36)}`;
process.env.SUPER_ADMIN_UTAMA = `akar-${suffix}`;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type UserUji = { id: string; orgId: string; username: string; role: "super_admin" };
let sebagai: UserUji;
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => sebagai,
    requireCapability: async () => sebagai,
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { activateDraftAction } = await import("@/app/(app)/lokasi/[slug]/rab/actions");
const { importHps } = await import("@/app/(app)/lokasi/[slug]/rab/import/actions");
const { createRevisionFromNodes, activateRevision, totalWeeksFor } = await import("@/lib/rab/import");
const { saveCategoryWeekly, deriveCategorySchedule } = await import("@/lib/baseline");
const { getPeriodReport } = await import("@/lib/periodic-report");
const { aktifkanAdendumPaket } = await import("@/lib/package/aktivasi-adendum");
const { setujuiRevisi } = await import("@/lib/rab/persetujuan");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");
type FlatNode = import("@/lib/rab/flatten").FlatNode;

let orgId: string;
let packageId: string;
let akar: UserUji;
const penyetuju: Record<"pd" | "sm", { id: string; role: never }> = {} as never;

function kategori(code: string, name: string, amount: bigint, sortOrder: number): FlatNode {
  return {
    kind: "kategori", code, name, volume: null, unit: null, unitPrice: null, amount,
    lineageKey: code, parentLineageKey: null, sortOrder, excelRow: null,
  };
}
function item(cat: string, name: string, amount: bigint, sortOrder: number): FlatNode {
  return {
    kind: "item", code: "1", name, volume: 1, unit: "ls", unitPrice: Number(amount), amount,
    lineageKey: `${cat}#1`, parentLineageKey: cat, sortOrder, excelRow: null,
  };
}
/** RAB sintetis: tiap kategori satu item senilai kategorinya. */
function rab(isi: [code: string, name: string, juta: number][]): FlatNode[] {
  return isi.flatMap(([code, name, juta], i) => [
    kategori(code, name, BigInt(juta) * 1_000_000n, i * 2),
    item(code, `Item ${name}`, BigInt(juta) * 1_000_000n, i * 2 + 1),
  ]);
}

async function buatLokasi(nama: string) {
  return db.location.create({
    data: {
      packageId, name: nama, slug: `${nama.toLowerCase().replace(/\s+/g, "-")}-${suffix}`,
      village: "Desa", regency: "Batang", province: "Jawa Tengah", status: "berjalan", isActive: true,
    },
  });
}

async function baselineAktif(locationId: string) {
  return db.baseline.findFirstOrThrow({
    where: { locationId, status: "aktif" },
    include: {
      points: { orderBy: { weekNumber: "asc" }, select: { plannedPct: true } },
      scheduleItems: { select: { lineageKey: true, name: true, weightPct: true, weekly: true } },
    },
  });
}
const angka = (b: Awaited<ReturnType<typeof baselineAktif>>) => b.points.map((p) => Number(p.plannedPct));
const matriks = (b: Awaited<ReturnType<typeof baselineAktif>>) =>
  Object.fromEntries(b.scheduleItems.map((s) => [s.lineageKey, s.weekly as number[]]));

function aktifkan(revisionId: string, revisionNo: number) {
  const fd = new FormData();
  fd.set("revisionId", revisionId);
  fd.set("tanpaPersetujuan", "1");
  fd.set("konfirmasi", `AKTIFKAN #${revisionNo}`);
  return activateDraftAction(undefined, fd);
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org KT ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const u = await db.user.create({
    data: { orgId, username: `akar-${suffix}`, fullName: "Akar", passwordHash: "x", role: "super_admin" },
  });
  akar = { id: u.id, orgId, username: `akar-${suffix}`, role: "super_admin" };
  sebagai = akar;
  for (const [tag, role] of [["pd", "program_director"], ["sm", "site_manager"]] as const) {
    const p = await db.user.create({
      data: { orgId, username: `${tag}-${suffix}`, fullName: tag.toUpperCase(), passwordHash: "x", role },
    });
    penyetuju[tag] = { id: p.id, role: role as never };
  }
  const pkg = await db.package.create({ data: { orgId, name: `Paket KT ${suffix}`, stage: "pelaksanaan" } });
  packageId = pkg.id;
  const vendor = await db.vendor.create({ data: { orgId, name: `Vendor KT ${suffix}` } });
  await db.contract.create({
    data: {
      packageId, vendorId: vendor.id, contractNumber: `SPK-${suffix}`, contractValue: 1_000_000_000n,
      signedDate: new Date("2026-05-25"), durationDays: 28,
      startDate: new Date("2026-06-01"), endDate: new Date("2026-06-28"),
    },
  });
}, 60_000);

afterAll(async () => {
  await db.$executeRawUnsafe(`DELETE FROM "organizations" WHERE id = '${orgId}'`).catch(() => null);
  await db.$disconnect();
});

describe("lokasi yang sudah punya kurva-S sendiri", () => {
  let locationId: string;
  /** Jadwal "impor Excel" user: bentuknya sengaja bukan bentuk generator. */
  const JADWAL = { I: [20, 20, 0, 0], II: [0, 10, 30, 20] };
  const KURVA = [20, 50, 80, 100];
  let nomorAwal: number;

  beforeAll(async () => {
    const lok = await buatLokasi("Lokasi Kurva");
    locationId = lok.id;
    const awal = await createRevisionFromNodes(
      locationId,
      rab([["I", "PEKERJAAN PERSIAPAN", 40], ["II", "PEKERJAAN STRUKTUR", 60]]),
      { source: "hps_awal", userId: akar.id, note: "kontrak" },
    );
    await activateRevision(awal.revisionId, akar.id);
    expect((await totalWeeksFor(locationId)).totalWeeks).toBe(4);
    await saveCategoryWeekly(
      locationId,
      Object.entries(JADWAL).map(([lineageKey, weekly]) => ({ lineageKey, weekly })),
      akar.id,
      "Impor Time Schedule Excel",
    );
    const b = await baselineAktif(locationId);
    expect(angka(b)).toEqual(KURVA);
    nomorAwal = b.baselineNo;
  }, 60_000);

  it("tombol Aktifkan: titik kurva & bobot mingguan sama persis, pekerjaan baru berbaris nol", async () => {
    const draft = await createRevisionFromNodes(
      locationId,
      rab([["I", "PEKERJAAN PERSIAPAN", 30], ["II", "PEKERJAAN STRUKTUR", 60], ["III", "PEKERJAAN SARANA", 20]]),
      { source: "adendum", userId: akar.id, note: "CCO 1" },
    );
    const res = await aktifkan(draft.revisionId, draft.revisionNo);
    expect(res?.error, res?.error).toBeUndefined();
    expect(res?.success).toMatch(/Kurva-S tidak diubah/);
    expect(res?.success).not.toMatch(/dibuat ulang/);
    // Pekerjaan baru DISEBUT – ia belum punya jadwal, dan itu harus terbaca.
    expect(res?.success).toContain("PEKERJAAN SARANA");

    const b = await baselineAktif(locationId);
    expect(b.rabRevisionId).toBe(draft.revisionId);
    expect(b.baselineNo).toBe(nomorAwal + 1);
    expect(angka(b)).toEqual(KURVA);
    const m = matriks(b);
    expect(m.I).toEqual(JADWAL.I);
    expect(m.II).toEqual(JADWAL.II);
    expect(m.III).toEqual([0, 0, 0, 0]);
    // Asal-usulnya tidak menyamar: jadwal impor tetap tercatat "manual".
    expect(b.source).toBe("manual");
    expect(b.note).toMatch(/tidak diubah/i);

    const lama = await db.baseline.findFirstOrThrow({ where: { locationId, baselineNo: nomorAwal } });
    expect(lama.status).toBe("digantikan");
    const jejak = await db.auditLog.findFirst({
      where: { action: "baseline.bawa_adendum", resourceId: b.id },
      select: { payload: true },
    });
    expect(jejak?.payload).toMatchObject({ dariBaselineNo: nomorAwal, pekerjaanBaru: 1 });
  }, 60_000);

  it("tabel KKP dan editor membaca jadwal yang DIBAWA, bukan jadwal otomatis", async () => {
    const jadwal = await deriveCategorySchedule(locationId);
    expect(jadwal?.origin).toBe("tersimpan");
    expect(jadwal?.rows.find((r) => r.lineageKey === "II")?.weekly).toEqual(JADWAL.II);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T09:00:00+07:00"));
    try {
      const rep = await getPeriodReport(locationId, "mingguan", 3);
      if (!rep) throw new Error("laporan periodik tidak terbentuk");
      const byKey = Object.fromEntries(rep.kurvaSchedule.map((c) => [c.lineageKey, c.weekly]));
      expect(byKey.I).toEqual(JADWAL.I);
      expect(byKey.II).toEqual(JADWAL.II);
      expect(byKey.III).toEqual([0, 0, 0, 0]);
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("aktivasi CCO di paket: kurva tetap, tidak dibuat ulang", async () => {
    const draft = await createRevisionFromNodes(
      locationId,
      rab([["I", "PEKERJAAN PERSIAPAN", 35], ["II", "PEKERJAAN STRUKTUR", 70], ["III", "PEKERJAAN SARANA", 20]]),
      { source: "adendum", userId: akar.id, note: "CCO 2" },
    );
    await setujuiRevisi(draft.revisionId, penyetuju.pd);
    await setujuiRevisi(draft.revisionId, penyetuju.sm);
    const sebelum = await baselineAktif(locationId);

    const hasil = await aktifkanAdendumPaket({
      packageId, revisionIds: [draft.revisionId], changeIds: [], ccoNumber: `CCO-KT-${suffix}`,
      effectiveDate: new Date("2026-06-15"), endDateDelta: 0, reason: "Tambah volume struktur", valueDelta: null,
    });
    expect(hasil.baselineGagal).toEqual([]);
    expect(hasil.revisi[0]?.kurva).toMatchObject({ cara: "dibawa", pekerjaanBaru: [] });

    const b = await baselineAktif(locationId);
    expect(b.rabRevisionId).toBe(draft.revisionId);
    expect(b.baselineNo).toBe(sebelum.baselineNo + 1);
    expect(angka(b)).toEqual(KURVA);
    expect(matriks(b)).toEqual(matriks(sebelum));
  }, 60_000);
});

describe("lokasi yang belum punya kurva-S", () => {
  it("adendum membuat kurvanya dari RAB baru – tidak ada yang bisa dipertahankan", async () => {
    const lok = await buatLokasi("Lokasi Kosong");
    const awal = await createRevisionFromNodes(
      lok.id,
      rab([["I", "PEKERJAAN PERSIAPAN", 40], ["II", "PEKERJAAN STRUKTUR", 60]]),
      { source: "hps_awal", userId: akar.id, note: "kontrak" },
    );
    await activateRevision(awal.revisionId, akar.id);
    expect(await db.baseline.count({ where: { locationId: lok.id } })).toBe(0);

    const draft = await createRevisionFromNodes(
      lok.id,
      rab([["I", "PEKERJAAN PERSIAPAN", 50], ["II", "PEKERJAAN STRUKTUR", 60]]),
      { source: "adendum", userId: akar.id, note: "CCO" },
    );
    const res = await aktifkan(draft.revisionId, draft.revisionNo);
    expect(res?.error, res?.error).toBeUndefined();
    expect(res?.success).toMatch(/belum punya kurva-S/);
    const b = await baselineAktif(lok.id);
    expect(b.rabRevisionId).toBe(draft.revisionId);
    expect(b.source).toBe("adendum");
  }, 60_000);
});

describe("impor \"jadikan RAB aktif\" untuk adendum", () => {
  const NAMA = "rab-aktif-situbondo.xlsx";
  const ISI = readFileSync(new URL(`../fixtures/${NAMA}`, import.meta.url).pathname);

  it("kurva-S lokasi dibawa apa adanya, bukan dibuat ulang dengan bentuk profilnya", async () => {
    const lok = await buatLokasi("Lokasi Impor");
    const nodes = flattenParsedRab((await parseHpsBuffer(ISI)).parsed);
    const awal = await createRevisionFromNodes(lok.id, nodes, { source: "hps_awal", userId: akar.id, note: "kontrak" });
    await activateRevision(awal.revisionId, akar.id);

    // Jadwal "milik user": seluruh bobot tiap pekerjaan jatuh di satu minggu,
    // bergiliran. Bentuk ini tidak pernah dihasilkan generator.
    const { totalWeeks } = await totalWeeksFor(lok.id);
    const kat = await db.rabNode.findMany({
      where: { revisionId: awal.revisionId, kind: "kategori", amount: { gt: 0n } },
      select: { lineageKey: true, amount: true },
      orderBy: { sortOrder: "asc" },
    });
    const total = kat.reduce((s, k) => s + Number(k.amount), 0);
    await saveCategoryWeekly(
      lok.id,
      kat.map((k, i) => {
        const weekly = new Array<number>(totalWeeks).fill(0);
        weekly[i % totalWeeks] = (Number(k.amount) / total) * 100;
        return { lineageKey: k.lineageKey, weekly };
      }),
      akar.id,
      "Impor Time Schedule Excel",
    );
    const sebelum = await baselineAktif(lok.id);

    // RAB aktif dibuat berbeda volume dari berkas – berkasnya "mengubah kontrak".
    const it0 = await db.rabNode.findFirstOrThrow({
      where: { revisionId: awal.revisionId, kind: "item", volume: { gt: 1 } },
      orderBy: { sortOrder: "asc" },
    });
    await db.rabNode.update({ where: { id: it0.id }, data: { volume: Number(it0.volume) + 1 } });

    const berkas = () =>
      new File([new Uint8Array(ISI)], NAMA, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    const impor = async (isian: Record<string, string> = {}) => {
      const fd = new FormData();
      fd.set("locationId", lok.id);
      fd.set("mode", "aktifkan");
      fd.set("file", berkas());
      for (const [k, v] of Object.entries(isian)) fd.set(k, v);
      return (await importHps(undefined, fd)) ?? {};
    };
    const pratinjau = await impor();
    const no = pratinjau.preview!.tanpaPersetujuan!.revisionNo;
    const simpan = await impor({
      confirm: "1",
      previewSha: pratinjau.preview!.sha256,
      tanpaPersetujuan: "1",
      konfirmasi: `AKTIFKAN #${no}`,
    });
    expect(simpan.error, simpan.error).toBeUndefined();
    expect(simpan.success).toMatch(/Kurva-S tidak diubah/);
    expect(simpan.success).not.toMatch(/dibuat ulang/);

    const sesudah = await baselineAktif(lok.id);
    const aktif = await db.rabRevision.findFirstOrThrow({ where: { locationId: lok.id, status: "aktif" } });
    expect(aktif.revisionNo).toBe(no);
    expect(sesudah.rabRevisionId).toBe(aktif.id);
    expect(sesudah.baselineNo).toBe(sebelum.baselineNo + 1);
    expect(angka(sesudah)).toEqual(angka(sebelum));
    expect(matriks(sesudah)).toEqual(matriks(sebelum));
  }, 300_000);
});
