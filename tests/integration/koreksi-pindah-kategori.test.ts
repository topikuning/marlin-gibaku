/*
 * KOREKSI RAB AKTIF: SUB YANG HANYA PINDAH KATEGORI (DECISIONS 790).
 *
 * Kasus nyata BUYAT TENGAH (user 2026-11-26): sub "III.2 Pekerjaan Pasangan
 * Batu" tertulis di bawah kategori IV – salah tulis, seharusnya IV.2. Parser
 * lama membuka kategori III bayangan untuknya, dan laporan harian sudah masuk
 * ke itemnya. Koreksi dengan berkas yang benar dulu DITOLAK ("tidak bisa
 * menghapus 4 baris yang sudah dipakai"). Permintaan user: *"apa solusimu agar
 * ini tidak merepotkan pengguna dan otomatis"*.
 *
 * Yang dibuktikan:
 * - impor koreksi: sub beserta isinya pindah ke IV DI TEMPAT (id node tetap),
 *   laporan harian – juga yang menunjuk revisi lama – ikut kunci barunya, dan
 *   realisasinya tetap terhitung; temuan, RAPL, pemasangan, backup ikut;
 * - koreksi dari draft: sama, dan laporan atas draft menjadi resmi;
 * - isi yang tidak sama persis tetap ditolak seperti dulu, tanpa ada yang berubah;
 * - satu laporan yang memuat pekerjaan yang sama dua kali ditolak, bukan digabung.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
const suffix = `pk${Date.now().toString(36)}`;
process.env.SUPER_ADMIN_UTAMA = `akar-${suffix}`;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
type UserUji = { id: string; orgId: string; username: string; role: "super_admin" };
let sebagai: UserUji;
vi.mock("@/lib/auth/session", async (importAsli) => ({
  ...(await importAsli<typeof import("@/lib/auth/session")>()),
  requireUser: async () => sebagai,
  getCurrentUser: async () => sebagai,
  hasLocationAccess: async () => true,
  requireCapability: async () => sebagai,
  requireLocationAccess: async () => {},
  requestIp: async () => null,
}));

const { db } = await import("@/lib/db");
const { createRevisionFromNodes } = await import("@/lib/rab/import");
const { samakanLineage } = await import("@/lib/rab/cocok-lineage");
const { terapkanKoreksiTimpa, koreksiDariDraft, pratinjauKoreksiDraft, KoreksiTimpaError } = await import(
  "@/lib/rab/koreksi-timpa-simpan"
);
const { getOrCreateDraft } = await import("@/lib/daily-report/service");
const { activateDraftAction } = await import("@/app/(app)/lokasi/[slug]/rab/actions");
const { cumulativeVolumeByLineage } = await import("@/lib/progress");
type FlatNode = import("@/lib/rab/flatten").FlatNode;

let orgId: string;
let pkgId: string;
let userId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org PK ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const u = await db.user.create({
    data: { orgId, username: `akar-${suffix}`, fullName: "Akar", passwordHash: "x", role: "super_admin" },
  });
  userId = u.id;
  sebagai = { id: u.id, orgId, username: u.username ?? "", role: "super_admin" };
  pkgId = (await db.package.create({ data: { orgId, name: `Paket ${suffix}` } })).id;
});

let urut = 0;
const node = (
  lineageKey: string,
  parentLineageKey: string | null,
  kind: FlatNode["kind"],
  code: string,
  name: string,
  unit: string | null = null,
  volume: number | null = null,
): FlatNode => ({
  kind,
  code,
  name,
  volume,
  unit,
  unitPrice: volume == null ? null : 100_000,
  amount: volume == null ? 0n : BigInt(Math.round(volume * 100_000)),
  lineageKey,
  parentLineageKey,
  sortOrder: urut++,
  excelRow: null,
});

/** Isi sub Pasangan Batu di bawah `sub`. */
const isiSub = (sub: string, kode = (k: string) => k): FlatNode[] => [
  node(`${sub}#-.a`, sub, "item", kode("-.a"), "Pekerjaan Galian Tanah keras s.d 1 m", "m3", 20),
  node(`${sub}#-.b`, sub, "item", kode("-.b"), "Pekerjaan Urugan Pasir urug t = 5 cm", "m3", 10),
  node(`${sub}#6`, sub, "grup", kode("6"), "Pekerjaan Lantai"),
  node(`${sub}#6#6.a`, `${sub}#6`, "item", kode("6.a"), "Pekerjaan Urugan Tanah Urug", "m3", 8),
];

/** RAB seperti hasil parser lama: kategori III bayangan berisi sub III.2. */
const rabLama = (): FlatNode[] => [
  node("IV", null, "kategori", "IV", "PEKERJAAN TAMBATAN PERAHU"),
  node("IV#IV.1", "IV", "sub", "IV.1", "Pekerjaan Persiapan"),
  node("IV#IV.1#a", "IV#IV.1", "item", "a", "Pembersihan Lokasi", "m2", 50),
  node("III#2", null, "kategori", "III", "PEKERJAAN (kategori III – judul tidak ada di file)"),
  node("III#2#III.2", "III#2", "sub", "III.2", "Pekerjaan Pasangan Batu"),
  ...isiSub("III#2#III.2"),
];

/** Berkas yang benar: sub itu IV.2 di bawah kategori IV. */
const berkasBenar = (ubah: (n: FlatNode) => FlatNode = (n) => n): FlatNode[] =>
  [
    node("IV", null, "kategori", "IV", "PEKERJAAN TAMBATAN PERAHU"),
    node("IV#IV.1", "IV", "sub", "IV.1", "Pekerjaan Persiapan"),
    node("IV#IV.1#a", "IV#IV.1", "item", "a", "Pembersihan Lokasi", "m2", 50),
    node("IV#IV.2", "IV", "sub", "IV.2", "Pekerjaan Pasangan Batu"),
    ...isiSub("IV#IV.2"),
  ].map(ubah);

/** Seperti pratinjau impor: identitas berkas disamakan dengan RAB aktif lebih dulu. */
async function samakan(revisionId: string, nodes: FlatNode[]): Promise<FlatNode[]> {
  const aktif = await db.rabNode.findMany({ where: { revisionId } });
  const kunci = new Map(aktif.map((n) => [n.id, n.lineageKey]));
  return samakanLineage(
    nodes,
    aktif.map((n) => ({
      lineageKey: n.lineageKey,
      parentLineageKey: n.parentId ? (kunci.get(n.parentId) ?? null) : null,
      kind: n.kind,
      code: n.code,
      name: n.name,
      unit: n.unit,
    })),
  ).nodes;
}

type Lokasi = {
  locationId: string;
  revLama: string;
  revAktif: string;
  /** id node RAB aktif per kunci lama. */
  id: Map<string, string>;
};

/** Lokasi dengan revisi lama (digantikan) + revisi aktif, keduanya hasil parser lama. */
async function siapkanLokasi(): Promise<Lokasi> {
  const t = `${suffix}-${urut++}`;
  const loc = await db.location.create({
    data: { packageId: pkgId, name: `BUYAT ${t}`, slug: `buyat-${t}`, village: "D", regency: "K", province: "P" },
  });
  const lama = await createRevisionFromNodes(loc.id, rabLama(), { source: "hps_awal", userId });
  await db.rabRevision.update({ where: { id: lama.revisionId }, data: { status: "digantikan", supersededAt: new Date() } });
  const aktif = await createRevisionFromNodes(loc.id, rabLama(), { source: "hps_awal", userId });
  await db.rabRevision.update({ where: { id: aktif.revisionId }, data: { status: "aktif" } });
  const nodes = await db.rabNode.findMany({ where: { revisionId: aktif.revisionId }, select: { id: true, lineageKey: true } });
  return {
    locationId: loc.id,
    revLama: lama.revisionId,
    revAktif: aktif.revisionId,
    id: new Map(nodes.map((n) => [n.lineageKey, n.id])),
  };
}

async function laporan(
  locationId: string,
  tanggal: string,
  rabNodeId: string,
  volume: number,
  o: { status?: "dikirim" | "final"; basis?: string } = {},
) {
  const r = await getOrCreateDraft(locationId, tanggal, userId);
  await db.dailyReport.update({ where: { id: r.id }, data: { status: o.status ?? "dikirim" } });
  const n = await db.rabNode.findUniqueOrThrow({ where: { id: rabNodeId }, select: { lineageKey: true } });
  return db.dailyReportItem.create({
    data: {
      reportId: r.id,
      rabNodeId,
      lineageKey: n.lineageKey,
      basis: o.basis ?? "aktif",
      volumeDone: volume,
      valueDone: BigInt(volume * 100_000),
    },
  });
}

const GALIAN_LAMA = "III#2#III.2#-.a";
const URUG_LAMA = "III#2#III.2#-.b";
const GALIAN_BARU = "IV#IV.2#-.a";
const URUG_BARU = "IV#IV.2#-.b";

describe("koreksi lewat impor: sub yang hanya pindah kategori", () => {
  it("sub + isinya pindah ke IV di tempat; laporan lama & baru, temuan, RAPL, pemasangan, backup ikut", async () => {
    const L = await siapkanLokasi();
    // Laporan atas revisi LAMA (sebelum revisi aktif berlaku) dan atas revisi aktif.
    const nodeLama = await db.rabNode.findFirstOrThrow({ where: { revisionId: L.revLama, lineageKey: GALIAN_LAMA } });
    const b1 = await laporan(L.locationId, "2026-11-10", nodeLama.id, 3, { status: "final" });
    const b2 = await laporan(L.locationId, "2026-11-20", L.id.get(GALIAN_LAMA)!, 4);
    const b3 = await laporan(L.locationId, "2026-11-20", L.id.get(URUG_LAMA)!, 2);
    const temuan = await db.finding.create({
      data: { locationId: L.locationId, title: "Galian kurang dalam", findingDate: new Date("2026-11-21"), raisedById: userId, lineageKey: GALIAN_LAMA },
    });
    const rapl = await db.raplRincian.create({ data: { locationId: L.locationId, lineageKey: URUG_LAMA } });
    const pasang = await db.rabPadananAktif.create({
      data: {
        locationId: L.locationId,
        revisionId: L.revAktif,
        lineageLama: "X#lama",
        lineageBaru: URUG_LAMA,
        jenis: "hilang",
        alasan: "uji",
        ringkasan: {},
        diajukanOlehId: userId,
      },
    });
    await db.rabBackupVolume.create({
      data: { revisionId: L.revAktif, lineageKey: GALIAN_LAMA, status: "angka_langsung", sumber: [], perantara: [], baris: [] },
    });

    const h = await terapkanKoreksiTimpa({
      revisionId: L.revAktif,
      locationId: L.locationId,
      nodes: await samakan(L.revAktif, berkasBenar()),
      userId,
      berkas: "BUYAT_benar.xlsx",
    });

    expect(h.pindahAkar).toEqual([
      {
        label: "III.2 Pekerjaan Pasangan Batu",
        labelBaru: "IV.2 Pekerjaan Pasangan Batu",
        indukDari: "III PEKERJAAN (kategori III – judul tidak ada di file)",
        indukKe: "IV PEKERJAAN TAMBATAN PERAHU",
        baris: 5,
      },
    ]);
    expect(h.ringkas).toMatchObject({ tambah: 0, hapus: 1 });

    // Node RAB aktif: id tetap, kunci & nomor & induk baru; kategori bayangan hilang.
    const aktif = await db.rabNode.findMany({ where: { revisionId: L.revAktif }, select: { id: true, lineageKey: true, code: true, parentId: true } });
    const byKey = new Map(aktif.map((n) => [n.lineageKey, n]));
    expect(byKey.has("III#2")).toBe(false);
    expect(byKey.get("IV#IV.2")).toMatchObject({ id: L.id.get("III#2#III.2"), code: "IV.2", parentId: L.id.get("IV") });
    expect(byKey.get(GALIAN_BARU)?.id).toBe(L.id.get(GALIAN_LAMA));
    expect(byKey.get("IV#IV.2#6#6.a")?.id).toBe(L.id.get("III#2#III.2#6#6.a"));
    expect(aktif).toHaveLength(8);

    // Laporan: baris tetap menunjuk node yang sama, kuncinya baru – juga yang menunjuk revisi lama.
    const baris = await db.dailyReportItem.findMany({
      where: { id: { in: [b1.id, b2.id, b3.id] } },
      select: { id: true, lineageKey: true, rabNodeId: true },
    });
    expect(new Map(baris.map((b) => [b.id, b.lineageKey]))).toEqual(
      new Map([
        [b1.id, GALIAN_BARU],
        [b2.id, GALIAN_BARU],
        [b3.id, URUG_BARU],
      ]),
    );
    expect(baris.find((b) => b.id === b1.id)?.rabNodeId).toBe(nodeLama.id);
    expect((await db.rabNode.findUniqueOrThrow({ where: { id: nodeLama.id } })).lineageKey).toBe(GALIAN_BARU);

    // Realisasi tetap terhitung, kini di kunci barunya.
    const kumulatif = await cumulativeVolumeByLineage(L.locationId);
    expect(kumulatif.get(GALIAN_BARU)).toBe(7);
    expect(kumulatif.get(URUG_BARU)).toBe(2);
    expect(kumulatif.has(GALIAN_LAMA)).toBe(false);

    // Rujukan lain ikut.
    expect((await db.finding.findUniqueOrThrow({ where: { id: temuan.id } })).lineageKey).toBe(GALIAN_BARU);
    expect((await db.raplRincian.findUniqueOrThrow({ where: { id: rapl.id } })).lineageKey).toBe(URUG_BARU);
    expect((await db.rabPadananAktif.findUniqueOrThrow({ where: { id: pasang.id } })).lineageBaru).toBe(URUG_BARU);
    expect(await db.rabBackupVolume.findFirst({ where: { revisionId: L.revAktif, lineageKey: GALIAN_BARU } })).not.toBeNull();

    // Jejak audit memuat kunci lama → baru.
    const jejak = await db.auditLog.findFirstOrThrow({
      where: { action: "rab.koreksi", resourceId: L.revAktif },
      orderBy: { createdAt: "desc" },
    });
    const payload = jejak.payload as { pindah: { dari: string; ke: string }[]; rujukanDipindah: Record<string, number> };
    expect(payload.pindah).toContainEqual({ dari: GALIAN_LAMA, ke: GALIAN_BARU });
    expect(payload.rujukanDipindah).toMatchObject({ laporanHarian: 3, temuan: 1, rapl: 1, pemasangan: 1, barisRevisiLain: 5 });
  });

  it("isi tidak sama persis (satu item berganti nama): tetap ditolak seperti dulu, tidak ada yang berubah", async () => {
    const L = await siapkanLokasi();
    const b = await laporan(L.locationId, "2026-11-20", L.id.get(GALIAN_LAMA)!, 4);
    const berkas = berkasBenar((n) => (n.lineageKey === "IV#IV.2#-.b" ? { ...n, name: "Pekerjaan Urugan Sirtu" } : n));
    await expect(
      terapkanKoreksiTimpa({
        revisionId: L.revAktif,
        locationId: L.locationId,
        nodes: await samakan(L.revAktif, berkas),
        userId,
        berkas: "BUYAT_lain.xlsx",
      }),
    ).rejects.toThrow(/Koreksi tidak bisa menghapus/);
    expect((await db.dailyReportItem.findUniqueOrThrow({ where: { id: b.id } })).lineageKey).toBe(GALIAN_LAMA);
    expect(await db.rabNode.count({ where: { revisionId: L.revAktif, lineageKey: "III#2" } })).toBe(1);
  });
});

describe("koreksi dari draft: sub yang hanya pindah kategori", () => {
  it("pratinjau menyebut yang pindah sebelum dikonfirmasi; laporan aktif & laporan draft menyatu di item yang sama", async () => {
    const L = await siapkanLokasi();
    const b = await laporan(L.locationId, "2026-11-20", L.id.get(GALIAN_LAMA)!, 4);
    const draft = await createRevisionFromNodes(L.locationId, await samakan(L.revAktif, berkasBenar()), {
      source: "adendum",
      userId,
    });
    const nodeDraft = await db.rabNode.findFirstOrThrow({ where: { revisionId: draft.revisionId, lineageKey: URUG_BARU } });
    const bd = await laporan(L.locationId, "2026-11-22", nodeDraft.id, 1.5, { basis: "draft_adendum" });

    const p = await pratinjauKoreksiDraft(draft.revisionId);
    expect(p?.terhalang).toEqual([]);
    expect(p?.pindahAkar.map((x) => x.labelBaru)).toEqual(["IV.2 Pekerjaan Pasangan Batu"]);
    expect(p?.kunciPindah).toContain(GALIAN_LAMA);

    const h = await koreksiDariDraft({ draftId: draft.revisionId, userId });
    expect(h.pindahAkar).toHaveLength(1);
    expect(h.dipindahDariDraft).toBe(1);
    expect(await db.rabRevision.count({ where: { id: draft.revisionId } })).toBe(0);
    const aktif = await db.dailyReportItem.findUniqueOrThrow({ where: { id: b.id } });
    const dariDraft = await db.dailyReportItem.findUniqueOrThrow({ where: { id: bd.id } });
    expect(aktif).toMatchObject({ lineageKey: GALIAN_BARU, rabNodeId: L.id.get(GALIAN_LAMA) });
    expect(dariDraft).toMatchObject({ lineageKey: URUG_BARU, rabNodeId: L.id.get(URUG_LAMA), basis: "aktif" });
  });

  it("lewat tombol \"Terapkan sebagai koreksi\": item yang ikut pindah tidak menuntut konfirmasi \"belum dipasangkan\"", async () => {
    const L = await siapkanLokasi();
    const b = await laporan(L.locationId, "2026-11-20", L.id.get(GALIAN_LAMA)!, 4);
    const draft = await createRevisionFromNodes(L.locationId, await samakan(L.revAktif, berkasBenar()), {
      source: "adendum",
      userId,
    });
    const fd = new FormData();
    fd.set("revisionId", draft.revisionId);
    fd.set("tanpaPersetujuan", "1");
    fd.set("cara", "koreksi");
    fd.set("konfirmasi", `KOREKSI #${draft.revisionNo}`);
    const r = await activateDraftAction(undefined, fd);
    expect(r?.error).toBeUndefined();
    expect(r?.success).toMatch(/III\.2 Pekerjaan Pasangan Batu pindah ke IV PEKERJAAN TAMBATAN PERAHU sebagai IV\.2/);
    expect(r?.success).toMatch(/1 baris laporan harian ikut pindah/);
    expect((await db.dailyReportItem.findUniqueOrThrow({ where: { id: b.id } })).lineageKey).toBe(GALIAN_BARU);
  });

  it("lewat tombol: item berlaporan yang benar-benar hilang tetap menuntut konfirmasi", async () => {
    const L = await siapkanLokasi();
    await laporan(L.locationId, "2026-11-20", L.id.get("IV#IV.1#a")!, 4);
    const draft = await createRevisionFromNodes(
      L.locationId,
      await samakan(L.revAktif, berkasBenar().filter((n) => n.lineageKey !== "IV#IV.1#a")),
      { source: "adendum", userId },
    );
    const fd = new FormData();
    fd.set("revisionId", draft.revisionId);
    fd.set("tanpaPersetujuan", "1");
    fd.set("cara", "koreksi");
    fd.set("konfirmasi", `KOREKSI #${draft.revisionNo}`);
    const r = await activateDraftAction(undefined, fd);
    expect(r?.error).toMatch(/1 item yang sudah dilaporkan belum dipasangkan/);
  });

  it("satu laporan memuat pekerjaan yang sama di RAB aktif DAN di draft: ditolak, tidak digabung diam-diam", async () => {
    const L = await siapkanLokasi();
    const b = await laporan(L.locationId, "2026-11-20", L.id.get(GALIAN_LAMA)!, 4);
    const draft = await createRevisionFromNodes(L.locationId, await samakan(L.revAktif, berkasBenar()), {
      source: "adendum",
      userId,
    });
    const nodeDraft = await db.rabNode.findFirstOrThrow({ where: { revisionId: draft.revisionId, lineageKey: GALIAN_BARU } });
    await laporan(L.locationId, "2026-11-20", nodeDraft.id, 1, { basis: "draft_adendum" });

    const gagal = koreksiDariDraft({ draftId: draft.revisionId, userId });
    await expect(gagal).rejects.toBeInstanceOf(KoreksiTimpaError);
    await expect(gagal).rejects.toThrow(/20 Nov 2026 memuat pekerjaan yang sama dua kali/);
    // Seluruh transaksi batal.
    expect((await db.dailyReportItem.findUniqueOrThrow({ where: { id: b.id } })).lineageKey).toBe(GALIAN_LAMA);
    expect(await db.rabRevision.count({ where: { id: draft.revisionId } })).toBe(1);
    expect((await db.rabNode.findUniqueOrThrow({ where: { id: L.id.get(GALIAN_LAMA)! } })).lineageKey).toBe(GALIAN_LAMA);
  });
});
