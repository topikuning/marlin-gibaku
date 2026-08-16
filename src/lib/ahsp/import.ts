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
    return { ...master.ringkas, sourceCode: AHSP_SOURCE_CODE, fileSha256, takBerubah: true };
  }

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
      fileSha256,
      importedById: userId,
    },
    select: { id: true },
  });

  await tulisEntri(source.id, master.entries);

  return { ...master.ringkas, sourceCode: AHSP_SOURCE_CODE, fileSha256, takBerubah: false };
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
};

/** Keadaan basis AHSP untuk layar Sistem. Null-safe: belum diimpor = `ada:false`. */
export async function ringkasAhsp(): Promise<RingkasAhsp | null> {
  const s = await db.ahspSource.findUnique({ where: { code: AHSP_SOURCE_CODE } });
  if (!s) return null;
  const [entri, perluVerifikasi, komponen] = await Promise.all([
    db.ahspEntry.count({ where: { sourceId: s.id } }),
    db.ahspEntry.count({ where: { sourceId: s.id, perluVerifikasi: true } }),
    db.ahspComponent.count({ where: { entry: { sourceId: s.id } } }),
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
  };
}
