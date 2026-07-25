import type { FieldActivityStatus } from "@/generated/prisma/enums";
import type { BadgeTone } from "@/components/ui";

// Jenis kegiatan lapangan kini MASTER DATA (tabel FieldActivityKind) — lihat
// src/lib/field-activity/kinds.ts. Label/urutan tidak lagi hardcode di sini.

export const FIELD_ACTIVITY_STATUS_LABEL: Record<FieldActivityStatus, string> = {
  draft: "Draft",
  final: "Final",
};

export const FIELD_ACTIVITY_STATUS_TONE: Record<FieldActivityStatus, BadgeTone> = {
  draft: "warning",
  final: "success",
};
