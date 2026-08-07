import { db } from "@/lib/db";
import { auditIn } from "@/lib/audit";
import { requireLocationAccess, type SessionUser } from "@/lib/auth/session";
import { konteksFoto } from "@/lib/photo-restamp/service";
import { EDITABLE_STATUSES } from "@/lib/daily-report/service";
import { lengkapiCap } from "./service";

/**
 * MEMAKAI FOTO KANTONG — SATU tempat aturannya ditulis.
 *
 * Dulu badan aturan ini hidup di dalam `pakaiFotoAction`, satu-satunya jalur
 * yang ada. Sekarang jalurnya dua: memakai foto untuk item yang SUDAH tersimpan
 * (dari daftar pekerjaan), dan memakai foto untuk item yang BARU SAJA disimpan
 * (dipilih di formulir sebelum menekan Simpan — permintaan user 2026-08-07:
 * *"seharusnya di tampilan utama pilih pekerjaan... kantong harusnya langsung
 * bisa dipilih sebelum simpan item... ini default paling nyaman"*).
 *
 * Dua jalur, satu aturan. Kalau badannya disalin, pagarnya akan bergeser diam-
 * diam di salah satu salinan — dan pagar yang dijaga di sini bukan pagar
 * remeh:
 *
 * - **Foto tanpa lokasi DITOLAK.** Menautkannya ke laporan lokasi X akan
 *   MENETAPKAN lokasinya ke X secara diam-diam, padahal deteksi tadi justru
 *   menolak menebak (DECISIONS 254).
 * - **Foto dari lokasi lain DITOLAK.** Foto hanya boleh dipakai di lokasi
 *   tempat ia dipotret.
 * - **Penautan dan pelengkapan cap sengaja BUKAN satu transaksi.** Melengkapi
 *   cap berarti render ulang + tulis ke R2; menahan transaksi selama itu
 *   mengunci baris jauh lebih lama daripada perlu. Kalau capnya gagal, fotonya
 *   TETAP tertaut dengan cap dasar (waktu + koordinat tetap benar) dan
 *   kegagalannya DISEBUTKAN — bukan disembunyikan.
 */

export type TujuanPakai =
  | { tujuan: "kegiatan"; kegiatanId: string }
  | { tujuan: "laporan"; reportItemId: string };

export type HasilPakai =
  | { error: string }
  | { dipakai: number; labelTujuan: string; gagalCap: string[] };

export async function pakaiFotoKeTujuan(
  actor: SessionUser,
  photoIds: string[],
  target: TujuanPakai,
): Promise<HasilPakai> {
  // ── Tujuan: harus ada, masih boleh disunting, dan lokasinya harus cocok ──
  let tujuanLocationId: string;
  let reportId: string | null = null;
  let reportItemId: string | null = null;
  let activityId: string | null = null;
  let labelTujuan: string;

  if (target.tujuan === "kegiatan") {
    const keg = await db.fieldActivity.findUnique({
      where: { id: target.kegiatanId },
      select: { id: true, locationId: true, status: true, title: true },
    });
    if (!keg) return { error: "Kegiatan tidak ditemukan." };
    if (keg.status !== "draft")
      return { error: "Kegiatan itu sudah difinalkan — fotonya tidak bisa ditambah lagi." };
    tujuanLocationId = keg.locationId;
    activityId = keg.id;
    labelTujuan = `kegiatan "${keg.title}"`;
  } else {
    const item = await db.dailyReportItem.findUnique({
      where: { id: target.reportItemId },
      select: {
        id: true,
        reportId: true,
        report: { select: { locationId: true, status: true } },
        rabNode: { select: { name: true } },
      },
    });
    if (!item) return { error: "Item laporan tidak ditemukan." };
    if (!EDITABLE_STATUSES.includes(item.report.status))
      return {
        error: "Laporan itu sudah dikirim/disetujui — lampirannya tidak bisa diubah dari sini.",
      };
    tujuanLocationId = item.report.locationId;
    reportId = item.reportId;
    reportItemId = item.id;
    labelTujuan = `item "${item.rabNode.name}"`;
  }
  await requireLocationAccess(actor, tujuanLocationId);

  // ── Foto: harus masih di kantong DAN lokasinya sama dengan tujuan ──
  const fotos = await db.photo.findMany({
    where: { id: { in: photoIds }, reportId: null, activityId: null },
    select: { id: true, locationId: true },
  });
  if (fotos.length === 0)
    return { error: "Foto tidak ditemukan di kantong (mungkin sudah dipakai)." };

  const tanpaLokasi = fotos.filter((f) => f.locationId == null);
  if (tanpaLokasi.length > 0)
    return {
      error: `${tanpaLokasi.length} foto belum ketahuan lokasinya. Tetapkan lokasinya dulu di kantong, baru bisa dipakai.`,
    };
  const bedaLokasi = fotos.filter((f) => f.locationId !== tujuanLocationId);
  if (bedaLokasi.length > 0)
    return {
      error: `${bedaLokasi.length} foto berasal dari lokasi lain. Foto hanya boleh dipakai di lokasi tempat ia dipotret.`,
    };

  const gagalCap: string[] = [];
  let dipakai = 0;
  for (const f of fotos) {
    // Nilai cap SEBELUM ditautkan — sesudahnya `konteksFoto` sudah membaca
    // induk barunya, jadi tidak lagi bisa dipakai sebagai pembanding.
    const sebelum = await konteksFoto(f.id);
    await db.$transaction(async (tx) => {
      await tx.photo.update({
        where: { id: f.id },
        data: { reportId, reportItemId, activityId },
      });
      await auditIn(tx, actor.id, "photo.quick_attach", "photo", f.id, {
        tujuan: target.tujuan,
        reportItemId,
        activityId,
        locationId: tujuanLocationId,
      });
    });
    dipakai++;
    if (!sebelum) continue;
    try {
      const hasil = await lengkapiCap(f.id, sebelum, actor.id);
      if (!hasil.ok) gagalCap.push(hasil.alasan);
    } catch {
      gagalCap.push("render cap gagal");
    }
  }

  return { dipakai, labelTujuan, gagalCap };
}
