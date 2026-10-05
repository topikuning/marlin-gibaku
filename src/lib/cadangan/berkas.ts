import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { bacaBerkasAsli } from "@/lib/arsip-asli/antrean";
import { ambilBerkas } from "@/lib/penyimpanan/berkas";
import { CadanganError } from "./akun";
import { namaDiDrive } from "./aturan";
import { batasLaju, cariDiFolder, folderAkar, hapusDiDrive, pastikanFolder, unggahResumable } from "./drive";

/**
 * CADANGAN BERKAS KE GOOGLE DRIVE (DECISIONS 650).
 *
 * Yang disalin: berkas ASLI foto, foto ber-cap, dokumen, surat, lampiran WA,
 * lampiran kegiatan – dari mana pun isinya sekarang (R2 atau Lenovo), lewat
 * pintu baca yang sama dengan seluruh MARLIN. Thumbnail, logo, kop, stempel,
 * dan tanda tangan TIDAK: kecil, tetap di R2, dan thumbnail bisa dibuat ulang.
 *
 * Urutan: berkas yang tinggal SATU salinan lebih dulu (sudah dibuang dari R2,
 * hanya di Lenovo) – kalau disk Lenovo rusak, merekalah yang hilang. Lalu
 * sisanya, tertua dulu.
 *
 * Satu berkas = baca → md5 → unggah → cocokkan md5 dari Google → catat.
 * Salinan di Drive TIDAK pernah dihapus otomatis, juga saat berkasnya dihapus
 * di MARLIN: cadangan yang ikut terhapus bukan cadangan.
 */

export type KategoriCadangan = "foto-asli" | "foto" | "dokumen" | "surat" | "lampiran-wa" | "lampiran-kegiatan";

export const LABEL_KATEGORI_CADANGAN: Record<KategoriCadangan, string> = {
  "foto-asli": "Foto asli",
  foto: "Foto ber-cap",
  dokumen: "Dokumen",
  surat: "Surat",
  "lampiran-wa": "Lampiran WA",
  "lampiran-kegiatan": "Lampiran kegiatan",
};

type Calon = {
  kunci: string;
  kategori: KategoriCadangan;
  dibuat: Date;
  satuSalinan: boolean;
  baca: () => Promise<Buffer>;
};

const PARALEL = 3;
const BATAS_GAGAL = 5;
const JEDA_PULIH_JAM = 6;

/** Seluruh berkas yang wajib punya cadangan. Daftar putih, sama seperti pemindah berkas. */
async function inventaris(): Promise<Calon[]> {
  const [foto, dok, surat, wa, keg, pindah] = await Promise.all([
    db.photo.findMany({
      select: {
        r2Key: true,
        originalKey: true,
        originalPurgedAt: true,
        originalR2PurgedAt: true,
        stampPending: true,
        createdAt: true,
      },
    }),
    db.document.findMany({ select: { r2Key: true, uploadedAt: true } }),
    db.letter.findMany({ where: { fileR2Key: { not: null } }, select: { fileR2Key: true, createdAt: true } }),
    db.waAttachment.findMany({ where: { r2Key: { not: null } }, select: { r2Key: true, createdAt: true } }),
    db.fieldActivityAttachment.findMany({ select: { r2Key: true, createdAt: true } }),
    db.berkasPindah.findMany({
      where: { dipindahAt: { not: null }, r2DibuangAt: { not: null }, kategori: { not: "dihapus" } },
      select: { kunci: true },
    }),
  ]);
  const hanyaDiLenovo = new Set(pindah.map((p) => p.kunci));
  const out = new Map<string, Calon>();
  const tambah = (kunci: string | null, kategori: KategoriCadangan, dibuat: Date) => {
    if (!kunci || out.has(kunci)) return;
    out.set(kunci, { kunci, kategori, dibuat, satuSalinan: hanyaDiLenovo.has(kunci), baca: () => ambilBerkas(kunci) });
  };
  for (const f of foto) {
    if (f.originalKey && !f.originalPurgedAt) {
      const asli = { originalKey: f.originalKey, originalR2PurgedAt: f.originalR2PurgedAt };
      out.set(f.originalKey, {
        kunci: f.originalKey,
        kategori: "foto-asli",
        dibuat: f.createdAt,
        satuSalinan: f.originalR2PurgedAt !== null,
        baca: () => bacaBerkasAsli(asli),
      });
    }
    // Selama cap dikerjakan di latar, r2Key menunjuk berkas asli – disalin sesudah capnya jadi.
    if (!f.stampPending && f.r2Key !== f.originalKey) tambah(f.r2Key, "foto", f.createdAt);
  }
  for (const d of dok) tambah(d.r2Key, "dokumen", d.uploadedAt);
  for (const s of surat) tambah(s.fileR2Key, "surat", s.createdAt);
  for (const w of wa) tambah(w.r2Key, "lampiran-wa", w.createdAt);
  for (const k of keg) tambah(k.r2Key, "lampiran-kegiatan", k.createdAt);
  return [...out.values()];
}

/** Yang belum punya cadangan dan tidak sedang dalam masa pulih sesudah gagal berkali-kali. */
async function antrean(sekarang: number): Promise<{ calon: Calon[]; total: number }> {
  const semua = await inventaris();
  const batasPulih = new Date(sekarang - JEDA_PULIH_JAM * 3_600_000);
  const lewati = new Set(
    (
      await db.cadanganBerkas.findMany({
        where: {
          OR: [{ dicadangkanAt: { not: null } }, { percobaan: { gte: BATAS_GAGAL }, dicobaAt: { gte: batasPulih } }],
        },
        select: { kunci: true },
      })
    ).map((r) => r.kunci),
  );
  const calon = semua
    .filter((c) => !lewati.has(c.kunci))
    .sort((a, b) => Number(b.satuSalinan) - Number(a.satuSalinan) || a.dibuat.getTime() - b.dibuat.getTime());
  return { calon, total: semua.length };
}

async function folderUntuk(kategori: KategoriCadangan, dibuat: Date): Promise<string> {
  const akar = await folderAkar();
  const berkas = await pastikanFolder(akar, "berkas");
  const kat = await pastikanFolder(berkas, kategori);
  return pastikanFolder(kat, dibuat.toISOString().slice(0, 7));
}

async function cadangkanSatu(c: Calon): Promise<number> {
  const isi = await c.baca();
  const md5 = createHash("md5").update(isi).digest("hex");
  const folder = await folderUntuk(c.kategori, c.dibuat);
  const nama = namaDiDrive(c.kunci);

  // Putaran sebelumnya bisa sudah mengunggah lalu mati sebelum mencatat.
  const ada = await cariDiFolder(folder, nama);
  let id = ada.find((a) => a.md5 === md5)?.id ?? null;
  if (!id) {
    const hasil = await unggahResumable(
      { induk: folder, nama, mime: "application/octet-stream", deskripsi: c.kunci, properti: { md5 } },
      isi,
    );
    if (hasil.md5 && hasil.md5 !== md5) {
      await hapusDiDrive(hasil.id).catch(() => null);
      throw new CadanganError("isi di Google Drive tidak sama dengan yang dikirim");
    }
    id = hasil.id;
  }
  const data = {
    kategori: c.kategori,
    bytes: isi.length,
    md5,
    driveFileId: id,
    dicadangkanAt: new Date(),
    percobaan: 0,
    galat: null,
    dicobaAt: new Date(),
  };
  await db.cadanganBerkas.upsert({ where: { kunci: c.kunci }, create: { kunci: c.kunci, ...data }, update: data });
  return isi.length;
}

async function catatGagal(c: Calon, pesan: string): Promise<void> {
  const data = { galat: pesan.slice(0, 500), dicobaAt: new Date() };
  await db.cadanganBerkas.upsert({
    where: { kunci: c.kunci },
    create: { kunci: c.kunci, kategori: c.kategori, percobaan: 1, ...data },
    update: { percobaan: { increment: 1 }, ...data },
  });
}

export type HasilBerkas = { disalin: number; bytes: number; gagal: number; sisa: number; galat: string[]; berhenti: string | null };

export async function cadangkanBerkas(anggaranMs: number): Promise<HasilBerkas> {
  const tenggat = Date.now() + anggaranMs;
  const { calon } = await antrean(Date.now());
  const galat: string[] = [];
  let disalin = 0;
  let bytes = 0;
  let gagal = 0;
  let berhenti: string | null = null;
  let i = 0;
  for (; i < calon.length && Date.now() < tenggat; i += PARALEL) {
    const tarikan = calon.slice(i, i + PARALEL);
    const hasil = await Promise.all(
      tarikan.map(async (c) => {
        try {
          return { ok: true as const, n: await cadangkanSatu(c) };
        } catch (err) {
          const pesan = err instanceof Error ? err.message : "gagal";
          await catatGagal(c, pesan).catch(() => null);
          return { ok: false as const, err, pesan, c };
        }
      }),
    );
    let gagalTarikan = 0;
    for (const h of hasil) {
      if (h.ok) {
        disalin++;
        bytes += h.n;
        continue;
      }
      gagal++;
      gagalTarikan++;
      galat.push(`${h.c.kunci.slice(-32)}: ${h.pesan}`);
      if (batasLaju(h.err)) berhenti = "Google meminta MARLIN memperlambat unggahan. Dilanjutkan pada putaran berikutnya.";
      if (h.err instanceof CadanganError && /penuh/.test(h.pesan)) berhenti = h.pesan;
    }
    if (berhenti) break;
    if (gagalTarikan === tarikan.length) {
      berhenti = "Semua berkas dalam satu kelompok gagal disalin. Server Lenovo, R2, atau Google sedang bermasalah.";
      break;
    }
  }
  return { disalin, bytes, gagal, sisa: Math.max(0, calon.length - disalin), galat: galat.slice(0, 20), berhenti };
}

/* ── Ringkasan untuk layar ───────────────────────────────────────────────── */

export type RingkasBerkas = {
  total: number;
  sudah: number;
  bytesSudah: number;
  menunggu: number;
  satuSalinanMenunggu: number;
  gagalTerus: number;
  galatTerakhir: string | null;
  terakhirBerhasil: Date | null;
  perKategori: { kategori: KategoriCadangan; label: string; berkas: number; bytes: number }[];
};

export async function ringkasBerkas(): Promise<RingkasBerkas> {
  const [semua, kelompok, gagalTerus, galat, terakhir] = await Promise.all([
    inventaris(),
    db.cadanganBerkas.groupBy({
      by: ["kategori"],
      where: { dicadangkanAt: { not: null } },
      _count: { _all: true },
      _sum: { bytes: true },
    }),
    db.cadanganBerkas.count({ where: { dicadangkanAt: null, percobaan: { gte: BATAS_GAGAL } } }),
    db.cadanganBerkas.findFirst({
      where: { galat: { not: null }, dicadangkanAt: null },
      orderBy: { dicobaAt: "desc" },
      select: { galat: true },
    }),
    db.cadanganBerkas.findFirst({
      where: { dicadangkanAt: { not: null } },
      orderBy: { dicadangkanAt: "desc" },
      select: { dicadangkanAt: true },
    }),
  ]);
  const sudahSet = new Set(
    (await db.cadanganBerkas.findMany({ where: { dicadangkanAt: { not: null } }, select: { kunci: true } })).map(
      (r) => r.kunci,
    ),
  );
  const belum = semua.filter((c) => !sudahSet.has(c.kunci));
  return {
    total: semua.length,
    sudah: semua.length - belum.length,
    bytesSudah: kelompok.reduce((t, k) => t + (k._sum.bytes ?? 0), 0),
    menunggu: belum.length,
    satuSalinanMenunggu: belum.filter((c) => c.satuSalinan).length,
    gagalTerus,
    galatTerakhir: galat?.galat ?? null,
    terakhirBerhasil: terakhir?.dicadangkanAt ?? null,
    perKategori: kelompok
      .map((k) => ({
        kategori: k.kategori as KategoriCadangan,
        label: LABEL_KATEGORI_CADANGAN[k.kategori as KategoriCadangan] ?? k.kategori,
        berkas: k._count._all,
        bytes: k._sum.bytes ?? 0,
      }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}
