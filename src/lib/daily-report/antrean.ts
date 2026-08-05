import "server-only";
import { db } from "@/lib/db";
import { locationRelScopeWhere } from "@/lib/auth/scope";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Antrean laporan harian yang MENUNGGU TINDAKAN (DECISIONS 204).
 *
 * Dashboard eksekutif punya dua kartu — "Perlu Koreksi" dan "Menunggu
 * Verifikasi" — yang keduanya menunjuk `/dokumen-laporan/laporan`. Halaman itu berisi daftar
 * lokasi dan 20 laporan FINAL terakhir; laporan yang dikembalikan atau yang
 * sedang menunggu verifikasi tidak ada di sana sama sekali. Angkanya jadi
 * pemberitahuan tanpa jalan ke barangnya: user tahu ada 1 yang dikembalikan,
 * lalu tidak bisa menemukan yang mana.
 *
 * Modul ini menyediakan daftarnya, ter-scope seperti halaman lain.
 */

export type AntreanKind = "perlu-koreksi" | "menunggu-verifikasi";

export const ANTREAN_KINDS: AntreanKind[] = ["perlu-koreksi", "menunggu-verifikasi"];

export function isAntreanKind(v: string): v is AntreanKind {
  return (ANTREAN_KINDS as string[]).includes(v);
}

export const ANTREAN_META: Record<
  AntreanKind,
  { title: string; description: string; kosong: string; kosongDetail: string }
> = {
  "perlu-koreksi": {
    title: "Laporan dikembalikan",
    description: "Perlu diperbaiki lalu dikirim ulang oleh pelapornya.",
    kosong: "Tidak ada laporan yang perlu diperbaiki",
    kosongDetail: "Semua laporan yang dikembalikan sudah ditindaklanjuti.",
  },
  "menunggu-verifikasi": {
    title: "Laporan menunggu verifikasi",
    description: "Sudah dikirim lapangan, menunggu diperiksa. Yang paling lama menunggu di atas.",
    kosong: "Tidak ada laporan yang menunggu verifikasi",
    kosongDetail: "Semua laporan yang masuk sudah diperiksa.",
  },
};

export type AntreanItem = {
  id: string;
  locationName: string;
  locationSlug: string;
  /** Tanggal kerja laporan (kunci URL /harian/[date]). */
  dateKey: string;
  reportDate: Date;
  itemCount: number;
  /** perlu-koreksi: alasan pengembalian. Null = pengembali tidak mengisi. */
  reason: string | null;
  /** Siapa yang mengembalikan / siapa yang mengirim. */
  olehNama: string | null;
  olehPada: Date | null;
  /** Yang membuat laporan — orang yang harus memperbaikinya. */
  pelaporNama: string | null;
  /** Sudah berapa hari menunggu (0 = hari ini). Null bila waktunya tak diketahui. */
  menungguHari: number | null;
};

const DAY_MS = 24 * 3600 * 1000;

/**
 * Selisih hari kalender Jakarta, bukan selisih jam: laporan yang masuk kemarin
 * jam 23 sudah "1 hari" menunggu walaupun baru 10 jam berlalu — itu yang
 * dirasakan orang yang menunggunya.
 */
export function menungguHariSejak(sejak: Date, sekarang = new Date()): number {
  const a = parseDateKey(jakartaDateKey(sejak));
  const b = parseDateKey(jakartaDateKey(sekarang));
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY_MS));
}

export async function getAntreanLaporan(
  user: SessionUser,
  scoped: string[] | null,
  kind: AntreanKind,
  now = new Date(),
): Promise<AntreanItem[]> {
  const perluKoreksi = kind === "perlu-koreksi";

  const reports = await db.dailyReport.findMany({
    where: {
      status: perluKoreksi ? "perlu_koreksi" : "dikirim",
      ...locationRelScopeWhere(user, scoped),
    },
    // Perlu koreksi: tanggal kerja terlama dulu (yang paling tertinggal).
    // Menunggu verifikasi: yang paling lama menunggu dulu — yang menumpuk tiga
    // hari adalah masalah, yang masuk pagi tadi bukan. Urutan abjad/tanggal
    // kerja menyembunyikan bedanya.
    orderBy: perluKoreksi ? { reportDate: "asc" } : { submittedAt: "asc" },
    select: {
      id: true,
      reportDate: true,
      createdById: true,
      submittedById: true,
      submittedAt: true,
      location: { select: { name: true, slug: true } },
      _count: { select: { items: true } },
      statusHistory: perluKoreksi
        ? {
            where: { toStatus: "perlu_koreksi" },
            orderBy: { changedAt: "desc" },
            take: 1,
            select: { reason: true, changedById: true, changedAt: true },
          }
        : false,
    },
  });
  if (reports.length === 0) return [];

  // `createdById`/`submittedById`/`changedById` tidak punya relasi Prisma ke
  // User — ambil namanya sekali untuk seluruh daftar (bukan per baris).
  const userIds = new Set<string>();
  for (const r of reports) {
    userIds.add(r.createdById);
    if (r.submittedById) userIds.add(r.submittedById);
    const h = "statusHistory" in r ? r.statusHistory?.[0] : undefined;
    if (h?.changedById) userIds.add(h.changedById);
  }
  const users = await db.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, fullName: true },
  });
  const nama = new Map(users.map((u) => [u.id, u.fullName]));

  return reports.map((r) => {
    const h = "statusHistory" in r ? r.statusHistory?.[0] : undefined;
    const olehId = perluKoreksi ? h?.changedById : r.submittedById;
    const olehPada = perluKoreksi ? (h?.changedAt ?? null) : r.submittedAt;
    return {
      id: r.id,
      locationName: r.location.name,
      locationSlug: r.location.slug,
      dateKey: jakartaDateKey(r.reportDate),
      reportDate: r.reportDate,
      itemCount: r._count.items,
      reason: perluKoreksi ? (h?.reason ?? null) : null,
      olehNama: olehId ? (nama.get(olehId) ?? null) : null,
      olehPada,
      pelaporNama: nama.get(r.submittedById ?? r.createdById) ?? null,
      menungguHari: olehPada ? menungguHariSejak(olehPada, now) : null,
    };
  });
}
