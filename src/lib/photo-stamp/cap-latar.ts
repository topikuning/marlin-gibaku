import "server-only";
import type { PhotoStamp } from "@/lib/photos";

/*
 * `db` dimuat saat dipakai, bukan saat modul diimpor: modul ini diimpor
 * pembuat PDF/WA/Drive yang juga dimuat rute API, dan impor `db` di puncak
 * modul memvalidasi environment sebelum pemeriksaan sesi rute berjalan.
 */
const muatDb = async () => (await import("@/lib/db")).db;

/**
 * CAP FOTO DI LATAR (DECISIONS 618).
 *
 * Keluhan user 2026-09-26: *"saat simpan, bisakah kita simpan saja fotonya,
 * dan dikerjakan di background tanpa mengganggu user? karena sistem terkesan
 * sangat lambat saat menyimpan foto"*. Diukur di mesin uji: tiap foto ±1,5 dtk
 * membaca tag bawaan (OCR) + ±0,5 dtk membuat cap + dua kiriman R2 tambahan —
 * semuanya ditunggu orang di lapangan sebelum bisa memotret lagi.
 *
 * Sekarang unggahan hanya menyimpan berkas ASLI + baris foto (`stampPending`),
 * lalu pekerja di bawah ini membaca tag, membuat cap & thumbnail, dan menukar
 * `r2Key`. Selama menunggu (hitungan detik), `r2Key` menunjuk berkas asli
 * sehingga foto tetap tampil — tanpa cap.
 *
 * ### Keluaran tidak boleh memakai foto tanpa cap
 *
 * PDF, kiriman WA, Drive, dan deck membaca foto lewat `kunciFotoBercap` /
 * `r2GetFotoBercap`: kalau fotonya masih menunggu, cap dikerjakan saat itu juga
 * (atau ditunggu kalau sedang dikerjakan) sebelum berkasnya dipakai.
 *
 * ### Proses mati di tengah jalan
 *
 * Antreannya di memori. Baris yang masih `stampPending` lebih dari dua menit
 * dan tidak sedang dikerjakan dipulihkan dari data di basis data (jalur yang
 * sama dengan perbaikan cap) — dipicu setiap ada unggahan baru dan setiap ada
 * keluaran yang membutuhkannya. Tiap langkah boleh diulang: yang ditulis ke R2
 * berkas BARU, barisnya ditukar hanya kalau masih menunggu.
 */

export type TugasCap = {
  photoId: string;
  gambar: Buffer;
  /** Isi cap persis seperti saat unggah — tanpa keputusan tag bawaan. */
  stamp: PhotoStamp;
  locationId: string | null;
  /** `photos/<slug>/<tanggal>/<uuid>` — kunci berkas ber-cap & thumbnail. */
  dasarKunci: string;
};

const BATAS_COBA = 3;
const UMUR_PULIH_MS = 2 * 60_000;

/** Foto yang sedang/akan dikerjakan proses ini → janji selesainya. */
const berjalan = new Map<string, Promise<void>>();
let antrean: Promise<unknown> = Promise.resolve();

async function kerjakan(t: TugasCap): Promise<void> {
  const db = await muatDb();
  const { processWithSharpOrOriginal, tagBawaanFoto, ringkasBukti } = await import("@/lib/photos");
  const { r2Put, r2Delete } = await import("@/lib/r2");
  const tag = await tagBawaanFoto(t.gambar, t.locationId);
  const hasil = await processWithSharpOrOriginal(
    t.gambar,
    {
      ...t.stamp,
      sembunyikanLokasi: tag?.lokasi ?? false,
      sembunyikanWaktu: tag?.waktu ?? false,
      hindari: tag?.kotak ?? [],
    },
    { name: "foto", type: "" },
  );
  const kunci = `${t.dasarKunci}.${hasil.ext}`;
  const kunciThumb = hasil.thumb ? `${t.dasarKunci}.thumb.webp` : null;
  await Promise.all([
    r2Put(kunci, hasil.main, hasil.contentType),
    kunciThumb ? r2Put(kunciThumb, hasil.thumb!, "image/webp") : Promise.resolve(),
  ]);
  // Ditukar HANYA kalau masih menunggu: foto yang sementara itu dihapus, atau
  // capnya sudah diperbaiki tangan, tidak boleh ditimpa hasil latar yang basi.
  const tukar = await db.photo.updateMany({
    where: { id: t.photoId, stampPending: true },
    data: {
      r2Key: kunci,
      thumbnailKey: kunciThumb,
      bytes: hasil.main.length,
      widthPx: hasil.width,
      heightPx: hasil.height,
      existingTagLocation: tag?.lokasi ?? false,
      existingTagTime: tag?.waktu ?? false,
      existingTagEvidence: tag && (tag.lokasi || tag.waktu) ? ringkasBukti(tag) : null,
      textBoxes: tag ? tag.kotak : undefined,
      stampPending: false,
    },
  });
  if (tukar.count === 0) {
    await r2Delete(kunci).catch(() => {});
    if (kunciThumb) await r2Delete(kunciThumb).catch(() => {});
  }
}

function antrekan(photoId: string, buat: () => Promise<TugasCap | null>): Promise<void> {
  const ada = berjalan.get(photoId);
  if (ada) return ada;
  const janji = antrean
    .then(async () => {
      const t = await buat();
      if (t) await kerjakan(t);
    })
    .catch(async (e) => {
      const db = await muatDb();
      console.error(`[cap-latar] foto ${photoId.slice(0, 8)} gagal diberi cap:`, e instanceof Error ? e.message : e);
      await db.photo
        .updateMany({ where: { id: photoId, stampPending: true }, data: { stampTries: { increment: 1 } } })
        .catch(() => {});
    })
    .finally(() => berjalan.delete(photoId));
  berjalan.set(photoId, janji);
  antrean = janji;
  return janji;
}

/** Dipanggil unggahan: berkas asli masih di memori, tidak perlu diunduh ulang. */
export function jadwalkanCap(t: TugasCap): void {
  void antrekan(t.photoId, async () => t);
  void pulihkanYangTertinggal();
}

/**
 * Susun ulang tugas dari basis data — untuk foto yang ditinggal proses yang
 * mati. Memakai jalur perbaikan cap (DECISIONS 198) supaya isi capnya sama.
 */
async function tugasDariBasisData(photoId: string): Promise<TugasCap | null> {
  const db = await muatDb();
  const [{ konteksFoto, stampDariNilai }, { bacaBerkasAsli }] = await Promise.all([
    import("@/lib/photo-restamp/service"),
    import("@/lib/arsip-asli/antrean"),
  ]);
  const k = await konteksFoto(photoId);
  if (!k) return null;
  const baris = await db.photo.findUnique({ where: { id: photoId }, select: { stampPending: true, locationId: true } });
  if (!baris?.stampPending) return null;
  const gambar = await bacaBerkasAsli(k);
  const { tagBawaanLokasi: _l, tagBawaanWaktu: _w, ...nilai } = k.saatIni;
  const stamp = await stampDariNilai(nilai);
  return {
    photoId,
    gambar,
    stamp,
    locationId: baris.locationId,
    dasarKunci: k.originalKey!.replace(/\.asli\.[^./]+$/, ""),
  };
}

let memulihkan = false;
/** Foto yang tertinggal (proses mati) dikerjakan ulang. Aman dipanggil sering. */
export async function pulihkanYangTertinggal(): Promise<number> {
  const db = await muatDb();
  if (memulihkan) return 0;
  memulihkan = true;
  try {
    const tua = await db.photo.findMany({
      where: {
        stampPending: true,
        stampTries: { lt: BATAS_COBA },
        createdAt: { lt: new Date(Date.now() - UMUR_PULIH_MS) },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    let n = 0;
    for (const { id } of tua) {
      if (berjalan.has(id)) continue;
      void antrekan(id, () => tugasDariBasisData(id));
      n++;
    }
    return n;
  } finally {
    memulihkan = false;
  }
}

/** Pastikan foto-foto ini sudah ber-cap sebelum dipakai keluaran. */
export async function pastikanFotoBercap(photoIds: string[]): Promise<void> {
  const db = await muatDb();
  if (photoIds.length === 0) return;
  const menunggu = await db.photo.findMany({
    where: { id: { in: photoIds }, stampPending: true },
    select: { id: true },
  });
  await Promise.all(menunggu.map(({ id }) => berjalan.get(id) ?? antrekan(id, () => tugasDariBasisData(id))));
}

/**
 * Kunci berkas yang boleh dipakai keluaran. Kunci berkas ASLI dari foto yang
 * masih menunggu cap → cap dikerjakan dulu, lalu kunci barunya dikembalikan.
 * Kunci lain dikembalikan apa adanya.
 */
export async function kunciFotoBercap(r2Key: string): Promise<string> {
  const db = await muatDb();
  if (!/\.asli\.[^./]+$/.test(r2Key)) return r2Key;
  const foto = await db.photo.findFirst({ where: { r2Key, stampPending: true }, select: { id: true } });
  if (!foto) return r2Key;
  await pastikanFotoBercap([foto.id]);
  const baru = await db.photo.findUnique({ where: { id: foto.id }, select: { r2Key: true } });
  return baru?.r2Key ?? r2Key;
}

/** `r2GetBuffer` untuk foto keluaran — tidak pernah mengembalikan foto tanpa cap bila capnya bisa dibuat. */
export async function r2GetFotoBercap(r2Key: string): Promise<Buffer> {
  const { r2GetBuffer } = await import("@/lib/r2");
  return r2GetBuffer(await kunciFotoBercap(r2Key));
}

/**
 * Baris foto untuk snapshot (paparan, laporan lokasi) yang MENYIMPAN kuncinya:
 * foto yang masih menunggu diberi cap dulu, lalu kuncinya diganti yang ber-cap —
 * snapshot tidak boleh membekukan kunci berkas asli.
 */
export async function barisFotoBercap<T extends { id: string; r2Key: string; thumbnailKey: string | null }>(
  rows: T[],
): Promise<T[]> {
  const db = await muatDb();
  const menunggu = await db.photo.findMany({
    where: { id: { in: rows.map((r) => r.id) }, stampPending: true },
    select: { id: true },
  });
  if (menunggu.length === 0) return rows;
  await pastikanFotoBercap(menunggu.map((m) => m.id));
  const baru = new Map(
    (
      await db.photo.findMany({
        where: { id: { in: menunggu.map((m) => m.id) } },
        select: { id: true, r2Key: true, thumbnailKey: true },
      })
    ).map((b) => [b.id, b]),
  );
  return rows.map((r) => {
    const b = baru.get(r.id);
    return b ? { ...r, r2Key: b.r2Key, thumbnailKey: b.thumbnailKey } : r;
  });
}

/** Selesainya semua tugas cap yang sudah diantre — untuk uji dan penutupan proses. */
export function antreanCapSelesai(): Promise<void> {
  return antrean.then(
    () => {},
    () => {},
  );
}
