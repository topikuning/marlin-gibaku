/*
 * SATU DRAFT ADENDUM PER LOKASI — impor baru MENGGANTIKAN yang lama, dan
 * laporan harian yang sudah diinput ikut pindah ke draft terbaru.
 *
 * **Laporan + ketetapan user 2026-09-24**, memotret satu lokasi dengan DUA
 * draft dan tombol "Buang" yang menjawab galat mentah Postgres:
 *
 *   *"kenapa bisa ada dua draft revisi pada satu lokasi, padahal seharusnya
 *   hanya boleh ada satu, tinggal diaktifkan atau dibuang."*
 *
 *   *"seharusnya jika ada import baru, itu yang digunakan sebagai draft
 *   terbaru dan 'draft aktif', jadi item yang sudah diinput dicari padanannya
 *   pada draft paling akhir. jika beresiko rancu, ada list laporan harian mana
 *   saja yang telah diinput dari draft."*
 *
 * ### Satu akar, dua gejala
 *
 * `DailyReportItem.rabNodeId` menunjuk node RAB lewat FK **RESTRICT**. Laporan
 * yang diinput terhadap draft adendum (`basis = "draft_adendum"`,
 * DECISIONS 210) menunjuk node milik DRAFT itu. Maka:
 *
 * 1. Menekan "Buang" pada draft yang sudah dipakai melapor ditolak Postgres,
 *    dan galat mentahnya lolos ke layar — bukan kalimat MARLIN.
 * 2. Impor draft baru berjalan create-dulu-baru-buang (sengaja, audit
 *    2026-09-15 F-2: urutan lama meninggalkan lokasi TANPA draft bila
 *    pembuatan gagal). Karena langkah buang itu sendiri bisa gagal dan
 *    keduanya BUKAN satu transaksi, drafnya jadi DUA.
 *
 * ### Yang berlaku sekarang
 *
 * Baris laporan dipindahkan ke node draft BARU yang `lineageKey`-nya sama,
 * lalu draft lama dibuang — semuanya dalam SATU transaksi, jadi kegagalan
 * apa pun meninggalkan tepat satu draft, bukan dua.
 *
 * Baris yang tidak punya padanan di berkas baru TIDAK dihapus diam-diam dan
 * TIDAK dibiarkan menggantung: impornya ditolak dengan menyebut tanggal dan
 * nama itemnya, supaya yang memutuskan tetap orang.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let sesi: { id: string; orgId: string; role: string };
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => sesi,
    requireCapability: async () => sesi,
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { importHps } = await import("@/app/(app)/lokasi/[slug]/rab/import/actions");
const { createRevisionFromNodes, activateRevision, discardDraft, gantiDraftLama } = await import("@/lib/rab/import");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");
const { getOrCreateDraft, upsertItem } = await import("@/lib/daily-report/service");

const BERKAS_A = "mc0-pasar-banggi-blok-cco01.xlsx";
const BERKAS_B = "mc0-tambakagung-blok-nilai-kontrak.xlsx";
const jalur = (n: string) => new URL(`../fixtures/${n}`, import.meta.url).pathname;
const suffix = `dt${Date.now().toString(36)}`;
let packageId: string;
let locationId: string;
let slug: string;

const berkasForm = (nama: string) =>
  new File([new Uint8Array(readFileSync(jalur(nama)))], nama, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

/** Unggah `nama` sebagai DRAFT lewat aksi server — persis tombol di layar. */
async function imporDraft(nama: string) {
  const fdP = new FormData();
  fdP.set("locationId", locationId);
  fdP.set("mode", "draft");
  fdP.set("file", berkasForm(nama));
  const pratinjau = await importHps(undefined, fdP);
  if (!pratinjau?.preview) return { error: pratinjau?.error ?? "pratinjau kosong" };

  const fd = new FormData();
  fd.set("locationId", locationId);
  fd.set("mode", "draft");
  fd.set("file", berkasForm(nama));
  fd.set("confirm", "1");
  fd.set("previewSha", pratinjau.preview.sha256);
  return (await importHps(undefined, fd)) ?? {};
}

const draftLokasi = () =>
  db.rabRevision.findMany({
    where: { locationId, status: "draft" },
    orderBy: { revisionNo: "asc" },
    select: { id: true, revisionNo: true },
  });

/** Laporkan satu item dari draft — membuat baris ber-`basis = draft_adendum`. */
async function laporkanDariDraft(draftId: string, tanggal: string) {
  const node = await db.rabNode.findFirstOrThrow({
    where: { revisionId: draftId, kind: "item", volume: { gt: 1 } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, lineageKey: true, name: true },
  });
  const laporan = await getOrCreateDraft(locationId, tanggal, sesi.id);
  await upsertItem(laporan.id, { rabNodeId: node.id, volumeDone: 1 }, sesi.id);
  return node;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org DT ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `dt-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  sesi = { id: user.id, orgId: org.id, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket DT ${suffix}`, stage: "pelaksanaan" } });
  packageId = pkg.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor DT ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 5_000_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 150,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-29"),
    },
  });
  slug = `lokasi-${suffix}`;
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi DT",
      slug,
      village: "Desa",
      regency: "Rembang",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;

  // RAB aktif dari berkas A supaya lokasi ini punya kontrak berlaku.
  const { parsed } = await parseHpsBuffer(readFileSync(jalur(BERKAS_A)));
  const hasil = await createRevisionFromNodes(loc.id, flattenParsedRab(parsed), {
    source: "hps_awal",
    userId: sesi.id,
    note: "kontrak",
  });
  await activateRevision(hasil.revisionId, sesi.id);
}, 900_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("impor draft kedua menggantikan yang pertama", () => {
  it("laporan yang sudah diinput PINDAH ke draft terbaru, dan drafnya tetap SATU", async () => {
    const pertama = await imporDraft(BERKAS_A);
    expect(pertama.error, `impor pertama gagal: ${pertama.error}`).toBeFalsy();
    const [draftLama] = await draftLokasi();
    expect(draftLama).toBeDefined();

    const node = await laporkanDariDraft(draftLama!.id, "2026-09-10");
    const sebelum = await db.dailyReportItem.findFirstOrThrow({
      where: { lineageKey: node.lineageKey, basis: "draft_adendum" },
      select: { id: true, rabNodeId: true },
    });
    expect(sebelum.rabNodeId).toBe(node.id);

    // Berkas yang SAMA: seluruh lineageKey punya padanan di draft baru.
    const kedua = await imporDraft(BERKAS_A);
    expect(kedua.error, `impor kedua gagal: ${kedua.error}`).toBeFalsy();

    const draft = await draftLokasi();
    expect(draft, `harus tersisa SATU draft, bukan ${draft.length}`).toHaveLength(1);
    expect(draft[0]!.id).not.toBe(draftLama!.id);

    const sesudah = await db.dailyReportItem.findUniqueOrThrow({
      where: { id: sebelum.id },
      select: { rabNodeId: true, basis: true, rabNode: { select: { revisionId: true, lineageKey: true } } },
    });
    expect(sesudah.rabNode.revisionId, "baris laporan masih menunjuk draft lama").toBe(draft[0]!.id);
    expect(sesudah.rabNode.lineageKey).toBe(node.lineageKey);
    expect(sesudah.basis).toBe("draft_adendum");
  }, 900_000);

  it("baris tanpa padanan di draft baru DITOLAK dengan menyebut tanggal & itemnya", async () => {
    /*
     * Diuji langsung pada `gantiDraftLama`, bukan lewat tombol impor.
     *
     * Lewat tombol, `samakanLineage` (DECISIONS 216/pemetaan manual) lebih dulu
     * MENYELARASKAN identitas berkas baru ke RAB aktif — jadi padanannya
     * nyaris selalu ketemu, dan uji yang menembak lewat sana akan hijau tanpa
     * pernah menyentuh pagar ini. Yang dijaga di sini kontrak fungsinya: kalau
     * sebuah baris laporan tidak punya rumah di draft baru, ia TIDAK dibuang
     * diam-diam dan TIDAK digantung — orangnya diberi daftarnya.
     */
    const draftSekarang = await draftLokasi();
    expect(draftSekarang).toHaveLength(1);

    const node = await db.rabNode.findFirstOrThrow({
      where: { revisionId: draftSekarang[0]!.id, kind: "item", volume: { gt: 1 } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, lineageKey: true },
    });
    const laporan = await getOrCreateDraft(locationId, "2026-09-11", sesi.id);
    await upsertItem(laporan.id, { rabNodeId: node.id, volumeDone: 1 }, sesi.id);

    // Draft "baru" yang sengaja TIDAK memuat lineage itu.
    const { parsed } = await parseHpsBuffer(readFileSync(jalur(BERKAS_A)));
    const tanpaItu = flattenParsedRab(parsed).filter((n) => n.lineageKey !== node.lineageKey);
    const baru = await createRevisionFromNodes(locationId, tanpaItu, {
      source: "adendum",
      userId: sesi.id,
      note: "uji",
    });

    let pesan = "";
    try {
      await gantiDraftLama(draftSekarang[0]!.id, baru.revisionId, sesi.id);
    } catch (e) {
      pesan = e instanceof Error ? e.message : String(e);
    }

    expect(pesan, "tidak ditolak – baris laporan menggantung atau terhapus").toBeTruthy();
    expect(pesan).toMatch(/laporan harian/i);
    // Tanggalnya disebut: tanpa itu orang harus menyisir laporan hari per hari.
    expect(pesan).toMatch(/11 Sep 2026|2026-09-11/);
    expect(pesan).not.toMatch(/constraint|rab_nodes|violates|foreign key/i);

    // Draft lama TETAP utuh: penolakan tidak boleh merusak yang sudah ada.
    const masih = await db.rabRevision.findUnique({ where: { id: draftSekarang[0]!.id } });
    expect(masih, "draft lama ikut terhapus oleh percobaan yang ditolak").not.toBeNull();
    await discardDraft(baru.revisionId, sesi.id);
  }, 900_000);
});

describe("membuang draft yang sudah dipakai melapor", () => {
  it("dijawab kalimat MARLIN yang menyebut jumlah & tanggalnya, bukan galat Postgres", async () => {
    const [draft] = await draftLokasi();
    let pesan = "";
    try {
      await discardDraft(draft!.id, sesi.id);
    } catch (e) {
      pesan = e instanceof Error ? e.message : String(e);
    }
    expect(pesan, "discardDraft tidak menolak – baris laporannya ikut terhapus?").toBeTruthy();
    expect(pesan).toMatch(/laporan harian/i);
    expect(pesan).toMatch(/10 Sep 2026|2026-09-10/);
    expect(pesan).not.toMatch(/constraint|rab_nodes|violates|foreign key/i);
    expect(await draftLokasi()).toHaveLength(1);
  }, 900_000);
});
