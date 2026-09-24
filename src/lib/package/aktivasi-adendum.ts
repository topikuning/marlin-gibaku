import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { selisihNilaiAdendum, type ItemSelisihAdendum } from "@/lib/finance/calc";
import { nilaiPersetujuan, suaraMasihBerlaku } from "@/lib/rab/persetujuan-aturan";
import { pastikanBolehAktivasi, ringkasPersetujuan } from "@/lib/rab/persetujuan";
import { activateRevision, regenerateBaseline } from "@/lib/rab/import";
import type { LocationScopeKind } from "@/generated/prisma/enums";

/**
 * AKTIVASI ADENDUM DI TINGKAT PAKET — satu pintu (DECISIONS 613).
 *
 * Keluhan user 2026-09-24: *"ada catat adendum. apa gunanya itu? lalu hubungan
 * dengan impor rab baru… kenapa kamu tidak integrasikan? … sungguh sebuah alur
 * yang membingungkan."* Dulu tiga pintu yang tak saling kenal: "Catat adendum"
 * mengetik angka CCO dengan tangan, draft RAB diaktifkan per lokasi, dan cabut
 * lokasi menuntut CCO yang sudah tercatat lebih dulu. Angka CCO dan RAB bisa
 * berbeda tanpa ada yang tahu.
 *
 * Sekarang: draft RAB adendum dan draft perubahan lingkup lahir tanpa nomor,
 * disetujui empat mata masing-masing, lalu DIBERLAKUKAN BERSAMA di sini — di
 * sinilah nomor CCO lahir. Ketetapan user pada hari yang sama:
 *
 * - *"saat aktivasi keseluruhan, karena bisa saja aktivasi cuma 1-2 lokasi,
 *   atas lokasi yang perubahannya sudah final"* — yang dipilih saja yang ikut;
 * - nilai CCO *"ambil dari RAB tapi tetap bisa diubah ketikan, ini penting jika
 *   selisih cuma ratusan sampai ribuan rupiah gara-gara selisih koma"* — angka
 *   turunan disimpan di `valueDeltaRab`, angka resmi di `valueDelta`;
 * - lokasi yang dicabut mengurangi *"seluruh nilai RAB-nya"*.
 *
 * Koreksi user di hari yang sama (DECISIONS 614): dua persetujuan sudah
 * MEMBERLAKUKAN perubahan — revisi RAB diaktifkan dari lokasinya, perubahan
 * lingkup berlaku otomatis. Yang tersisa di sini administrasinya: mencatat
 * nomor CCO atas perubahan yang "sudah berlaku, nomor CCO menyusul", tanpa
 * mengaktifkan ulang apa pun. Draft yang lengkap tetap bisa ikut sekaligus.
 */

export class AktivasiAdendumError extends Error {}

export type DraftRevisiTertunda = {
  revisionId: string;
  /** Sudah AKTIF dari lokasinya, tinggal dicatat dalam CCO (DECISIONS 614). */
  sudahBerlaku: boolean;
  revisionNo: number;
  locationId: string;
  locationName: string;
  locationSlug: string;
  /** RAB yang sudah tercakup CCO sebelumnya (pre-PPN) – dasar selisih. */
  totalAktif: bigint | null;
  totalDraft: bigint;
  lengkap: boolean;
  kurang: string[];
};

export type DraftLingkupTertunda = {
  changeId: string;
  /** Sudah berlaku sejak persetujuan kedua, tinggal dicatat dalam CCO. */
  sudahBerlaku: boolean;
  effectiveDate: Date | null;
  locationId: string;
  locationName: string;
  locationSlug: string;
  kind: LocationScopeKind;
  reason: string;
  totalAktif: bigint | null;
  lengkap: boolean;
  kurang: string[];
};

export type AdendumTertunda = { revisi: DraftRevisiTertunda[]; lingkup: DraftLingkupTertunda[] };

/**
 * RAB yang sudah TERCAKUP CCO per lokasi (pre-PPN): revisi terakhir yang
 * pernah aktif dan tidak sedang menunggu CCO. Revisi yang diaktifkan dari
 * lokasi sebelum CCO-nya tercatat belum menjadi dasar kontrak, jadi selisihnya
 * masih harus masuk CCO berikutnya. Lokasi tanpa RAB tidak ada di peta.
 */
async function totalTercakupPerLokasi(locationIds: string[]): Promise<Map<string, bigint>> {
  if (locationIds.length === 0) return new Map();
  const rows = await db.rabRevision.findMany({
    where: { locationId: { in: locationIds }, status: { in: ["aktif", "digantikan"] }, awaitingCco: false },
    orderBy: { revisionNo: "desc" },
    select: { locationId: true, totalValue: true },
  });
  const peta = new Map<string, bigint>();
  for (const r of rows) if (!peta.has(r.locationId)) peta.set(r.locationId, r.totalValue);
  return peta;
}

/**
 * Semua draft adendum paket yang belum diberlakukan.
 *
 * Draft revisi yang dihitung adendum hanya yang MENGGANTI RAB aktif, atau RAB
 * pertama lokasi yang sedang diusulkan masuk. RAB awal lokasi kontrak asli
 * bukan adendum — ia tetap diaktifkan dari halaman lokasinya.
 */
export async function adendumTertunda(packageId: string): Promise<AdendumTertunda> {
  const [revisiRows, lingkupRows] = await Promise.all([
    db.rabRevision.findMany({
      where: {
        location: { packageId },
        OR: [{ status: "draft" }, { status: "aktif", awaitingCco: true }],
      },
      orderBy: [{ location: { name: "asc" } }, { revisionNo: "asc" }],
      select: {
        id: true,
        revisionNo: true,
        status: true,
        totalValue: true,
        locationId: true,
        location: { select: { name: true, slug: true } },
      },
    }),
    db.locationScopeChange.findMany({
      where: {
        location: { packageId },
        OR: [{ status: "draft" }, { status: "aktif", amendmentId: null }],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        locationId: true,
        kind: true,
        status: true,
        effectiveDate: true,
        reason: true,
        updatedAt: true,
        location: { select: { name: true, slug: true } },
        approvals: { select: { userId: true, role: true, approvedAt: true } },
      },
    }),
  ]);
  const tercakup = await totalTercakupPerLokasi([
    ...new Set([...revisiRows.map((r) => r.locationId), ...lingkupRows.map((r) => r.locationId)]),
  ]);

  const revisi: DraftRevisiTertunda[] = [];
  for (const r of revisiRows) {
    const sudahBerlaku = r.status === "aktif";
    // Draft tanpa RAB tercakup = RAB AWAL lokasi, bukan adendum – ia
    // diaktifkan dari halaman lokasinya dan tidak masuk CCO.
    if (!sudahBerlaku && !tercakup.has(r.locationId)) continue;
    const status = sudahBerlaku ? { lengkap: true, kurang: [] } : await ringkasPersetujuan(r.id);
    revisi.push({
      revisionId: r.id,
      sudahBerlaku,
      revisionNo: r.revisionNo,
      locationId: r.locationId,
      locationName: r.location.name,
      locationSlug: r.location.slug,
      totalAktif: tercakup.get(r.locationId) ?? null,
      totalDraft: r.totalValue,
      lengkap: status.lengkap,
      kurang: status.kurang,
    });
  }
  const lingkup: DraftLingkupTertunda[] = lingkupRows.map((r) => {
    const sudahBerlaku = r.status === "aktif";
    const s = sudahBerlaku
      ? { lengkap: true, kurang: [] }
      : nilaiPersetujuan(suaraMasihBerlaku(r.approvals, r.updatedAt));
    return {
      changeId: r.id,
      sudahBerlaku,
      effectiveDate: r.effectiveDate,
      locationId: r.locationId,
      locationName: r.location.name,
      locationSlug: r.location.slug,
      kind: r.kind,
      reason: r.reason,
      totalAktif: tercakup.get(r.locationId) ?? null,
      lengkap: s.lengkap,
      kurang: s.kurang,
    };
  });
  return { revisi, lingkup };
}

export type InputAktivasiAdendum = {
  packageId: string;
  revisionIds: string[];
  changeIds: string[];
  ccoNumber: string;
  effectiveDate: Date;
  endDateDelta: number;
  reason: string;
  /** Nilai resmi CCO (inklusif PPN) yang diketik; null = pakai turunan RAB. */
  valueDelta: bigint | null;
};

export type HasilAktivasiAdendum = {
  amendmentId: string;
  ccoNumber: string;
  valueDelta: bigint;
  valueDeltaRab: bigint;
  revisi: {
    revisionNo: number;
    locationName: string;
    penyesuaian: Awaited<ReturnType<typeof activateRevision>>["penyesuaian"];
  }[];
  /** Usulan lingkup yang baru berlaku lewat CCO ini (masih draft sebelumnya). */
  lingkup: number;
  /** Perubahan yang SUDAH berlaku sejak dua persetujuan, kini bernomor CCO. */
  dicatat: number;
  /** Lokasi yang revisinya SUDAH aktif tetapi kurva-S-nya gagal dibuat ulang. */
  baselineGagal: string[];
};

/** Hitung selisih turunan RAB untuk pilihan tertentu — dipakai layar DAN aktivasi. */
export function selisihPilihan(
  tertunda: AdendumTertunda,
  revisionIds: string[],
  changeIds: string[],
  ppnPercent: number,
) {
  const perLokasi = new Map<string, ItemSelisihAdendum>();
  const ambil = (locationId: string, aktif: bigint | null) => {
    const ada = perLokasi.get(locationId);
    if (ada) return ada;
    const baru: ItemSelisihAdendum = { locationId, aktif, draft: null, lingkup: null };
    perLokasi.set(locationId, baru);
    return baru;
  };
  for (const r of tertunda.revisi.filter((x) => revisionIds.includes(x.revisionId)))
    ambil(r.locationId, r.totalAktif).draft = r.totalDraft;
  for (const l of tertunda.lingkup.filter((x) => changeIds.includes(x.changeId)))
    ambil(l.locationId, l.totalAktif).lingkup = l.kind;
  return selisihNilaiAdendum([...perLokasi.values()], ppnPercent);
}

export async function aktifkanAdendumPaket(input: InputAktivasiAdendum): Promise<HasilAktivasiAdendum> {
  const user = await requireCapability("amendment.manage");
  const ccoNumber = input.ccoNumber.trim();
  const reason = input.reason.trim();
  if (!ccoNumber) throw new AktivasiAdendumError("Nomor CCO/adendum wajib diisi.");
  if (reason.length < 5) throw new AktivasiAdendumError("Alasan adendum wajib diisi (min 5 karakter).");

  const contract = await db.contract.findFirst({
    where: { packageId: input.packageId, package: { orgId: user.orgId } },
    select: { id: true, ppnPercent: true },
  });
  if (!contract) throw new AktivasiAdendumError("Paket ini belum punya kontrak.");
  const dupe = await db.contractAmendment.findUnique({
    where: { contractId_ccoNumber: { contractId: contract.id, ccoNumber } },
    select: { id: true },
  });
  if (dupe) throw new AktivasiAdendumError(`Adendum "${ccoNumber}" sudah tercatat untuk kontrak ini.`);

  /*
   * SEMUA DIPERIKSA SEBELUM APA PUN DITULIS. Aktivasi revisi tidak bisa dalam
   * satu transaksi dengan pembuatan CCO (ia punya transaksinya sendiri dan
   * membangun ulang snapshot di luar transaksi), jadi satu-satunya cara
   * menghindari CCO setengah jadi adalah menolak di depan.
   */
  const tertunda = await adendumTertunda(input.packageId);
  const revisi = input.revisionIds.map((id) => {
    const r = tertunda.revisi.find((x) => x.revisionId === id);
    if (!r) throw new AktivasiAdendumError("Ada draft revisi yang bukan draft adendum paket ini – muat ulang halaman.");
    return r;
  });
  const lingkup = input.changeIds.map((id) => {
    const l = tertunda.lingkup.find((x) => x.changeId === id);
    if (!l) throw new AktivasiAdendumError("Ada usulan lingkup yang bukan draft paket ini – muat ulang halaman.");
    return l;
  });
  for (const locationId of new Set([...revisi, ...lingkup].map((x) => x.locationId)))
    await requireLocationAccess(user, locationId);

  const draftRevisi = revisi.filter((r) => !r.sudahBerlaku);
  const draftPerLokasi = new Map<string, number>();
  for (const r of draftRevisi) draftPerLokasi.set(r.locationId, (draftPerLokasi.get(r.locationId) ?? 0) + 1);
  for (const r of draftRevisi) {
    if ((draftPerLokasi.get(r.locationId) ?? 0) > 1)
      throw new AktivasiAdendumError(`${r.locationName} punya lebih dari satu draft terpilih – pilih satu saja.`);
    if (lingkup.some((l) => l.locationId === r.locationId && l.kind === "cabut"))
      throw new AktivasiAdendumError(
        `${r.locationName} dicabut dalam adendum ini – draft revisi RAB-nya tidak perlu ikut diberlakukan.`,
      );
    if (!r.lengkap)
      throw new AktivasiAdendumError(
        `Revisi #${r.revisionNo} ${r.locationName} belum lengkap persetujuannya: ${r.kurang.join(" + ")}.`,
      );
  }
  for (const l of lingkup)
    if (!l.lengkap)
      throw new AktivasiAdendumError(
        `Usulan ${l.kind === "cabut" ? "pencabutan" : "penambahan"} ${l.locationName} belum lengkap persetujuannya: ${l.kurang.join(" + ")}.`,
      );
  // Gerbang empat mata dipanggil ulang langsung — pagar yang sama dengan
  // jalur lokasi, bukan salinan aturannya.
  for (const r of draftRevisi) await pastikanBolehAktivasi(r.revisionId);

  const ppn = Number(contract.ppnPercent);
  const turunan = selisihPilihan(tertunda, input.revisionIds, input.changeIds, ppn).denganPpn;
  const valueDelta = input.valueDelta ?? turunan;

  const amendment = await db.$transaction(async (tx) => {
    const a = await tx.contractAmendment.create({
      data: {
        contractId: contract.id,
        ccoNumber,
        valueDelta,
        valueDeltaRab: turunan,
        endDateDelta: input.endDateDelta,
        effectiveDate: input.effectiveDate,
        reason,
        createdById: user.id,
      },
      select: { id: true },
    });
    const ids = lingkup.map((l) => l.changeId);
    if (ids.length > 0) {
      await tx.locationScopeChange.updateMany({
        where: { id: { in: ids }, status: "draft" },
        data: { status: "aktif", appliedAt: new Date(), amendmentId: a.id, effectiveDate: input.effectiveDate },
      });
      // Yang sudah berlaku sejak persetujuan kedua hanya dicatat nomornya —
      // tanggal berlakunya tidak digeser ke tanggal CCO (DECISIONS 614).
      await tx.locationScopeChange.updateMany({
        where: { id: { in: ids }, status: "aktif", amendmentId: null },
        data: { amendmentId: a.id },
      });
    }
    /*
     * Semua revisi yang MENUNGGU CCO di lokasi yang disentuh ikut dicatat,
     * termasuk yang sudah digantikan revisi berikutnya: selisih nilainya
     * dihitung dari RAB tercakup terakhir, jadi seluruh rantainya sudah masuk
     * angka CCO ini. Membiarkan salah satunya menunggu akan menghitungnya dua
     * kali di CCO berikutnya.
     */
    const lokasiDisentuh = [...new Set([...revisi, ...lingkup].map((x) => x.locationId))];
    if (lokasiDisentuh.length > 0)
      await tx.rabRevision.updateMany({
        where: { locationId: { in: lokasiDisentuh }, awaitingCco: true },
        data: { amendmentId: a.id, awaitingCco: false },
      });
    return a;
  });

  const hasilRevisi: HasilAktivasiAdendum["revisi"] = [];
  const baselineGagal: string[] = [];
  for (const r of draftRevisi) {
    const aktif = await activateRevision(r.revisionId, user.id);
    // Ditautkan SESUDAH aktif: menyentuh draft sebelum aktivasi menggeser
    // updatedAt-nya dan menggugurkan suara persetujuan yang baru diperiksa.
    await db.rabRevision.update({ where: { id: r.revisionId }, data: { amendmentId: amendment.id } });
    hasilRevisi.push({ revisionNo: r.revisionNo, locationName: r.locationName, penyesuaian: aktif.penyesuaian });
    try {
      await regenerateBaseline(r.locationId, {
        source: "adendum",
        rabRevisionId: r.revisionId,
        note: `Regenerate otomatis (aktivasi ${ccoNumber})`,
        userId: user.id,
      });
    } catch (e) {
      console.error("[adendum] regenerate baseline gagal (revisi sudah aktif):", e);
      baselineGagal.push(r.locationName);
    }
  }
  // Lokasi tambahan yang baru berlaku LEWAT CCO ini (draft) dan RAB-nya sudah
  // aktif: kurva-S-nya dibuat ulang supaya mulai dari tanggal berlakunya. Yang
  // sudah berlaku sejak persetujuan kedua sudah dibuat ulang saat itu.
  for (const l of lingkup) {
    if (l.sudahBerlaku || l.kind !== "tambah" || l.totalAktif === null) continue;
    if (draftRevisi.some((r) => r.locationId === l.locationId)) continue;
    try {
      await regenerateBaseline(l.locationId, {
        source: "adendum",
        note: `Regenerate otomatis (lokasi masuk lewat ${ccoNumber})`,
        userId: user.id,
      });
    } catch (e) {
      console.error("[adendum] regenerate baseline lokasi tambahan gagal:", e);
      baselineGagal.push(l.locationName);
    }
  }

  await audit(user.id, "amendment.aktivasi", "package", input.packageId, {
    amendmentId: amendment.id,
    ccoNumber,
    valueDelta: valueDelta.toString(),
    valueDeltaRab: turunan.toString(),
    endDateDelta: input.endDateDelta,
    effectiveDate: input.effectiveDate.toISOString().slice(0, 10),
    revisi: revisi.map((r) => ({
      revisionId: r.revisionId,
      locationId: r.locationId,
      revisionNo: r.revisionNo,
      sudahBerlaku: r.sudahBerlaku,
    })),
    lingkup: lingkup.map((l) => ({
      changeId: l.changeId,
      locationId: l.locationId,
      kind: l.kind,
      sudahBerlaku: l.sudahBerlaku,
    })),
    baselineGagal,
  });
  return {
    amendmentId: amendment.id,
    ccoNumber,
    valueDelta,
    valueDeltaRab: turunan,
    revisi: hasilRevisi,
    lingkup: lingkup.filter((l) => !l.sudahBerlaku).length,
    dicatat: revisi.filter((r) => r.sudahBerlaku).length + lingkup.filter((l) => l.sudahBerlaku).length,
    baselineGagal,
  };
}
