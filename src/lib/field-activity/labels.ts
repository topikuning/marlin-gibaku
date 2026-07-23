import type { FieldActivityStatus, FieldActivityType } from "@/generated/prisma/enums";
import type { BadgeTone } from "@/components/ui";

/** Label & urutan jenis kegiatan lapangan (untuk dropdown & tampilan). */
export const FIELD_ACTIVITY_TYPE_LABEL: Record<FieldActivityType, string> = {
  rapat_pcm: "Rapat Persiapan (PCM)",
  pengukuran_uitzet: "Pengukuran / Uitzet",
  mc0: "Mutual Check awal (MC-0)",
  sosialisasi: "Sosialisasi",
  mobilisasi: "Mobilisasi",
  dokumentasi_0: "Dokumentasi kondisi 0%",
  lainnya: "Lainnya",
};

/** Urutan tampil di dropdown (paling umum pra-pelaksanaan dulu). */
export const FIELD_ACTIVITY_TYPES: FieldActivityType[] = [
  "rapat_pcm",
  "pengukuran_uitzet",
  "mc0",
  "dokumentasi_0",
  "sosialisasi",
  "mobilisasi",
  "lainnya",
];

export const FIELD_ACTIVITY_STATUS_LABEL: Record<FieldActivityStatus, string> = {
  draft: "Draft",
  final: "Final",
};

export const FIELD_ACTIVITY_STATUS_TONE: Record<FieldActivityStatus, BadgeTone> = {
  draft: "warning",
  final: "success",
};
