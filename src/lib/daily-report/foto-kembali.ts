import type { DailyReportStatus, UserRole } from "@/generated/prisma/enums";
import { EDITABLE_STATUSES } from "./constants";
import { PERAN_BOLEH_HAPUS_FOTO_ORANG_LAIN } from "./foto-susulan";

/**
 * KEMBALIKAN FOTO LAPORAN KE FOTO CEPAT – aturan murni (DECISIONS 791).
 *
 * Pertanyaan user 2026-11-26: *"bagaimana mengembalikan foto yang digunakan
 * pekerjaan diluar rab atau yang volume 0 untuk dikembalikan ke foto cepat?
 * saat ini sepertinya kamu hanya set super admin yang bisa … padahal
 * pekerjaan tidak di rab"*.
 *
 * Dulu tombolnya hanya ada untuk foto TANPA pekerjaan di laporan Draft/Perlu
 * Koreksi. Begitu laporan dikirim, jalan satu-satunya adalah super admin
 * membuka kunci laporan final. Padahal foto di baris bervolume 0 atau di
 * catatan di luar RAB tidak menopang angka resmi apa pun.
 *
 * Batasnya satu: foto yang menopang angka resmi tetap menempel. Sesudah
 * laporan dikirim, foto pekerjaan bervolume adalah bukti yang sudah diperiksa
 * (DECISIONS 696). Foto catatan luar RAB yang sudah DIPADANKAN kini menjadi
 * bukti baris RAB-nya. Foto yang ditautkan pemeriksa ke temuan/inspeksi juga
 * tetap (426).
 *
 * Siapa: sama dengan hapus foto – pengunggahnya, Site Manager, Super Admin.
 */

export type AsalFotoLaporan =
  | { jenis: "yatim" }
  | { jenis: "item"; volume: number }
  | { jenis: "luar_rab"; status: "tercatat" | "dipadankan" | "dibatalkan"; fotoLain: number };

export type IzinKembaliFoto =
  | {
      boleh: true;
      /**
       * Foto TERAKHIR catatan luar RAB yang masih menunggu: catatan tanpa foto
       * tidak sah (foto wajib), jadi catatannya dibatalkan – bisa diaktifkan
       * lagi Site Manager, isinya tidak hilang.
       */
      batalkanCatatan: boolean;
    }
  | { boleh: false; pesan: string };

const EPS = 0.0005;

export function izinKembalikanFoto(i: {
  asal: AsalFotoLaporan;
  status: DailyReportStatus;
  pengunggahId: string | null;
  user: { id: string; role: UserRole };
  /** Foto ini ditautkan pemeriksa ke temuan atau inspeksi. */
  dipakaiBukti: boolean;
}): IzinKembaliFoto {
  const miliknya = i.pengunggahId !== null && i.pengunggahId === i.user.id;
  if (!miliknya && !PERAN_BOLEH_HAPUS_FOTO_ORANG_LAIN.includes(i.user.role)) {
    return {
      boleh: false,
      pesan: "Hanya pengunggah foto, Site Manager, atau Super Admin yang bisa mengembalikan foto ini ke Foto Cepat.",
    };
  }
  if (i.dipakaiBukti) {
    return { boleh: false, pesan: "Foto ini sudah dipakai sebagai bukti temuan atau inspeksi, jadi tetap di laporan ini." };
  }
  const bisaDiisi = EDITABLE_STATUSES.includes(i.status);
  switch (i.asal.jenis) {
    case "yatim":
      return { boleh: true, batalkanCatatan: false };
    case "item":
      if (i.asal.volume <= EPS) return { boleh: true, batalkanCatatan: false };
      // Foto pekerjaan bervolume tidak dilepas diam-diam dari buktinya
      // (keputusan 2026-08-07) – di Draft pun volumenya diubah dulu.
      return {
        boleh: false,
        pesan: bisaDiisi
          ? "Foto ini masih menempel pada pekerjaan yang bervolume. Kalau fotonya salah pekerjaan, ubah volume " +
            "pekerjaan itu jadi 0 atau hapus pekerjaannya dulu, lalu kembalikan fotonya."
          : "Foto ini masih menempel pada pekerjaan yang bervolume di laporan yang sudah dikirim, jadi tetap " +
            "menjadi buktinya. Yang bisa dikembalikan: foto pekerjaan bervolume 0, foto catatan di luar RAB, dan " +
            "foto tanpa pekerjaan.",
      };
    case "luar_rab":
      if (i.asal.status === "dipadankan") {
        return {
          boleh: false,
          pesan: "Catatan ini sudah dipadankan ke pekerjaan RAB, jadi fotonya kini bukti pekerjaan itu dan tetap menempel.",
        };
      }
      return { boleh: true, batalkanCatatan: i.asal.status === "tercatat" && i.asal.fotoLain === 0 };
  }
}
