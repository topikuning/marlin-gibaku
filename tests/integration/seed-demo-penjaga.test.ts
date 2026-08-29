// SEED DEMO TIDAK BOLEH MENYENTUH BASIS DATA OPERASIONAL.
//
// `pnpm db:seed` menolak `APP_ENV=production`, jadi satu-satunya jalan seed demo
// bisa mencapai server yang sedang berjalan adalah `BOOTSTRAP_DEMO_DATA=true`.
// Sampai 2026-08-28 jalan itu tidak punya penjaga apa pun — hanya komentar
// "jangan dipakai kalau sudah ada data sungguhan". Satu env var salah pasang
// sudah cukup untuk menyuntikkan lokasi contoh dan user berpassword `marlin123`
// ke basis data berisi pekerjaan nyata, dan kegagalannya SUNYI: tidak ada galat,
// hanya paket demo yang tiba-tiba muncul di daftar.
//
// Penjaganya sengaja membaca ISI basis data, BUKAN `APP_ENV`: deployment uji
// coba memang berjalan dengan `APP_ENV=production` — itu justru sebabnya env
// bootstrap ini ada. Yang membedakan bukan nama lingkungan, melainkan apakah
// ada yang sudah bekerja sungguhan di sana.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { bolehMuatDemo, NOMOR_PAKET_DEMO } = await import("@/lib/seed/demo");

const suffix = `sdp${Date.now().toString(36)}`;
let orgId = "";

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org ${suffix}`, slug: `o-${suffix}` },
  });
  orgId = org.id;
});

beforeEach(async () => {
  /*
   * SELURUH paket dibersihkan, bukan hanya milik org uji ini.
   *
   * `bolehMuatDemo()` sengaja memeriksa seluruh basis data tanpa menyaring
   * organisasi — memuat seed demo ke basis data berisi pekerjaan organisasi
   * LAIN sama merusaknya. Uji yang hanya membersihkan org-nya sendiri karena
   * itu bergantung pada sisa berkas uji lain yang kebetulan jalan lebih dulu,
   * dan hijau/merahnya jadi soal urutan.
   */
  // TRUNCATE ... CASCADE, bukan `deleteMany`: paket sisa berkas lain masih
  // digantungi lokasi/kontrak, dan penghapusan biasa ditolak kunci asing.
  await db.$executeRawUnsafe(`TRUNCATE TABLE packages RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE TABLE packages, organizations RESTART IDENTITY CASCADE`);
  await db.$disconnect();
});

describe("izin memuat seed demo", () => {
  it("basis data kosong: boleh", async () => {
    expect(await bolehMuatDemo(db)).toEqual({ boleh: true });
  });

  it("berisi paket demo saja: tetap boleh (seed idempotent, aman diulang)", async () => {
    for (const nomor of NOMOR_PAKET_DEMO.slice(0, 3)) {
      await db.package.create({
        data: { orgId, name: `Paket ${nomor}`, packageNumber: nomor, stage: "pelaksanaan" },
      });
    }
    expect(await bolehMuatDemo(db)).toEqual({ boleh: true });
  });

  it("REGRESI: satu paket ASING sudah cukup untuk menolak, dan paketnya DISEBUT", async () => {
    /*
     * Disebut namanya karena penolakan yang tidak menyebut sebabnya akan dibaca
     * sebagai kerusakan, lalu env-nya dipasang ulang lebih keras.
     */
    await db.package.create({
      data: {
        orgId,
        name: "Paket KNMP Demak (operasional)",
        packageNumber: "PKT-OPS-2026-777",
        stage: "pelaksanaan",
      },
    });
    const izin = await bolehMuatDemo(db);
    expect(izin.boleh).toBe(false);
    expect(izin.boleh === false && izin.alasan).toContain("PKT-OPS-2026-777");
    expect(izin.boleh === false && izin.alasan).toContain("Paket KNMP Demak (operasional)");
  });

  it("paket TANPA nomor juga menolak – bukan celah", async () => {
    /*
     * `packageNumber` boleh kosong (paket yang dibuat lewat layar belum tentu
     * bernomor). Kalau yang tak bernomor dianggap "bukan asing", satu paket
     * operasional tanpa nomor akan membuka pintu untuk seluruh seed.
     */
    await db.package.create({
      data: { orgId, name: "Paket tanpa nomor", packageNumber: null, stage: "prospek" },
    });
    const izin = await bolehMuatDemo(db);
    expect(izin.boleh).toBe(false);
    expect(izin.boleh === false && izin.alasan).toContain("tanpa nomor");
  });
});

describe("daftar nomor paket demo tidak boleh tertinggal", () => {
  it("mencakup SETIAP paket yang ditulis seed", () => {
    /*
     * Penjaga di atas hanya sekuat daftarnya. Menambah paket ke seed tanpa
     * memasukkan nomornya ke `NOMOR_PAKET_DEMO` membuat seed menolak basis
     * datanya sendiri pada jalan kedua — dan lebih buruk, membuat orang
     * menyangka penjaganya rusak lalu mematikannya.
     *
     * Karena itu daftarnya DITURUNKAN dari kedua array di `demo.ts`, dan uji
     * ini menjaga bahwa tidak ada `packageNumber` lain yang ditulis di luar
     * keduanya.
     */
    const src = readFileSync("src/lib/seed/demo.ts", "utf8");
    const penulis = [...src.matchAll(/packageNumber:\s*([A-Za-z_][\w.]*)/g)]
      .map((m) => m[1])
      // `null` & `true` = pemakaian di `where`/`select`, bukan penulisan nilai.
      .filter((v) => v !== "null" && v !== "true");
    // Hanya dua penulis yang sah: `p.number` (PACKAGES) dan `e.number` (pipeline).
    expect(new Set(penulis)).toEqual(new Set(["p.number", "e.number"]));

    expect(NOMOR_PAKET_DEMO.length).toBe(new Set(NOMOR_PAKET_DEMO).size);
    expect(NOMOR_PAKET_DEMO.length).toBeGreaterThanOrEqual(13);
  });
});
