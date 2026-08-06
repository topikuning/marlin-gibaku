import "server-only";
import type { DailyReportStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { locationScopeWhere } from "@/lib/auth/scope";
import { parseDateKey } from "@/lib/format";
import type { SessionUser } from "@/lib/auth/session";

/**
 * PAPAN STATUS LAPORAN HARIAN — satu halaman untuk menjawab, per tanggal:
 * lokasi mana yang sudah melapor, sampai tahap apa, dan apakah berkasnya sudah
 * naik ke Google Drive. Permintaan user 2026-08-05. DECISIONS 262.
 *
 * Sebelum ini jawabannya harus dikumpulkan sendiri dari beberapa halaman:
 * status laporan di workspace lokasi, jejak Drive di panel kelengkapan paket.
 * Untuk 83 lokasi itu bukan pekerjaan yang masuk akal.
 *
 * ### Yang TIDAK dilakukan modul ini
 *
 * Tidak menyimpulkan apa pun dari ketiadaan. "Belum ada laporan" ditulis apa
 * adanya, bukan diterjemahkan jadi "lokasi ini bermasalah" — hari libur,
 * lokasi yang belum SPMK, dan kelalaian menghasilkan keadaan yang sama di
 * tabel, dan hanya dua yang terakhir yang perlu ditindak.
 */

export type JejakDrive = {
  /** null = belum pernah dicoba. */
  status: "sukses" | "gagal" | null;
  webLink: string | null;
  at: Date | null;
  error: string | null;
  /** Berapa berkas sukses naik untuk tanggal ini (PDF + foto-fotonya). */
  fileSukses: number;
};

export type StatusHarianRow = {
  locationId: string;
  locationName: string;
  /** Kabupaten/kota — baris daftar ini tidak punya kolom wilayah sendiri. */
  regency: string;
  slug: string;
  packageName: string;
  /** null = paket belum punya folder Drive; tombol unggah tidak akan berhasil. */
  driveFolderId: string | null;
  /** null = paket belum punya grup WA; tombol kirim tidak akan berhasil. */
  waGroupId: string | null;

  status: DailyReportStatus | null;
  itemCount: number;
  fotoCount: number;
  kegiatanCount: number;
  kegiatanFotoCount: number;
  waSentAt: Date | null;

  drive: JejakDrive;
};

export type RingkasanStatusHarian = {
  dateKey: string;
  rows: StatusHarianRow[];
  /** Angka pita atas — dihitung dari `rows`, bukan query terpisah yang bisa menyimpang. */
  total: number;
  belumAda: number;
  masihDraft: number;
  sudahFinal: number;
  sudahDrive: number;
  sudahWa: number;
};

/**
 * Ambil papan status untuk satu tanggal, TER-SCOPE akses lokasi si pengguna.
 *
 * Hanya lokasi aktif yang ditampilkan — lokasi yang sudah selesai/dibekukan
 * tidak menagih laporan harian dan hanya akan menambah baris kosong.
 */
export async function getStatusHarian(
  user: SessionUser,
  scoped: string[] | null,
  dateKey: string,
): Promise<RingkasanStatusHarian | null> {
  const reportDate = parseDateKey(dateKey);
  if (!reportDate) return null;

  const locations = await db.location.findMany({
    where: { ...locationScopeWhere(user, scoped), isActive: true },
    select: {
      id: true,
      name: true,
      regency: true,
      slug: true,
      package: { select: { id: true, name: true, driveFolderId: true, waGroupId: true } },
      dailyReports: {
        where: { reportDate },
        select: {
          status: true,
          waSentAt: true,
          _count: { select: { items: true, photos: true } },
        },
      },
      fieldActivities: {
        where: { activityDate: reportDate },
        select: { _count: { select: { photos: true } } },
      },
    },
    orderBy: [{ package: { name: "asc" } }, { name: "asc" }],
  });

  // Jejak Drive: SATU query untuk semua lokasi (bukan N+1). refKey mengikuti
  // konvensi `uploadDailyReportToDriveAction`: "<slug>:<dateKey>".
  const refKeys = locations.map((l) => `${l.slug}:${dateKey}`);
  const uploads =
    refKeys.length === 0
      ? []
      : await db.gDriveUpload.findMany({
          where: { kind: "laporan_harian", refKey: { in: refKeys } },
          select: {
            refKey: true,
            status: true,
            webLink: true,
            error: true,
            createdAt: true,
            // Nama berkas dipakai memilih tautan yang BENAR — lihat di bawah.
            fileName: true,
          },
          orderBy: { createdAt: "desc" },
        });

  /**
   * Tautan "Buka Drive" harus menunjuk BLANKO LAPORANNYA, bukan berkas terakhir.
   *
   * Satu unggahan menghasilkan banyak baris log: satu PDF blanko harian lalu
   * foto-fotonya. Karena log diurut terbaru-dulu, baris pertama hampir selalu
   * FOTO — sehingga tombolnya membuka sebuah foto di dalam subfolder `Foto`,
   * dan pembacanya menyimpulkan blankonya tidak ikut naik. Padahal naik: PDF
   * masuk ke `3. LAPORAN HARIAN/<Lokasi>/<bulan>/`, fotonya ke `.../Foto/`.
   *
   * Keluhan user 2026-08-06: *"kenapa cuma foto, blanko laporannya tidak ikut
   * ke drive"*. Yang salah bukan pengunggahnya, melainkan tautan yang
   * ditawarkan papan ini — dan itu tetap salah, karena membuat orang percaya
   * dokumen resminya hilang.
   */
  const namaBlanko = (n: string) => n.toLowerCase().startsWith("laporan harian");

  /** Tautan dipilih SESUDAH semua baris dibaca: blanko diutamakan, lalu apa pun. */
  const tautan = new Map<string, { blanko: string | null; lain: string | null }>();
  const perRef = new Map<string, JejakDrive>();

  for (const u of uploads) {
    const t = tautan.get(u.refKey) ?? { blanko: null, lain: null };
    if (u.status === "sukses" && u.webLink) {
      if (namaBlanko(u.fileName)) t.blanko ??= u.webLink;
      else t.lain ??= u.webLink;
    }
    tautan.set(u.refKey, t);

    const ada = perRef.get(u.refKey);
    if (!ada) {
      // Baris pertama = percobaan TERBARU (query sudah diurut menurun).
      perRef.set(u.refKey, {
        status: u.status === "sukses" ? "sukses" : "gagal",
        // Diisi belakangan; di sini belum semua baris terbaca.
        webLink: null,
        at: u.createdAt,
        error: u.error,
        fileSukses: u.status === "sukses" ? 1 : 0,
      });
      continue;
    }
    if (u.status === "sukses") ada.fileSukses += 1;
  }

  for (const [ref, jejak] of perRef) {
    const t = tautan.get(ref);
    // Blanko diutamakan; kalau memang tidak ada yang bernama begitu, tautan
    // sukses mana pun tetap dipakai — tombol yang mati lebih buruk daripada
    // tombol yang membuka berkas pendamping.
    jejak.webLink = t?.blanko ?? t?.lain ?? null;
  }

  const rows: StatusHarianRow[] = locations.map((l) => {
    const lap = l.dailyReports[0];
    return {
      locationId: l.id,
      locationName: l.name,
      regency: l.regency,
      slug: l.slug,
      packageName: l.package.name,
      driveFolderId: l.package.driveFolderId,
      waGroupId: l.package.waGroupId,
      status: lap?.status ?? null,
      itemCount: lap?._count.items ?? 0,
      fotoCount: lap?._count.photos ?? 0,
      kegiatanCount: l.fieldActivities.length,
      kegiatanFotoCount: l.fieldActivities.reduce((s, k) => s + k._count.photos, 0),
      waSentAt: lap?.waSentAt ?? null,
      drive:
        perRef.get(`${l.slug}:${dateKey}`) ??
        ({ status: null, webLink: null, at: null, error: null, fileSukses: 0 } satisfies JejakDrive),
    };
  });

  return {
    dateKey,
    rows,
    total: rows.length,
    belumAda: rows.filter((r) => r.status == null).length,
    masihDraft: rows.filter((r) => r.status === "draft").length,
    sudahFinal: rows.filter((r) => r.status === "final").length,
    sudahDrive: rows.filter((r) => r.drive.status === "sukses").length,
    sudahWa: rows.filter((r) => r.waSentAt != null).length,
  };
}
