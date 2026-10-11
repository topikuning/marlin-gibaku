import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jakartaDateKey } from "@/lib/format";
import { buangPintasan, buatPintasan, ensureFolderPath, GDriveError, ubahPintasan } from "./client";
import {
  BANGUNAN_ALAT,
  BANGUNAN_MATERIAL,
  dokumentasiPath,
  namaBangunan,
  namaPintasan,
  rencanaPintasan,
  tautkanTarget,
  type AksiPintasan,
  type InginPintasan,
} from "./dokumentasi-murni";
import { refKeyHarian } from "./kirim";
import { jenisGalat } from "./laju";

/**
 * DOKUMENTASI FOTO PER BANGUNAN DI DRIVE – shortcut (DECISIONS 666).
 *
 * "6. DOKUMENTASI/<Lokasi>/<Bangunan>" berisi shortcut ke foto laporan harian
 * yang sudah ada di "3. LAPORAN HARIAN/…/Foto". Tidak ada berkas yang
 * digandakan. Bangunan = kategori RAB tingkat 1 dari item foto itu, dengan
 * nama dari revisi RAB yang AKTIF (adendum yang mengganti nama bangunan ikut
 * memindahkan shortcut-nya).
 *
 * Hanya laporan FINAL: itu yang foto-fotonya naik ke Drive. Laporan yang
 * dibuka kembali kehilangan shortcut-nya, dan mendapatkannya lagi saat final
 * dan diunggah ulang.
 */

export type HasilDokumentasi = {
  dibuat: number;
  dipindah: number;
  dibuang: number;
  tertunda: number;
  /** Galat pertama; `laju` = Google meminta berhenti dulu. */
  galat: { pesan: string; laju: boolean } | null;
};

const kosong = (): HasilDokumentasi => ({ dibuat: 0, dipindah: 0, dibuang: 0, tertunda: 0, galat: null });

type SimpulRab = { id: string; parentId: string | null; code: string; name: string; lineageKey: string };

/** Akar (kategori tingkat 1) sebuah node, dari node revisi yang sama. */
function akar(id: string, peta: Map<string, SimpulRab>): SimpulRab | null {
  let n = peta.get(id) ?? null;
  for (let i = 0; n?.parentId && i < 20; i++) n = peta.get(n.parentId) ?? n;
  return n;
}

const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Susun shortcut untuk foto SATU laporan harian. Dipanggil sesudah foto
 * laporan itu naik ke Drive, dan oleh pengisi berkala untuk laporan lama.
 */
export async function sinkronDokumentasiLaporan(
  reportId: string,
  opts: { jedaMs?: number } = {},
): Promise<HasilDokumentasi> {
  const hasil = kosong();
  const r = await db.dailyReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      reportDate: true,
      status: true,
      finalizedAt: true,
      location: { select: { id: true, slug: true, name: true, package: { select: { driveFolderId: true } } } },
      photos: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          r2Key: true,
          reportItem: { select: { rabNode: { select: { id: true, revisionId: true, name: true } } } },
          reportMaterial: { select: { name: true } },
          reportEquipment: { select: { name: true } },
        },
      },
    },
  });
  const root = r?.location.package.driveFolderId;
  if (!r || !root) return hasil;

  const dateKey = jakartaDateKey(r.reportDate);
  const ada = await db.gDrivePintasanFoto.findMany({ where: { reportId: r.id } });
  const aktif = await db.rabRevision.findFirst({
    where: { locationId: r.location.id, status: "aktif" },
    select: { id: true },
  });

  const ingin: InginPintasan[] = [];
  if (r.status === "final") {
    const rows = await db.gDriveUpload.findMany({
      where: {
        kind: "laporan_harian",
        refKey: refKeyHarian(r.location.slug, dateKey),
        status: "sukses",
        fileId: { not: null },
      },
      select: { fileName: true, fileId: true, photoId: true, createdAt: true },
    });
    const target = tautkanTarget(
      r.photos,
      rows.map((x) => ({ ...x, fileId: x.fileId! })),
      { dateKey, locationName: r.location.name, finalizedAt: r.finalizedAt },
    );

    // Pohon RAB per revisi (biasanya satu) + akar revisi AKTIF menurut lineage.
    const revisi = new Set(r.photos.map((p) => p.reportItem?.rabNode.revisionId).filter((v): v is string => !!v));
    if (aktif) revisi.add(aktif.id);
    const simpul = await db.rabNode.findMany({
      where: { revisionId: { in: [...revisi] } },
      select: { id: true, parentId: true, code: true, name: true, lineageKey: true, revisionId: true },
    });
    const peta = new Map(simpul.map((n) => [n.id, n]));
    const akarAktif = new Map(
      simpul.filter((n) => n.revisionId === aktif?.id && !n.parentId).map((n) => [n.lineageKey, n]),
    );

    r.photos.forEach((p, i) => {
      let bangunan: string | null = null;
      let pekerjaan: string | null = null;
      if (p.reportItem) {
        const a = akar(p.reportItem.rabNode.id, peta);
        if (a) bangunan = namaBangunan(akarAktif.get(a.lineageKey) ?? a);
        pekerjaan = p.reportItem.rabNode.name;
      } else if (p.reportMaterial) {
        bangunan = BANGUNAN_MATERIAL;
        pekerjaan = p.reportMaterial.name;
      } else if (p.reportEquipment) {
        bangunan = BANGUNAN_ALAT;
        pekerjaan = p.reportEquipment.name;
      }
      if (!bangunan || !pekerjaan) return;
      ingin.push({
        photoId: p.id,
        targetId: target.get(p.id) ?? null,
        bangunan,
        nama: namaPintasan(dateKey, pekerjaan, i + 1),
      });
    });
  }

  const aksi = rencanaPintasan(ingin, ada);
  const folder = new Map<string, string>();
  const folderBangunan = async (b: string) => {
    let id = folder.get(b);
    if (!id) {
      id = await ensureFolderPath(root, dokumentasiPath(r.location.name, b));
      folder.set(b, id);
    }
    return id;
  };
  const simpan = (i: InginPintasan, ubah: { shortcutId: string | null; folderId: string | null }) =>
    db.gDrivePintasanFoto.upsert({
      where: { photoId: i.photoId },
      create: {
        photoId: i.photoId,
        reportId: r.id,
        locationId: r.location.id,
        revisionId: aktif?.id ?? null,
        targetId: i.targetId,
        bangunan: i.bangunan,
        nama: i.nama,
        ...ubah,
      },
      update: { revisionId: aktif?.id ?? null, targetId: i.targetId, bangunan: i.bangunan, nama: i.nama, ...ubah },
    });

  const kerjakan = async (x: AksiPintasan): Promise<void> => {
    switch (x.jenis) {
      case "tunda":
        await simpan(x.ingin, { shortcutId: null, folderId: null });
        hasil.tertunda++;
        return;
      case "buang":
        if (x.lama.shortcutId) await buangPintasan(x.lama.shortcutId);
        await db.gDrivePintasanFoto.delete({ where: { photoId: x.lama.photoId } }).catch(() => undefined);
        hasil.dibuang++;
        return;
      case "ubah": {
        const ke = await folderBangunan(x.ingin.bangunan);
        try {
          await ubahPintasan(x.lama.shortcutId!, { name: x.ingin.nama, dariFolder: x.lama.folderId ?? undefined, keFolder: ke });
          await simpan(x.ingin, { shortcutId: x.lama.shortcutId, folderId: ke });
          hasil.dipindah++;
          return;
        } catch (e) {
          // Shortcut-nya dihapus orang dari Drive → buat lagi.
          if (!(e instanceof GDriveError && e.status === 404)) throw e;
        }
        const id = await buatPintasan({ folderId: ke, name: x.ingin.nama, targetId: x.ingin.targetId! });
        await simpan(x.ingin, { shortcutId: id, folderId: ke });
        hasil.dibuat++;
        return;
      }
      case "buat_ulang":
        if (x.lama.shortcutId) await buangPintasan(x.lama.shortcutId);
      // fallthrough – lalu buat yang baru
      case "buat": {
        const ke = await folderBangunan(x.ingin.bangunan);
        const id = await buatPintasan({ folderId: ke, name: x.ingin.nama, targetId: x.ingin.targetId! });
        await simpan(x.ingin, { shortcutId: id, folderId: ke });
        hasil.dibuat++;
        return;
      }
    }
  };

  let pertama = true;
  for (const x of aksi) {
    const keDrive = x.jenis !== "tunda" && !(x.jenis === "buang" && !x.lama.shortcutId);
    if (keDrive && !pertama && opts.jedaMs) await tidur(opts.jedaMs);
    if (keDrive) pertama = false;
    try {
      await kerjakan(x);
    } catch (e) {
      const status = e instanceof GDriveError ? e.status : null;
      const pesan = e instanceof Error ? e.message : "Shortcut dokumentasi gagal disusun.";
      const laju = jenisGalat(status, pesan) === "laju";
      hasil.galat ??= { pesan, laju };
      if (laju) break;
    }
  }
  return hasil;
}

/**
 * Laporan final yang fotonya sudah di Drive tetapi shortcut-nya belum
 * lengkap, atau disusun dengan revisi RAB yang sudah bukan revisi aktif.
 * Terbaru dulu: dokumentasi minggu ini lebih sering dibuka daripada bulan lalu.
 */
async function laporanPerluDisusun(batas: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT r.id
    FROM daily_reports r
    JOIN locations l ON l.id = r.location_id
    JOIN packages pk ON pk.id = l.package_id
    WHERE r.status = 'final'
      AND pk.drive_folder_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM gdrive_uploads u
        WHERE u.kind = 'laporan_harian' AND u.status = 'sukses'
          AND u.ref_key = l.slug || ':' || to_char(r.report_date, 'YYYY-MM-DD')
      )
      AND EXISTS (
        SELECT 1 FROM photos p
        LEFT JOIN gdrive_pintasan_foto g ON g.photo_id = p.id
        WHERE p.report_id = r.id
          AND (p.report_item_id IS NOT NULL OR p.report_material_id IS NOT NULL OR p.report_equipment_id IS NOT NULL)
          AND (
            g.photo_id IS NULL
            OR g.revision_id IS DISTINCT FROM (
              SELECT rv.id FROM rab_revisions rv
              WHERE rv.location_id = r.location_id AND rv.status = 'aktif'
              LIMIT 1
            )
          )
      )
    ORDER BY r.report_date DESC
    LIMIT ${batas}
  `);
  return rows.map((x) => x.id);
}

/**
 * Pengisi berkala: dijalankan di ujung putaran antrean Drive dengan sisa
 * anggaran waktunya. Foto lama terisi bertahap tanpa mengganggu unggahan
 * laporan, dan berhenti begitu Google menahan laju.
 */
export async function isiDokumentasi(opts: {
  batasMs: number;
  jedaMs: number;
  batasLaporan?: number;
}): Promise<HasilDokumentasi & { laporan: number }> {
  const mulai = Date.now();
  const total = { ...kosong(), laporan: 0 };
  for (const id of await laporanPerluDisusun(opts.batasLaporan ?? 40)) {
    if (Date.now() - mulai >= opts.batasMs) break;
    const h = await sinkronDokumentasiLaporan(id, { jedaMs: opts.jedaMs });
    total.laporan++;
    total.dibuat += h.dibuat;
    total.dipindah += h.dipindah;
    total.dibuang += h.dibuang;
    total.tertunda += h.tertunda;
    total.galat ??= h.galat;
    if (h.galat?.laju) break;
  }
  return total;
}
