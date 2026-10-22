import type { DailyReportStatus, UserRole } from "@/generated/prisma/enums";
import { EDITABLE_STATUSES } from "./constants";

/**
 * FOTO SUSULAN (DECISIONS 696) – aturan murni, satu tempat.
 *
 * Permintaan user 2026-10-22: item yang memang belum diisi foto tetap bisa
 * diberi foto walau laporannya sudah final. Ini membalik SEBAGIAN aturan
 * 28 Juli ("begitu dikirim, foto sudah jadi dasar verifikasi"), dan sempitnya
 * disengaja:
 *
 * - hanya item yang BELUM PUNYA FOTO sama sekali – foto bukti yang sudah
 *   diperiksa tidak bisa ditambah, ditimpa, atau dikurangi;
 * - hanya laporan yang sudah dikirim (dikirim, disetujui, final) – selama
 *   draft/perlu koreksi foto sudah bisa ditambah lewat jalur biasa;
 * - volume, catatan, dan progres tidak tersentuh;
 * - fotonya ditandai susulan (`Photo.addedAfterSubmitAt`) supaya pemeriksa
 *   tahu bukti itu masuk sesudah laporannya dikirim.
 */
export const STATUS_FOTO_SUSULAN: DailyReportStatus[] = ["dikirim", "disetujui", "final"];

export type IzinFoto = { boleh: true; susulan: boolean } | { boleh: false; pesan: string };

/** Boleh menambah foto ke SATU item laporan? `jumlahFoto` = foto item itu sekarang. */
export function izinTambahFotoItem(status: DailyReportStatus, jumlahFoto: number): IzinFoto {
  if (EDITABLE_STATUSES.includes(status)) return { boleh: true, susulan: false };
  if (!STATUS_FOTO_SUSULAN.includes(status)) {
    return { boleh: false, pesan: "Foto tidak bisa ditambah ke laporan ini." };
  }
  if (jumlahFoto > 0) {
    return {
      boleh: false,
      pesan:
        "Laporan sudah dikirim dan pekerjaan ini sudah punya foto. Foto susulan hanya untuk pekerjaan yang belum punya foto sama sekali.",
    };
  }
  return { boleh: true, susulan: true };
}

/** Peran yang boleh menghapus foto milik orang lain – sama dengan hapus foto biasa. */
export const PERAN_BOLEH_HAPUS_FOTO_ORANG_LAIN: UserRole[] = ["site_manager", "super_admin"];

/**
 * Boleh menghapus SATU foto laporan?
 *
 * Selama laporan masih bisa disunting: aturan lama. Sesudah dikirim: hanya
 * foto SUSULAN – foto bukti asli tetap terkunci. Siapa-nya sama untuk
 * keduanya: pengunggah foto itu sendiri, Site Manager, atau Super Admin.
 */
export function izinHapusFotoLaporan(input: {
  status: DailyReportStatus;
  susulan: boolean;
  pengunggahId: string | null;
  user: { id: string; role: UserRole };
}): { boleh: true } | { boleh: false; pesan: string } {
  const jendela =
    EDITABLE_STATUSES.includes(input.status) || (input.susulan && STATUS_FOTO_SUSULAN.includes(input.status));
  if (!jendela) {
    return {
      boleh: false,
      pesan:
        "Foto hanya bisa dihapus saat laporan berstatus Draft atau Perlu Koreksi. Sesudah laporan dikirim, yang bisa dihapus hanya foto susulan.",
    };
  }
  const miliknya = input.pengunggahId !== null && input.pengunggahId === input.user.id;
  if (!miliknya && !PERAN_BOLEH_HAPUS_FOTO_ORANG_LAIN.includes(input.user.role)) {
    return { boleh: false, pesan: "Hanya pengunggah foto, Site Manager, atau Super Admin yang bisa menghapus foto ini." };
  }
  return { boleh: true };
}
