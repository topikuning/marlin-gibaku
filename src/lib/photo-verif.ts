import type { PhotoVerification } from "@/generated/prisma/enums";

/** Label & tone status verifikasi foto — dipakai server & client. */
export type PhotoTone = "success" | "warning" | "danger" | "info" | "neutral";

export const PHOTO_VERIF_LABEL: Record<PhotoVerification, string> = {
  passed: "Terverifikasi",
  pending: "Menunggu Review",
  flagged_gps: "Tanpa GPS",
  flagged_time: "Waktu Ditandai",
  flagged_duplicate: "Duplikat",
  rejected: "Ditolak",
};

export const PHOTO_VERIF_TONE: Record<PhotoVerification, PhotoTone> = {
  passed: "success",
  pending: "info",
  flagged_gps: "warning",
  flagged_time: "warning",
  flagged_duplicate: "warning",
  rejected: "danger",
};

export const ALL_VERIFICATIONS: PhotoVerification[] = [
  "passed",
  "pending",
  "flagged_gps",
  "flagged_time",
  "flagged_duplicate",
  "rejected",
];
