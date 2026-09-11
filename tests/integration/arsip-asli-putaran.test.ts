// SATU PUTARAN ARSIP DINGIN, DIJALANKAN SUNGGUHAN.
//
// Yang diuji di sini bukan bentuk kode melainkan URUTAN KEJADIAN — dan itu
// bagian yang kalau salah tidak bisa diperbaiki: sebuah berkas dihapus dari
// tempat asalnya padahal belum benar-benar aman di tempat tujuan.
//
// Arsip dinginnya server HTTP sungguhan di dalam uji ini (bukan tiruan
// fungsi), jadi yang teruji termasuk headernya, kode statusnya, dan bacaan
// ulang setelah kirim. R2-nya ditiru karena yang diuji bukan R2.
//
// Empat hal yang dijaga:
//   1. kirim → baca ulang → catat, dan R2 TIDAK disentuh di putaran itu
//   2. salinan R2 baru dibuang sesudah masa tenggang lewat
//   3. mati di tengah jalan tidak menggandakan: putaran berikutnya melihat
//      berkasnya sudah ada di sana dan melanjutkan, bukan mengirim ulang
//   4. isi yang tidak cocok sidik jarinya DITOLAK, bukan dipindahkan
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

/** R2 ditiru: yang diuji perpindahannya, bukan R2. */
const gudangR2 = new Map<string, Buffer>();
const dihapusDariR2: string[] = [];
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2GetBuffer: async (k: string) => {
    const b = gudangR2.get(k);
    if (!b) throw new Error(`R2 tiruan: ${k} tidak ada`);
    return b;
  },
  r2Delete: async (k: string) => {
    dihapusDariR2.push(k);
    gudangR2.delete(k);
  },
}));

const ISI = Buffer.from(`BYTE-ASLI-${"x".repeat(3000)}`);
const SHA = createHash("sha256").update(ISI).digest("hex");
const KUNCI = "photos/uji-arsip-dingin/2026-08-01/aaa.asli.jpg";

/**
 * Arsip dingin tiruan — HTTP sungguhan, lengkap dengan pemeriksaan token.
 *
 * Berdiri SEBELUM modul aplikasi diimpor, dan itu bukan gaya penulisan: `env.ts`
 * membaca `process.env` sekali saat dimuat, jadi alamat yang disetel sesudahnya
 * tidak akan pernah terlihat. Versi pertama uji ini menyetelnya di `beforeAll`
 * dan seluruh putaran berhenti dengan alasan "belum-dikonfigurasi".
 */
const simpananArsip = new Map<string, Buffer>();
const jejak: string[] = [];

/**
 * Jalur → kunci logis. Arsip tiruan ini menirukan dialek gateway sungguhan:
 * `/v1/objects/<kunci base64url>` (DECISIONS 554). Jejaknya tetap dicatat dalam
 * kunci LOGIS, bukan jalur tersandi — yang diuji berkas mana yang disentuh,
 * bukan bagaimana ia dieja di URL.
 */
function kunciDari(url: string): string {
  const awalan = "/v1/objects/";
  if (!url.startsWith(awalan)) return url;
  return Buffer.from(url.slice(awalan.length), "base64url").toString("utf8");
}

const server: Server = createServer(async (req, res) => {
  const kunci = kunciDari(req.url ?? "");
  jejak.push(`${req.method} ${kunci}`);
  if (req.headers.authorization !== "Bearer rahasia-uji") {
    res.writeHead(403);
    return res.end();
  }
  if (req.method === "HEAD") {
    const b = simpananArsip.get(kunci);
    if (!b) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      "content-length": String(b.length),
      "x-content-sha256": createHash("sha256").update(b).digest("hex"),
    });
    return res.end();
  }
  if (req.method === "PUT") {
    const bagian: Buffer[] = [];
    for await (const c of req) bagian.push(c as Buffer);
    simpananArsip.set(kunci, Buffer.concat(bagian));
    res.writeHead(201);
    return res.end();
  }
  res.writeHead(405);
  res.end();
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
process.env.ORIGINAL_ARCHIVE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.ORIGINAL_ARCHIVE_TOKEN = "rahasia-uji";

const { db } = await import("@/lib/db");
const { jalankanArsipAsli } = await import("@/lib/arsip-asli/antrean");
const { setArsipAktif, setTenggangHari, ARSIP_AKTIF_KEY, ARSIP_TENGGANG_KEY } = await import(
  "@/lib/arsip-asli/setelan"
);

async function bersihkan() {
  await db.photo.deleteMany({ where: { r2Key: { startsWith: "photos/uji-arsip-dingin/" } } });
  await db.appSetting.deleteMany({ where: { key: { in: [ARSIP_AKTIF_KEY, ARSIP_TENGGANG_KEY] } } });
}

/** Satu baris foto yang berkas aslinya menunggu dipindahkan. */
async function fotoMenunggu(opts: { isi?: Buffer } = {}) {
  const isi = opts.isi ?? ISI;
  gudangR2.clear();
  dihapusDariR2.length = 0;
  simpananArsip.clear();
  jejak.length = 0;
  gudangR2.set(KUNCI, isi);
  return db.photo.create({
    data: {
      r2Key: `photos/uji-arsip-dingin/2026-08-01/aaa.webp`,
      originalKey: KUNCI,
      originalBytes: ISI.length,
      sha256: SHA,
      bytes: 1234,
    },
    select: { id: true },
  });
}

beforeEach(async () => {
  await bersihkan();
  await setArsipAktif(true);
  await setTenggangHari(7);
});

describe("putaran arsip dingin", () => {
  it("mengirim, membaca ulang, mencatat – dan TIDAK menghapus apa pun", async () => {
    const foto = await fotoMenunggu();
    const h = await jalankanArsipAsli();

    expect(h.dijalankan).toBe(true);
    expect(h.dikirim).toBe(1);
    expect(h.gagal).toBe(0);
    // Jejaknya membuktikan urutannya: periksa dulu (belum ada), kirim, periksa lagi.
    expect(jejak).toEqual([`HEAD ${KUNCI}`, `PUT ${KUNCI}`, `HEAD ${KUNCI}`]);
    expect(simpananArsip.get(KUNCI)).toEqual(ISI);

    // Masa tenggang 7 hari: salinan R2 masih utuh.
    expect(dihapusDariR2).toEqual([]);
    expect(gudangR2.has(KUNCI)).toBe(true);

    const baris = await db.photo.findUniqueOrThrow({
      where: { id: foto.id },
      select: { originalArchivedAt: true, originalR2PurgedAt: true, originalArchiveTries: true },
    });
    expect(baris.originalArchivedAt).not.toBeNull();
    expect(baris.originalR2PurgedAt, "salinan R2 dibuang terlalu cepat").toBeNull();
    expect(baris.originalArchiveTries).toBe(0);
  });

  it("salinan R2 baru dibuang setelah masa tenggang lewat", async () => {
    const foto = await fotoMenunggu();
    await jalankanArsipAsli();
    expect(dihapusDariR2).toEqual([]);

    // Tenggang 0 = buang segera; putaran berikutnya yang mengerjakannya.
    await setTenggangHari(0);
    const h = await jalankanArsipAsli();

    expect(h.dibuangDariR2).toBe(1);
    expect(dihapusDariR2).toEqual([KUNCI]);
    const baris = await db.photo.findUniqueOrThrow({
      where: { id: foto.id },
      select: { originalR2PurgedAt: true },
    });
    expect(baris.originalR2PurgedAt).not.toBeNull();
    // Yang di arsip dingin TIDAK ikut terhapus – itu justru tujuannya.
    expect(simpananArsip.has(KUNCI)).toBe(true);
  });

  it("mati sesudah kirim tapi sebelum mencatat: tidak dikirim dua kali", async () => {
    const foto = await fotoMenunggu();
    await jalankanArsipAsli();

    // Menirukan proses yang mati tepat setelah PUT: berkasnya sudah di sana,
    // tapi DB belum sempat mencatatnya.
    await db.photo.update({ where: { id: foto.id }, data: { originalArchivedAt: null } });
    jejak.length = 0;

    const h = await jalankanArsipAsli();
    expect(h.dikirim).toBe(1);
    // HEAD saja – tidak ada PUT kedua.
    expect(jejak).toEqual([`HEAD ${KUNCI}`]);
    const baris = await db.photo.findUniqueOrThrow({
      where: { id: foto.id },
      select: { originalArchivedAt: true },
    });
    expect(baris.originalArchivedAt).not.toBeNull();
  });

  it("isi di R2 tidak cocok sidik jarinya: DITOLAK, tidak dipindahkan", async () => {
    // Berkas yang tercatat bukan lagi berkas yang ada di sana. Memindahkan yang
    // salah ke arsip permanen jauh lebih buruk daripada gagal memindahkannya.
    const foto = await fotoMenunggu({ isi: Buffer.from("ISI-LAIN-YANG-BUKAN-ASLINYA") });
    const h = await jalankanArsipAsli();

    expect(h.dikirim).toBe(0);
    expect(h.gagal).toBe(1);
    expect(simpananArsip.size, "berkas salah ikut terkirim").toBe(0);
    const baris = await db.photo.findUniqueOrThrow({
      where: { id: foto.id },
      select: { originalArchivedAt: true, originalArchiveTries: true, originalArchiveError: true },
    });
    expect(baris.originalArchivedAt).toBeNull();
    expect(baris.originalArchiveTries).toBe(1);
    expect(baris.originalArchiveError).toMatch(/sidik jari/);
  });

  it("berkas LENYAP dari arsip: salinan R2 TIDAK ikut dibuang", async () => {
    /*
     * Ini kegagalan yang paling tidak bisa diperbaiki, dan satu-satunya yang
     * hasilnya permanen: baris tercatat terarsip berhari-hari lalu, lalu
     * berkasnya lenyap dari mesin itu — terhapus tangan, disk diganti,
     * direktori ter-mount ulang. Kalau penghapusan R2 hanya percaya pada
     * CATATAN, yang hilang berkas aslinya, dan tidak ada yang tahu sampai ada
     * yang mencoba memperbaiki cap berbulan-bulan kemudian.
     *
     * Karena itu catatannya tidak cukup: keberadaannya dipastikan ULANG tepat
     * sebelum menghapus.
     */
    const foto = await fotoMenunggu();
    await jalankanArsipAsli();
    simpananArsip.delete(KUNCI); // lenyap di seberang, tanpa ada yang tahu

    await setTenggangHari(0);
    const h = await jalankanArsipAsli();

    expect(h.dibuangDariR2, "R2 dibuang padahal arsipnya kosong").toBe(0);
    expect(dihapusDariR2).toEqual([]);
    expect(gudangR2.has(KUNCI), "berkas asli hilang dari KEDUA tempat").toBe(true);
    const baris = await db.photo.findUniqueOrThrow({
      where: { id: foto.id },
      select: { originalR2PurgedAt: true, originalArchivedAt: true },
    });
    expect(baris.originalR2PurgedAt).toBeNull();
    // Catatannya ikut dibatalkan: yang tidak ada di sana bukan "sudah terarsip".
    expect(baris.originalArchivedAt, "masih tercatat terarsip padahal tidak ada").toBeNull();
  });

  it("putaran yang pengirimannya GAGAL tidak membuang satu salinan R2 pun", async () => {
    // Arsip yang sedang bermasalah bukan tempat yang aman untuk mengurangi
    // salinan — walau baris LAIN sudah lama terbukti terarsip.
    const lama = await fotoMenunggu();
    await jalankanArsipAsli();

    // Satu baris baru yang isinya di R2 tidak cocok → pengirimannya gagal.
    const isiSalah = Buffer.from("BUKAN-ISI-YANG-TERCATAT");
    const kunciBaru = "photos/uji-arsip-dingin/2026-08-02/bbb.asli.jpg";
    gudangR2.set(kunciBaru, isiSalah);
    await db.photo.create({
      data: {
        r2Key: "photos/uji-arsip-dingin/2026-08-02/bbb.webp",
        originalKey: kunciBaru,
        originalBytes: ISI.length,
        sha256: SHA,
        bytes: 1234,
      },
    });

    await setTenggangHari(0);
    const h = await jalankanArsipAsli();

    expect(h.gagal).toBeGreaterThan(0);
    expect(h.dibuangDariR2, "membuang salinan R2 di putaran yang gagal").toBe(0);
    expect(dihapusDariR2).toEqual([]);
    const baris = await db.photo.findUniqueOrThrow({
      where: { id: lama.id },
      select: { originalR2PurgedAt: true },
    });
    expect(baris.originalR2PurgedAt).toBeNull();
  });

  it("yang berhenti dicoba DICOBA LAGI sesudah masa pulih lewat", async () => {
    // Gangguan jaringan yang berlangsung beberapa jam tidak boleh membuat
    // berkasnya berhenti dicoba SELAMANYA sampai ada orang yang menengok.
    const foto = await fotoMenunggu({ isi: Buffer.from("ISI-SALAH") });
    for (let i = 0; i < 6; i++) await jalankanArsipAsli();
    let baris = await db.photo.findUniqueOrThrow({
      where: { id: foto.id },
      select: { originalArchiveTries: true },
    });
    expect(baris.originalArchiveTries, "tidak pernah berhenti mencoba").toBe(5);

    // Isinya dibetulkan (mis. gangguannya berlalu), lalu waktunya dimundurkan.
    gudangR2.set(KUNCI, ISI);
    await db.photo.update({
      where: { id: foto.id },
      data: { originalArchiveTriedAt: new Date(Date.now() - 24 * 3600_000) },
    });

    const h = await jalankanArsipAsli();
    expect(h.dikirim, "tidak pernah dicoba lagi walau masa pulih lewat").toBe(1);
    baris = await db.photo.findUniqueOrThrow({
      where: { id: foto.id },
      select: { originalArchiveTries: true },
    });
    expect(baris.originalArchiveTries).toBe(0);
  });

  it("sakelar mati: tidak ada yang disentuh sama sekali", async () => {
    await fotoMenunggu();
    await setArsipAktif(false);
    const h = await jalankanArsipAsli();
    expect(h.dijalankan).toBe(false);
    expect(h.alasan).toBe("mati");
    expect(jejak).toEqual([]);
    expect(dihapusDariR2).toEqual([]);
  });
});
