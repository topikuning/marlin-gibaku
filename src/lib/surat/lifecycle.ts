import type { BadgeTone } from "@/components/ui";
import type {
  LetterCategory,
  LetterDirection,
  LetterParty,
  LetterStatus,
} from "@/generated/prisma/enums";
import type { WaAttachmentDecision, WaAttachmentKind, WaAttachmentStatus } from "@/generated/prisma/enums";

/**
 * Label + nada + mesin transisi untuk register surat dan antrean lampiran WA
 * (DECISIONS 432). MURNI — tanpa DB, bisa diuji unit.
 *
 * Sesuai aturan repo, status hanya berubah lewat mesin transisi di sini, dan
 * label Indonesia-nya satu sumber supaya layar, PDF, dan pesan WA tidak
 * menyebut hal yang sama dengan nama berbeda.
 */

export const ARAH_LABEL: Record<LetterDirection, string> = {
  masuk: "Surat masuk",
  keluar: "Surat keluar",
};

export const PIHAK_LABEL: Record<LetterParty, string> = {
  penyedia: "Penyedia",
  wakil_ppk: "Wakil PPK",
  ppk: "PPK",
  konsultan: "Konsultan pengawas",
  dinas: "Dinas/instansi",
  internal: "Internal",
  lainnya: "Lainnya",
};

export const KATEGORI_SURAT_LABEL: Record<LetterCategory, string> = {
  mutu: "Mutu",
  jadwal: "Jadwal",
  pembayaran: "Pembayaran",
  administrasi: "Administrasi",
  koordinasi: "Koordinasi",
  k3: "K3",
  lainnya: "Lainnya",
};

export const STATUS_SURAT_LABEL: Record<LetterStatus, string> = {
  baru: "Baru",
  perlu_jawaban: "Perlu jawaban",
  dijawab: "Sudah dijawab",
  selesai: "Selesai",
  arsip: "Arsip",
};

export const STATUS_SURAT_TONE: Record<LetterStatus, BadgeTone> = {
  baru: "info",
  perlu_jawaban: "warning",
  dijawab: "success",
  selesai: "success",
  arsip: "neutral",
};

/** Transisi status surat yang diizinkan. */
const TRANSISI: Record<LetterStatus, LetterStatus[]> = {
  baru: ["perlu_jawaban", "selesai", "arsip"],
  perlu_jawaban: ["dijawab", "selesai", "arsip"],
  dijawab: ["selesai", "perlu_jawaban", "arsip"],
  selesai: ["arsip", "perlu_jawaban"],
  arsip: ["baru"],
};

export type TransisiHasil = { ok: true; status: LetterStatus } | { ok: false; error: string };

export function transisiSurat(dari: LetterStatus, ke: LetterStatus): TransisiHasil {
  if (dari === ke) return { ok: true, status: ke };
  if (!TRANSISI[dari].includes(ke)) {
    return {
      ok: false,
      error: `Surat berstatus "${STATUS_SURAT_LABEL[dari]}" tidak bisa langsung menjadi "${STATUS_SURAT_LABEL[ke]}".`,
    };
  }
  return { ok: true, status: ke };
}

/**
 * Surat masuk yang menunggu jawaban melewati tenggatnya. MURNI — dipakai layar
 * DAN aturan EWS, supaya keduanya tidak pernah berbeda pendapat.
 */
export function terlambatDijawab(
  surat: { status: LetterStatus; needsReply: boolean; replyDueDate: Date | null },
  hariIni: Date,
): boolean {
  if (!surat.needsReply || !surat.replyDueDate) return false;
  if (surat.status === "dijawab" || surat.status === "selesai" || surat.status === "arsip") return false;
  return surat.replyDueDate.getTime() < hariIni.getTime();
}

/** Sisa hari menuju tenggat jawaban; negatif = sudah lewat. null = tanpa tenggat. */
export function sisaHariJawab(replyDueDate: Date | null, hariIni: Date): number | null {
  if (!replyDueDate) return null;
  return Math.round((replyDueDate.getTime() - hariIni.getTime()) / 86_400_000);
}

/* ── Antrean lampiran WA ─────────────────────────────────────────────────── */

export const LAMPIRAN_KIND_LABEL: Record<WaAttachmentKind, string> = {
  foto_lapangan: "Foto lapangan",
  dokumen: "Dokumen",
  surat_kandidat: "Kemungkinan surat",
  media_lain: "Media lain",
  abaikan: "Diabaikan",
};

export const LAMPIRAN_KIND_TONE: Record<WaAttachmentKind, BadgeTone> = {
  foto_lapangan: "neutral",
  dokumen: "info",
  surat_kandidat: "warning",
  media_lain: "neutral",
  abaikan: "neutral",
};

export const LAMPIRAN_STATUS_LABEL: Record<WaAttachmentStatus, string> = {
  tertangkap: "Berkas tersimpan",
  dilewati: "Tidak disimpan",
  gagal: "Gagal diunduh",
};

export const LAMPIRAN_KEPUTUSAN_LABEL: Record<WaAttachmentDecision, string> = {
  belum: "Menunggu ditetapkan",
  jadi_surat: "Ditetapkan sebagai surat",
  jadi_dokumen: "Ditetapkan sebagai dokumen",
  bukan_apa_apa: "Bukan bahan kerja",
};
