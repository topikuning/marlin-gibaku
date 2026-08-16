import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";
import { bacaMasterAhsp, type EntriAhsp, type MasterAhsp } from "./parse";

/**
 * Impor basis data AHSP dari `seed-data/` ke database (DECISIONS 317).
 *
 * IDEMPOTEN: kunci `AhspSource.code` + `(sourceId, externalId)`. Impor ulang
 * berkas yang sama tidak menggandakan apa pun; impor berkas BARU dengan code
 * yang sama mengganti isinya (entri lama dihapus lewat cascade), sehingga
 * pemutakhiran regulasi tidak meninggalkan campuran dua terbitan.
 *
 * Berkasnya ikut di repo (`seed-data/`, pola yang sama dengan data demo) dengan
 * sha256-nya dicatat: sumber yang dipakai menghitung uang harus bisa dibuktikan
 * versinya, bukan "entah berkas yang mana".
 */

export const AHSP_SOURCE_CODE = "SE_DJBK_47_2026";
const NAMA_BERKAS = "ahsp-se-djbk-47-2026.json";

/** Folder seed-data: repo root (dev) atau /app (container standalone). */
function folderSeed(): string {
  const kandidat = [
    join(process.cwd(), "seed-data"),
    join(process.cwd(), "..", "..", "seed-data"),
  ];
  for (const c of kandidat) if (existsSync(c)) return c;
  throw new Error(`Folder seed-data tidak ditemukan (dicari: ${kandidat.join(", ")})`);
}

export type HasilImporAhsp = MasterAhsp["ringkas"] & {
  sourceCode: string;
  fileSha256: string;
  /** true = isi identik dengan yang sudah tersimpan, tidak ada yang ditulis. */
  takBerubah: boolean;
  /** Padanan manusia yang berhasil disambungkan ke terbitan baru. */
  padananTersambung: number;
  /** Padanan manusia yang analisanya TIDAK ADA lagi di terbitan baru. */
  padananPutus: number;
};

/** Sisipkan komponen per potongan — 26 ribu baris tidak muat satu perintah. */
const POTONGAN = 2000;

export async function imporAhspDariSeed(userId: string | null): Promise<HasilImporAhsp> {
  const path = join(folderSeed(), NAMA_BERKAS);
  const isi = await readFile(path);
  const fileSha256 = createHash("sha256").update(isi).digest("hex");

  const master = bacaMasterAhsp(JSON.parse(isi.toString("utf8")), AHSP_SOURCE_CODE);

  const lama = await db.ahspSource.findUnique({
    where: { code: AHSP_SOURCE_CODE },
    select: { id: true, fileSha256: true },
  });
  if (lama?.fileSha256 === fileSha256) {
    // Berkas yang sama persis: tidak ada gunanya menulis ulang 26 ribu baris.
    return {
      ...master.ringkas,
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
      name: master.sumber.name,
      subject: master.sumber.subject,
      schemaVersion: master.sumber.schemaVersion,
      generatedAt: master.sumber.generatedAt,
      documents: master.sumber.documents as never,
      matchingEngine: master.sumber.matchingEngine as never,
      fileSha256,
      importedById: userId,
    },
    select: { id: true },
  });

  await tulisEntri(source.id, master.entries);
  const sambung = await sambungUlangPadanan(source.id, sebelum);

  return {
    ...master.ringkas,
    sourceCode: AHSP_SOURCE_CODE,
    fileSha256,
    takBerubah: false,
    ...sambung,
  };
}

async function tulisEntri(sourceId: string, entries: EntriAhsp[]): Promise<void> {
  for (let i = 0; i < entries.length; i += POTONGAN) {
    const potong = entries.slice(i, i + POTONGAN);
    await db.ahspEntry.createMany({
      data: potong.map((e) => ({
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
  }

  // Ambil id yang baru dibuat sekali saja, lalu tulis komponennya per potongan.
  const idMap = new Map(
    (
      await db.ahspEntry.findMany({ where: { sourceId }, select: { id: true, externalId: true } })
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
  };
}

/**
 * Sambungkan ulang padanan manusia ke analisa pada terbitan BARU (DECISIONS 323).
 *
 * Tiga jalur, dicoba berurutan dari yang paling pasti:
 *
 *  1. `externalId` sama — terbitan yang idnya tidak berubah.
 *  2. `legacyId` analisa baru menunjuk `externalId` lama. Ini afordansi berkasnya
 *     sendiri: setiap record v2 membawa `legacy.id` = id v1-nya. Memakainya
 *     berarti perpindahan terbitan mengikuti pemetaan resmi penyusun berkas,
 *     bukan tebakan MARLIN.
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

  let tersambung = 0;
  for (const p of perlu) {
    const e = p.entry!;
    const id =
      perExternal.get(e.externalId) ??
      perLegacy.get(e.externalId) ??
      perKodeUraian.get(`${e.kode} ${e.uraian}`);
    if (!id) continue;
    await db.ahspPadanan.update({ where: { tanda: p.tanda }, data: { entryId: id } });
    tersambung += 1;
  }
  return { padananTersambung: tersambung, padananPutus: perlu.length - tersambung };
}
