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
 *
 * ### Satu foto bisa dikerjakan DUA pekerja (insiden produksi 2026-09-30)
 *
 * Antrean di memori hanya mencegah kerja ganda di dalam SATU salinan modul.
 * Next.js memuat modul yang sama terpisah untuk server action dan rute API
 * (cron), dan dua replika/pergantian rilis juga dua proses. Keduanya bisa
 * mengerjakan foto yang sama. Dulu kunci keluarannya tetap (`<dasar>.webp`) —
 * untuk baca SUSULAN itu kunci berkas yang SEDANG hidup — dan pekerja yang
 * kalah membuang "hasilnya yang basi", yang ternyata berkas hidup milik
 * pemenang: 17 foto produksi kehilangan berkas ber-cap + thumbnail-nya.
 * Sekarang tiap pengerjaan menulis kunci UNIK, dan yang kalah hanya membuang
 * kunci yang tidak dirujuk baris mana pun (DECISIONS 631).
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

/** Baca tag bawaan + render cap & thumbnail dari berkas asli — tanpa menulis apa pun. */
async function render(t: Pick<TugasCap, "gambar" | "stamp">) {
  const { processWithSharpOrOriginal, tagBawaanFoto } = await import("@/lib/photos");
  // Di latar tidak ada yang menunggu: OCR tidak dilewati karena antrean.
  const tag = await tagBawaanFoto(t.gambar, { latar: true });
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
  return { tag, hasil };
}

type Tag = Awaited<ReturnType<typeof render>>["tag"];

async function dataTag(tag: Tag) {
  const { ringkasBukti } = await import("@/lib/photos");
  return {
    existingTagLocation: tag?.lokasi ?? false,
    existingTagTime: tag?.waktu ?? false,
    existingTagEvidence: tag && (tag.lokasi || tag.waktu) ? ringkasBukti(tag) : null,
    textBoxes: tag ? tag.kotak : undefined,
    // Tetap gagal dibaca → cap lengkap sementara, dicoba lagi oleh pemulih.
    ocrPending: !tag,
  };
}

/** Kunci yang masih dirujuk baris foto mana pun — TIDAK PERNAH boleh dihapus. */
async function masihDirujuk(kunci: string[]): Promise<Set<string>> {
  const db = await muatDb();
  const rows = await db.photo.findMany({
    where: { OR: [{ r2Key: { in: kunci } }, { thumbnailKey: { in: kunci } }, { originalKey: { in: kunci } }] },
    select: { r2Key: true, thumbnailKey: true, originalKey: true },
  });
  return new Set(rows.flatMap((r) => [r.r2Key, r.thumbnailKey, r.originalKey]).filter((k): k is string => !!k));
}

async function kerjakan(t: TugasCap): Promise<void> {
  const db = await muatDb();
  const { r2Put } = await import("@/lib/r2");
  const { hapusBerkas } = await import("@/lib/penyimpanan/berkas");
  const { randomUUID } = await import("node:crypto");
  const { tag, hasil } = await render(t);
  // Kunci UNIK per pengerjaan – pekerja lain yang mengerjakan foto yang sama
  // tidak pernah menulis ke, apalagi menghapus, kunci yang sama.
  const unik = randomUUID().slice(0, 8);
  const kunci = `${t.dasarKunci}.c${unik}.${hasil.ext}`;
  const kunciThumb = hasil.thumb ? `${t.dasarKunci}.c${unik}.thumb.webp` : null;
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
      ...(await dataTag(tag)),
      stampPending: false,
    },
  });
  if (tukar.count === 0) {
    const buang = [kunci, kunciThumb].filter((k): k is string => !!k);
    const hidup = await masihDirujuk(buang);
    for (const k of buang) if (!hidup.has(k)) await hapusBerkas(k).catch(() => {});
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
async function tugasDariBasisData(photoId: string, wajibMenunggu = true): Promise<TugasCap | null> {
  const db = await muatDb();
  const [{ konteksFoto, stampDariNilai }, { bacaBerkasAsli }] = await Promise.all([
    import("@/lib/photo-restamp/service"),
    import("@/lib/arsip-asli/antrean"),
  ]);
  const k = await konteksFoto(photoId);
  if (!k) return null;
  const baris = await db.photo.findUnique({ where: { id: photoId }, select: { stampPending: true, locationId: true } });
  if (!baris || (wajibMenunggu && !baris.stampPending)) return null;
  const asli = await bacaBerkasAsli(k);
  /*
   * Putaran yang pernah diberikan tangan (putarFotoAction) disimpan sebagai
   * `rotationDeg`, bukan di berkas asli – harus diterapkan lagi, persis
   * seperti di sana, supaya cap ulang tidak menegakkan foto kembali.
   */
  const gambar =
    k.rotationDeg === 0
      ? asli
      : await (await import("sharp")).default(asli, { failOn: "none" }).rotate().rotate(k.rotationDeg).toBuffer();
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
    /*
     * Tag bawaan yang belum terbaca (DECISIONS 628): foto sudah bercap
     * lengkap, dibaca SUSULAN dari berkas asli lewat jalur yang sama –
     * ditandai menunggu lagi, lalu cap dirender ulang dengan hasil OCR.
     * Foto yang capnya pernah diperbaiki tangan ikut (629: perbaikan tangan
     * sebelum rilis itu memakai aturan tag lokasi yang salah); perbaikan
     * tangan SESUDAHNYA menutup tanda ini sendiri, jadi tidak pernah ditimpa.
     */
    const susulan = await db.photo.findMany({
      where: {
        ocrPending: true,
        stampPending: false,
        originalKey: { not: null },
        stampTries: { lt: BATAS_COBA },
        createdAt: { lt: new Date(Date.now() - UMUR_PULIH_MS) },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    for (const { id } of susulan) {
      const tandai = await db.photo.updateMany({
        where: { id, ocrPending: true, stampPending: false },
        data: { stampPending: true, stampTries: { increment: 1 } },
      });
      if (tandai.count > 0) tua.push({ id });
    }
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

/** `ambilBerkas` untuk foto keluaran — tidak pernah mengembalikan foto tanpa cap bila capnya bisa dibuat. */
export async function r2GetFotoBercap(r2Key: string): Promise<Buffer> {
  const { ambilBerkas } = await import("@/lib/penyimpanan/berkas");
  return ambilBerkas(await kunciFotoBercap(r2Key));
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

/**
 * Berkas ber-cap/thumbnail yang HILANG dari R2 dibuat ulang dari berkas asli
 * (R2 atau arsip dingin), DI KUNCI YANG SAMA — snapshot laporan final dan
 * kiriman yang membekukan kunci itu ikut pulih. Isi capnya dirender dari nilai
 * foto saat ini, jalur yang sama dengan baca susulan. Satu per satu: tiap foto
 * ±2 dtk, dan pekerjaan ini jarang.
 */
export async function buatUlangBerkasHilang(
  foto: { id: string; r2Key: string; thumbnailKey: string | null; hilang: ("utama" | "thumbnail")[] }[],
): Promise<{ pulih: number; gagal: { id: string; sebab: string }[] }> {
  const db = await muatDb();
  const { r2Put } = await import("@/lib/r2");
  let pulih = 0;
  const gagal: { id: string; sebab: string }[] = [];
  for (const f of foto) {
    try {
      const t = await tugasDariBasisData(f.id, false);
      if (!t) throw new Error("Foto ini tidak punya berkas asli, jadi tidak bisa dibuat ulang.");
      const { tag, hasil } = await render(t);
      if (f.hilang.includes("utama")) await r2Put(f.r2Key, hasil.main, hasil.contentType);
      if (f.hilang.includes("thumbnail") && f.thumbnailKey) {
        if (!hasil.thumb) throw new Error("Thumbnail tidak bisa dibuat dari berkas asli.");
        await r2Put(f.thumbnailKey, hasil.thumb, "image/webp");
      }
      // Metadata hanya ikut berkas utama yang benar-benar ditulis ulang.
      if (f.hilang.includes("utama"))
        await db.photo.updateMany({
          where: { id: f.id, r2Key: f.r2Key },
          data: { bytes: hasil.main.length, widthPx: hasil.width, heightPx: hasil.height, ...(await dataTag(tag)) },
        });
      pulih++;
    } catch (e) {
      gagal.push({ id: f.id, sebab: e instanceof Error ? e.message : "gagal" });
    }
  }
  return { pulih, gagal };
}
