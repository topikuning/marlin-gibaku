import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability } from "@/lib/auth/session";
import { bolehMenyetujui, nilaiPersetujuan, suaraMasihBerlaku } from "@/lib/rab/persetujuan-aturan";
import type { LocationScopeKind } from "@/generated/prisma/enums";

/**
 * LINGKUP LOKASI SEBUAH KONTRAK — bertambah atau berkurang lewat adendum.
 *
 * Kebutuhan user 2026-09-05: *"ada kebutuhan dimana, adendum mengurangi lokasi
 * atau bahkan menambah lokasi. saat ini di kamu belum ada."*
 *
 * Tiga ketetapan user pada hari yang sama menentukan bentuk modul ini:
 *
 * 1. **Lokasi yang dicabut DITANDAI, bukan dihapus** — "angka lampau tetap".
 *    Laporan, foto, dan realisasinya utuh; yang berubah cuma keikutsertaannya
 *    dalam angka paket sejak tanggal berlaku CCO. Karena itu keikutsertaan
 *    DITURUNKAN dari tabel perubahan ini (`lingkupLokasi`), tidak pernah
 *    disalin jadi kolom di `locations` — dua sumber kebenaran untuk hal yang
 *    sama adalah cacat yang paling mahal di sistem ini.
 * 2. **Lokasi baru mulai dari tanggal berlaku adendum** — baselinenya dibuat
 *    di jendela minggu sisa, bukan sejak minggu-1 kontrak (lihat
 *    `regenerateBaseline`). Menyamakannya dengan lokasi lain akan membuatnya
 *    terlihat telat sejak minggu pertama padahal belum ada dalam kontrak.
 * 3. **Empat mata**, sama seperti aktivasi adendum RAB (DECISIONS 234):
 *    Program Director + satu peran penugasan, dan nomor CCO wajib. Mengubah
 *    lingkup kontrak menggeser nilai kontrak, progres, kurva-S, dan laporan
 *    KKP sekaligus — itu bukan kelas keputusan satu orang.
 */

export class LingkupError extends Error {}

export type PerubahanLingkup = {
  id: string;
  locationId: string;
  locationName: string;
  locationSlug: string;
  kind: LocationScopeKind;
  effectiveDate: Date;
  status: "draft" | "aktif" | "dibatalkan";
  reason: string;
  ccoNumber: string;
  appliedAt: Date | null;
  diubahPada: Date;
  setuju: { direktur: boolean; penugasan: boolean; lengkap: boolean; kurang: string[] };
  suaraGugur: number;
};

const pilih = {
  id: true,
  locationId: true,
  kind: true,
  effectiveDate: true,
  status: true,
  reason: true,
  appliedAt: true,
  updatedAt: true,
  amendment: { select: { ccoNumber: true } },
  location: { select: { name: true, slug: true } },
  approvals: { select: { userId: true, role: true, approvedAt: true } },
} as const;

function keBentuk(r: {
  id: string;
  locationId: string;
  kind: LocationScopeKind;
  effectiveDate: Date;
  status: "draft" | "aktif" | "dibatalkan";
  reason: string;
  appliedAt: Date | null;
  updatedAt: Date;
  amendment: { ccoNumber: string };
  location: { name: string; slug: string };
  approvals: { userId: string; role: Parameters<typeof nilaiPersetujuan>[0][number]["role"]; approvedAt: Date }[];
}): PerubahanLingkup {
  const berlaku = suaraMasihBerlaku(r.approvals, r.updatedAt);
  const status = nilaiPersetujuan(berlaku);
  return {
    id: r.id,
    locationId: r.locationId,
    locationName: r.location.name,
    locationSlug: r.location.slug,
    kind: r.kind,
    effectiveDate: r.effectiveDate,
    status: r.status,
    reason: r.reason,
    ccoNumber: r.amendment.ccoNumber,
    appliedAt: r.appliedAt,
    diubahPada: r.updatedAt,
    setuju: {
      direktur: status.adaDirektur,
      penugasan: status.adaPenugasan,
      lengkap: status.lengkap,
      kurang: status.kurang,
    },
    suaraGugur: r.approvals.length - berlaku.length,
  };
}

/** Seluruh perubahan lingkup (draft + aktif) untuk lokasi-lokasi ini. */
export async function daftarPerubahanLingkup(locationIds: string[]): Promise<PerubahanLingkup[]> {
  if (locationIds.length === 0) return [];
  const rows = await db.locationScopeChange.findMany({
    where: { locationId: { in: locationIds }, status: { not: "dibatalkan" } },
    select: pilih,
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(keBentuk);
}

export type LingkupLokasi = {
  /** Lokasi yang SUDAH dicabut dan tanggal berlakunya sudah lewat. */
  dicabut: Map<string, { ccoNumber: string; effectiveDate: Date }>;
  /** Lokasi yang masuk lewat adendum (aktif), dengan tanggal mulainya. */
  masuk: Map<string, { ccoNumber: string; effectiveDate: Date }>;
};

/**
 * Keikutsertaan lokasi PADA SUATU TANGGAL — dasar seluruh agregat paket.
 *
 * `pada` default hari ini. Yang dicabut BARU keluar dari agregat sejak tanggal
 * berlakunya: laporan sebelum tanggal itu tetap sah dan tetap terhitung, sesuai
 * ketetapan "angka lampau tetap".
 */
export async function lingkupLokasi(locationIds: string[], pada = new Date()): Promise<LingkupLokasi> {
  const dicabut = new Map<string, { ccoNumber: string; effectiveDate: Date }>();
  const masuk = new Map<string, { ccoNumber: string; effectiveDate: Date }>();
  if (locationIds.length === 0) return { dicabut, masuk };
  const rows = await db.locationScopeChange.findMany({
    where: { locationId: { in: locationIds }, status: "aktif" },
    select: { locationId: true, kind: true, effectiveDate: true, amendment: { select: { ccoNumber: true } } },
    orderBy: { effectiveDate: "asc" },
  });
  for (const r of rows) {
    const isi = { ccoNumber: r.amendment.ccoNumber, effectiveDate: r.effectiveDate };
    if (r.kind === "cabut") {
      if (r.effectiveDate.getTime() <= pada.getTime()) dicabut.set(r.locationId, isi);
    } else {
      masuk.set(r.locationId, isi);
      // Lokasi yang dicabut lalu dimasukkan lagi lewat adendum berikutnya ikut
      // kembali — urutan tanggal yang menentukan, bukan jenisnya.
      if ((dicabut.get(r.locationId)?.effectiveDate.getTime() ?? -Infinity) <= r.effectiveDate.getTime())
        dicabut.delete(r.locationId);
    }
  }
  return { dicabut, masuk };
}

/** Tanggal lokasi ini MASUK kontrak lewat adendum; null bila sejak awal. */
export async function tanggalMasukAdendum(locationId: string): Promise<Date | null> {
  const r = await db.locationScopeChange.findFirst({
    where: { locationId, kind: "tambah", status: "aktif" },
    select: { effectiveDate: true },
    orderBy: { effectiveDate: "desc" },
  });
  return r?.effectiveDate ?? null;
}

/** Ajukan perubahan lingkup — DRAFT, belum berlaku sampai empat mata terpenuhi. */
export async function ajukanPerubahanLingkup(input: {
  locationId: string;
  amendmentId: string;
  kind: LocationScopeKind;
  reason: string;
}): Promise<{ id: string }> {
  const user = await requireCapability("contract.manage");
  const [lokasi, adendum] = await Promise.all([
    db.location.findUnique({
      where: { id: input.locationId },
      select: { id: true, packageId: true, name: true },
    }),
    db.contractAmendment.findUnique({
      where: { id: input.amendmentId },
      select: { id: true, ccoNumber: true, effectiveDate: true, contract: { select: { packageId: true } } },
    }),
  ]);
  if (!lokasi) throw new LingkupError("Lokasi tidak ditemukan.");
  if (!adendum) throw new LingkupError("Adendum (CCO) tidak ditemukan.");
  // Adendum milik paket LAIN tidak boleh mengubah lingkup paket ini — itu
  // mengubah kontrak orang lain lewat pintu belakang.
  if (adendum.contract.packageId !== lokasi.packageId)
    throw new LingkupError("Adendum itu milik paket lain – pilih CCO pada kontrak paket ini.");
  if (!input.reason.trim()) throw new LingkupError("Alasan wajib diisi – ini dokumen perubahan kontrak.");

  const sudahAda = await db.locationScopeChange.findFirst({
    where: { locationId: input.locationId, status: "draft" },
    select: { id: true },
  });
  if (sudahAda)
    throw new LingkupError(
      "Lokasi ini sudah punya usulan perubahan lingkup yang menunggu persetujuan – selesaikan dulu yang itu.",
    );

  const row = await db.locationScopeChange.create({
    data: {
      locationId: input.locationId,
      amendmentId: adendum.id,
      kind: input.kind,
      effectiveDate: adendum.effectiveDate,
      reason: input.reason.trim(),
      createdById: user.id,
    },
    select: { id: true },
  });
  await audit(user.id, "location_scope.ajukan", "location", input.locationId, {
    changeId: row.id,
    kind: input.kind,
    ccoNumber: adendum.ccoNumber,
    effectiveDate: adendum.effectiveDate.toISOString().slice(0, 10),
  });
  return row;
}

/**
 * Setujui usulan. Begitu empat mata terpenuhi, perubahan LANGSUNG berlaku —
 * tidak ada tombol ketiga yang bisa ditekan satu orang sesudahnya.
 */
export async function setujuiPerubahanLingkup(changeId: string): Promise<{ berlaku: boolean }> {
  const user = await requireCapability("contract.manage");
  if (!bolehMenyetujui(user.role))
    throw new LingkupError(
      "Peran Anda tidak berhak menyetujui perubahan lingkup – syaratnya Program Director + Area/Project/Site Manager.",
    );

  const row = await db.locationScopeChange.findUnique({
    where: { id: changeId },
    select: {
      id: true,
      locationId: true,
      kind: true,
      status: true,
      updatedAt: true,
      amendment: { select: { ccoNumber: true } },
      approvals: { select: { userId: true, role: true, approvedAt: true } },
    },
  });
  if (!row) throw new LingkupError("Usulan tidak ditemukan.");
  if (row.status !== "draft") throw new LingkupError("Usulan ini sudah tidak berstatus draft.");

  await db.locationScopeApproval.upsert({
    where: { changeId_userId: { changeId, userId: user.id } },
    create: { changeId, userId: user.id, role: user.role },
    update: { role: user.role, approvedAt: new Date() },
  });
  await audit(user.id, "location_scope.setujui", "location", row.locationId, {
    changeId,
    kind: row.kind,
    ccoNumber: row.amendment.ccoNumber,
  });

  const semua = await db.locationScopeApproval.findMany({
    where: { changeId },
    select: { userId: true, role: true, approvedAt: true },
  });
  const status = nilaiPersetujuan(suaraMasihBerlaku(semua, row.updatedAt));
  if (!status.lengkap) return { berlaku: false };

  await db.locationScopeChange.update({
    where: { id: changeId },
    data: { status: "aktif", appliedAt: new Date() },
  });
  await audit(user.id, "location_scope.berlaku", "location", row.locationId, {
    changeId,
    kind: row.kind,
    ccoNumber: row.amendment.ccoNumber,
  });
  return { berlaku: true };
}

/** Batalkan usulan yang belum berlaku. */
export async function batalkanPerubahanLingkup(changeId: string): Promise<void> {
  const user = await requireCapability("contract.manage");
  const row = await db.locationScopeChange.findUnique({
    where: { id: changeId },
    select: { id: true, locationId: true, status: true },
  });
  if (!row) throw new LingkupError("Usulan tidak ditemukan.");
  if (row.status === "aktif")
    throw new LingkupError(
      "Perubahan yang SUDAH berlaku tidak dibatalkan diam-diam – terbitkan adendum berikutnya yang mengembalikannya.",
    );
  await db.locationScopeChange.update({ where: { id: changeId }, data: { status: "dibatalkan" } });
  await audit(user.id, "location_scope.batal", "location", row.locationId, { changeId });
}
