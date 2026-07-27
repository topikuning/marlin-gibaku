import "server-only";
import { db } from "@/lib/db";
import { KKP_FOLDERS, folderForDocumentType, type KkpFolder } from "./folders";

/**
 * Kelengkapan Drive per paket: untuk tiap folder standar KKP, berapa yang
 * SEHARUSNYA ada di MARLIN vs berapa yang sudah terupload. Menjawab pertanyaan
 * operasional "mana yang belum disetor ke KKP". DECISIONS 143.
 */

export type FolderCoverage = {
  folder: KkpFolder;
  /** Sumber datanya di MARLIN (kalimat pendek). */
  source: string;
  /** Jumlah berkas yang layak diupload menurut data MARLIN (null = tak terhitung). */
  expected: number | null;
  /** Jumlah upload sukses tercatat. */
  uploaded: number;
  /** Upload gagal yang belum berhasil diulang. */
  failed: number;
  lastAt: Date | null;
};

/** Folder tujuan untuk tiap kind log upload (selain dokumen yang per-tipe). */
const KIND_FOLDER: Record<string, KkpFolder> = {
  laporan_harian: "3. LAPORAN HARIAN",
  laporan_mingguan: "4. LAPORAN MINGGUAN",
  laporan_bulanan: "5. LAPORAN BULANAN",
  kegiatan: "6. DOKUMENTASI",
};

export async function getDriveCoverage(packageId: string): Promise<FolderCoverage[]> {
  const [logs, docs, locations, dailyFinal, activities] = await Promise.all([
    db.gDriveUpload.findMany({
      where: { packageId },
      select: { kind: true, refKey: true, status: true, createdAt: true, fileName: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    db.document.findMany({
      where: { OR: [{ packageId }, { location: { packageId } }] },
      select: { id: true, type: true },
    }),
    db.location.findMany({ where: { packageId }, select: { id: true } }),
    db.dailyReport.count({ where: { location: { packageId }, status: "final" } }),
    db.fieldActivity.count({ where: { location: { packageId }, status: "final" } }),
  ]);

  const docFolderById = new Map(docs.map((d) => [d.id, folderForDocumentType(d.type)]));
  const expectedDocs = new Map<KkpFolder, number>();
  for (const f of docFolderById.values()) {
    if (f) expectedDocs.set(f, (expectedDocs.get(f) ?? 0) + 1);
  }

  // Agregasi log per folder. Dokumen dipetakan lewat refKey (= documentId).
  const agg = new Map<KkpFolder, { ok: Set<string>; failed: number; last: Date | null }>();
  for (const f of KKP_FOLDERS) agg.set(f, { ok: new Set(), failed: 0, last: null });

  for (const l of logs) {
    const folder = l.kind === "dokumen" ? (docFolderById.get(l.refKey) ?? null) : (KIND_FOLDER[l.kind] ?? null);
    if (!folder) continue;
    const a = agg.get(folder)!;
    if (l.status === "sukses") {
      a.ok.add(`${l.refKey}::${l.fileName}`);
      if (!a.last || l.createdAt > a.last) a.last = l.createdAt;
    } else {
      a.failed++;
    }
  }

  const locCount = locations.length;
  const rows: FolderCoverage[] = KKP_FOLDERS.map((folder) => {
    const a = agg.get(folder)!;
    let expected: number | null = null;
    let source: string;
    switch (folder) {
      case "3. LAPORAN HARIAN":
        expected = dailyFinal;
        source = "Laporan harian final (PDF + foto)";
        break;
      case "4. LAPORAN MINGGUAN":
        expected = null;
        source = `Laporan mingguan KKP per lokasi (${locCount} lokasi) — PDF + Excel`;
        break;
      case "5. LAPORAN BULANAN":
        expected = null;
        source = `Laporan bulanan KKP per lokasi (${locCount} lokasi) — PDF + Excel`;
        break;
      case "6. DOKUMENTASI":
        expected = activities;
        source = "Kegiatan lapangan final (PDF + foto)";
        break;
      default:
        expected = expectedDocs.get(folder) ?? 0;
        source = "Dokumen administrasi (Dokumen → jenis terkait)";
    }
    return { folder, source, expected, uploaded: a.ok.size, failed: a.failed, lastAt: a.last };
  });

  return rows;
}
