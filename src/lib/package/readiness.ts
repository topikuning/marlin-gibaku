import "server-only";
import { db } from "@/lib/db";
import { PACKAGE_STAGE_ORDER } from "@/lib/lifecycle";
import type { PackageStage } from "@/generated/prisma/enums";

/**
 * READINESS GATE PAKET — gap P0 pada PRD ("Guided Package Readiness").
 *
 * PRD §5.2: "Stage ada, tetapi onboarding belum menyajikan checklist terurut
 * dan resumable." Lifecycle-nya memang sudah benar — `canTransitionPackage`
 * menjaga urutan — tetapi ia hanya menjawab "boleh pindah tahap?", bukan
 * "sudah siap pindah tahap?". Akibatnya paket bisa naik tahap dengan data
 * pembentuk yang belum lengkap, dan kekurangannya baru ketahuan jauh di
 * hilir: saat laporan tidak bisa dicetak atau termin tidak bisa diajukan.
 *
 * SIFATNYA ADVISORY, BUKAN PALANG. Keputusan yang disengaja: memasang palang
 * keras pada transisi yang HARI INI berhasil akan mengurung paket yang sudah
 * berjalan di produksi — data lama tidak pernah melewati pemeriksaan ini, jadi
 * sebagian pasti tidak lolos. Yang dijanjikan modul ini adalah pengguna TAHU
 * persis apa yang kurang dan ke mana memperbaikinya sebelum menekan tombol
 * (PRD: "blocker, warning, owner ... dan konfirmasi eksplisit"), bukan sistem
 * yang menolak diam-diam.
 *
 * Tidak ada tabel baru dan tidak ada kolom baru: seluruh syarat DITURUNKAN
 * dari data yang sudah ada.
 */

/** Satu syarat yang bisa terpenuhi atau tidak. */
export type Syarat = {
  label: string;
  /** Sudah terpenuhi? */
  ok: boolean;
  /**
   * `blocker` = benar-benar menghalangi tahap berikutnya bermakna.
   * `warning` = boleh jalan, tetapi menyisakan utang yang harus ditutup.
   */
  tingkat: "blocker" | "warning";
  /** Kenapa ini diminta — supaya checklist tidak terbaca sebagai birokrasi. */
  alasan: string;
  /** Ke mana memperbaikinya. */
  href: string;
};

export type LangkahSetup = {
  key: "tender" | "kontrak" | "lokasi" | "rencana";
  judul: string;
  ringkas: string;
  syarat: Syarat[];
  /** Tidak ada blocker tersisa. */
  siap: boolean;
};

export type PackageReadiness = {
  stage: PackageStage;
  langkah: LangkahSetup[];
  /** Semua blocker lintas langkah — dipakai panel konfirmasi transisi. */
  blockers: Syarat[];
  warnings: Syarat[];
  /** Tahap berikutnya menurut urutan lifecycle; null bila sudah di ujung. */
  stageBerikutnya: PackageStage | null;
};

function stageBerikutnya(stage: PackageStage): PackageStage | null {
  const i = PACKAGE_STAGE_ORDER.indexOf(stage);
  if (i < 0 || i >= PACKAGE_STAGE_ORDER.length - 1) return null;
  return PACKAGE_STAGE_ORDER[i + 1] ?? null;
}

export async function getPackageReadiness(packageId: string): Promise<PackageReadiness | null> {
  const pkg = await db.package.findUnique({
    where: { id: packageId },
    select: {
      stage: true,
      packageNumber: true,
      hpsValue: true,
      candidateVendorName: true,
      contract: {
        select: {
          contractNumber: true,
          contractValue: true,
          signedDate: true,
          startDate: true,
          endDate: true,
          vendor: { select: { name: true } },
        },
      },
      locations: {
        select: {
          id: true,
          name: true,
          slug: true,
          gpsLat: true,
          _count: { select: { rabRevisions: true, baselines: true } },
        },
      },
    },
  });
  if (!pkg) return null;

  const base = `/proyek/paket/${packageId}`;
  const c = pkg.contract;

  const tender: Syarat[] = [
    {
      label: "Nomor paket terisi",
      ok: !!pkg.packageNumber?.trim(),
      tingkat: "warning",
      alasan: "Dipakai di kop laporan KKP dan penomoran dokumen.",
      href: `${base}/tender`,
    },
    {
      label: "Nilai HPS terisi",
      ok: pkg.hpsValue > 0n,
      tingkat: "blocker",
      alasan: "Jadi pembanding nilai kontrak; tanpa ini rekonsiliasi RAB tidak punya acuan.",
      href: `${base}/tender`,
    },
    {
      label: "Calon penyedia tercatat",
      ok: !!pkg.candidateVendorName?.trim() || !!c?.vendor?.name,
      tingkat: "warning",
      alasan: "Menghubungkan hasil tender ke kontrak tanpa input ulang (PRD FR-PKG-03).",
      href: `${base}/tender`,
    },
  ];

  const kontrak: Syarat[] = [
    {
      label: "Kontrak terbit",
      ok: !!c,
      tingkat: "blocker",
      alasan: "Pangkal seluruh angka: nilai, PPN, retensi, uang muka, dan termin.",
      href: `${base}/kontrak`,
    },
    {
      label: "Nomor & nilai kontrak terisi",
      ok: !!c?.contractNumber?.trim() && (c?.contractValue ?? 0n) > 0n,
      tingkat: "blocker",
      alasan: "Dipakai kurva-S, keuangan, dan seluruh laporan formal.",
      href: `${base}/kontrak`,
    },
    {
      label: "Tanggal tanda tangan terisi",
      ok: !!c?.signedDate,
      tingkat: "warning",
      alasan: "Menentukan awal kewajiban administrasi.",
      href: `${base}/kontrak`,
    },
    {
      label: "SPMK terbit (tanggal mulai & selesai)",
      ok: !!c?.startDate && !!c?.endDate,
      tingkat: "blocker",
      alasan:
        "Tanpa periode kerja, baseline kurva-S tidak bisa dibentuk dan deviasi tidak punya arti.",
      href: `${base}/kontrak`,
    },
  ];

  const tanpaRab = pkg.locations.filter((l) => l._count.rabRevisions === 0);
  const tanpaBaseline = pkg.locations.filter((l) => l._count.baselines === 0);
  const tanpaKoordinat = pkg.locations.filter((l) => l.gpsLat == null);

  const lokasi: Syarat[] = [
    {
      label: "Minimal satu lokasi terdaftar",
      ok: pkg.locations.length > 0,
      tingkat: "blocker",
      alasan: "Seluruh pelaksanaan, RAB, dan transaksi menempel pada lokasi.",
      href: `${base}/lokasi`,
    },
    {
      label:
        tanpaKoordinat.length === 0
          ? "Semua lokasi berkoordinat"
          : `${tanpaKoordinat.length} lokasi belum berkoordinat`,
      ok: pkg.locations.length > 0 && tanpaKoordinat.length === 0,
      tingkat: "warning",
      alasan: "Tanpa koordinat, lokasi tidak muncul di peta dan cap foto kehilangan titik cadangan.",
      href: `${base}/lokasi`,
    },
  ];

  const rencana: Syarat[] = [
    {
      label:
        tanpaRab.length === 0
          ? "Semua lokasi punya RAB"
          : `${tanpaRab.length} lokasi belum punya RAB`,
      ok: pkg.locations.length > 0 && tanpaRab.length === 0,
      tingkat: "blocker",
      alasan: "RAB adalah dasar bobot progres; tanpanya kurva-S dan realisasi tidak bisa dihitung.",
      href: tanpaRab[0] ? `/proyek/lokasi/${tanpaRab[0].slug}/rab` : `${base}/lokasi`,
    },
    {
      label:
        tanpaBaseline.length === 0
          ? "Semua lokasi punya baseline"
          : `${tanpaBaseline.length} lokasi belum punya baseline`,
      ok: pkg.locations.length > 0 && tanpaBaseline.length === 0,
      tingkat: "blocker",
      alasan: "Baseline adalah pembanding rencana; tanpanya deviasi selalu terbaca nol.",
      href: tanpaBaseline[0]
        ? `/proyek/lokasi/${tanpaBaseline[0].slug}/progress`
        : `${base}/lokasi`,
    },
  ];

  const langkah: LangkahSetup[] = [
    {
      key: "tender",
      judul: "Tender & penetapan",
      ringkas: "Identitas paket, nilai HPS, dan calon penyedia.",
      syarat: tender,
      siap: tender.every((s) => s.ok || s.tingkat !== "blocker"),
    },
    {
      key: "kontrak",
      judul: "Kontrak & SPMK",
      ringkas: "Pangkal seluruh angka dan periode kerja.",
      syarat: kontrak,
      siap: kontrak.every((s) => s.ok || s.tingkat !== "blocker"),
    },
    {
      key: "lokasi",
      judul: "Lokasi",
      ringkas: "Tempat pekerjaan dilaksanakan dan dicatat.",
      syarat: lokasi,
      siap: lokasi.every((s) => s.ok || s.tingkat !== "blocker"),
    },
    {
      key: "rencana",
      judul: "Rencana & baseline",
      ringkas: "RAB sebagai bobot progres, baseline sebagai pembanding.",
      syarat: rencana,
      siap: rencana.every((s) => s.ok || s.tingkat !== "blocker"),
    },
  ];

  const semua = langkah.flatMap((l) => l.syarat);
  return {
    stage: pkg.stage,
    langkah,
    blockers: semua.filter((s) => !s.ok && s.tingkat === "blocker"),
    warnings: semua.filter((s) => !s.ok && s.tingkat === "warning"),
    stageBerikutnya: stageBerikutnya(pkg.stage),
  };
}
