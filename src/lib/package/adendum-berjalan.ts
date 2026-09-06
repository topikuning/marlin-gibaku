import { db } from "@/lib/db";
import { nilaiPersetujuan, suaraMasihBerlaku } from "@/lib/rab/persetujuan-aturan";

/**
 * ADENDUM YANG SEDANG BERJALAN DI SATU PAKET.
 *
 * Keluhan user 2026-09-05 di halaman paket: *"saat terjadi draft adendum, sama
 * sekali tidak ada informasi atau apa pun yang bisa membantu menjelaskan"*.
 * Betul — draft adendum hidup di halaman RAB masing-masing LOKASI, sementara
 * yang memutuskan (dan yang menandatangani CCO) bekerja dari halaman paket.
 * Di layar paket, adendum yang sedang diajukan sama sekali tidak kelihatan:
 * nilai kontrak berjalan tetap angka lama, dan tidak ada satu pun tanda bahwa
 * ada usulan yang menunggu persetujuan.
 *
 * Modul ini MEMBACA saja — tidak ada angka baru yang lahir di sini: nilai draft
 * adalah `RabRevision.totalValue` yang ditulis importer, nilai berjalan adalah
 * `totalValue` revisi aktif, dan status persetujuannya dinilai aturan empat
 * mata yang sama dengan tombol aktivasi (DECISIONS 234).
 */

export type DraftAdendumLokasi = {
  revisionId: string;
  locationId: string;
  locationName: string;
  locationSlug: string;
  revisionNo: number;
  /** Nilai RAB yang BERLAKU sekarang (revisi aktif); null bila lokasi belum punya. */
  nilaiAktif: bigint | null;
  nilaiDraft: bigint;
  /** draft − aktif; null bila belum ada revisi aktif untuk dibandingkan. */
  selisih: bigint | null;
  note: string | null;
  diubahPada: Date;
  /** Nomor CCO bila draft ini sudah ditautkan ke adendum kontrak. */
  ccoNumber: string | null;
  /** Persetujuan yang MASIH berlaku (suara sebelum draft berubah gugur). */
  setuju: { direktur: boolean; penugasan: boolean; lengkap: boolean; kurang: string[] };
  /** Suara yang gugur karena draft diubah sesudahnya – disebut, bukan didiamkan. */
  suaraGugur: number;
};

export type AdendumBerjalan = {
  draft: DraftAdendumLokasi[];
  /** Σ selisih seluruh draft (pra-PPN) – dampak bila semuanya diaktifkan. */
  totalSelisih: bigint;
  /** Draft yang persetujuannya sudah lengkap dan tinggal diaktifkan. */
  siapAktif: number;
};

export async function getAdendumBerjalan(locationIds: string[]): Promise<AdendumBerjalan> {
  if (locationIds.length === 0) return { draft: [], totalSelisih: 0n, siapAktif: 0 };

  const [drafts, aktif] = await Promise.all([
    db.rabRevision.findMany({
      where: { locationId: { in: locationIds }, status: "draft" },
      select: {
        id: true,
        locationId: true,
        revisionNo: true,
        totalValue: true,
        note: true,
        updatedAt: true,
        amendment: { select: { ccoNumber: true } },
        location: { select: { name: true, slug: true } },
        approvals: { select: { userId: true, role: true, approvedAt: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.rabRevision.findMany({
      where: { locationId: { in: locationIds }, status: "aktif" },
      select: { locationId: true, totalValue: true },
    }),
  ]);

  const nilaiAktifPer = new Map(aktif.map((r) => [r.locationId, r.totalValue]));

  const draft = drafts.map((d) => {
    const nilaiAktif = nilaiAktifPer.get(d.locationId) ?? null;
    // Suara yang diberikan SEBELUM draft terakhir diubah tidak dihitung: isinya
    // sudah bukan yang disetujui (DECISIONS 234).
    const berlaku = suaraMasihBerlaku(d.approvals, d.updatedAt);
    const status = nilaiPersetujuan(berlaku);
    return {
      revisionId: d.id,
      locationId: d.locationId,
      locationName: d.location.name,
      locationSlug: d.location.slug,
      revisionNo: d.revisionNo,
      nilaiAktif,
      nilaiDraft: d.totalValue,
      selisih: nilaiAktif == null ? null : d.totalValue - nilaiAktif,
      note: d.note,
      diubahPada: d.updatedAt,
      ccoNumber: d.amendment?.ccoNumber ?? null,
      setuju: {
        direktur: status.adaDirektur,
        penugasan: status.adaPenugasan,
        lengkap: status.lengkap,
        kurang: status.kurang,
      },
      suaraGugur: d.approvals.length - berlaku.length,
    };
  });

  return {
    draft,
    totalSelisih: draft.reduce((t, d) => t + (d.selisih ?? 0n), 0n),
    siapAktif: draft.filter((d) => d.setuju.lengkap).length,
  };
}
