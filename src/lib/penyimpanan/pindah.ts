import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { isR2Configured, r2Delete, r2GetDenganJenis, r2List, type R2Obyek } from "@/lib/r2";
import {
  hapusDingin,
  kirimDingin,
  periksaDingin,
  setelanDingin,
  statusDingin,
  type SetelanDingin,
} from "@/lib/arsip-asli/dingin";
import { KATEGORI_DIHAPUS, kunciDinginUntuk } from "./berkas";
import { catatUkuranR2, setelanPindah } from "./setelan";

/**
 * PEMINDAHAN BERKAS R2 → ARSIP LENOVO (DECISIONS 645).
 *
 * Permintaan user 2026-10-01: *"jangan terlalu banyak storage di R2,
 * maksimalkan di disket/server lenovo, kita jaga R2 tetap di bawah 10GB"*.
 *
 * Dua aturan, satu antrean – berkas TERTUA lebih dulu:
 *   1. UMUR: yang lebih tua dari `umurHari` dipindah, berapa pun isi R2.
 *   2. BATAS: selama R2 masih di atas 90% batas, yang lebih muda ikut dipindah
 *      (tetap tertua dulu, tidak pernah yang berumur < 3 hari). Sisa 10%
 *      adalah ruang untuk unggahan baru di antara dua putaran.
 *
 * Yang dipindah HANYA isi yang dirujuk kolom ini: foto ber-cap, dokumen,
 * surat, lampiran WA, lampiran kegiatan. Thumbnail, logo, kop, stempel, dan
 * tanda tangan tetap di R2 – kecil, dan dipakai di setiap halaman dan PDF.
 * Berkas ASLI foto punya pemindahnya sendiri (`arsip-asli/`).
 *
 * Urutan satu berkas – sama ketatnya dengan arsip berkas asli:
 *   baca R2 → kirim → BACA ULANG di Lenovo (ukuran + sidik jari) → catat
 *   (sejak detik ini dibaca dari Lenovo) → hapus R2 → catat.
 * Mati di tengah jalan aman: kirim ulang dikenali lewat HEAD, hapus R2 diulang.
 */

const PARALEL = 3;
const ANGGARAN_BAWAAN_MS = 4 * 60_000;
const ANGGARAN_LATAR_MS = 55 * 60_000;
/** Berkas semuda ini tidak pernah dipindah – sedang dikerjakan (cap latar, revisi). */
const UMUR_MINIMUM_HARI = 3;
/** Di bawah batas objek gateway (32 MiB). Yang lebih besar tetap di R2. */
const MAKS_BYTES = 30 * 1024 * 1024;
const BATAS_GAGAL = 5;
const JEDA_PULIH_JAM = 6;
const BATAS_GAGAL_PUTARAN = 20;
/** Sisa ruang Lenovo minimum sebelum pemindahan berhenti sendiri. */
export const CADANGAN_DISK_LENOVO = 20 * 1024 ** 3;
/** Satuan batas mengikuti tagihan Cloudflare (GB desimal) – lebih ketat daripada GiB. */
const GB = 1_000_000_000;

export type KategoriBerkas = "foto" | "dokumen" | "surat" | "lampiran-wa" | "lampiran-kegiatan";

export const LABEL_KATEGORI: Record<string, string> = {
  foto: "Foto",
  dokumen: "Dokumen",
  surat: "Surat",
  "lampiran-wa": "Lampiran WA",
  "lampiran-kegiatan": "Lampiran kegiatan",
  [KATEGORI_DIHAPUS]: "Sudah dihapus, menunggu dibersihkan dari Lenovo",
};

export type HasilPindah = {
  dijalankan: boolean;
  alasan: "mati" | "belum-dikonfigurasi" | "r2-mati" | "lenovo-hampir-penuh" | "jalan";
  r2AwalBytes: number;
  r2AkhirBytes: number;
  dipindah: number;
  bytesDipindah: number;
  gagal: number;
  galat: string[];
};

type Calon = { kunci: string; kategori: KategoriBerkas; bytes: number; diubah: Date };

/** Kunci yang boleh dipindah, dari tabel pemiliknya. Daftar putih: yang lupa disebut tetap di R2 (aman). */
async function kunciBolehPindah(): Promise<Map<string, KategoriBerkas>> {
  const [foto, dok, surat, wa, keg] = await Promise.all([
    db.photo.findMany({ where: { stampPending: false }, select: { r2Key: true, originalKey: true } }),
    db.document.findMany({ select: { r2Key: true } }),
    db.letter.findMany({ where: { fileR2Key: { not: null } }, select: { fileR2Key: true } }),
    db.waAttachment.findMany({ where: { r2Key: { not: null } }, select: { r2Key: true } }),
    db.fieldActivityAttachment.findMany({ select: { r2Key: true } }),
  ]);
  const m = new Map<string, KategoriBerkas>();
  // Foto yang r2Key-nya = berkas asli (cap tidak pernah jadi) diurus arsip-asli.
  for (const f of foto) if (f.r2Key !== f.originalKey) m.set(f.r2Key, "foto");
  for (const d of dok) m.set(d.r2Key, "dokumen");
  for (const s of surat) if (s.fileR2Key) m.set(s.fileR2Key, "surat");
  for (const w of wa) if (w.r2Key && !m.has(w.r2Key)) m.set(w.r2Key, "lampiran-wa");
  for (const k of keg) m.set(k.r2Key, "lampiran-kegiatan");
  return m;
}

async function masihDirujuk(kunci: string): Promise<boolean> {
  const n = await Promise.all([
    db.photo.count({ where: { r2Key: kunci } }),
    db.document.count({ where: { r2Key: kunci } }),
    db.letter.count({ where: { fileR2Key: kunci } }),
    db.waAttachment.count({ where: { r2Key: kunci } }),
    db.fieldActivityAttachment.count({ where: { r2Key: kunci } }),
  ]);
  return n.some((x) => x > 0);
}

/**
 * Calon pindah, TERTUA dulu. Yang sudah di Lenovo, terlalu muda, terlalu
 * besar, atau baru saja gagal berkali-kali tidak ikut.
 */
async function susunCalon(obyek: R2Obyek[], sekarang: number): Promise<Calon[]> {
  const boleh = await kunciBolehPindah();
  const batasPulih = new Date(sekarang - JEDA_PULIH_JAM * 3600_000);
  const tertahan = new Set(
    (
      await db.berkasPindah.findMany({
        where: {
          OR: [
            { dipindahAt: { not: null } },
            { percobaan: { gte: BATAS_GAGAL }, dicobaAt: { gte: batasPulih } },
          ],
        },
        select: { kunci: true },
      })
    ).map((r) => r.kunci),
  );
  const minimum = sekarang - UMUR_MINIMUM_HARI * 86_400_000;
  const out: Calon[] = [];
  for (const o of obyek) {
    const kategori = boleh.get(o.key);
    if (!kategori || tertahan.has(o.key) || !o.diubah) continue;
    if (o.diubah.getTime() > minimum || o.bytes > MAKS_BYTES || o.bytes === 0) continue;
    out.push({ kunci: o.key, kategori, bytes: o.bytes, diubah: o.diubah });
  }
  return out.sort((a, b) => a.diubah.getTime() - b.diubah.getTime());
}

/** Satu berkas. `false` = tidak dipindah karena sudah tidak dirujuk siapa pun. */
async function pindahkanSatu(s: SetelanDingin, c: Calon): Promise<boolean> {
  const kd = kunciDinginUntuk(c.kunci, c.diubah);
  const { isi, jenis } = await r2GetDenganJenis(c.kunci);
  const sha = createHash("sha256").update(isi).digest("hex");

  const sudah = await periksaDingin(s, kd);
  if (sudah.ada) {
    // Putaran sebelumnya mengirim lalu mati sebelum mencatat – wajar. Tapi isi
    // LAIN dengan nama sama tidak boleh dianggap berkas ini.
    if (sudah.sha256 && sudah.sha256 !== sha) throw new Error("di Lenovo ada berkas lain dengan nama sama – tidak ditimpa");
  } else {
    await kirimDingin(s, kd, isi);
  }
  // Yang menentukan aman adalah yang BISA DIBACA KEMBALI, bukan balasan PUT.
  const cek = await periksaDingin(s, kd);
  if (!cek.ada) throw new Error("sudah dikirim tapi tidak terbaca kembali di Lenovo");
  if (cek.sha256 && cek.sha256 !== sha) throw new Error("sidik jari di Lenovo tidak cocok");
  if (cek.bytes != null && cek.bytes !== isi.length) throw new Error("ukuran di Lenovo tidak cocok");

  // Pemiliknya bisa menghapus berkas selama pengiriman berjalan.
  if (!(await masihDirujuk(c.kunci))) {
    await hapusDingin(s, kd, sha).catch(() => null);
    return false;
  }

  const sekarang = new Date();
  const data = {
    kunciDingin: kd,
    kategori: c.kategori,
    bytes: isi.length,
    sha256: sha,
    contentType: jenis,
    dipindahAt: sekarang,
    r2DibuangAt: null,
    percobaan: 0,
    galat: null,
    dicobaAt: sekarang,
  };
  await db.berkasPindah.upsert({ where: { kunci: c.kunci }, create: { kunci: c.kunci, ...data }, update: data });
  // Sejak baris di atas tercatat, pembaca mengambil dari Lenovo – baru R2 dibuang.
  await r2Delete(c.kunci);
  await db.berkasPindah.update({ where: { kunci: c.kunci }, data: { r2DibuangAt: new Date() } });
  return true;
}

async function catatGagal(c: Calon, pesan: string): Promise<void> {
  const data = { galat: pesan.slice(0, 500), dicobaAt: new Date() };
  await db.berkasPindah.upsert({
    where: { kunci: c.kunci },
    create: { kunci: c.kunci, kunciDingin: kunciDinginUntuk(c.kunci, c.diubah), kategori: c.kategori, bytes: c.bytes, percobaan: 1, ...data },
    update: { percobaan: { increment: 1 }, ...data },
  });
}

/**
 * Pekerjaan yang tertinggal: salinan R2 yang belum terbuang (putaran mati
 * sesudah mencatat), dan berkas yang dihapus pemiliknya tapi salinan
 * Lenovonya gagal ikut terhapus.
 */
async function bereskanTertinggal(s: SetelanDingin, galat: string[]): Promise<void> {
  const belumDibuang = await db.berkasPindah.findMany({
    where: { dipindahAt: { not: null }, r2DibuangAt: null, kategori: { not: KATEGORI_DIHAPUS } },
    select: { kunci: true, kunciDingin: true, sha256: true },
    take: 200,
  });
  for (const r of belumDibuang) {
    try {
      const cek = await periksaDingin(s, r.kunciDingin);
      if (!cek.ada || (cek.sha256 && r.sha256 && cek.sha256 !== r.sha256)) {
        // Tidak ada (lagi) di Lenovo: catatannya dibatalkan, baca kembali dari R2.
        await db.berkasPindah.update({
          where: { kunci: r.kunci },
          data: { dipindahAt: null, galat: "tidak ditemukan di Lenovo – dibaca dari R2 lagi", dicobaAt: new Date() },
        });
        continue;
      }
      await r2Delete(r.kunci);
      await db.berkasPindah.update({ where: { kunci: r.kunci }, data: { r2DibuangAt: new Date() } });
    } catch (err) {
      galat.push(`buang-r2 ${r.kunci.slice(-24)}: ${err instanceof Error ? err.message : "gagal"}`);
    }
  }
  const dihapus = await db.berkasPindah.findMany({
    where: { kategori: KATEGORI_DIHAPUS },
    select: { kunci: true, kunciDingin: true, sha256: true },
    take: 200,
  });
  for (const r of dihapus) {
    try {
      await hapusDingin(s, r.kunciDingin, r.sha256 ?? undefined);
      await db.berkasPindah.delete({ where: { kunci: r.kunci } });
    } catch (err) {
      galat.push(`hapus-lenovo ${r.kunci.slice(-24)}: ${err instanceof Error ? err.message : "gagal"}`);
    }
  }
}

export async function jalankanPindahBerkas(opsi: { anggaranMs?: number } = {}): Promise<HasilPindah> {
  const kosong = { r2AwalBytes: 0, r2AkhirBytes: 0, dipindah: 0, bytesDipindah: 0, gagal: 0, galat: [] as string[] };
  const setelan = await setelanPindah();
  if (!setelan.aktif) return { dijalankan: false, alasan: "mati", ...kosong };
  const s = setelanDingin();
  if (!s) return { dijalankan: false, alasan: "belum-dikonfigurasi", ...kosong };
  if (!isR2Configured()) return { dijalankan: false, alasan: "r2-mati", ...kosong };

  const galat: string[] = [];
  const st = await statusDingin(s).catch(() => null);
  if (st?.freeBytes != null && st.freeBytes < CADANGAN_DISK_LENOVO) {
    return { dijalankan: false, alasan: "lenovo-hampir-penuh", ...kosong };
  }

  await bereskanTertinggal(s, galat);

  const sekarang = Date.now();
  const tenggat = sekarang + (opsi.anggaranMs ?? ANGGARAN_BAWAAN_MS);
  const { obyek } = await r2List();
  const r2AwalBytes = obyek.reduce((t, o) => t + o.bytes, 0);
  await catatUkuranR2({ bytes: r2AwalBytes, obyek: obyek.length, pada: new Date().toISOString() });

  const sasaran = setelan.batasGb * GB * 0.9;
  const batasUmur = sekarang - setelan.umurHari * 86_400_000;
  const calon = await susunCalon(obyek, sekarang);

  let total = r2AwalBytes;
  let dipindah = 0;
  let bytesDipindah = 0;
  let gagal = 0;
  for (let i = 0; i < calon.length && Date.now() < tenggat && gagal < BATAS_GAGAL_PUTARAN; i += PARALEL) {
    // Tertua dulu: begitu yang berikutnya tidak lagi wajib karena umur, ia
    // hanya dipindah demi batas – dan berhenti begitu R2 sudah di bawahnya.
    const tarikan = calon
      .slice(i, i + PARALEL)
      .filter((c) => c.diubah.getTime() <= batasUmur || total > sasaran);
    if (tarikan.length === 0) break;
    const hasil = await Promise.all(
      tarikan.map(async (c) => {
        try {
          return { c, ok: await pindahkanSatu(s, c) };
        } catch (err) {
          const pesan = err instanceof Error ? err.message : "gagal";
          galat.push(`${c.kunci.slice(-32)}: ${pesan}`);
          await catatGagal(c, pesan).catch(() => null);
          return { c, ok: null };
        }
      }),
    );
    let gagalTarikan = 0;
    for (const h of hasil) {
      if (h.ok === null) {
        gagal++;
        gagalTarikan++;
      } else if (h.ok) {
        dipindah++;
        bytesDipindah += h.c.bytes;
        total -= h.c.bytes;
      }
    }
    if (gagalTarikan === tarikan.length) {
      galat.push("pemindahan dihentikan: semua berkas dalam satu kelompok gagal dikirim. Server Lenovo atau jaringannya bermasalah.");
      break;
    }
  }
  await catatUkuranR2({ bytes: total, obyek: obyek.length - dipindah, pada: new Date().toISOString() });
  return { dijalankan: true, alasan: "jalan", r2AwalBytes, r2AkhirBytes: total, dipindah, bytesDipindah, gagal, galat };
}

/* ── Putaran latar ───────────────────────────────────────────────────────── */

let latar: { mulai: Date } | null = null;
let hasilLatarTerakhir: (HasilPindah & { selesai: Date }) | null = null;

export function keadaanPindahLatar() {
  return { berjalanSejak: latar?.mulai ?? null, terakhir: hasilLatarTerakhir };
}

/** Mulai di latar lalu langsung pulang – pola yang sama dengan arsip berkas asli (DECISIONS 615). */
export async function mulaiPindahLatar(): Promise<
  { dimulai: boolean; berjalanSejak: Date } | { dimulai: false; alasan: HasilPindah["alasan"] }
> {
  if (latar) return { dimulai: false, berjalanSejak: latar.mulai };
  if (!(await setelanPindah()).aktif) return { dimulai: false, alasan: "mati" };
  if (!setelanDingin()) return { dimulai: false, alasan: "belum-dikonfigurasi" };
  if (!isR2Configured()) return { dimulai: false, alasan: "r2-mati" };
  const mulai = new Date();
  latar = { mulai };
  void (async () => {
    try {
      hasilLatarTerakhir = { ...(await jalankanPindahBerkas({ anggaranMs: ANGGARAN_LATAR_MS })), selesai: new Date() };
    } catch (err) {
      console.error("[pindah-berkas] putaran latar gagal:", err);
      hasilLatarTerakhir = {
        dijalankan: true,
        alasan: "jalan",
        r2AwalBytes: 0,
        r2AkhirBytes: 0,
        dipindah: 0,
        bytesDipindah: 0,
        gagal: 1,
        galat: [err instanceof Error ? err.message : "pemindahan gagal berjalan"],
        selesai: new Date(),
      };
    } finally {
      latar = null;
    }
  })();
  return { dimulai: true, berjalanSejak: mulai };
}

/* ── Ringkasan untuk layar ───────────────────────────────────────────────── */

export type RingkasPindah = {
  perKategori: { kategori: string; berkas: number; bytes: number }[];
  gagalTerus: number;
  galatTerakhir: string | null;
  terakhirDipindah: Date | null;
};

export async function ringkasPindah(): Promise<RingkasPindah> {
  const [kelompok, gagalTerus, galat, terakhir] = await Promise.all([
    db.berkasPindah.groupBy({
      by: ["kategori"],
      where: { dipindahAt: { not: null } },
      _count: { _all: true },
      _sum: { bytes: true },
    }),
    db.berkasPindah.count({ where: { dipindahAt: null, percobaan: { gte: BATAS_GAGAL } } }),
    db.berkasPindah.findFirst({ where: { galat: { not: null } }, orderBy: { dicobaAt: "desc" }, select: { galat: true } }),
    db.berkasPindah.findFirst({
      where: { dipindahAt: { not: null } },
      orderBy: { dipindahAt: "desc" },
      select: { dipindahAt: true },
    }),
  ]);
  return {
    perKategori: kelompok
      .map((k) => ({ kategori: k.kategori, berkas: k._count._all, bytes: k._sum.bytes ?? 0 }))
      .sort((a, b) => b.bytes - a.bytes),
    gagalTerus,
    galatTerakhir: galat?.galat ?? null,
    terakhirDipindah: terakhir?.dipindahAt ?? null,
  };
}
