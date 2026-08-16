// IMPOR YANG TERPUTUS TIDAK BOLEH MENGAKU MUTAKHIR (DECISIONS 325).
//
// Laporan user 2026-08-16 dari /sistem: *"saat proses periksa dan segarkan ahsp
// selalu terjadi seperti itu [unexpected response from the server], lalu kalau
// diklik lagi ada pernyataan berhasil"*.
//
// Sebabnya berlapis. Server produksi 0,5 vCPU / 512 MB; `JSON.parse` berkas
// master 14,6 MB saja memuncakkan RSS 184 MB di atas Next.js yang sudah memakan
// ratusan MB, jadi prosesnya dibunuh di tengah impor. Sampai di situ ia "cuma"
// gagal. Yang membuatnya berbahaya: `fileSha256` dipasang di AWAL, jadi sumber
// yang isinya baru separuh sudah MENGAKU sha berkas itu — dan klik berikutnya
// menjawab "sudah mutakhir" di atas basis yang bolong.
//
// Uji ini MEMUTUS impor sungguhan di tengah (bukan memalsukan keadaan
// akhirnya), lalu memeriksa apa yang tertinggal di database.
//
// Jalankan: DATABASE_URL=...marlin_test APP_ENV=test pnpm vitest run tests/integration
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { imporAhspDariSeed, ringkasAhsp, AHSP_SOURCE_CODE } = await import("@/lib/ahsp/import");

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.$disconnect();
});

/** Paksa jalur tulis-ulang pada impor berikutnya. */
async function paksaTulisUlang(): Promise<void> {
  await db.ahspSource.updateMany({
    where: { code: AHSP_SOURCE_CODE },
    data: { fileSha256: `paksa-${Date.now()}` },
  });
}

describe("impor AHSP yang terputus di tengah", () => {
  it("mati saat menulis komponen → basis TIDAK mengaku mutakhir, dan diulang penuh", async () => {
    const utuh = await imporAhspDariSeed(null);
    const shaBerkas = utuh.fileSha256;
    await paksaTulisUlang();

    /*
     * Matikan penulisan komponen setelah beberapa potongan — tiruan proses yang
     * dibunuh kernel karena kehabisan memori. Yang diperiksa BUKAN lemparannya,
     * melainkan apa yang TERTINGGAL di database sesudahnya.
     */
    let lolos = 0;
    const asli = db.ahspComponent.createMany.bind(db.ahspComponent);
    vi.spyOn(db.ahspComponent, "createMany").mockImplementation((async (args: never) => {
      lolos += 1;
      if (lolos > 5) throw new Error("simulasi: proses dibunuh saat menulis komponen");
      return asli(args);
    }) as never);

    await expect(imporAhspDariSeed(null)).rejects.toThrow(/simulasi/);
    vi.restoreAllMocks();

    // INTI-nya: sumber yang tertinggal tidak boleh membawa sha berkas.
    const rusak = await ringkasAhsp();
    expect(rusak?.belumSelesai).toBe(true);
    expect(rusak?.fileSha256).not.toBe(shaBerkas);

    // Klik berikutnya harus MENGULANG, bukan menjawab "sudah mutakhir".
    const ulang = await imporAhspDariSeed(null);
    expect(ulang.takBerubah).toBe(false);
    expect(ulang.fileSha256).toBe(shaBerkas);

    const pulih = await ringkasAhsp();
    expect(pulih?.belumSelesai).toBe(false);
    expect(pulih?.entri).toBe(utuh.total);
  }, 900000);

  it("penulisan yang diam-diam bolong DITOLAK, bukan dilaporkan berhasil", async () => {
    await paksaTulisUlang();

    /*
     * Tiruan kegagalan paling jahat: perintah tulis "berhasil" tapi barisnya
     * tidak masuk. Tanpa pemeriksaan jumlah, basis yang kurang ribuan komponen
     * akan dinyatakan selesai dan baru ketahuan saat angka kebutuhan bahan
     * salah — jauh dari tempat sebabnya.
     */
    let lolos = 0;
    const asli = db.ahspComponent.createMany.bind(db.ahspComponent);
    vi.spyOn(db.ahspComponent, "createMany").mockImplementation((async (args: never) => {
      lolos += 1;
      if (lolos > 5) return { count: 0 };
      return asli(args);
    }) as never);

    await expect(imporAhspDariSeed(null)).rejects.toThrow(/tidak lengkap/i);
    vi.restoreAllMocks();

    const rusak = await ringkasAhsp();
    expect(rusak?.belumSelesai).toBe(true);

    // Bersihkan supaya uji berikutnya berangkat dari basis yang utuh.
    await imporAhspDariSeed(null);
  }, 900000);

  it("impor kedua atas berkas yang sama berhenti cepat — tanpa membaca ulang basisnya", async () => {
    // Jalur inilah yang dipakai tombol "Periksa & segarkan" sehari-hari, dan
    // dulu ia ikut mem-parse berkas 14,6 MB hanya untuk menyimpulkan "tidak ada
    // yang berubah" — 184 MB RSS untuk menjawab "tidak ada yang berubah".
    const t0 = Date.now();
    const h = await imporAhspDariSeed(null);
    const ms = Date.now() - t0;
    expect(h.takBerubah).toBe(true);
    expect(ms).toBeLessThan(2000);
  }, 300000);

  it("jumlah yang tersimpan sama persis dengan yang dijanjikan manifest", async () => {
    const h = await imporAhspDariSeed(null);
    const r = await ringkasAhsp();
    expect(r?.entri).toBe(h.total);
    expect(r?.komponen).toBe(
      h.komponen.upah +
        h.komponen.bahan +
        h.komponen.alat +
        Object.values(h.kategoriLain).reduce((a, b) => a + b, 0),
    );
  }, 300000);
});
