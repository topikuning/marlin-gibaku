import "server-only";
import { db } from "@/lib/db";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { jakartaToday } from "@/lib/format";
import type { IssueSeverity, IssueSource, IssueStatus, RecoveryStatus } from "@/generated/prisma/enums";
import { lewatTenggat, terbengkalai, urutkanKendala } from "./prioritas";

/**
 * PAPAN KENDALA TERPUSAT (DECISIONS 392).
 *
 * Sebelum ini kendala hanya bisa dilihat di dalam tab Progress SATU lokasi,
 * atau sebagai ringkasan di dashboard eksekutif. Tidak ada satu tempat pun
 * untuk menjawab *"kendala apa saja yang terbuka di 83 lokasi, siapa
 * pemiliknya, mana yang lewat tenggat"* — padahal itu pertanyaan yang membuat
 * pencatatan kendala ada gunanya.
 *
 * Lingkupnya dipotong `locationScopeWhere` seperti seluruh halaman lain:
 * kendala lokasi di luar penugasan tidak pernah ikut, bahkan tidak ikut
 * dihitung.
 */

export type SaringKendalaPapan = {
  /** null = semua status kecuali selesai lama. */
  status?: IssueStatus | "lewat_tenggat" | "terbengkalai" | null;
  severity?: IssueSeverity | null;
  source?: IssueSource | null;
  locationId?: string | null;
  /** Cari di judul & uraian. */
  cari?: string | null;
};

export type BarisKendala = {
  id: string;
  title: string;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  source: IssueSource;
  locationId: string;
  locationName: string;
  locationSlug: string;
  packageName: string | null;
  picUserId: string | null;
  picUserName: string | null;
  picName: string | null;
  dueDate: Date | null;
  createdAt: Date;
  closedAt: Date | null;
  /** Aksi pemulihan terbaru — null bila belum ada satu pun. */
  recoveryStatus: RecoveryStatus | null;
  jumlahAksi: number;
  lewatTenggat: boolean;
  terbengkalai: boolean;
  umurHari: number;
};

export type RingkasKendala = {
  terbuka: number;
  ditangani: number;
  lewatTenggat: number;
  terbengkalai: number;
  selesai30Hari: number;
};

/** Berapa lama kendala "selesai" masih ikut ditampilkan di papan. */
export const HARI_SELESAI_TAMPIL = 30;

function umurHari(sejak: Date, kini: Date): number {
  return Math.max(0, Math.floor((kini.getTime() - sejak.getTime()) / 86_400_000));
}

/**
 * Seluruh kendala dalam lingkup penanya, sudah diurut prioritas.
 *
 * Sengaja mengembalikan SEMUA lalu menyaring di memori, bukan menyaring di
 * SQL: ringkasan papan (berapa terbuka / lewat tenggat / terbengkalai) harus
 * dihitung dari himpunan yang sama dengan daftarnya. Menghitungnya lewat query
 * terpisah membuka celah dua angka yang berbeda untuk hal yang sama — persis
 * yang dilarang Calculation Integrity Protocol. Skalanya juga tidak menuntut:
 * 83 lokasi dengan puluhan kendala per lokasi masih ribuan baris, bukan jutaan.
 */
export async function papanKendala(
  user: SessionUser,
  saring: SaringKendalaPapan = {},
): Promise<{ baris: BarisKendala[]; ringkas: RingkasKendala; total: number }> {
  const scoped = await accessibleLocationIds(user);
  const today = jakartaToday();
  const batasSelesai = new Date(today.getTime() - HARI_SELESAI_TAMPIL * 86_400_000);

  const rows = await db.issue.findMany({
    where: {
      location: locationScopeWhere(user, scoped),
      mergedIntoId: null,
      // Kendala selesai yang sudah lama tidak ikut — papan ini alat kerja,
      // bukan arsip. Riwayat penuh tetap ada di halaman lokasinya.
      OR: [
        { status: { in: ["terbuka", "ditangani"] } },
        { status: "selesai", closedAt: { gte: batasSelesai } },
        { status: "selesai", closedAt: null, updatedAt: { gte: batasSelesai } },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      severity: true,
      status: true,
      source: true,
      picUserId: true,
      picName: true,
      dueDate: true,
      createdAt: true,
      closedAt: true,
      locationId: true,
      location: {
        select: { name: true, slug: true, package: { select: { name: true } } },
      },
      actions: {
        orderBy: { createdAt: "desc" },
        select: { status: true, dueDate: true },
      },
    },
  });

  const picIds = [...new Set(rows.map((r) => r.picUserId).filter((v): v is string => !!v))];
  const picUsers = picIds.length
    ? await db.user.findMany({ where: { id: { in: picIds } }, select: { id: true, fullName: true } })
    : [];
  const namaPic = new Map(picUsers.map((u) => [u.id, u.fullName]));

  const semua: BarisKendala[] = rows.map((r) => {
    const aksiTerbaru = r.actions[0] ?? null;
    /*
     * Tenggat kendala menang atas tenggat aksi pemulihan.
     *
     * Kendala sekarang punya tenggatnya sendiri; tenggat aksi dipakai HANYA
     * sebagai cadangan untuk data lama yang tenggatnya cuma ada di sana.
     * Tanpa cadangan itu, seluruh kendala yang dibuat sebelum DECISIONS 392
     * mendadak terlihat "tanpa tenggat".
     */
    const dueDate = r.dueDate ?? aksiTerbaru?.dueDate ?? null;
    const dasar = {
      severity: r.severity,
      status: r.status,
      dueDate,
      recoveryStatus: aksiTerbaru?.status ?? null,
      picUserId: r.picUserId,
      picName: r.picName,
    };
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      severity: r.severity,
      status: r.status,
      source: r.source,
      locationId: r.locationId,
      locationName: r.location.name,
      locationSlug: r.location.slug,
      packageName: r.location.package?.name ?? null,
      picUserId: r.picUserId,
      picUserName: r.picUserId ? (namaPic.get(r.picUserId) ?? null) : null,
      picName: r.picName,
      dueDate,
      createdAt: r.createdAt,
      closedAt: r.closedAt,
      recoveryStatus: aksiTerbaru?.status ?? null,
      jumlahAksi: r.actions.length,
      lewatTenggat: lewatTenggat(dasar, today),
      terbengkalai: terbengkalai(dasar),
      umurHari: umurHari(r.createdAt, today),
    };
  });

  const ringkas: RingkasKendala = {
    terbuka: semua.filter((k) => k.status === "terbuka").length,
    ditangani: semua.filter((k) => k.status === "ditangani").length,
    lewatTenggat: semua.filter((k) => k.lewatTenggat).length,
    terbengkalai: semua.filter((k) => k.terbengkalai).length,
    selesai30Hari: semua.filter((k) => k.status === "selesai").length,
  };

  const cari = saring.cari?.trim().toLowerCase() ?? "";
  const baris = urutkanKendala(
    semua.filter((k) => {
      if (saring.status === "lewat_tenggat" && !k.lewatTenggat) return false;
      if (saring.status === "terbengkalai" && !k.terbengkalai) return false;
      if (
        saring.status &&
        saring.status !== "lewat_tenggat" &&
        saring.status !== "terbengkalai" &&
        k.status !== saring.status
      ) {
        return false;
      }
      // Tanpa saringan status, yang selesai disembunyikan: papan ini daftar
      // KERJA. Yang sudah selesai dibuka lewat saringannya sendiri.
      if (!saring.status && k.status === "selesai") return false;
      if (saring.severity && k.severity !== saring.severity) return false;
      if (saring.source && k.source !== saring.source) return false;
      if (saring.locationId && k.locationId !== saring.locationId) return false;
      if (cari) {
        const teks = `${k.title} ${k.description ?? ""}`.toLowerCase();
        if (!teks.includes(cari)) return false;
      }
      return true;
    }),
    today,
  );

  return { baris, ringkas, total: semua.length };
}
