import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { isR2Configured, r2Delete, r2GetBuffer } from "@/lib/r2";
import { ambilDingin, kirimDingin, periksaDingin, setelanDingin, type SetelanDingin } from "./dingin";
import { arsipAktif, tenggangHari } from "./setelan";

/**
 * PEMINDAHAN BERKAS ASLI KE ARSIP DINGIN — satu putaran.
 *
 * ### Antreannya kueri, bukan tabel
 *
 * Rancangan awal membuat tabel pekerjaan sendiri lengkap dengan state
 * `railway_pending`, `local_railway_cleanup`, `local`, `r2_overflow`, dan
 * `local_r2_cleanup`. Tidak satu pun dibutuhkan di sini: baris `Photo` SUDAH
 * menyatakan pekerjaannya. Yang menunggu dikirim adalah baris yang punya
 * `originalKey` tapi belum punya `originalArchivedAt`; yang menunggu dibuang
 * dari R2 adalah baris yang sudah lewat masa tenggang. Dua kueri, dua indeks
 * parsial, selesai.
 *
 * Dua state "pembersihan" di rancangan itu ada untuk menandai pekerjaan yang
 * mati di tengah jalan. Di sini tidak perlu, karena tiap langkahnya boleh
 * diulang dan hasilnya sama:
 *
 *   kirim → mati sebelum DB   → putaran berikutnya HEAD, sudah ada, lanjut
 *   hapus R2 → mati sebelum DB → putaran berikutnya hapus lagi (404 = sukses)
 *
 * ### Kenapa tidak ada kunci antar-proses
 *
 * Rancangan awal memakai berkas kunci di disk. Itu hanya benar selama servicenya
 * satu replika — asumsi yang tidak tertulis di mana pun dan akan diam-diam
 * salah begitu ada dua. Yang dipakai di sini penanda waktu di baris itu sendiri
 * (`originalArchiveError` + `tries`) dan batas jumlah per putaran, pola yang
 * sama dengan antrean Drive: dua putaran yang bertabrakan paling buruk
 * mengerjakan berkas yang sama dua kali, dan karena tiap langkahnya boleh
 * diulang, hasilnya tetap benar.
 */

/** Sedikit per putaran: uplink rumah, bukan pusat data. Cron yang mengatur seringnya. */
const PER_PUTARAN = 3;

/**
 * Batas percobaan sebelum sebuah berkas dilewati.
 *
 * Ada supaya SATU berkas bermasalah — terhapus dari R2, korup, kuncinya aneh —
 * tidak menyumbat antrean selamanya. Yang melewati batas berhenti dicoba dan
 * muncul di layar dengan sebabnya, menunggu diperiksa orang.
 */
const BATAS_GAGAL = 5;

export type HasilPutaran = {
  dijalankan: boolean;
  alasan: "mati" | "belum-dikonfigurasi" | "r2-mati" | "jalan";
  dikirim: number;
  dibuangDariR2: number;
  gagal: number;
  galat: string[];
};

export async function jalankanArsipAsli(): Promise<HasilPutaran> {
  const kosong = { dikirim: 0, dibuangDariR2: 0, gagal: 0, galat: [] as string[] };
  if (!(await arsipAktif())) return { dijalankan: false, alasan: "mati", ...kosong };
  const setelan = setelanDingin();
  if (!setelan) return { dijalankan: false, alasan: "belum-dikonfigurasi", ...kosong };
  if (!isR2Configured()) return { dijalankan: false, alasan: "r2-mati", ...kosong };

  const galat: string[] = [];
  let dikirim = 0;
  let gagal = 0;

  const menunggu = await db.photo.findMany({
    where: {
      originalKey: { not: null },
      originalArchivedAt: null,
      originalPurgedAt: null,
      originalArchiveTries: { lt: BATAS_GAGAL },
    },
    select: { id: true, originalKey: true, originalBytes: true, sha256: true },
    orderBy: { createdAt: "asc" },
    take: PER_PUTARAN,
  });

  for (const foto of menunggu) {
    try {
      await pindahkanSatu(setelan, foto);
      dikirim++;
    } catch (err) {
      gagal++;
      const pesan = err instanceof Error ? err.message : "gagal";
      galat.push(`${foto.id.slice(0, 8)}: ${pesan}`);
      await db.photo.update({
        where: { id: foto.id },
        data: {
          originalArchiveTries: { increment: 1 },
          originalArchiveError: pesan.slice(0, 500),
        },
      });
    }
  }

  const dibuangDariR2 = await buangSalinanR2Lewat(galat);
  return { dijalankan: true, alasan: "jalan", dikirim, dibuangDariR2, gagal, galat };
}

/**
 * Satu berkas: R2 → arsip dingin, dengan pembuktian.
 *
 * Yang TIDAK dilakukan di sini: menghapus apa pun. Penghapusan salinan R2
 * menunggu masa tenggang dan dikerjakan terpisah — supaya kalau arsip dinginnya
 * ternyata bermasalah, yang hilang belum apa-apa.
 */
async function pindahkanSatu(
  setelan: SetelanDingin,
  foto: { id: string; originalKey: string | null; originalBytes: number | null; sha256: string },
): Promise<void> {
  const kunci = foto.originalKey;
  if (!kunci) throw new Error("tidak punya kunci berkas asli");

  const sudah = await periksaDingin(setelan, kunci);
  if (sudah.ada) {
    /*
     * Sudah ada di sana. Dua kemungkinan, dan bedanya penting: putaran
     * sebelumnya berhasil mengirim lalu mati sebelum sempat mencatat (wajar,
     * lanjutkan), ATAU di sana ada berkas LAIN dengan kunci yang sama (tidak
     * wajar, berhenti). Yang membedakan cuma sidik jarinya.
     */
    if (sudah.sha256 && sudah.sha256 !== foto.sha256.toLowerCase()) {
      throw new Error("berkas di arsip berbeda isinya – JANGAN ditimpa, periksa manual");
    }
    if (sudah.bytes != null && foto.originalBytes != null && sudah.bytes !== foto.originalBytes) {
      throw new Error(`ukuran di arsip beda (${sudah.bytes} vs ${foto.originalBytes})`);
    }
    await tandaiTerarsip(foto.id);
    return;
  }

  const isi = await r2GetBuffer(kunci);
  const sha = createHash("sha256").update(isi).digest("hex");
  /*
   * Sidik jari dicocokkan SEBELUM dikirim. `Photo.sha256` adalah sidik jari
   * berkas ASLI saat diunggah, jadi kalau tidak cocok berarti yang ada di R2
   * bukan lagi berkas yang tercatat — dan memindahkan berkas yang salah ke
   * arsip permanen jauh lebih buruk daripada gagal memindahkannya.
   */
  if (sha !== foto.sha256.toLowerCase()) {
    throw new Error("isi di R2 tidak cocok dengan sidik jari yang tercatat");
  }

  await kirimDingin(setelan, kunci, isi);

  // Percaya pada balasan PUT saja tidak cukup: yang menentukan aman-tidaknya
  // adalah apa yang BISA DIBACA KEMBALI, bukan apa yang katanya sudah ditulis.
  const cek = await periksaDingin(setelan, kunci);
  if (!cek.ada) throw new Error("sudah dikirim tapi tidak terbaca kembali di arsip");
  if (cek.sha256 && cek.sha256 !== sha) throw new Error("sidik jari di arsip tidak cocok setelah dikirim");
  if (cek.bytes != null && cek.bytes !== isi.length) throw new Error("ukuran di arsip tidak cocok setelah dikirim");

  await tandaiTerarsip(foto.id);
}

async function tandaiTerarsip(id: string): Promise<void> {
  await db.photo.update({
    where: { id },
    data: { originalArchivedAt: new Date(), originalArchiveError: null, originalArchiveTries: 0 },
  });
}

/**
 * Buang salinan R2 yang masa tenggangnya sudah lewat.
 *
 * Dipisah dari pengiriman dengan sengaja: pengiriman menambah salinan,
 * penghapusan mengurangi. Keduanya tidak boleh terjadi dalam satu tarikan napas
 * — kalau digabung, satu kesalahan di tengah bisa membuat berkas hilang dari
 * kedua tempat sekaligus.
 */
async function buangSalinanR2Lewat(galat: string[]): Promise<number> {
  const hari = await tenggangHari();
  const batas = new Date(Date.now() - hari * 86_400_000);
  const siap = await db.photo.findMany({
    where: {
      originalArchivedAt: { not: null, lte: batas },
      originalR2PurgedAt: null,
      originalKey: { not: null },
    },
    select: { id: true, originalKey: true },
    orderBy: { originalArchivedAt: "asc" },
    take: PER_PUTARAN * 4, // menghapus jauh lebih murah daripada mengirim
  });

  let n = 0;
  for (const f of siap) {
    try {
      await r2Delete(f.originalKey!);
      await db.photo.update({ where: { id: f.id }, data: { originalR2PurgedAt: new Date() } });
      n++;
    } catch (err) {
      galat.push(`buang-r2 ${f.id.slice(0, 8)}: ${err instanceof Error ? err.message : "gagal"}`);
    }
  }
  return n;
}

/**
 * Baca berkas asli dari mana pun ia berada sekarang.
 *
 * Dipakai perbaikan cap, putar foto, dan unduh berkas asli. Selama masa
 * tenggang berkasnya ada di KEDUA tempat; arsip dingin dicoba dulu supaya
 * jalurnya benar-benar teruji sejak hari pertama, bukan baru ketahuan rusak
 * saat salinan R2-nya sudah dibuang.
 */
export async function bacaBerkasAsli(foto: {
  originalKey: string | null;
  originalR2PurgedAt: Date | null;
}): Promise<Buffer> {
  if (!foto.originalKey) throw new Error("Foto ini tidak punya arsip berkas asli.");
  const setelan = setelanDingin();
  const masihDiR2 = foto.originalR2PurgedAt == null;

  if (setelan) {
    try {
      return await ambilDingin(setelan, foto.originalKey);
    } catch (err) {
      if (!masihDiR2) {
        throw new Error(
          `Arsip berkas asli sedang tidak bisa dihubungi: ${err instanceof Error ? err.message : "gagal"}`,
        );
      }
      // Masih ada salinan R2 — pakai itu, jangan menggagalkan pekerjaan orang.
    }
  }
  if (!masihDiR2) throw new Error("Arsip berkas asli tidak dikonfigurasi, sedangkan salinan R2 sudah dibuang.");
  return await r2GetBuffer(foto.originalKey);
}

export type RingkasArsip = {
  menunggu: number;
  terarsip: number;
  masaTenggang: number;
  gagalTerus: number;
  bytesMenunggu: number;
  galatTerakhir: string | null;
  terakhirBerhasil: Date | null;
};

/** Angka untuk layar Sistem. Murni hitungan; tidak menyentuh arsip dingin. */
export async function ringkasArsipAsli(): Promise<RingkasArsip> {
  const [menunggu, terarsip, masaTenggang, gagalTerus, agregat, terakhir, galat] = await Promise.all([
    db.photo.count({ where: { originalKey: { not: null }, originalArchivedAt: null, originalPurgedAt: null } }),
    db.photo.count({ where: { originalR2PurgedAt: { not: null } } }),
    db.photo.count({ where: { originalArchivedAt: { not: null }, originalR2PurgedAt: null } }),
    db.photo.count({ where: { originalArchiveTries: { gte: BATAS_GAGAL }, originalArchivedAt: null } }),
    db.photo.aggregate({
      _sum: { originalBytes: true },
      where: { originalKey: { not: null }, originalArchivedAt: null, originalPurgedAt: null },
    }),
    db.photo.findFirst({
      where: { originalArchivedAt: { not: null } },
      orderBy: { originalArchivedAt: "desc" },
      select: { originalArchivedAt: true },
    }),
    db.photo.findFirst({
      where: { originalArchiveError: { not: null } },
      orderBy: { id: "desc" },
      select: { originalArchiveError: true },
    }),
  ]);
  return {
    menunggu,
    terarsip,
    masaTenggang,
    gagalTerus,
    bytesMenunggu: agregat._sum.originalBytes ?? 0,
    galatTerakhir: galat?.originalArchiveError ?? null,
    terakhirBerhasil: terakhir?.originalArchivedAt ?? null,
  };
}
