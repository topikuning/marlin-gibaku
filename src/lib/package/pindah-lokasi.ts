import "server-only";
import { db } from "@/lib/db";
import { auditIn } from "@/lib/audit";
import { weekDateRange, weekEndFractions } from "@/lib/progress-calc";
import { konversiBaselineModeMinggu } from "@/lib/baseline";
import { bangunUlangSnapshotFinal } from "@/lib/daily-report/snapshot-rebuild";
import { namaKembarDi } from "@/lib/package/nama-kembar";
import type { PackageStage } from "@/generated/prisma/enums";

/**
 * PINDAHKAN LOKASI KE PAKET LAIN — super admin saja.
 *
 * Kebutuhan user 2026-09-15: *"aku butuh satu fitur yang hanya ada di super
 * admin, yaitu memindahkan lokasi ke paket lain."*
 *
 * ## Dua jalur, sengaja dibedakan (ketetapan user pada hari yang sama)
 *
 * - **`paksa`** — KOREKSI SALAH INPUT. Lokasi ini memang sejak awal salah
 *   paket; tidak ada satu pun dokumen yang menyatakan perpindahannya, dan
 *   memang tidak perlu ada. Sejajar dengan `location.correct` (DECISIONS 187):
 *   nilai kontrak tidak disentuh, karena tidak ada yang berubah secara
 *   kontraktual — yang salah cuma tempat datanya diletakkan.
 * - **`cco`** — PERPINDAHAN KONTRAKTUAL. Lokasi keluar dari kontrak paket lama
 *   dan masuk kontrak paket baru lewat adendum. Nomor CCO wajib disebut.
 *
 * Yang membedakan keduanya di kode cuma dua hal: `cco` menuntut nomor CCO, dan
 * `paksa` DITOLAK bila lokasi itu punya riwayat lingkup kontraktual — lokasi
 * yang pernah dicabut/ditambah lewat adendum bukan kasus salah input.
 *
 * ## Riwayat paket lama
 *
 * Ketetapan user: *"kalau jalur cco, maka sistem cukup memberikan history pada
 * paket lama bahwa pernah ada lokasi itu."* Karena itu KEDUA paket mendapat
 * baris `PackageStageHistory` (stage tidak berubah, catatannya yang bicara),
 * dan baris `LocationScopeChange` TIDAK ikut pindah: ia milik adendum kontrak
 * paket lama, dan memindahkannya akan membuat dokumen CCO menunjuk lokasi yang
 * bukan lagi anggota paket itu.
 *
 * Konsekuensinya `lingkupLokasi` harus sadar-paket — lihat catatan di sana.
 *
 * ## Kalender ikut menyesuaikan, bukan menolak
 *
 * Ketetapan user: sistem yang menyesuaikan. SPMK, durasi, dan mode minggu milik
 * PAKET, jadi begitu lokasi pindah, kalendernya berganti. Yang dihitung ulang
 * di sini: rentang tanggal rencana mingguan, grid minggu baseline (mesin yang
 * sama dengan ganti mode minggu — jadwal impor/manual DIKONVERSI, bukan
 * dibuang, DECISIONS 427d), dan snapshot laporan final. Tidak ada yang perlu
 * diimpor ulang.
 *
 * Satu keadaan tetap DITOLAK: paket tujuan belum berkontrak (SPMK belum ada)
 * sementara lokasi ini sudah punya baseline atau laporan. Di situ bukan
 * "menyesuaikan" melainkan menghapus kalender yang jadi dasar seluruh angkanya.
 */

export class PindahLokasiError extends Error {}

/** Tahap paket yang masih boleh menerima/melepas lokasi lewat jalur ini. */
const TAHAP_BOLEH: PackageStage[] = ["prospek", "tender", "penetapan", "kontrak", "pelaksanaan"];

export type ModePindah = "paksa" | "cco";

export type HasilPindahLokasi = {
  locationName: string;
  locationSlug: string;
  dariPaket: string;
  kePaket: string;
  /** Rencana mingguan yang rentang tanggalnya dihitung ulang ke grid baru. */
  rencanaDihitungUlang: number;
  /** "dikonversi" | "dilewati" | "tanpa-baseline" — nasib baseline lokasi. */
  baseline: "dikonversi" | "dilewati" | "tanpa-baseline";
  /** Blanko harian final yang snapshotnya dibangun ulang. */
  snapshotDibangunUlang: number;
  /** Baris ber-paket yang ikut dipindah (dokumen, milestone, surat, Drive). */
  barisIkut: number;
  /**
   * Lokasi ini tadinya terpasang ke grup WA kabupaten paket ASAL, dan
   * tautannya dilepas (DECISIONS 596). Disebut supaya yang memindahkan tahu
   * lokasi itu kini mengikuti grup paket barunya.
   */
  grupKabupatenDilepas: boolean;
  /**
   * Dokumen yang ikut pindah TAPI masih menunjuk kontrak/adendum paket LAMA.
   * Disebut, bukan dibetulkan diam-diam: berkasnya memang milik kontrak itu.
   */
  dokumenMenunjukKontrakLama: number;
};

type Kontrak = {
  startDate: Date | null;
  endDate: Date | null;
  weekMode: "tujuh_hari" | "senin_minggu";
} | null;

/** Grid minggu sebuah kontrak; null bila SPMK/akhir belum ada. */
function grid(k: Kontrak): { fracs: number[]; totalWeeks: number } | null {
  if (!k?.startDate || !k.endDate) return null;
  const fr = weekEndFractions(k.startDate, k.endDate, k.weekMode);
  return { fracs: fr, totalWeeks: fr.length };
}

export async function pindahkanLokasi(
  input: {
    locationId: string;
    tujuanPackageId: string;
    mode: ModePindah;
    alasan: string;
    ccoNumber?: string | null;
  },
  actor: { id: string; orgId: string },
  ip: string | null,
): Promise<HasilPindahLokasi> {
  const lokasi = await db.location.findUnique({
    where: { id: input.locationId },
    select: {
      id: true,
      name: true,
      slug: true,
      packageId: true,
      waGroupRefId: true,
      package: { select: { id: true, name: true, orgId: true, stage: true, contract: { select: { startDate: true, endDate: true, weekMode: true } } } },
    },
  });
  // Filter organisasi DI SINI, bukan di UI: satu UUID yang terbaca dari dokumen
  // mana pun tidak boleh cukup untuk memindahkan lokasi organisasi lain.
  if (!lokasi || lokasi.package.orgId !== actor.orgId) {
    throw new PindahLokasiError("Lokasi tidak ditemukan.");
  }
  if (lokasi.packageId === input.tujuanPackageId) {
    throw new PindahLokasiError("Lokasi ini sudah ada di paket itu.");
  }

  const tujuan = await db.package.findFirst({
    where: { id: input.tujuanPackageId, orgId: actor.orgId },
    select: {
      id: true,
      name: true,
      stage: true,
      contract: { select: { startDate: true, endDate: true, weekMode: true, durationDays: true } },
    },
  });
  if (!tujuan) throw new PindahLokasiError("Paket tujuan tidak ditemukan.");
  const durasiTujuan = tujuan.contract?.durationDays ?? 0;

  /*
   * NAMA KEMBAR DI PAKET TUJUAN — ditolak, tidak dipaksakan.
   *
   * Perpindahan tidak pernah bisa menabrak slug (`slug` global unik dan tidak
   * ikut berubah), jadi sampai 2026-09-16 tidak ada apa pun yang menghalangi
   * dua lokasi bernama sama berkumpul di satu paket. Angkanya memang tetap
   * benar — semuanya dijumlahkan lewat `location.id` — tetapi `matchLocation`
   * memilah berkas Google Drive LEWAT NAMA dari daftar lokasi satu paket dan
   * memakai yang pertama cocok. Selama keduanya di paket berbeda, pemilahan itu
   * tidak pernah ambigu; perpindahan inilah yang mempertemukan mereka dan
   * menyalakan ambiguitasnya.
   *
   * Tidak ada jalur "paksa" untuk ini: memaksakannya berarti menyerahkan
   * pengarsipan berkas lapangan pada urutan daftar. Yang diminta cuma satu
   * langkah — beri nama pembeda lebih dulu (Lokasi › ubah nama).
   */
  const diTujuan = await db.location.findMany({
    where: { packageId: tujuan.id },
    select: { id: true, name: true },
  });
  const kembar = namaKembarDi(lokasi.name, diTujuan, lokasi.id);
  if (kembar.length > 0) {
    throw new PindahLokasiError(
      `Paket "${tujuan.name}" sudah punya lokasi bernama "${kembar[0].name}". Dua nama kembar di satu ` +
        "paket membuat berkas Google Drive tidak bisa dipilah ke lokasi yang benar. Beri nama pembeda " +
        "pada salah satunya dulu – mis. sebut kecamatannya – baru pindahkan.",
    );
  }

  for (const p of [lokasi.package, tujuan]) {
    if (!TAHAP_BOLEH.includes(p.stage)) {
      throw new PindahLokasiError(
        `Paket "${p.name}" sudah tahap ${p.stage} – susunan lokasinya mengikuti laporan yang sudah final dan tidak bisa dipindah lewat jalur ini.`,
      );
    }
  }

  if (input.mode === "cco" && !input.ccoNumber?.trim()) {
    throw new PindahLokasiError("Nomor CCO wajib diisi untuk perpindahan lewat adendum.");
  }

  // Riwayat lingkup kontraktual: pemisah kedua jalur.
  const lingkupAktif = await db.locationScopeChange.findMany({
    where: { locationId: lokasi.id, status: "aktif" },
    select: { kind: true, amendment: { select: { ccoNumber: true } } },
  });
  if (input.mode === "paksa" && lingkupAktif.length > 0) {
    const nomor = [...new Set(lingkupAktif.map((r) => r.amendment.ccoNumber))].join(", ");
    throw new PindahLokasiError(
      `Lokasi ini punya riwayat lingkup kontraktual (${nomor}) – itu bukan salah input. ` +
        "Pakai jalur CCO dan sebutkan nomor adendumnya.",
    );
  }

  /*
   * DRAFT REVISI RAB YANG TERIKAT ADENDUM PAKET ASAL — ditolak.
   *
   * `RabRevision.amendmentId` menunjuk `ContractAmendment` milik KONTRAK paket
   * asal. Revisi yang sudah AKTIF adalah riwayat: dibaca lewat relasinya, ia
   * tetap benar di mana pun lokasinya berada. Draft tidak: di paket tujuan
   * tidak ada adendum yang menaunginya, `createAdendumDraft` menolak draft
   * baru selama ia ada, dan mengaktifkannya di sana berarti mencatat perubahan
   * kontrak paket lain sebagai RAB paket ini. Draft tanpa adendum (impor HPS
   * yang belum diaktifkan) tidak membawa apa pun yang khas-paket, jadi boleh
   * ikut. Recheck user 2026-09-18.
   */
  const draftAdendum = await db.rabRevision.findFirst({
    where: { locationId: lokasi.id, status: "draft", amendmentId: { not: null } },
    select: { revisionNo: true, amendment: { select: { ccoNumber: true } } },
  });
  if (draftAdendum) {
    throw new PindahLokasiError(
      `Lokasi ini punya draft revisi RAB #${draftAdendum.revisionNo} yang terikat adendum ` +
        `${draftAdendum.amendment?.ccoNumber ?? "(tanpa nomor)"} paket "${lokasi.package.name}". ` +
        "Aktifkan atau buang draft itu dulu – di paket tujuan tidak ada adendum yang menaunginya.",
    );
  }

  const [punyaBaseline, laporanTerhitung] = await Promise.all([
    db.baseline.count({ where: { locationId: lokasi.id, status: "aktif" } }),
    db.dailyReport.count({
      where: { locationId: lokasi.id, status: { in: ["dikirim", "disetujui", "final"] } },
    }),
  ]);
  const gridTujuan = grid(tujuan.contract);
  if (!gridTujuan && (punyaBaseline > 0 || laporanTerhitung > 0)) {
    throw new PindahLokasiError(
      `Paket "${tujuan.name}" belum punya SPMK, sementara lokasi ini sudah punya ` +
        `${laporanTerhitung} laporan terhitung dan kurva-S rencananya. Terbitkan SPMK paket tujuan ` +
        "lebih dulu – tanpa kalender, seluruh nomor minggu dan deviasi lokasi ini kehilangan dasarnya.",
    );
  }
  const gridAsal = grid(lokasi.package.contract);

  /*
   * Baris yang memikul packageId DAN locationId sekaligus. Dibiarkan menunjuk
   * paket lama, ia akan mengaku milik paket yang sudah tidak memuat lokasinya.
   */
  const dokumenMenunjukKontrakLama = await db.document.count({
    where: {
      locationId: lokasi.id,
      packageId: lokasi.packageId,
      OR: [{ contractId: { not: null } }, { amendmentId: { not: null } }],
    },
  });

  let grupKabupatenDilepas = false;
  const hasil = await db.$transaction(async (tx) => {
    let barisIkut = 0;
    for (const pindah of [
      () => tx.document.updateMany({ where: { locationId: lokasi.id, packageId: lokasi.packageId }, data: { packageId: tujuan.id } }),
      () => tx.adminMilestone.updateMany({ where: { locationId: lokasi.id, packageId: lokasi.packageId }, data: { packageId: tujuan.id } }),
      () => tx.letter.updateMany({ where: { locationId: lokasi.id, packageId: lokasi.packageId }, data: { packageId: tujuan.id } }),
      () => tx.gDriveUpload.updateMany({ where: { locationId: lokasi.id, packageId: lokasi.packageId }, data: { packageId: tujuan.id } }),
      () => tx.gDriveJob.updateMany({ where: { locationId: lokasi.id, packageId: lokasi.packageId }, data: { packageId: tujuan.id } }),
    ]) {
      barisIkut += (await pindah()).count;
    }

    /*
     * GRUP KABUPATEN PAKET ASAL DILEPAS (DECISIONS 596).
     *
     * Grup kabupaten milik satu paket, ditegakkan FK komposit
     * (wa_group_ref_id, package_id). Tanpa pelepasan ini, pembaruan di bawah
     * GAGAL dengan galat Postgres mentah di tengah transaksi, dan yang membaca
     * layar cuma melihat "terjadi kesalahan".
     *
     * Dilepas, bukan dipindahkan: lokasi yang berpindah paket tidak lagi punya
     * hak atas grup paket asal. Ia kembali mengikuti grup paket barunya, dan
     * itu DISEBUT di hasil supaya yang memindahkan tidak menemukannya sendiri
     * lewat pengingat yang tiba-tiba berhenti datang.
     */
    grupKabupatenDilepas = lokasi.waGroupRefId !== null;
    await tx.location.update({
      where: { id: lokasi.id },
      data: { packageId: tujuan.id, waGroupRefId: null },
    });

    /*
     * Rentang tanggal rencana mingguan dihitung ulang ke GRID PAKET BARU.
     * Blanko harian mencari rencana lewat weekStart<=tanggal<=weekEnd, jadi
     * rentang paket lama akan menjodohkan hari dengan rencana minggu yang
     * salah — atau tidak sama sekali.
     */
    let rencanaDihitungUlang = 0;
    if (gridTujuan && tujuan.contract?.startDate) {
      const rencana = await tx.weeklyPlan.findMany({
        where: { locationId: lokasi.id },
        select: { id: true, weekNumber: true },
      });
      for (const r of rencana) {
        const { start, end } = weekDateRange(
          tujuan.contract.startDate,
          r.weekNumber,
          tujuan.contract.weekMode,
          tujuan.contract.endDate,
        );
        await tx.weeklyPlan.update({ where: { id: r.id }, data: { weekStart: start, weekEnd: end } });
        rencanaDihitungUlang++;
      }
    }

    const catatan =
      input.mode === "cco"
        ? `Perpindahan lokasi lewat adendum ${input.ccoNumber!.trim()}`
        : "Pemindahan lokasi (koreksi salah input paket, bukan adendum)";
    // Jejak di lini masa KEDUA paket — stage tidak berubah (from = to), yang
    // bicara catatannya. Paket lama tetap menyimpan bahwa lokasi ini pernah
    // ada di sana; itu seluruh isi ketetapan user.
    await tx.packageStageHistory.create({
      data: {
        packageId: lokasi.package.id,
        fromStage: lokasi.package.stage,
        toStage: lokasi.package.stage,
        changedById: actor.id,
        note: `${catatan}: "${lokasi.name}" DIPINDAH KE paket "${tujuan.name}" – ${input.alasan}`,
      },
    });
    await tx.packageStageHistory.create({
      data: {
        packageId: tujuan.id,
        fromStage: tujuan.stage,
        toStage: tujuan.stage,
        changedById: actor.id,
        note: `${catatan}: "${lokasi.name}" DITERIMA DARI paket "${lokasi.package.name}" – ${input.alasan}`,
      },
    });

    const payload = {
      locationId: lokasi.id,
      slug: lokasi.slug,
      name: lokasi.name,
      dariPackageId: lokasi.package.id,
      kePackageId: tujuan.id,
      mode: input.mode,
      ccoNumber: input.mode === "cco" ? input.ccoNumber!.trim() : null,
      alasan: input.alasan,
      barisIkut,
      rencanaDihitungUlang,
      dokumenMenunjukKontrakLama,
    };
    // Dicatat pada KEDUA paket: yang mencari "ke mana lokasi itu" membuka paket
    // lama, yang mencari "dari mana lokasi ini" membuka paket baru.
    await auditIn(tx, actor.id, "package.location_move_out", "package", lokasi.package.id, payload, ip);
    await auditIn(tx, actor.id, "package.location_move_in", "package", tujuan.id, payload, ip);

    return { barisIkut, rencanaDihitungUlang };
  });

  /*
   * Konversi baseline & pembangunan ulang snapshot DI LUAR transaksi: keduanya
   * menulis banyak baris dan memanggil lapisan kalkulasi yang membaca keadaan
   * SESUDAH pindah. Kegagalannya tidak boleh membatalkan pemindahan yang sudah
   * sah — tombol "Bangun ulang snapshot" di Sistem tetap jadi jaring terakhir.
   */
  let baseline: HasilPindahLokasi["baseline"] = "tanpa-baseline";
  if (gridTujuan && punyaBaseline > 0) {
    baseline = await konversiBaselineModeMinggu(lokasi.id, {
      oldEndFracs: gridAsal?.fracs ?? null,
      oldTotalWeeks: gridAsal?.totalWeeks ?? gridTujuan.totalWeeks,
      newEndFracs: gridTujuan.fracs,
      newTotalWeeks: gridTujuan.totalWeeks,
      userId: actor.id,
      note: `Pindah paket: "${lokasi.package.name}" → "${tujuan.name}"`,
    });
    /*
     * `konversiBaselineModeMinggu` mewarisi `contractDays` dari baseline lama —
     * benar untuk pemakainya yang lain (ganti mode minggu: kontraknya sama),
     * salah di sini. Masa pelaksanaan milik KONTRAK, dan lokasi ini baru saja
     * berpindah ke kontrak yang lain.
     */
    await db.baseline.updateMany({
      where: { locationId: lokasi.id, status: "aktif" },
      data: { contractDays: durasiTujuan },
    });
  }
  const snapshotDibangunUlang = await bangunUlangSnapshotFinal(lokasi.id, {});

  return {
    locationName: lokasi.name,
    locationSlug: lokasi.slug,
    dariPaket: lokasi.package.name,
    kePaket: tujuan.name,
    rencanaDihitungUlang: hasil.rencanaDihitungUlang,
    baseline,
    snapshotDibangunUlang,
    barisIkut: hasil.barisIkut,
    grupKabupatenDilepas,
    dokumenMenunjukKontrakLama,
  };
}
