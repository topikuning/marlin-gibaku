import "server-only";
import { db } from "@/lib/db";
import type { ImportIssueSeverity, ImportKind } from "@/generated/prisma/enums";
import { statusDari } from "./labels";

/**
 * JEJAK IMPOR — satu tempat menulis riwayat unggah berkas (DECISIONS 254).
 *
 * Sebelum ini hasil impor hanya hidup selama satu render: parser mengembalikan
 * `warnings: string[]`, sebuah banner menampilkannya, lalu semuanya hilang
 * begitu halaman ditutup. Akibatnya pertanyaan yang paling sering datang
 * berminggu-minggu kemudian tidak bisa dijawab sama sekali — "RAB lokasi ini
 * diimpor dari berkas mana, oleh siapa, dan baris mana yang waktu itu ditolak?"
 *
 * Penulisannya BEST-EFFORT dan sengaja begitu: gagal mencatat jejak tidak boleh
 * menggagalkan impornya. Jejak yang hilang menyusahkan; impor yang batal karena
 * jejaknya gagal ditulis membuat orang berhenti memakai fiturnya sama sekali.
 * (Bandingkan `auditIn` untuk mutasi uang/status — di sana justru sebaliknya,
 * karena yang dijaga adalah bukti perubahan, bukan catatan pekerjaan.)
 */

export type MasalahImpor = {
  severity: ImportIssueSeverity;
  /** Nomor baris di berkas ASLI (1-based, termasuk header). */
  rowNumber?: number | null;
  column?: string | null;
  /** Nilai apa adanya dari sel — tidak dinormalkan (DECISIONS 203). */
  value?: string | null;
  message: string;
};

export type CatatanImpor = {
  orgId: string;
  userId?: string | null;
  locationId?: string | null;
  packageId?: string | null;
  kind: ImportKind;
  fileName: string;
  fileBytes?: number;
  rowsRead?: number;
  rowsAccepted?: number;
  rowsRejected?: number;
  message?: string | null;
  masalah?: MasalahImpor[];
};

/**
 * Batas jumlah masalah yang disimpan per pekerjaan.
 *
 * Satu berkas RAB yang kolomnya bergeser bisa menghasilkan ribuan baris
 * bermasalah — dan menyimpan semuanya tidak menambah satu pun informasi baru
 * bagi pembacanya, sementara halaman riwayatnya jadi tidak bisa dibuka.
 * Yang PENTING: pemotongannya dikatakan (lihat `pesanPemotongan`), tidak
 * diam-diam. Daftar yang terpotong tanpa keterangan terbaca sebagai daftar
 * lengkap, dan orang lalu menyangka sisanya baik-baik saja.
 */
const BATAS_MASALAH = 200;

function pesanPemotongan(total: number): MasalahImpor | null {
  if (total <= BATAS_MASALAH) return null;
  return {
    severity: "peringatan",
    message: `Masih ada ${total - BATAS_MASALAH} masalah lain yang tidak disimpan (hanya ${BATAS_MASALAH} pertama yang dicatat). Perbaiki yang tampil lalu impor ulang untuk melihat sisanya.`,
  };
}

export async function catatImpor(c: CatatanImpor): Promise<string | null> {
  const rowsRead = c.rowsRead ?? 0;
  const rowsAccepted = c.rowsAccepted ?? 0;
  const rowsRejected = c.rowsRejected ?? 0;
  const masalah = c.masalah ?? [];
  const potong = pesanPemotongan(masalah.length);
  const disimpan = [...masalah.slice(0, BATAS_MASALAH), ...(potong ? [potong] : [])];

  try {
    const job = await db.importJob.create({
      data: {
        orgId: c.orgId,
        userId: c.userId ?? null,
        locationId: c.locationId ?? null,
        packageId: c.packageId ?? null,
        kind: c.kind,
        status: statusDari(rowsRead, rowsAccepted, rowsRejected),
        fileName: c.fileName.slice(0, 300),
        fileBytes: c.fileBytes ?? 0,
        rowsRead,
        rowsAccepted,
        rowsRejected,
        message: c.message ?? null,
        finishedAt: new Date(),
        issues: {
          create: disimpan.map((m) => ({
            severity: m.severity,
            rowNumber: m.rowNumber ?? null,
            column: m.column ?? null,
            value: m.value == null ? null : String(m.value).slice(0, 500),
            message: m.message,
          })),
        },
      },
      select: { id: true },
    });
    return job.id;
  } catch (err) {
    console.error("[import-log] gagal mencatat jejak impor:", c.kind, c.fileName, err);
    return null;
  }
}

/** Impor yang gagal TOTAL (berkas tidak terbaca, sheet tidak ada, dst). */
export async function catatImporGagal(
  c: Omit<CatatanImpor, "rowsRead" | "rowsAccepted" | "rowsRejected" | "masalah"> & {
    alasan: string;
  },
): Promise<string | null> {
  try {
    const job = await db.importJob.create({
      data: {
        orgId: c.orgId,
        userId: c.userId ?? null,
        locationId: c.locationId ?? null,
        packageId: c.packageId ?? null,
        kind: c.kind,
        status: "gagal",
        fileName: c.fileName.slice(0, 300),
        fileBytes: c.fileBytes ?? 0,
        message: c.alasan.slice(0, 1000),
        finishedAt: new Date(),
      },
      select: { id: true },
    });
    return job.id;
  } catch (err) {
    console.error("[import-log] gagal mencatat impor gagal:", c.kind, err);
    return null;
  }
}

export { BATAS_MASALAH };
