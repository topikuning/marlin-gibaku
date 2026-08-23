// EDITOR DRAFT ADENDUM RAB (tahap a) — keputusan user 29 Juli 2026:
//   1. harga satuan item LAMA tidak boleh berubah (memang tidak ada jalurnya —
//      diuji: mutasi volume tidak menyentuh unitPrice);
//   2. penghapusan wajib berjejak: audit log + tetap terlihat di diff;
//   3. volume tidak boleh di bawah realisasi tercatat;
//   4. semua total agregat SELALU dihitung ulang dari daun.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const {
  AdendumError,
  addDraftItem,
  addDraftKategori,
  createAdendumDraft,
  diffRevisions,
  removeDraftNode,
  updateDraftItemVolume,
  updateDraftNewItemFields,
} = await import("@/lib/rab/adendum");
const { getOrCreateDraft, upsertItem, submitReport } = await import("@/lib/daily-report/service");

const suffix = `ad${Date.now().toString(36)}`;
let locationId: string;
let userId: string;
let activeRevId: string;
/** id node pada REVISI AKTIF (bukan draft). */
let aktifPasanganBatuId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org AD ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `ad-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket AD ${suffix}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor AD ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 200_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 150,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-29"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi AD",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;

  // RAB aktif: 1 kategori, 2 item — pasangan batu 100 m3 × 1jt, galian 50 m3 × 500rb.
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 125_000_000n },
  });
  activeRevId = rev.id;
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI", amount: 125_000_000n, lineageKey: "I", sortOrder: 1 },
  });
  const psb = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan batu",
      volume: 100, unit: "m3", unitPrice: 1_000_000, amount: 100_000_000n, lineageKey: "I#1", sortOrder: 2,
    },
  });
  aktifPasanganBatuId = psb.id;
  await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "2", name: "Galian tanah",
      volume: 50, unit: "m3", unitPrice: 500_000, amount: 25_000_000n, lineageKey: "I#2", sortOrder: 3,
    },
  });

  // Realisasi tercatat: pasangan batu 30 m3 (laporan dikirim = counted).
  const draft = await getOrCreateDraft(locationId, "2026-07-10", userId);
  await upsertItem(draft.id, { rabNodeId: aktifPasanganBatuId, volumeDone: 30 }, userId);
  await submitReport(draft.id, userId);
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

/** node draft menurut lineageKey. */
async function draftNode(revisionId: string, lineageKey: string) {
  return db.rabNode.findFirstOrThrow({ where: { revisionId, lineageKey } });
}

/**
 * DERAU PEMBULATAN: menambah satu item tidak boleh menulis ulang nilai item
 * lain (DECISIONS 423).
 *
 * Laporan user 2026-08-23: menambah item baru mendadak memunculkan ratusan
 * baris "berubah" yang volumenya sama persis dan nilainya bergeser puluhan
 * rupiah. Sebabnya `recomputeTotals` menghitung ulang `amount` SETIAP item dari
 * `volume × harga`, sementara nilai tersimpan berasal dari berkas yang
 * diunggah user dengan pembulatannya sendiri.
 *
 * Fixture ini sengaja memakai item yang `amount`-nya TIDAK sama dengan
 * `round(volume × harga)` — persis keadaan berkas nyata. Kalau penjaganya
 * lepas, item itu ikut tertulis ulang dan muncul di `diff.diubah`.
 */
describe("adendum tidak menulis ulang nilai item yang tidak disentuh", () => {
  it("tambah item baru: item lain tetap apa adanya, tidak muncul sebagai perubahan", async () => {
    // Lokasi SENDIRI: draft yang ditinggalkan di sini tidak boleh menghalangi
    // `createAdendumDraft` pada uji lain (satu lokasi = satu draft).
    const pkgId = (
      await db.location.findUniqueOrThrow({ where: { id: locationId }, select: { packageId: true } })
    ).packageId;
    const lokDerau = await db.location.create({
      data: {
        packageId: pkgId,
        name: "Lokasi Derau",
        slug: `lokasi-derau-${suffix}`,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
        status: "berjalan",
        isActive: true,
      },
      select: { id: true },
    });
    const rev = await db.rabRevision.create({
      data: { locationId: lokDerau.id, revisionNo: 1, source: "hps_awal", status: "draft", totalValue: 1_000_003n },
    });
    const kat = await db.rabNode.create({
      data: { revisionId: rev.id, kind: "kategori", code: "Z", name: "KAT DERAU", amount: 1_000_003n, lineageKey: "Z", sortOrder: 1 },
    });
    // 3,333 × 300.001,25 = 1.000.004,16 → hitung ulang memberi 1.000.004,
    // sedangkan berkas menulis 1.000.003. Selisihnya SATU rupiah: derau.
    const derau = await db.rabNode.create({
      data: {
        revisionId: rev.id, parentId: kat.id, kind: "item", code: "9", name: "Item derau",
        volume: 3.333, unit: "m3", unitPrice: 300_001.25, amount: 1_000_003n, lineageKey: "Z#9", sortOrder: 2,
      },
    });
    expect(Math.round(3.333 * 300_001.25)).not.toBe(Number(derau.amount));

    // Draft = salinan; nilai item disalin apa adanya.
    const salinanKat = await db.rabNode.create({
      data: { revisionId: rev.id, kind: "kategori", code: "Z2", name: "KAT LAIN", amount: 0n, lineageKey: "Z2", sortOrder: 3 },
    });
    // Tambah item baru ke kategori kedua revisi yang SAMA (memakai jalur yang
    // sama dengan editor: addDraftItem → recomputeTotals).
    await addDraftItem(
      rev.id,
      salinanKat.id,
      { code: "10", name: "Item baru", unit: "ls", volume: 1, unitPrice: 5_000_000 },
      userId,
    );

    const sesudah = await db.rabNode.findUniqueOrThrow({ where: { id: derau.id }, select: { amount: true } });
    expect(sesudah.amount, "nilai item yang tidak disentuh ikut ditulis ulang").toBe(1_000_003n);
  });
});

describe("daftar perubahan menyebut LETAK item", () => {
  it("setiap baris diff membawa jalur kategori induknya (DECISIONS 423)", async () => {
    /*
     * Revisi tandingan dibangun langsung (bukan lewat editor) supaya uji ini
     * tidak merebut "satu draft per lokasi" dari uji lain. Yang diperiksa
     * `diffRevisions`, dan ia tidak peduli bagaimana revisinya lahir.
     */
    const pkgId2 = (
      await db.location.findUniqueOrThrow({ where: { id: locationId }, select: { packageId: true } })
    ).packageId;
    // Lokasi sendiri: menambah revisi di lokasi utama akan menggeser nomor
    // revisi yang diuji blok lain.
    const lokJalur = await db.location.create({
      data: {
        packageId: pkgId2, name: "Lokasi Jalur", slug: `lokasi-jalur-${suffix}`,
        village: "Desa", regency: "Kab", province: "Prov", status: "berjalan", isActive: true,
      },
      select: { id: true },
    });
    const revLama = await db.rabRevision.create({
      data: { locationId: lokJalur.id, revisionNo: 1, source: "hps_awal", status: "digantikan", totalValue: 125_000_000n },
    });
    const katLama = await db.rabNode.create({
      data: { revisionId: revLama.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI", amount: 125_000_000n, lineageKey: "I", sortOrder: 1 },
    });
    await db.rabNode.create({
      data: {
        revisionId: revLama.id, parentId: katLama.id, kind: "item", code: "1", name: "Pasangan batu",
        volume: 100, unit: "m3", unitPrice: 1_000_000, amount: 100_000_000n, lineageKey: "I#1", sortOrder: 2,
      },
    });
    const rev = await db.rabRevision.create({
      data: { locationId: lokJalur.id, revisionNo: 2, source: "adendum", status: "aktif", totalValue: 145_000_000n },
    });
    const kat = await db.rabNode.create({
      data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI", amount: 145_000_000n, lineageKey: "I", sortOrder: 1 },
    });
    await db.rabNode.create({
      data: {
        revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan batu",
        volume: 120, unit: "m3", unitPrice: 1_000_000, amount: 120_000_000n, lineageKey: "I#1", sortOrder: 2,
      },
    });
    const diff = await diffRevisions(revLama.id, rev.id);
    const baris = diff.diubah.find((d) => d.lineageKey === "I#1");
    // Tanpa jalur, satu RAB dengan belasan bangunan menampilkan "Pasangan batu"
    // berulang kali tanpa penanda mana yang mana.
    expect(baris?.jalur).toBe("I. PEKERJAAN UJI");
  });
});

describe("editor draft adendum", () => {
  let draftId: string;

  it("membuat draft salinan penuh dari revisi aktif (lineage ikut)", async () => {
    const res = await createAdendumDraft(locationId, userId);
    draftId = res.revisionId;
    expect(res.revisionNo).toBe(2);
    const nodes = await db.rabNode.findMany({ where: { revisionId: draftId } });
    expect(nodes).toHaveLength(3);
    expect(new Set(nodes.map((n) => n.lineageKey))).toEqual(new Set(["I", "I#1", "I#2"]));
    // Draft kedua ditolak selama yang pertama masih ada.
    await expect(createAdendumDraft(locationId, userId)).rejects.toThrow(AdendumError);
  });

  it("volume di bawah realisasi DITOLAK; sama dengan realisasi boleh", async () => {
    const psb = await draftNode(draftId, "I#1");
    await expect(updateDraftItemVolume(draftId, psb.id, 20, userId)).rejects.toThrow(/realisasi/i);
    const ok = await updateDraftItemVolume(draftId, psb.id, 30, userId); // pekerjaan-kurang sampai batas realisasi
    // total = 30×1jt + 50×500rb = 55jt
    expect(ok.totalValue).toBe(55_000_000n);
  });

  it("harga satuan item lama TIDAK berubah oleh mutasi volume", async () => {
    const psb = await draftNode(draftId, "I#1");
    expect(Number(psb.unitPrice)).toBe(1_000_000);
    expect(Number(psb.volume)).toBe(30);
    // amount item ikut dihitung ulang dari volume × harga LAMA.
    expect(psb.amount).toBe(30_000_000n);
  });

  it("agregat kategori & totalValue selalu dihitung ulang dari daun", async () => {
    const psb = await draftNode(draftId, "I#1");
    await updateDraftItemVolume(draftId, psb.id, 120, userId); // pekerjaan-tambah
    const kat = await draftNode(draftId, "I");
    expect(kat.amount).toBe(120_000_000n + 25_000_000n);
    const rev = await db.rabRevision.findUniqueOrThrow({ where: { id: draftId } });
    expect(rev.totalValue).toBe(145_000_000n);
  });

  it("tambah item baru (harga negosiasi bebas) + tambah kategori baru (bangunan baru)", async () => {
    const kat = await draftNode(draftId, "I");
    await addDraftItem(
      draftId,
      kat.id,
      { code: "3", name: "Pekerjaan sondir", unit: "titik", volume: 4, unitPrice: 2_500_000 },
      userId,
    );
    const bangunan = await addDraftKategori(draftId, { code: "II", name: "BANGUNAN POS JAGA" }, userId);
    await addDraftItem(
      draftId,
      bangunan.nodeId,
      { code: "1", name: "Pondasi batu kali", unit: "m3", volume: 10, unitPrice: 800_000 },
      userId,
    );
    const rev = await db.rabRevision.findUniqueOrThrow({ where: { id: draftId } });
    // 145jt + 10jt (sondir) + 8jt (pondasi) = 163jt
    expect(rev.totalValue).toBe(163_000_000n);
    const pondasi = await draftNode(draftId, "II#1");
    expect(pondasi.lineageKey).toBe("II#1");
  });

  it("harga satuan item BARU bisa diedit (negosiasi); item LAMA ditolak – terkunci", async () => {
    const sondir = await draftNode(draftId, "I#3");
    const naik = await updateDraftNewItemFields(draftId, sondir.id, { unitPrice: 3_000_000 }, userId);
    expect(naik.totalValue).toBe(165_000_000n); // 163jt + 4 titik × 500rb
    const balik = await updateDraftNewItemFields(draftId, sondir.id, { unitPrice: 2_500_000 }, userId);
    expect(balik.totalValue).toBe(163_000_000n);

    const psb = await draftNode(draftId, "I#1"); // item kontrak lama
    await expect(
      updateDraftNewItemFields(draftId, psb.id, { unitPrice: 900_000 }, userId),
    ).rejects.toThrow(/terkunci/i);
  });

  it("hapus item BER-realisasi DITOLAK; item tanpa realisasi boleh dan berjejak audit", async () => {
    const psb = await draftNode(draftId, "I#1");
    await expect(removeDraftNode(draftId, psb.id, userId)).rejects.toThrow(/realisasi/i);

    const galian = await draftNode(draftId, "I#2"); // tanpa realisasi
    const res = await removeDraftNode(draftId, galian.id, userId);
    expect(res.removedItems).toBe(1);
    expect(res.totalValue).toBe(138_000_000n); // 163jt − 25jt

    const jejak = await db.auditLog.findFirst({
      where: { action: "rab.adendum_node_remove", resourceId: galian.id },
    });
    expect(jejak, "penghapusan wajib meninggalkan audit log").not.toBeNull();
  });

  it("diff lama vs baru: item terhapus TETAP terlihat, plus tambah & ubah", async () => {
    const diff = await diffRevisions(activeRevId, draftId);
    expect(diff.dihapus.map((d) => d.lineageKey)).toEqual(["I#2"]);
    expect(new Set(diff.ditambah.map((d) => d.lineageKey))).toEqual(new Set(["I#3", "II#1"]));
    expect(diff.diubah.map((d) => d.lineageKey)).toEqual(["I#1"]);
    expect(diff.diubah[0].volumeLama).toBe(100);
    expect(diff.diubah[0].volumeBaru).toBe(120);
    expect(diff.totalLama).toBe(125_000_000n);
    expect(diff.totalBaru).toBe(138_000_000n);
    expect(diff.delta).toBe(13_000_000n);
  });

  it("mutasi pada revisi NON-draft ditolak", async () => {
    const psbAktif = await db.rabNode.findFirstOrThrow({ where: { revisionId: activeRevId, lineageKey: "I#1" } });
    await expect(updateDraftItemVolume(activeRevId, psbAktif.id, 90, userId)).rejects.toThrow(/bukan draft/i);
  });
});
