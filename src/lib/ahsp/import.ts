import "server-only";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { db } from "@/lib/db";
import type { EntriAhsp } from "./parse";
import {
  AHSP_SOURCE_CODE,
  FOLDER_SIAP,
  NAMA_MANIFEST,
  NAMA_NDJSON,
  type ManifestAhsp,
} from "./berkas";

export { AHSP_SOURCE_CODE };

/**
 * Impor basis data AHSP dari `seed-data/` ke database (DECISIONS 317, 323, 325).
 *
 * IDEMPOTEN: kunci `AhspSource.code` + `(sourceId, externalId)`. Impor ulang
 * berkas yang sama tidak menggandakan apa pun; impor berkas BARU dengan code
 * yang sama mengganti isinya (entri lama dihapus lewat cascade), sehingga
 * pemutakhiran regulasi tidak meninggalkan campuran dua terbitan.
 *
 * ### Dialirkan, tidak dimuat sekaligus
 *
 * Berkas master 14,6 MB dan `JSON.parse` atasnya memuncakkan RSS **184 MB**
 * (diukur, bukan dugaan). Server produksi berjalan di **0,5 vCPU / 512 MB** dan
 * Next.js sendiri sudah memakai ratusan MB — impor lewat jalur itu menabrak
 * batas memori dan prosesnya dibunuh di tengah, yang sampai ke layar user
 * sebagai *"An unexpected response was received from the server"*.
 *
 * Karena itu impor membaca `seed-data/ahsp/entri.ndjson` BARIS DEMI BARIS
 * (dibangkitkan `pnpm ahsp:siapkan`): yang ditahan di memori cuma satu potongan.
 * sha256 yang dicatat tetap sha berkas MASTER — versinya harus bisa dibuktikan
 * ke dokumen aslinya, bukan ke hasil olahan.
 *
 * ### Belum selesai ≠ mutakhir
 *
 * sha256 dipasang PALING AKHIR. Lihat catatan pada `BELUM_SELESAI`.
 */

/**
 * Besar potongan penulisan. Kecil BUKAN karena kehati-hatian, tapi karena
 * diukur: puncak RSS impor penuh pada mesin uji, dengan berkas terbitan 5.0 —
 *
 *   potongan 2000 → 518 MB      potongan 250 → 344 MB
 *   potongan 1000 → 444 MB      potongan 100 → 307 MB   (waktu ~sama: 7,0 → 7,5 s)
 *
 * Yang memakan memori bukan tumpukan JS melainkan buffer native driver: satu
 * `createMany` 2.000 baris berisi dua kolom `text[]` menjadi satu perintah SQL
 * raksasa. Server produksi 0,5 vCPU / 512 MB dan Next.js sudah memakan ratusan
 * MB duluan, jadi 100 dipilih: tambahan waktunya setengah detik, marginnya
 * ratusan megabyte. DECISIONS 325.
 */
const POTONGAN = 100;

/**
 * Penanda "impor BELUM selesai" pada kolom sha256.
 *
 * Sumber ditulis dengan penanda ini lebih dulu; sha256 yang sebenarnya baru
 * dipasang SETELAH seluruh entri + komponen tertulis dan jumlahnya diperiksa.
 *
 * Kenapa begitu penting: dulu sha dipasang di awal, jadi impor yang terputus di
 * tengah (memori habis, koneksi putus, proses di-restart) meninggalkan sumber
 * yang MENGAKU sha berkas itu padahal isinya cuma separuh. Klik berikutnya
 * membaca sha-nya sama, menjawab "sudah mutakhir", dan basis yang bolong itu
 * menetap selamanya sambil terlihat benar. Persis yang dilaporkan user:
 * "selalu error, lalu kalau diklik lagi ada pernyataan berhasil".
 *
 * Dengan penanda ini, impor yang terputus TIDAK PERNAH cocok dengan sha berkas
 * mana pun, sehingga percobaan berikutnya mengulang dari awal. DECISIONS 325.
 */
const BELUM_SELESAI = "impor-belum-selesai";

/** Folder seed-data: repo root (dev) atau /app (container standalone). */
function folderSeed(): string {
  const kandidat = [
    join(process.cwd(), "seed-data"),
    join(process.cwd(), "..", "..", "seed-data"),
  ];
  for (const c of kandidat) if (existsSync(c)) return c;
  throw new Error(`Folder seed-data tidak ditemukan (dicari: ${kandidat.join(", ")})`);
}

export type HasilImporAhsp = ManifestAhsp["ringkas"] & {
  sourceCode: string;
  fileSha256: string;
  /** true = isi identik dengan yang sudah tersimpan, tidak ada yang ditulis. */
  takBerubah: boolean;
  /** Padanan manusia yang berhasil disambungkan ke terbitan baru. */
  padananTersambung: number;
  /** Padanan manusia yang analisanya TIDAK ADA lagi di terbitan baru. */
  padananPutus: number;
};

async function bacaManifest(): Promise<ManifestAhsp> {
  const path = join(folderSeed(), FOLDER_SIAP, NAMA_MANIFEST);
  if (!existsSync(path)) {
    throw new Error(
      `Basis AHSP siap-alir belum dibangkitkan (${path} tidak ada). Jalankan \`pnpm ahsp:siapkan\` lalu commit hasilnya.`,
    );
  }
  return JSON.parse(await readFile(path, "utf8")) as ManifestAhsp;
}

export async function imporAhspDariSeed(userId: string | null): Promise<HasilImporAhsp> {
  const manifest = await bacaManifest();
  const fileSha256 = manifest.fileSha256;

  const lama = await db.ahspSource.findUnique({
    where: { code: AHSP_SOURCE_CODE },
    select: { id: true, fileSha256: true },
  });
  if (lama?.fileSha256 === fileSha256) {
    // Berkas yang sama persis DAN impornya tuntas: tidak ada gunanya menulis
    // ulang 30 ribu baris. Sumber bertanda BELUM_SELESAI tidak akan pernah
    // sampai ke sini, jadi impor yang terputus selalu diulang.
    return {
      ...manifest.ringkas,
      sourceCode: AHSP_SOURCE_CODE,
      fileSha256,
      takBerubah: true,
      padananTersambung: 0,
      padananPutus: 0,
    };
  }

  /*
   * SEBELUM sumber lama dihapus: catat padanan manusia beserta IDENTITAS ALAMI
   * analisa yang ditunjuknya (externalId + kode + uraian).
   *
   * Tanpa ini, mengganti terbitan AHSP menghancurkan seluruh pemetaan secara
   * senyap: `ahsp_padanan.entry_id` ber-ON DELETE SET NULL, jadi begitu
   * analisanya ikut terhapus, 1.086 padanan yang sudah disetujui berubah jadi
   * baris tanpa tautan — dan dulu terbaca sebagai "manusia menyatakan tidak ada
   * padanan". Keputusan yang tidak pernah diambil siapa pun. DECISIONS 323.
   */
  const sebelum = lama
    ? await db.ahspPadanan.findMany({
        where: { entryId: { not: null } },
        select: {
          tanda: true,
          entry: { select: { externalId: true, kode: true, uraian: true } },
        },
      })
    : [];

  // Ganti utuh, bukan tambal: dua terbitan yang tercampur menghasilkan koefisien
  // yang tidak bisa dijelaskan asalnya.
  if (lama) await db.ahspSource.delete({ where: { id: lama.id } });

  const source = await db.ahspSource.create({
    data: {
      code: AHSP_SOURCE_CODE,
      name: manifest.sumber.name,
      subject: manifest.sumber.subject,
      schemaVersion: manifest.sumber.schemaVersion,
      generatedAt: new Date(manifest.sumber.generatedAt),
      documents: manifest.sumber.documents as never,
      matchingEngine: manifest.sumber.matchingEngine as never,
      // sha256 SENGAJA belum dipasang — lihat catatan pada BELUM_SELESAI.
      fileSha256: BELUM_SELESAI,
      importedById: userId,
    },
    select: { id: true },
  });

  const tertulis = await alirkanEntri(source.id);

  /*
   * PERIKSA sebelum mengaku selesai. Tulisan yang terpotong harus berisik, bukan
   * diam: tanpa pemeriksaan ini, basis yang kurang sepuluh ribu komponen tetap
   * dilaporkan "berhasil" dan baru ketahuan saat angka kebutuhan bahan salah.
   */
  const [entriTertulis, komponenTertulis] = await Promise.all([
    db.ahspEntry.count({ where: { sourceId: source.id } }),
    db.ahspComponent.count({ where: { entry: { sourceId: source.id } } }),
  ]);
  if (
    entriTertulis !== manifest.jumlah.entri ||
    komponenTertulis !== manifest.jumlah.komponen ||
    tertulis.entri !== manifest.jumlah.entri
  ) {
    throw new Error(
      `Impor AHSP tidak lengkap: ${entriTertulis}/${manifest.jumlah.entri} analisa, ` +
        `${komponenTertulis}/${manifest.jumlah.komponen} komponen. ` +
        `Basis dibiarkan bertanda belum selesai — ulangi impornya.`,
    );
  }

  const sambung = await sambungUlangPadanan(source.id, sebelum);

  // Barulah sumber diakui selesai. Sejak baris ini, klik berikutnya boleh
  // menjawab "sudah mutakhir".
  await db.ahspSource.update({ where: { id: source.id }, data: { fileSha256 } });

  return {
    ...manifest.ringkas,
    sourceCode: AHSP_SOURCE_CODE,
    fileSha256,
    takBerubah: false,
    ...sambung,
  };
}

/**
 * Baca `entri.ndjson` baris demi baris dan tulis per potongan.
 *
 * Yang ditahan di memori cuma satu potongan (2.000 analisa) beserta komponennya
 * — bukan seluruh basis. Ini bagian yang membuat impor muat di 512 MB.
 */
async function alirkanEntri(sourceId: string): Promise<{ entri: number }> {
  const path = join(folderSeed(), FOLDER_SIAP, NAMA_NDJSON);
  if (!existsSync(path)) {
    throw new Error(
      `Basis AHSP siap-alir belum dibangkitkan (${path} tidak ada). Jalankan \`pnpm ahsp:siapkan\`.`,
    );
  }

  const baca = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let potongan: EntriAhsp[] = [];
  let total = 0;
  for await (const baris of baca) {
    const t = baris.trim();
    if (!t) continue;
    potongan.push(JSON.parse(t) as EntriAhsp);
    if (potongan.length >= POTONGAN) {
      await tulisPotongan(sourceId, potongan);
      total += potongan.length;
      potongan = [];
    }
  }
  if (potongan.length > 0) {
    await tulisPotongan(sourceId, potongan);
    total += potongan.length;
  }
  return { entri: total };
}

async function tulisPotongan(sourceId: string, entries: EntriAhsp[]): Promise<void> {
  await db.ahspEntry.createMany({
    data: entries.map((e) => ({
      sourceId,
      externalId: e.externalId,
      kode: e.kode,
      uraian: e.uraian,
      satuan: e.satuan,
      bidang: e.bidang,
      ahspType: e.ahspType,
      workGroup: e.workGroup,
      divisi: e.divisi,
      notes: e.notes,
      perluVerifikasi: e.perluVerifikasi,
      lampiran: e.lampiran,
      tocPdfPage: e.tocPdfPage,
      analysisPdfPage: e.analysisPdfPage,
      excerptId: e.excerptId,
      legacyId: e.legacyId,
      aliases: e.aliases,
      keywords: e.keywords,
    })),
  });

  // Ambil id potongan INI saja — bukan seluruh sumber. Query yang menarik 5.560
  // baris tiap potongan akan tumbuh kuadratik dan sia-sia.
  const idMap = new Map(
    (
      await db.ahspEntry.findMany({
        where: { sourceId, externalId: { in: entries.map((e) => e.externalId) } },
        select: { id: true, externalId: true },
      })
    ).map((e) => [e.externalId, e.id]),
  );

  const komponen = entries.flatMap((e) => {
    const entryId = idMap.get(e.externalId);
    if (!entryId) return [];
    return e.components.map((c) => ({
      entryId,
      kategori: c.kategori,
      nama: c.nama,
      satuan: c.satuan,
      koefisien: c.koefisien,
      urutan: c.urutan,
    }));
  });
  for (let i = 0; i < komponen.length; i += POTONGAN) {
    await db.ahspComponent.createMany({ data: komponen.slice(i, i + POTONGAN) });
  }
}

/**
 * Sambungkan ulang padanan manusia ke analisa pada terbitan BARU (DECISIONS 323).
 *
 * Tiga jalur, dicoba berurutan dari yang paling pasti:
 *
 *  1. `externalId` sama — terbitan yang idnya tidak berubah.
 *  2. `legacyId` analisa baru menunjuk `externalId` lama. Ini afordansi berkasnya
 *     sendiri: setiap record membawa `legacy.id` = id terbitan sebelumnya.
 *     Memakainya berarti perpindahan terbitan mengikuti pemetaan resmi penyusun
 *     berkas, bukan tebakan MARLIN.
 *  3. `kode` + `uraian` persis sama.
 *
 * Yang tidak tersambung DIBIARKAN `entryId` kosong dengan `tidakAda` tetap
 * false — artinya "tautannya putus, perlu dipetakan ulang", dan barisnya muncul
 * lagi sebagai pekerjaan. Yang dilarang keras adalah menyulapnya jadi keputusan
 * "memang tidak ada".
 */
async function sambungUlangPadanan(
  sourceId: string,
  sebelum: { tanda: string; entry: { externalId: string; kode: string; uraian: string } | null }[],
): Promise<{ padananTersambung: number; padananPutus: number }> {
  const perlu = sebelum.filter((p) => p.entry !== null);
  if (perlu.length === 0) return { padananTersambung: 0, padananPutus: 0 };

  const baru = await db.ahspEntry.findMany({
    where: { sourceId },
    select: { id: true, externalId: true, legacyId: true, kode: true, uraian: true },
  });
  const perExternal = new Map(baru.map((e) => [e.externalId, e.id]));
  const perLegacy = new Map<string, string>();
  for (const e of baru) if (e.legacyId && !perLegacy.has(e.legacyId)) perLegacy.set(e.legacyId, e.id);
  const perKodeUraian = new Map<string, string>();
  for (const e of baru) {
    const k = `${e.kode} ${e.uraian}`;
    if (!perKodeUraian.has(k)) perKodeUraian.set(k, e.id);
  }

  const tanda: string[] = [];
  const entryId: string[] = [];
  for (const p of perlu) {
    const e = p.entry!;
    const id =
      perExternal.get(e.externalId) ??
      perLegacy.get(e.externalId) ??
      perKodeUraian.get(`${e.kode} ${e.uraian}`);
    if (!id) continue;
    tanda.push(p.tanda);
    entryId.push(id);
  }

  /*
   * SATU perintah, bukan satu per baris. Versi sebelumnya mengirim satu UPDATE
   * per padanan; di server yang databasenya seberang jaringan, seribu padanan =
   * seribu perjalanan bolak-balik, dan itu ikut membuat impor melewati batas
   * waktu permintaan.
   */
  if (tanda.length > 0) {
    await db.$executeRaw`
      UPDATE ahsp_padanan AS p
      SET entry_id = v.entry_id::uuid
      FROM (
        SELECT unnest(${tanda}::text[]) AS tanda, unnest(${entryId}::text[]) AS entry_id
      ) AS v
      WHERE p.tanda = v.tanda
    `;
  }
  return { padananTersambung: tanda.length, padananPutus: perlu.length - tanda.length };
}

export type RingkasAhsp = {
  ada: boolean;
  name: string;
  code: string;
  schemaVersion: string;
  generatedAt: Date;
  importedAt: Date;
  fileSha256: string;
  entri: number;
  perluVerifikasi: number;
  komponen: number;
  /** Analisa yang membawa lapisan pencocokan dari berkasnya (DECISIONS 321). */
  punyaAlias: number;
  /** true = impor sebelumnya TERPUTUS; basis ini belum boleh dipercaya. */
  belumSelesai: boolean;
};

/** Keadaan basis AHSP untuk layar Sistem. Null-safe: belum diimpor = `ada:false`. */
export async function ringkasAhsp(): Promise<RingkasAhsp | null> {
  const s = await db.ahspSource.findUnique({ where: { code: AHSP_SOURCE_CODE } });
  if (!s) return null;
  const [entri, perluVerifikasi, komponen, punyaAlias] = await Promise.all([
    db.ahspEntry.count({ where: { sourceId: s.id } }),
    db.ahspEntry.count({ where: { sourceId: s.id, perluVerifikasi: true } }),
    db.ahspComponent.count({ where: { entry: { sourceId: s.id } } }),
    db.ahspEntry.count({ where: { sourceId: s.id, NOT: { aliases: { isEmpty: true } } } }),
  ]);
  return {
    ada: true,
    name: s.name,
    code: s.code,
    schemaVersion: s.schemaVersion,
    generatedAt: s.generatedAt,
    importedAt: s.importedAt,
    fileSha256: s.fileSha256,
    entri,
    perluVerifikasi,
    komponen,
    punyaAlias,
    belumSelesai: s.fileSha256 === BELUM_SELESAI,
  };
}
