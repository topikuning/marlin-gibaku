// KENDALA PER PERIODE — dua tafsir, dan keduanya benar-benar berbeda isinya
// (DECISIONS 381 · menutup `WATANYA-02`).
//
// Koreksi user 2026-08-19: mesin klarifikasi (DECISIONS 376) memang dibuat untuk
// kasus seperti ini. Sebelumnya MARLIN memilih sendiri — menjawab SEMUA kendala
// yang terbuka sekarang, kapan pun dibukanya, lalu menempel catatan bahwa itu
// bukan keadaan pada periode yang ditanya. Jujur, tapi menjawab pertanyaan yang
// tidak ditanyakan.
//
// Yang dijaga berkas ini: ketiga cara baca menghasilkan daftar yang BERBEDA
// terhadap data yang sama. Uji yang tidak membedakannya akan hijau walau ketiga
// cabang diam-diam mengembalikan hal yang sama.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { dataKendala } = await import("@/lib/waha/tanya-data");
import type { LokasiKatalog } from "@/lib/waha/tanya-niat";

const suffix = `kdl${Date.now().toString(36)}`;
let katalog: LokasiKatalog[] = [];
let orgId = "";

const HARI = 24 * 3600 * 1000;
const SEKARANG = new Date();
/** Periode "minggu lalu": 14 s/d 8 hari yang lalu. */
const MULAI = new Date(SEKARANG.getTime() - 14 * HARI);
const AKHIR = new Date(SEKARANG.getTime() - 8 * HARI);

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org KDL ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const pkg = await db.package.create({
    data: { orgId, name: `Paket KDL ${suffix}`, stage: "pelaksanaan" },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Sukamaju ${suffix}`,
      slug: `sukamaju-${suffix}`,
      village: "Sukamaju",
      regency: "Demak",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true, name: true },
  });
  katalog = [
    {
      id: loc.id,
      nama: loc.name,
      desa: "Sukamaju",
      kecamatan: null,
      kabupaten: "Demak",
      provinsi: "Jawa Tengah",
    },
  ];

  /*
   * Empat kendala yang sengaja memilah ketiga cara baca:
   *
   * | kendala          | dibuka        | status    |
   * |------------------|---------------|-----------|
   * | LAMA_TERBUKA     | 30 hari lalu  | terbuka   |
   * | PERIODE_SELESAI  | minggu lalu   | selesai   |
   * | PERIODE_TERBUKA  | minggu lalu   | terbuka   |
   * | BARU_TERBUKA     | kemarin       | terbuka   |
   */
  const buat = async (title: string, dibuka: Date, status: "terbuka" | "selesai") => {
    const i = await db.issue.create({
      data: { locationId: loc.id, title, severity: "sedang", status },
      select: { id: true },
    });
    // `createdAt` @default(now()) tidak bisa diisi saat create — digeser di sini.
    await db.$executeRawUnsafe(
      `UPDATE issues SET created_at = $1 WHERE id = $2::uuid`,
      dibuka,
      i.id,
    );
  };
  await buat(`LAMA_TERBUKA ${suffix}`, new Date(SEKARANG.getTime() - 30 * HARI), "terbuka");
  await buat(`PERIODE_SELESAI ${suffix}`, new Date(SEKARANG.getTime() - 10 * HARI), "selesai");
  await buat(`PERIODE_TERBUKA ${suffix}`, new Date(SEKARANG.getTime() - 9 * HARI), "terbuka");
  await buat(`BARU_TERBUKA ${suffix}`, new Date(SEKARANG.getTime() - 1 * HARI), "terbuka");
});

afterAll(async () => {
  /*
   * TRUNCATE, bukan DELETE — pola yang sama dengan berkas integrasi lain.
   *
   * `audit_logs` append-only di tingkat basis data (trigger menolak
   * UPDATE/DELETE), tapi trigger itu TIDAK berlaku untuk TRUNCATE. Jadi jejak
   * audit tetap tak bisa dihapus dalam pemakaian normal, sementara uji tetap
   * bisa mengembalikan basis data ke keadaan bersih.
   *
   * Wajib: sebagian uji lain menegaskan hitungan GLOBAL, jadi baris yang
   * tertinggal dari berkas ini membuat uji yang sama sekali tidak berhubungan
   * gagal — dan gagalnya di tempat yang tidak menunjuk ke sini.
   */
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE issues, locations, packages, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

const judulSaja = (baris: { judul: string }[]) =>
  baris.map((b) => b.judul.replace(` ${suffix}`, "")).sort();

describe("tiga cara baca menghasilkan daftar yang BERBEDA", () => {
  it("terbuka_sekarang: apa pun yang masih terbuka, kapan pun dibukanya", async () => {
    const d = await dataKendala(katalog, SEKARANG, "terbuka_sekarang");
    expect(judulSaja(d.baris)).toEqual(["BARU_TERBUKA", "LAMA_TERBUKA", "PERIODE_TERBUKA"]);
  });

  it("dibuka_periode: SEMUA yang dibuka minggu lalu — termasuk yang sudah selesai", async () => {
    /*
     * Tafsir pertama yang diminta user: "kendala-kendala minggu lalu tanpa
     * peduli status sekarang". Yang sudah SELESAI justru wajib ikut — kalau
     * tidak, pertanyaan ini tidak ada bedanya dengan tafsir kedua.
     */
    const d = await dataKendala(katalog, SEKARANG, "dibuka_periode", {
      mulai: MULAI,
      akhir: AKHIR,
    });
    expect(judulSaja(d.baris)).toEqual(["PERIODE_SELESAI", "PERIODE_TERBUKA"]);
  });

  it("dibuka_periode_masih_terbuka: dibuka minggu lalu DAN belum selesai", async () => {
    // Tafsir kedua: "kendala dari minggu lalu yang masih terbuka".
    const d = await dataKendala(katalog, SEKARANG, "dibuka_periode_masih_terbuka", {
      mulai: MULAI,
      akhir: AKHIR,
    });
    expect(judulSaja(d.baris)).toEqual(["PERIODE_TERBUKA"]);
  });

  it("yang dibuka DI LUAR periode tidak pernah ikut", async () => {
    // Pagar arah sebaliknya: saringan periode yang longgar akan membuat kedua
    // tafsir perlahan berubah jadi "semua kendala" tanpa ada yang sadar.
    for (const saring of ["dibuka_periode", "dibuka_periode_masih_terbuka"] as const) {
      const d = await dataKendala(katalog, SEKARANG, saring, { mulai: MULAI, akhir: AKHIR });
      const judul = judulSaja(d.baris);
      expect(judul, saring).not.toContain("LAMA_TERBUKA");
      expect(judul, saring).not.toContain("BARU_TERBUKA");
    }
  });

  it("batas akhir periode INKLUSIF sampai penghujung hari", async () => {
    /*
     * `Issue.createdAt` bertimestamp, periode datang sebagai tanggal. Tanpa
     * penghujung hari, kendala yang dibuka pukul 09:00 pada hari terakhir
     * periode jatuh di luar rentang — dan yang hilang justru yang paling baru.
     */
    /*
     * Batas akhir dibuat TENGAH MALAM, persis seperti `parseDateKey` — itulah
     * bentuk yang benar-benar dipakai perangkai. Versi pertama uji ini memakai
     * instan yang sama persis dengan `createdAt` kendalanya, sehingga `lte`
     * cocok dengan atau tanpa penghujung hari: hijau yang tidak membuktikan
     * apa pun.
     */
    const hariKendala = new Date(SEKARANG.getTime() - 9 * HARI);
    const tengahMalam = new Date(
      Date.UTC(hariKendala.getUTCFullYear(), hariKendala.getUTCMonth(), hariKendala.getUTCDate()),
    );
    expect(hariKendala.getTime()).toBeGreaterThan(tengahMalam.getTime());

    const d = await dataKendala(katalog, SEKARANG, "dibuka_periode", {
      mulai: MULAI,
      akhir: tengahMalam,
    });
    expect(judulSaja(d.baris)).toContain("PERIODE_TERBUKA");
  });
});
