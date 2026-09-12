// KORPUS BERKAS TAMBAH/KURANG KKP — banyak penyusun, satu pola, tata letak beda.
//
// Berkas-berkas ini datang dari orang yang berbeda-beda dengan maksud yang sama,
// dan tidak ada satu pun yang bisa dipaksa seragam. Karena itu yang diuji BUKAN
// satu berkas melainkan KORPUS: tiap tata letak yang pernah ditemui masuk ke
// tabel di bawah, dan aturan yang sama dijalankan atas semuanya.
//
//   Pasar Banggi : MC 0          | TAMBAH | KURANG | CCO - 01
//   Karangmangu  : MC - 0        | TAMBAH | KURANG | … | CCO - 01   (+ kolom TKDN)
//   Tambakagung  : NILAI KONTRAK | TAMBAH | KURANG | MC - 0          (VOL & SAT bersama)
//
// Tambakagung yang dilaporkan user 2026-09-12 — *"pasarbanggi dan karangmangu
// bisa dibaca baik, tambakagung malah baca group nilai kontrak lalu muncul error
// itu"*. Dua lainnya ikut masuk BUKAN sebagai pelengkap: merekalah yang
// membuktikan bahwa perbaikan untuk yang satu tidak merusak yang lain.
//
// Yang dipanggil `importHps` apa adanya lewat FormData — persis tombol
// Pratinjau. Membuktikan parsernya benar bukan membuktikan layarnya sembuh:
// yang tumbang di layar user adalah aksi servernya, dengan RAB aktif di
// seberangnya dan penyusunan pratinjau di ujungnya.
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

/** Tata letak yang sudah ditemui di lapangan. Tambah baris saat ketemu yang baru. */
const KORPUS = [
  {
    label: "Tambakagung – blok dasar NILAI KONTRAK, VOL & SAT di kolom bersama",
    berkas: "mc0-tambakagung-blok-nilai-kontrak.xlsx",
    itemMin: 400,
  },
  {
    label: "Pasar Banggi – blok MC 0 → CCO - 01",
    berkas: "mc0-pasar-banggi-blok-cco01.xlsx",
    itemMin: 900,
  },
  {
    label: "Karangmangu – blok MC - 0 → CCO - 01, dengan kolom TKDN di tengah",
    berkas: "mc0-karangmangu-blok-cco01-tkdn.xlsx",
    itemMin: 500,
  },
] as const;

const jalur = (n: string) => new URL(`../fixtures/${n}`, import.meta.url).pathname;
const suffix = `kk${Date.now().toString(36)}`;
let packageId: string;

/** Berkas siap-kirim, sama seperti yang dipilih user di kotak unggah. */
const berkasForm = (nama: string) =>
  new File([new Uint8Array(readFileSync(jalur(nama)))], nama, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

/** Lokasi baru + RAB aktif dari berkas `dariBerkas`. */
async function lokasiDenganRabAktif(nama: string, dariBerkas: string): Promise<string> {
  const loc = await db.location.create({
    data: {
      packageId,
      name: nama,
      slug: `${nama.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`,
      village: nama,
      regency: "Rembang",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
  });
  const { parsed } = await parseHpsBuffer(readFileSync(jalur(dariBerkas)));
  const hasil = await createRevisionFromNodes(loc.id, flattenParsedRab(parsed), {
    source: "hps_awal",
    userId: sesi.id,
    note: "kontrak",
  });
  await activateRevision(hasil.revisionId, sesi.id);
  return loc.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org KK ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: {
      orgId: org.id,
      username: `kk-${suffix}`,
      fullName: "Tester",
      passwordHash: "x",
      role: "super_admin",
    },
  });
  sesi = { id: user.id, orgId: org.id, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket KK ${suffix}`, stage: "pelaksanaan" } });
  packageId = pkg.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor KK ${suffix}` } });
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
}, 600_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("impor berkas tambah/kurang KKP lewat aksi server", () => {
  for (const { label, berkas, itemMin } of KORPUS) {
    it(`${label} – pratinjau menjawab, kolomnya blok CCO`, async () => {
      const locationId = await lokasiDenganRabAktif(berkas.slice(4, 20), berkas);

      const fd = new FormData();
      fd.set("locationId", locationId);
      fd.set("mode", "draft");
      fd.set("file", berkasForm(berkas));

      const mulai = Date.now();
      const hasil = await importHps(undefined, fd);
      const detik = (Date.now() - mulai) / 1000;

      expect(hasil?.error, `pratinjau gagal: ${hasil?.error}`).toBeUndefined();
      expect(hasil?.preview, "tidak ada pratinjau yang dikembalikan").toBeDefined();
      // Batas waktu proxy di produksi puluhan detik; yang menembusnya sampai ke
      // layar sebagai jawaban bukan-aksi, bukan sebagai galat MARLIN.
      expect(detik, `pratinjau makan ${detik.toFixed(1)} detik`).toBeLessThan(60);

      const p = hasil!.preview!;
      expect(p.priceColumnLabel, "dibaca sebagai HPS biasa, bukan blok CCO KKP").toMatch(/CCO KKP/i);
      expect(p.itemCount).toBeGreaterThan(itemMin);

      // Berkas yang sama dengan RAB aktifnya: tidak ada yang baru, tidak ada
      // yang hilang, nilainya tidak bergerak. Kalau ini meleset, identitasnya
      // yang tidak nyambung — bukan angkanya.
      expect(p.beda, "tidak ada perbandingan terhadap RAB aktif").not.toBeNull();
      expect(p.beda!.itemBaru, "item baru palsu").toHaveLength(0);
      expect(p.beda!.itemHilang, "item hilang palsu").toHaveLength(0);
      expect(p.beda!.totalBaru).toBe(p.beda!.totalAktif);
    }, 600_000);
  }

  it("RAB aktif dari berkas LAIN pun tetap dijawab, tidak menggantung", async () => {
    /*
     * Keadaan terberat, dan yang paling mungkin terjadi di lapangan: RAB aktif
     * berasal dari berkas lain, jadi hampir seluruh identitas tidak berpasangan.
     * Di situ pencocokan identitas bekerja paling keras DAN pratinjaunya paling
     * gemuk — ratusan "item baru" plus ratusan "item hilang", masing-masing
     * dengan jalur dan namanya.
     */
    const locationId = await lokasiDenganRabAktif("Campuran", "mc0-pasar-banggi-blok-cco01.xlsx");

    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("mode", "draft");
    fd.set("file", berkasForm("mc0-tambakagung-blok-nilai-kontrak.xlsx"));

    const mulai = Date.now();
    const res = await importHps(undefined, fd);
    const detik = (Date.now() - mulai) / 1000;

    expect(res?.error, `pratinjau gagal: ${res?.error}`).toBeUndefined();
    expect(res?.preview).toBeDefined();
    expect(detik, `pratinjau makan ${detik.toFixed(1)} detik`).toBeLessThan(60);
    expect(res!.preview!.beda!.itemHilang.length).toBeGreaterThan(100);

    /*
     * Balasan harus MUAT dikirim. Balasan aksi server yang membengkak berakhir
     * sama dengan proses yang mati: yang sampai ke layar bukan galat MARLIN,
     * melainkan "An unexpected response was received from the server".
     */
    const besar = JSON.stringify(res!.preview).length;
    expect(besar, `balasan pratinjau ${(besar / 1024).toFixed(0)} KB`).toBeLessThan(1_000_000);
  }, 600_000);
});
