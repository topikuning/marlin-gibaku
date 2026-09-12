// AKSI IMPOR YANG SEBENARNYA, DENGAN BERKAS YANG TUMBANG DI LAYAR USER.
//
// Dilaporkan 2026-09-12: menekan "Pratinjau" untuk `MC 0 A TAMBAKAGUNG` (2,8 MB)
// ke DRAFT adendum berakhir dengan *"Gagal mengirim – server menolak permintaan
// ini … An unexpected response was received from the server."* Dua berkas lain
// dari paket yang sama (Pasar Banggi, Karangmangu) baik-baik saja.
//
// Uji unit sudah membuktikan sebabnya: berkas ini menaruh VOL dan SAT di kolom
// BERSAMA, sehingga `deteksiCco` menyerah dan berkasnya dibaca sebagai HPS biasa
// dari kolom yang salah. Tapi membuktikan parsernya benar BUKAN membuktikan
// layarnya sembuh — yang tumbang adalah aksi servernya, dengan RAB aktif di
// seberangnya, pencocokan identitas, dan penyusunan pratinjau.
//
// Karena itu uji ini memanggil `importHps` apa adanya, lewat FormData, persis
// seperti tombolnya.
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
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");

const BERKAS = "mc0-tambakagung-blok-nilai-kontrak.xlsx";
const jalur = new URL(`../fixtures/${BERKAS}`, import.meta.url).pathname;
const suffix = `tb${Date.now().toString(36)}`;
let locationId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org TB ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: {
      orgId: org.id,
      username: `tb-${suffix}`,
      fullName: "Tester",
      passwordHash: "x",
      role: "super_admin",
    },
  });
  sesi = { id: user.id, orgId: org.id, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket TB ${suffix}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor TB ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 2_400_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 150,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-29"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Tambakagung",
      slug: `lokasi-${suffix}`,
      village: "Tambakagung",
      regency: "Rembang",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;

  /*
   * RAB AKTIF dari berkas yang SAMA — itu keadaan nyatanya: lokasi ini sudah
   * punya kontrak berjalan, lalu MC-0-nya diimpor ke draft adendum. Tanpa RAB
   * aktif, seluruh mesin pencocokan identitas tidak pernah jalan, dan justru di
   * situlah berkas ini paling berat.
   */
  const { parsed } = await parseHpsBuffer(readFileSync(jalur));
  const hasil = await createRevisionFromNodes(locationId, flattenParsedRab(parsed), {
    source: "hps_awal",
    userId: sesi.id,
    note: "kontrak",
  });
  await activateRevision(hasil.revisionId, sesi.id);
}, 300_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("impor MC 0 Tambakagung lewat aksi server", () => {
  it("Pratinjau ke DRAFT adendum menjawab, bukan menjatuhkan server", async () => {
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("mode", "draft");
    fd.set(
      "file",
      new File([new Uint8Array(readFileSync(jalur))], BERKAS, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const mulai = Date.now();
    const hasil = await importHps(undefined, fd);
    const detik = (Date.now() - mulai) / 1000;

    expect(hasil?.error, `pratinjau gagal: ${hasil?.error}`).toBeUndefined();
    expect(hasil?.preview, "tidak ada pratinjau yang dikembalikan").toBeDefined();
    // Batas waktu proxy di produksi puluhan detik; kalau pratinjau menembusnya,
    // yang sampai ke layar bukan galat kami melainkan jawaban yang bukan-aksi.
    expect(detik, `pratinjau makan ${detik.toFixed(1)} detik`).toBeLessThan(60);

    const p = hasil!.preview!;
    expect(p.priceColumnLabel, "dibaca sebagai HPS biasa, bukan blok CCO KKP").toMatch(/CCO KKP/i);
    expect(p.itemCount).toBeGreaterThan(400);
    expect(p.beda, "tidak ada perbandingan terhadap RAB aktif").not.toBeNull();
    // Berkas yang sama dengan RAB aktifnya: tidak ada yang baru, tidak ada yang
    // hilang. Kalau ini meleset, identitasnya yang tidak nyambung — bukan
    // angkanya — dan itu yang dulu berbunyi "676 item baru · 676 item hilang".
    expect(p.beda!.itemBaru, "item baru palsu").toHaveLength(0);
    expect(p.beda!.itemHilang, "item hilang palsu").toHaveLength(0);
    expect(p.beda!.totalBaru).toBe(p.beda!.totalAktif);
  }, 300_000);

  it("RAB aktif yang SANGAT berbeda pun tetap dijawab, tidak menggantung", async () => {
    /*
     * Keadaan terberat, dan yang paling mungkin terjadi di lapangan: RAB aktif
     * berasal dari berkas lain, jadi hampir seluruh identitas tidak berpasangan.
     * Di situ pencocokan identitas bekerja paling keras DAN pratinjaunya paling
     * gemuk — ratusan "item baru" plus ratusan "item hilang", masing-masing
     * dengan jalur dan namanya. Balasan aksi server yang membengkak berakhir
     * sama dengan proses yang mati: yang sampai ke layar bukan galat MARLIN,
     * melainkan "An unexpected response was received from the server".
     */
    const lain = await db.location.findFirstOrThrow({ where: { id: locationId } });
    const { parsed } = await parseHpsBuffer(
      readFileSync(new URL("../fixtures/mc0-pasar-banggi-blok-cco01.xlsx", import.meta.url).pathname),
    );
    const hasil = await createRevisionFromNodes(lain.id, flattenParsedRab(parsed), {
      source: "adendum",
      userId: sesi.id,
      note: "RAB lain",
    });
    await activateRevision(hasil.revisionId, sesi.id);

    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("mode", "draft");
    fd.set(
      "file",
      new File([new Uint8Array(readFileSync(jalur))], BERKAS, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const mulai = Date.now();
    const res = await importHps(undefined, fd);
    const detik = (Date.now() - mulai) / 1000;

    expect(res?.error, `pratinjau gagal: ${res?.error}`).toBeUndefined();
    expect(res?.preview).toBeDefined();
    expect(detik, `pratinjau makan ${detik.toFixed(1)} detik`).toBeLessThan(60);

    // Balasan harus MUAT dikirim. 1 MB sudah jauh di atas pratinjau normal;
    // di atas itu yang salah bukan berkasnya melainkan bentuk balasannya.
    const besar = JSON.stringify(res!.preview).length;
    expect(besar, `balasan pratinjau ${(besar / 1024).toFixed(0)} KB`).toBeLessThan(1_000_000);
  }, 300_000);
});
