import type { IssueSeverity, IssueStatus, RecoveryStatus } from "@/generated/prisma/enums";

/**
 * PRIORITAS KENDALA — MURNI, satu-satunya tempat urutannya ditulis
 * (DECISIONS 392).
 *
 * Sebelum ini rumusnya hidup di dalam `dashboard.ts`, dipakai satu layar saja.
 * Begitu kendala punya papan terpusat DAN pengingat WhatsApp, urutan yang sama
 * dibutuhkan di tiga tempat — dan tiga salinan urutan "mana yang paling
 * mendesak" adalah tiga kesempatan untuk menjawab berbeda tentang kendala yang
 * sama.
 *
 * ### Kenapa lewat tenggat menang atas tingkat
 *
 * Kendala "rendah" yang tenggatnya lewat seminggu sudah membuktikan dirinya
 * tidak tertangani; kendala "kritis" yang tenggatnya besok masih punya
 * kesempatan. Yang perlu ditagih lebih dulu adalah yang janjinya sudah lewat.
 */

export const PERINGKAT_TINGKAT: Record<IssueSeverity, number> = {
  kritis: 0,
  tinggi: 1,
  sedang: 2,
  rendah: 3,
};

export type KendalaPrioritas = {
  severity: IssueSeverity;
  status: IssueStatus;
  /** Tenggat kendala; bila kosong, tenggat aksi pemulihan terbarunya. */
  dueDate: Date | null;
  /** Status aksi pemulihan terbaru — null bila belum ada aksi sama sekali. */
  recoveryStatus: RecoveryStatus | null;
};

/**
 * Apakah kendala ini LEWAT TENGGAT pada hari `today`.
 *
 * Kendala yang sudah `selesai` tidak pernah terlambat, berapa pun tenggatnya —
 * menandainya merah setelah selesai membuat papan penuh peringatan yang tidak
 * menuntut apa pun, dan peringatan yang tidak menuntut apa pun akan berhenti
 * dibaca.
 */
export function lewatTenggat(k: KendalaPrioritas, today: Date): boolean {
  if (k.status === "selesai") return false;
  if (!k.dueDate) return false;
  return k.dueDate < today;
}

/**
 * Kendala yang belum punya PEMILIK maupun TENGGAT sama sekali.
 *
 * Bukan "terlambat" — tidak ada janji yang dilanggar. Tapi justru inilah
 * keadaan yang paling sering terjadi dan paling tidak terlihat: dicatat,
 * lalu tidak pernah ditagih siapa pun karena memang tidak ada yang ditagih.
 * Tangkapan layar user memuat empat kendala seperti ini sekaligus.
 */
export function terbengkalai(k: {
  status: IssueStatus;
  picUserId: string | null;
  picName: string | null;
  dueDate: Date | null;
}): boolean {
  if (k.status === "selesai") return false;
  return !k.picUserId && !k.picName && !k.dueDate;
}

/**
 * Bandingkan dua kendala: lewat tenggat → terbengkalai → tingkat → tenggat
 * terdekat.
 */
export function bandingKendala<T extends KendalaPrioritas & {
  picUserId: string | null;
  picName: string | null;
}>(a: T, b: T, today: Date): number {
  const la = lewatTenggat(a, today);
  const lb = lewatTenggat(b, today);
  if (la !== lb) return la ? -1 : 1;

  const ta = terbengkalai(a);
  const tb = terbengkalai(b);
  if (ta !== tb) return ta ? -1 : 1;

  const pa = PERINGKAT_TINGKAT[a.severity];
  const pb = PERINGKAT_TINGKAT[b.severity];
  if (pa !== pb) return pa - pb;

  return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
}

export function urutkanKendala<T extends KendalaPrioritas & {
  picUserId: string | null;
  picName: string | null;
}>(rows: T[], today: Date): T[] {
  return [...rows].sort((a, b) => bandingKendala(a, b, today));
}
