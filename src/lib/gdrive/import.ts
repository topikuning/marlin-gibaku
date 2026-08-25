import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { accessibleLocationIds, requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { DocumentError, uploadDocument } from "@/lib/documents";
import {
  ALL_DOC_TYPES,
  ALLOWED_UPLOAD_MIMES,
  MAX_UPLOAD_BYTES,
  resolveUploadMime,
} from "@/lib/documents-meta";
import {
  driveFileMeta,
  downloadDriveFile,
  GDriveError,
  GOOGLE_NATIVE_EXPORT,
  walkDriveFolder,
} from "./client";
import {
  alasanDilewati,
  classifyDriveFile,
  extractDocDate,
  matchLocation,
  phaseForType,
  type Keyakinan,
} from "./classify";
import type { AdminPhase, DocumentType } from "@/generated/prisma/enums";

/**
 * IMPOR dokumen dari folder Google Drive KKP ke Document Center. DECISIONS 184.
 *
 * Kebijakan:
 * - Isi berkas DISALIN ke R2, bukan cuma ditautkan: arsip MARLIN tidak boleh
 *   ikut hilang kalau KKP memindah/menghapus/mencabut akses file di Drive.
 *   Tautan & jalur Drive tetap disimpan sebagai jejak asal.
 * - Dua langkah: PRATINJAU (baca folder, tebak jenis/lokasi, tandai yang sudah
 *   pernah diimpor) lalu IMPOR TERPILIH. Tidak ada impor otomatis diam-diam —
 *   klasifikasi ini tebakan, dan yang masuk arsip harus lewat mata manusia.
 * - Commit TIDAK memercayai data pratinjau dari browser: metadata tiap file
 *   dibaca ulang dari Drive, jenis divalidasi enum, lokasi wajib milik paket ini.
 * - Semua penjaga upload biasa tetap jalan karena impor memakai `uploadDocument`
 *   yang sama: capability, akses lokasi, dedup sha256, penautan milestone, audit.
 */

/** Jumlah maksimum file yang ditawarkan sekali baca folder. */
const MAX_PREVIEW_FILES = 500;
/** Jumlah maksimum file yang diimpor dalam satu penekanan tombol. */
export const MAX_IMPORT_PER_BATCH = 40;

function mimeDidukung(mime: string): boolean {
  return Boolean(ALLOWED_UPLOAD_MIMES[mime]) || Boolean(GOOGLE_NATIVE_EXPORT[mime]);
}

/** Nama file tanpa ekstensi — dipakai sebagai judul awal dokumen. */
function baseName(fileName: string): string {
  const cut = fileName.replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  return (cut || fileName).slice(0, 200);
}

export type DriveImportRow = {
  driveFileId: string;
  fileName: string;
  /** Jalur folder relatif akar paket, sudah digabung untuk tampilan. */
  path: string;
  mimeType: string;
  bytes: number | null;
  modifiedAt: string | null;
  type: DocumentType;
  phase: AdminPhase;
  keyakinan: Keyakinan;
  alasan: string;
  locationId: string | null;
  locationName: string | null;
  docDate: string | null;
  /** Terisi = tidak bisa/tak perlu diimpor (sudah ada, foto, mime tak didukung). */
  dilewati: string | null;
};

export type DriveImportPreview = {
  packageId: string;
  folderId: string;
  rows: DriveImportRow[];
  /** Batas kedalaman/jumlah tercapai — masih ada berkas yang belum ditampilkan. */
  terpotong: boolean;
  jumlah: {
    total: number;
    siap: number;
    sudahAda: number;
    dilewati: number;
    /** Berkas terbitan MARLIN sendiri yang TIDAK ditampilkan (DECISIONS 191). */
    terbitanSendiri: number;
  };
};

async function paketDenganAkses(packageId: string, orgId: string) {
  const pkg = await db.package.findUnique({
    where: { id: packageId },
    select: {
      id: true,
      orgId: true,
      name: true,
      driveFolderId: true,
      locations: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
  });
  if (!pkg || pkg.orgId !== orgId) throw new DocumentError("Paket tidak ditemukan");
  if (!pkg.driveFolderId) {
    throw new DocumentError(
      "Paket ini belum punya folder Google Drive – isi ID folder KKP di halaman paket dulu.",
    );
  }
  return pkg;
}

/**
 * Baca folder Drive paket dan susun usulan impor. Dipicu tombol, bukan saat
 * halaman dibuka: membaca folder KKP bisa memakan puluhan panggilan jaringan.
 */
export async function previewDriveImport(packageId: string): Promise<DriveImportPreview> {
  const user = await requireCapability("document.upload");
  const pkg = await paketDenganAkses(packageId, user.orgId);

  // Role ter-scope hanya boleh menarik berkas lokasi yang ia pegang.
  const scoped = await accessibleLocationIds(user);
  const lokasiBoleh =
    scoped === null ? pkg.locations : pkg.locations.filter((l) => scoped.includes(l.id));

  const { files, truncated } = await walkDriveFolder(pkg.driveFolderId!, {
    maxFiles: MAX_PREVIEW_FILES,
  });

  // Berkas TERBITAN MARLIN sendiri tidak ditawarkan lagi (DECISIONS 191).
  // Dua sumber, sengaja dua-duanya: penanda appProperties di Drive (tahan ganti
  // nama, tidak bergantung DB) DAN catatan GDriveUpload (menangkap berkas yang
  // sudah terlanjur naik sebelum penanda itu ada).
  const idTerbitanSendiri = new Set<string>();
  if (files.length > 0) {
    const unggahanSendiri = await db.gDriveUpload.findMany({
      where: {
        packageId: pkg.id,
        status: "sukses",
        fileId: { in: files.map((f) => f.id) },
      },
      select: { fileId: true },
    });
    for (const g of unggahanSendiri) if (g.fileId) idTerbitanSendiri.add(g.fileId);
  }
  for (const f of files) if (f.terbitanMarlin) idTerbitanSendiri.add(f.id);

  const kandidat = files.filter((f) => !idTerbitanSendiri.has(f.id));

  const sudahAda = new Map<string, string>();
  if (kandidat.length > 0) {
    const imported = await db.document.findMany({
      where: { orgId: user.orgId, driveFileId: { in: kandidat.map((f) => f.id) } },
      select: { driveFileId: true, title: true },
    });
    for (const d of imported) if (d.driveFileId) sudahAda.set(d.driveFileId, d.title);
  }

  const rows: DriveImportRow[] = kandidat.map((f) => {
    const klas = classifyDriveFile({ fileName: f.name, path: f.path });
    const lokasi = matchLocation({ fileName: f.name, path: f.path }, lokasiBoleh);
    const docDate = extractDocDate(f.name);

    let dilewati = alasanDilewati({
      fileName: f.name,
      mimeType: f.mimeType,
      path: f.path,
      didukung: mimeDidukung,
    });
    const judul = sudahAda.get(f.id);
    if (judul) dilewati = `sudah pernah diimpor sebagai "${judul}"`;
    else if (!dilewati && f.size !== null && f.size > MAX_UPLOAD_BYTES) {
      dilewati = `ukuran ${(f.size / 1024 / 1024).toFixed(1)} MB melebihi batas ${Math.round(
        MAX_UPLOAD_BYTES / 1024 / 1024,
      )} MB`;
    }

    return {
      driveFileId: f.id,
      fileName: f.name,
      path: f.path.join(" / "),
      mimeType: f.mimeType,
      bytes: f.size,
      modifiedAt: f.modifiedTime ? f.modifiedTime.toISOString() : null,
      type: klas.type,
      phase: klas.phase,
      keyakinan: klas.keyakinan,
      alasan: lokasi ? `${klas.alasan}; desa dari ${lokasi.dari}` : klas.alasan,
      locationId: lokasi?.locationId ?? null,
      locationName: lokasi?.locationName ?? null,
      docDate: docDate ? docDate.toISOString().slice(0, 10) : null,
      dilewati,
    };
  });

  await audit(user.id, "document.drive_preview", "package", pkg.id, {
    ditemukan: rows.length,
    terbitanSendiri: idTerbitanSendiri.size,
    terpotong: truncated,
  });

  return {
    packageId: pkg.id,
    folderId: pkg.driveFolderId!,
    rows,
    terpotong: truncated,
    jumlah: {
      total: rows.length,
      siap: rows.filter((r) => !r.dilewati).length,
      sudahAda: rows.filter((r) => r.dilewati?.startsWith("sudah pernah")).length,
      dilewati: rows.filter((r) => r.dilewati && !r.dilewati.startsWith("sudah pernah")).length,
      terbitanSendiri: idTerbitanSendiri.size,
    },
  };
}

export type DriveImportSelection = {
  driveFileId: string;
  type: DocumentType;
  locationId: string | null;
  /** Jalur folder untuk jejak asal (tampilan saja). */
  path: string;
};

export type DriveImportResult = {
  berhasil: { fileName: string; documentId: string }[];
  gagal: { fileName: string; sebab: string }[];
};

/** Jalur Drive dari klien = teks tampilan; dibersihkan sebelum disimpan. */
function bersihkanPath(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Impor berkas terpilih. Satu per satu (bukan paralel): Drive membatasi laju
 * panggilan, dan tiap berkas ditarik penuh ke memori sebelum disalin ke R2.
 * Kegagalan satu berkas TIDAK menggagalkan yang lain — hasilnya dilaporkan
 * per baris supaya jelas apa yang masuk dan apa yang tidak.
 */
export async function commitDriveImport(
  packageId: string,
  selections: DriveImportSelection[],
): Promise<DriveImportResult> {
  const user = await requireCapability("document.upload");
  const pkg = await paketDenganAkses(packageId, user.orgId);
  if (selections.length === 0) throw new DocumentError("Tidak ada berkas yang dipilih.");
  if (selections.length > MAX_IMPORT_PER_BATCH) {
    throw new DocumentError(
      `Maksimum ${MAX_IMPORT_PER_BATCH} berkas per impor – pilih sebagian dulu, sisanya menyusul.`,
    );
  }

  const scoped = await accessibleLocationIds(user);
  const lokasiPaket = new Map(pkg.locations.map((l) => [l.id, l.name]));

  const result: DriveImportResult = { berhasil: [], gagal: [] };
  for (const sel of selections) {
    let namaBerkas = sel.driveFileId;
    try {
      if (!ALL_DOC_TYPES.includes(sel.type)) throw new DocumentError("Jenis dokumen tidak dikenal");
      if (sel.locationId) {
        if (!lokasiPaket.has(sel.locationId)) {
          throw new DocumentError("Lokasi yang dipilih bukan lokasi paket ini");
        }
        if (scoped !== null && !scoped.includes(sel.locationId)) {
          throw new DocumentError("Tidak punya akses ke lokasi tersebut");
        }
      }

      // Metadata dibaca ULANG dari Drive — data pratinjau di browser bisa basi
      // atau dijahili; nama/mime/ukuran yang dipakai harus yang sebenarnya.
      const meta = await driveFileMeta(sel.driveFileId);
      namaBerkas = meta.name;
      // Penjaga sisi server: berkas terbitan MARLIN sendiri tidak boleh masuk
      // lagi walau lolos ke daftar pilihan (pratinjau basi / permintaan dijahili).
      if (meta.terbitanMarlin) {
        throw new DocumentError(
          "Berkas ini terbitan MARLIN sendiri (laporan yang diunggah dari sini) – datanya sudah ada, tidak perlu diimpor",
        );
      }
      if (!mimeDidukung(meta.mimeType)) {
        throw new DocumentError(`Jenis berkas tidak didukung (${meta.mimeType})`);
      }

      const sudah = await db.document.findFirst({
        where: { orgId: user.orgId, driveFileId: meta.id },
        select: { title: true },
      });
      if (sudah) throw new DocumentError(`Sudah pernah diimpor sebagai "${sudah.title}"`);

      const { data, mime, extension } = await downloadDriveFile(
        meta.id,
        meta.mimeType,
        MAX_UPLOAD_BYTES,
      );
      // Dokumen native Google berubah bentuk saat diekspor (Docs → PDF,
      // Sheets → XLSX): ekstensi namanya ikut disesuaikan supaya file yang
      // tersimpan tidak berbohong soal isinya.
      const fileName = extension ? `${baseName(meta.name)}.${extension}` : meta.name;
      const kanonik = resolveUploadMime(fileName, mime);
      if (!kanonik) throw new DocumentError(`Jenis berkas tidak didukung (${mime})`);

      const file = new File([new Uint8Array(data)], fileName, { type: kanonik });
      const doc = await uploadDocument(
        {
          file,
          packageId: pkg.id,
          locationId: sel.locationId,
          phase: phaseForType(sel.type),
          type: sel.type,
          title: baseName(meta.name),
          docDate: extractDocDate(meta.name),
          description: `Diimpor dari Google Drive KKP${sel.path ? ` – ${bersihkanPath(sel.path)}` : ""}`,
          origin: {
            driveFileId: meta.id,
            driveWebLink: meta.webViewLink,
            drivePath: bersihkanPath(sel.path),
            driveModifiedAt: meta.modifiedTime,
          },
        },
        user.id,
      );
      result.berhasil.push({ fileName: meta.name, documentId: doc.id });
    } catch (err) {
      const sebab =
        err instanceof DocumentError || err instanceof GDriveError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Sebab tidak diketahui";
      result.gagal.push({ fileName: namaBerkas, sebab });
    }
  }

  await audit(user.id, "document.drive_import", "package", pkg.id, {
    diminta: selections.length,
    berhasil: result.berhasil.length,
    gagal: result.gagal.length,
  });
  return result;
}

/** Boleh membuka menu impor? (frontend hanya menyembunyikan; action tetap cek.) */
export function bolehImporDrive(role: Parameters<typeof can>[0]): boolean {
  return can(role, "document.upload");
}
