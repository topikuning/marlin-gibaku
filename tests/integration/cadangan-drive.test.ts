/*
 * CADANGAN KE GOOGLE DRIVE (DECISIONS 650), DIJALANKAN SUNGGUHAN.
 *
 * Permintaan user 2026-10-05: cadangan database dan foto rutin ke akun Google
 * One 2TB, *"agar tidak cuma di backup di server lokal lenovo"*.
 *
 * pg_dump-nya SUNGGUHAN, terhadap database uji. Google Drive ditiru di tingkat
 * modul `lib/cadangan/drive` – yang diuji adalah apa yang MARLIN kirim dan
 * catat, bukan Google.
 *
 * Yang dijaga:
 *   1. cadangan database bisa DIBUKA KEMBALI dengan kuncinya dan isinya pg_dump utuh
 *   2. pg_dump yang gagal di tengah jalan tidak meninggalkan "cadangan" di Drive
 *   3. retensi membuang yang lama, tidak menyentuh yang baru dan berkas asing
 *   4. berkas yang tinggal satu salinan (hanya di Lenovo) dicadangkan lebih dulu
 *   5. md5 dari Google tidak cocok = tidak dicatat sebagai tercadangkan
 *   6. yang sudah tercadangkan tidak diunggah lagi
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const KUNCI = randomBytes(32);
process.env.BACKUP_ENCRYPTION_KEY = KUNCI.toString("base64");
const PG_DUMP = ["/usr/lib/postgresql/16/bin/pg_dump", "/usr/lib/postgresql/17/bin/pg_dump", "/usr/bin/pg_dump"].find(
  (p) => existsSync(p),
);
process.env.PG_DUMP_PATH = PG_DUMP ?? "pg_dump";

/* ── Google Drive tiruan ─────────────────────────────────────────────────── */
type BerkasDrive = { id: string; induk: string; nama: string; isi: Buffer; md5: string };
const drive = new Map<string, BerkasDrive>();
const urutanUnggah: string[] = [];
const dihapus: string[] = [];
let md5PalsuUntuk: string | null = null;
let nomor = 0;

vi.mock("@/lib/cadangan/drive", () => ({
  UKURAN_POTONGAN: 8 * 1024 * 1024,
  NAMA_FOLDER_AKAR: "MARLIN Cadangan",
  batasLaju: () => false,
  folderAkar: async () => "akar",
  alamatFolder: async (id: string) => `https://drive.tiruan/${id}`,
  pastikanFolder: async (induk: string, nama: string) => `${induk}/${nama}`,
  unggahResumable: async (
    meta: { induk: string; nama: string },
    sumber: AsyncIterable<Buffer | Uint8Array> | Buffer,
  ) => {
    const bagian: Buffer[] = [];
    if (Buffer.isBuffer(sumber)) bagian.push(sumber);
    else for await (const c of sumber) bagian.push(Buffer.from(c));
    const isi = Buffer.concat(bagian);
    const id = `f${++nomor}`;
    const md5 = createHash("md5").update(isi).digest("hex");
    drive.set(id, { id, induk: meta.induk, nama: meta.nama, isi, md5 });
    urutanUnggah.push(meta.nama);
    return { id, bytes: isi.length, md5: md5PalsuUntuk && meta.nama.includes(md5PalsuUntuk) ? "0".repeat(32) : md5 };
  },
  cariDiFolder: async (induk: string, nama: string) =>
    [...drive.values()].filter((b) => b.induk === induk && b.nama === nama).map((b) => ({ id: b.id, md5: b.md5 })),
  daftarDiFolder: async (induk: string) =>
    [...drive.values()].filter((b) => b.induk === induk).map((b) => ({ id: b.id, name: b.nama, size: b.isi.length })),
  hapusDiDrive: async (id: string) => {
    dihapus.push(id);
    drive.delete(id);
  },
  ruangDrive: async () => ({ terpakai: 0, batas: 2 * 1024 ** 4 }),
}));

/* ── Isi berkas tiruan: semua kunci menjawab, supaya sisa data uji lain tidak mengacaukan ── */
const isiUntuk = (kunci: string) => Buffer.from(`ISI:${kunci}`);
vi.mock("@/lib/penyimpanan/berkas", async (asli) => ({
  ...(await asli<typeof import("@/lib/penyimpanan/berkas")>()),
  ambilBerkas: async (kunci: string) => isiUntuk(kunci),
}));
vi.mock("@/lib/arsip-asli/antrean", async (asli) => ({
  ...(await asli<typeof import("@/lib/arsip-asli/antrean")>()),
  bacaBerkasAsli: async (f: { originalKey: string | null }) => isiUntuk(f.originalKey ?? ""),
}));

const { db } = await import("@/lib/db");
const { cadangkanDatabase, keadaanDb } = await import("@/lib/cadangan/database");
const { cadangkanBerkas, ringkasBerkas } = await import("@/lib/cadangan/berkas");
const { bukaSandi } = await import("@/lib/cadangan/sandi");
const { namaBerkasDb } = await import("@/lib/cadangan/aturan");

const AWALAN = "uji-cadangan-drive";

async function bersihkan() {
  await db.photo.deleteMany({ where: { r2Key: { contains: AWALAN } } });
  await db.berkasPindah.deleteMany({ where: { kunci: { contains: AWALAN } } });
  await db.cadanganBerkas.deleteMany({});
  await db.appSetting.deleteMany({ where: { key: { startsWith: "cadangan." } } });
}

beforeAll(bersihkan);
afterAll(async () => {
  await bersihkan();
  await db.$disconnect();
});
beforeEach(() => {
  drive.clear();
  urutanUnggah.length = 0;
  dihapus.length = 0;
  md5PalsuUntuk = null;
});

describe("cadangan database", () => {
  it("pg_dump tersedia di mesin uji – tanpa itu bagian ini tidak menguji apa pun", () => {
    expect(PG_DUMP).toBeTruthy();
  });

  it("berkas di Drive tersandi, bisa dibuka dengan kuncinya, dan isinya pg_dump format custom", async () => {
    const c = await cadangkanDatabase(new Date("2026-10-05T02:00:00Z"));
    expect(c.nama).toBe("marlin-db-2026-10-05-0200.dump.enc");
    const b = [...drive.values()].find((x) => x.nama === c.nama)!;
    expect(b.induk).toBe("akar/database");
    expect(b.isi.includes(Buffer.from("PGDMP"))).toBe(false); // tidak terbaca tanpa kunci
    const isi = bukaSandi(b.isi, KUNCI);
    expect(isi.subarray(0, 5).toString()).toBe("PGDMP");
    expect((await keadaanDb()).terakhir?.nama).toBe(c.nama);
  }, 120_000);

  it("pg_dump gagal = berkas setengah jadi dibuang dari Drive, dan TIDAK dicatat berhasil", async () => {
    const sebelum = (await keadaanDb()).terakhir;
    process.env.PG_DUMP_PATH = "/bin/false";
    try {
      await expect(cadangkanDatabase(new Date("2026-10-06T02:00:00Z"))).rejects.toThrow(/pg_dump/);
    } finally {
      process.env.PG_DUMP_PATH = PG_DUMP ?? "pg_dump";
    }
    expect(drive.size).toBe(0);
    expect(dihapus.length).toBe(1);
    expect((await keadaanDb()).terakhir).toEqual(sebelum);
  });

  it("retensi: cadangan lama dibuang, yang 30 hari terakhir dan berkas asing tidak disentuh", async () => {
    // Juli: yang PERTAMA disimpan sebagai cadangan bulanan, yang lain dibuang.
    const awalJuli = { id: "awal-juli", induk: "akar/database", nama: namaBerkasDb(new Date("2026-07-01T02:00:00Z")), isi: Buffer.alloc(1), md5: "" };
    const lama = { id: "lama", induk: "akar/database", nama: namaBerkasDb(new Date("2026-07-15T02:00:00Z")), isi: Buffer.alloc(1), md5: "" };
    drive.set(awalJuli.id, awalJuli);
    const asing = { id: "asing", induk: "akar/database", nama: "catatan.txt", isi: Buffer.alloc(1), md5: "" };
    drive.set(lama.id, lama);
    drive.set(asing.id, asing);
    await cadangkanDatabase(new Date("2026-10-05T03:00:00Z"));
    expect(dihapus).toEqual(["lama"]);
    expect(drive.has("awal-juli")).toBe(true);
    expect(drive.has("asing")).toBe(true);
  }, 120_000);
});

describe("cadangan berkas", () => {
  async function foto(nama: string, opsi: { satuSalinan?: boolean; hari: number }) {
    const r2Key = `photos/${AWALAN}/2026-08-01/${nama}.webp`;
    const originalKey = `photos/${AWALAN}/2026-08-01/${nama}.asli.jpg`;
    await db.photo.create({
      data: {
        r2Key,
        originalKey,
        sha256: createHash("sha256").update(nama).digest("hex"),
        bytes: 10,
        createdAt: new Date(Date.now() - opsi.hari * 86_400_000),
        ...(opsi.satuSalinan ? { originalArchivedAt: new Date(), originalR2PurgedAt: new Date() } : {}),
      },
    });
    return { r2Key, originalKey };
  }

  it("berkas yang tinggal SATU salinan didahulukan, walau lebih baru", async () => {
    const tua = await foto("tua", { hari: 40 });
    const satu = await foto("satu-salinan", { satuSalinan: true, hari: 1 });
    const h = await cadangkanBerkas(60_000);
    expect(h.berhenti).toBeNull();
    const iSatu = urutanUnggah.indexOf(satu.originalKey.replace(/\//g, "__"));
    const iTua = urutanUnggah.indexOf(tua.originalKey.replace(/\//g, "__"));
    expect(iSatu).toBeGreaterThanOrEqual(0);
    expect(iTua).toBeGreaterThan(iSatu);
  });

  it("asli dan ber-cap sama-sama tercatat, dengan md5 dan id Drive-nya", async () => {
    const rows = await db.cadanganBerkas.findMany({ where: { kunci: { contains: `${AWALAN}/2026-08-01/tua` } } });
    expect(rows.map((r) => r.kategori).sort()).toEqual(["foto", "foto-asli"]);
    for (const r of rows) {
      expect(r.dicadangkanAt).not.toBeNull();
      expect(r.driveFileId).toBeTruthy();
      expect(r.md5).toBe(createHash("md5").update(isiUntuk(r.kunci)).digest("hex"));
    }
  });

  it("yang sudah tercadangkan tidak diunggah lagi", async () => {
    await cadangkanBerkas(60_000);
    expect(urutanUnggah.filter((n) => n.includes(AWALAN))).toEqual([]);
  });

  it("md5 dari Google tidak cocok = dibuang dan dicatat gagal, bukan tercadangkan", async () => {
    const f = await foto("rusak", { hari: 2 });
    md5PalsuUntuk = "rusak.asli";
    await cadangkanBerkas(60_000);
    const row = await db.cadanganBerkas.findUnique({ where: { kunci: f.originalKey } });
    expect(row?.dicadangkanAt).toBeNull();
    expect(row?.percobaan).toBe(1);
    expect(row?.galat).toMatch(/tidak sama/);
    expect(dihapus.length).toBeGreaterThan(0);
  });

  it("ringkasan menyebut yang menunggu, termasuk yang tinggal satu salinan", async () => {
    const r = await ringkasBerkas();
    expect(r.menunggu).toBeGreaterThanOrEqual(1);
    expect(r.sudah).toBeGreaterThanOrEqual(3);
    expect(r.perKategori.find((k) => k.kategori === "foto-asli")?.berkas).toBeGreaterThanOrEqual(2);
  });
});
