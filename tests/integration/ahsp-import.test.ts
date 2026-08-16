// Impor basis data AHSP SE DJBK 47/2026 (DECISIONS 317).
//
// Berjalan terhadap BERKAS SUNGGUHAN di seed-data/ — bukan fixture. Berkas itu
// yang nanti dipakai menghitung uang, jadi yang perlu dibuktikan adalah bahwa
// berkas itu yang masuk, utuh, dan bisa diimpor ulang tanpa menggandakan apa pun.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { imporAhspDariSeed, ringkasAhsp, AHSP_SOURCE_CODE } = await import("@/lib/ahsp/import");

beforeAll(async () => {
  // Mulai bersih: uji ini harus membuktikan impor PERTAMA, bukan menumpang
  // hasil impor sebelumnya di database yang sama.
  await db.ahspSource.deleteMany({ where: { code: AHSP_SOURCE_CODE } });
}, 120000);

afterAll(async () => {
  await db.ahspSource.deleteMany({ where: { code: AHSP_SOURCE_CODE } });
  await db.$disconnect();
});

describe("impor AHSP dari seed-data", () => {
  it("memuat seluruh analisa beserta komponennya", async () => {
    const h = await imporAhspDariSeed(null);
    expect(h.takBerubah).toBe(false);
    // Angka acuan dari berkas terbitan ini. Kalau berkasnya diganti dan
    // jumlahnya berubah, uji ini SENGAJA memerah — basis perhitungan uang tidak
    // boleh berganti diam-diam.
    expect(h.total).toBe(5560);
    expect(h.kanonik).toBe(5015);
    expect(h.perluVerifikasi).toBe(545);
    expect(h.komponen.upah + h.komponen.bahan + h.komponen.alat).toBe(29683);
    // Kategori di luar upah/bahan/alat DILAPORKAN, bukan dibuang. Terbitan 5.0
    // menambahkan `fasilitas` (Base Camp, Barak, Gudang pada analisa
    // "Fasilitas"); dengan daftar putih yang lama, 6 komponen resmi ini lenyap
    // tanpa suara. DECISIONS 324.
    expect(h.kategoriLain).toEqual({ fasilitas: 6 });
    // Lapisan pencocokan hanya melekat pada records kanonik yang memang
    // membawanya; supplemental TIDAK ditambal sendiri (DECISIONS 321).
    expect(h.punyaAlias).toBe(2688);

    const r = await ringkasAhsp();
    expect(r?.entri).toBe(5560);
    // Hitungan komponen di DB memuat SEMUA kategori, termasuk `fasilitas`.
    expect(r?.komponen).toBe(29689);
    expect(r?.punyaAlias).toBe(2688);
    expect(r?.fileSha256).toHaveLength(64);
  }, 300000);

  it("analisa tanpa koefisien terstruktur tetap membawa rujukan halaman sumbernya", async () => {
    const tanpa = await db.ahspEntry.findFirst({
      where: { components: { none: {} }, perluVerifikasi: false },
      select: { excerptId: true, analysisPdfPage: true, lampiran: true },
    });
    expect(tanpa).not.toBeNull();
    // Koefisiennya tidak dikarang — yang disimpan adalah jalan ke sumbernya.
    expect(tanpa!.excerptId).toBeTruthy();
    expect(tanpa!.lampiran).toBeTruthy();
  });

  it("KODE duplikat tersimpan sebagai analisa terpisah", async () => {
    const dobel = await db.$queryRaw<{ kode: string; n: bigint }[]>`
      SELECT kode, COUNT(*) AS n FROM ahsp_entries GROUP BY kode HAVING COUNT(*) > 1 LIMIT 3
    `;
    expect(dobel.length).toBeGreaterThan(0);
    // Uraian/satuannya memang berbeda — itu sebabnya kuncinya id, bukan kode.
    const contoh = await db.ahspEntry.findMany({
      where: { kode: dobel[0].kode },
      select: { externalId: true, uraian: true },
    });
    expect(new Set(contoh.map((c) => c.externalId)).size).toBe(contoh.length);
  });

  it("impor ulang berkas yang sama tidak menulis apa pun", async () => {
    const sebelum = await db.ahspEntry.count();
    const h = await imporAhspDariSeed(null);
    expect(h.takBerubah).toBe(true);
    expect(await db.ahspEntry.count()).toBe(sebelum);
  }, 300000);

  it("komponen menyimpan koefisien presisi penuh, bukan dibulatkan", async () => {
    // Koefisien alat berat lazim 4+ desimal; pembulatan menggeser hasil kali
    // volume besar.
    const c = await db.ahspComponent.findFirst({
      where: { koefisien: { lt: 0.001, gt: 0 } },
      select: { koefisien: true },
    });
    expect(c).not.toBeNull();
    expect(Number(c!.koefisien)).toBeGreaterThan(0);
  });
});
