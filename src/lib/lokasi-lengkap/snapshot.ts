import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey, jakartaToday } from "@/lib/format";
import {
  COUNTED_REPORT_STATUSES,
  FINDING_CATEGORY_LABEL,
  FINDING_STATUS_LABEL,
  LOCATION_STATUS_LABEL,
  OPEN_FINDING_STATUSES,
} from "@/lib/lifecycle";
import { getLocationProgress, getLocationsProgress, cumulativeVolumeByLineage } from "@/lib/progress";
import { bobotPct, realisasiKategoriPct, type WeekPeriodMode } from "@/lib/progress-calc";
import { getScurveSeries } from "@/lib/baseline";
import { asOfMinggu, mingguKontrak, rentangMingguKontrak } from "@/lib/mingguan/kirim";
import { ambilKronologi } from "@/lib/kronologi/queries";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import { sudahLapor } from "@/lib/harian/belum-lapor";
import { AMBANG, evaluasiEwsLokasi, evaluasiEwsPaket, urutkanWarning, type EwsWarning } from "@/lib/ews/rules";
import { PHASE_LABEL } from "@/lib/documents-meta";
import type { SourceRef } from "@/lib/ai-hub/types";
import { kesimpulanLokasi, babakBulanan } from "./kesimpulan";
import type {
  FotoLaporanLokasi,
  KategoriLaporanLokasi,
  KegiatanLaporanLokasi,
  KelengkapanLaporanLokasi,
  KendalaLaporanLokasi,
  KurvaLaporanLokasi,
  LaporanLokasiLengkap,
  MilestoneLaporanLokasi,
  MingguLaporanLokasi,
  TemuanLaporanLokasi,
} from "./jenis";

/**
 * PENGAMBIL DATA LAPORAN LENGKAP SATU LOKASI (permintaan user 2026-09-19).
 *
 * Seluruh angkanya datang dari calculation layer kanonik — `lib/progress`,
 * `lib/baseline`, `lib/progress-calc`, `lib/kronologi/susun`, `lib/ews/rules`.
 * Berkas ini MERAKIT, tidak menghitung: tidak ada rumus progres, deviasi, atau
 * bobot yang ditulis ulang di sini. Yang memang dihitung di sini hanya cacah
 * baris dan selisih hari kalender.
 *
 * TANPA otorisasi di dalam — pemanggil yang menggerbangi (halaman lewat
 * page-guard + `requireLocationAccess`, route lewat sesi + `report.export`,
 * jalur WhatsApp lewat penyaring lingkup). Pola yang sama dengan
 * `ambilKronologi` dan `renderHarianKkpPdf`.
 *
 * ### Dua keputusan yang menentukan seluruh angkanya
 *
 * 1. **Tanpa `opts.asOf` = POSISI TERKINI.** Snapshot tidak mengarang `asOf`
 *    hari ini lalu menyerahkannya ke calculation layer: `${asOf}::date` di SQL
 *    `getLocationsProgress` di-cast di zona SERVER (UTC), sehingga stempel
 *    waktu sore WIB bisa memangkas laporan hari ini. Tanpa `asOf` ia membaca
 *    posisi terkini — persis kepala halaman lokasi.
 *
 * 2. **Mingguan dari `getLocationsProgress` asOf AKHIR tiap minggu.** Realisasi
 *    minggu lampau tidak diambil dari deret `actualPct` melainkan dihitung
 *    `asOf` akhir minggunya (pola `paparan/snapshot.ts`, DECISIONS 357):
 *    semantiknya persis "posisi pada akhir minggu itu", dan ia tetap hidup saat
 *    kontrak molor melewati panjang kurva-S. Dijalankan paralel.
 */

const HARI_MS = 86_400_000;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function selisihHari(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / HARI_MS);
}

/** Tengah malam UTC — tanggal kerja `@db.Date` disimpan begitu. */
function tengahMalam(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function keTanggal(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export async function buatLaporanLokasiLengkap(
  locationId: string,
  opts: { asOf?: Date } = {},
): Promise<LaporanLokasiLengkap | null> {
  const lokasi = await db.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      slug: true,
      village: true,
      district: true,
      regency: true,
      province: true,
      gpsLat: true,
      gpsLng: true,
      status: true,
      pelaksanaName: true,
      pelaksanaTitle: true,
      supervisorName: true,
      supervisorFirm: true,
      package: {
        select: {
          id: true,
          name: true,
          packageNumber: true,
          ownerAgency: true,
          pelaksanaName: true,
          pelaksanaTitle: true,
          contract: {
            select: {
              contractNumber: true,
              workTitle: true,
              contractValue: true,
              durationDays: true,
              startDate: true,
              endDate: true,
              weekMode: true,
              ppkName: true,
              supervisorName: true,
              supervisorFirm: true,
              vendor: { select: { name: true } },
              amendments: { select: { endDateDelta: true } },
            },
          },
        },
      },
    },
  });
  if (!lokasi) return null;

  const limitations: string[] = [];
  const sumber: SourceRef[] = [];
  const pkg = lokasi.package;
  const kontrak = pkg.contract;
  const mulai = kontrak?.startDate ?? null;
  const weekMode: WeekPeriodMode = kontrak?.weekMode ?? "tujuh_hari";

  /*
   * `asOf` yang diminta pemanggil dipakai apa adanya; tanpa itu seluruh
   * pembacaan memakai posisi TERKINI (calculation layer dipanggil TANPA asOf).
   * `asOfKey` tetap ditulis supaya laporan menyebut kapan angkanya berlaku.
   */
  const asOf = opts.asOf ?? null;
  const asOfKey = jakartaDateKey(asOf ?? new Date());
  const asOfHari = tengahMalam(asOf ?? jakartaToday());
  const optProgres = asOf ? { asOf } : {};

  /* ── Progres (calculation layer) ─────────────────────────────────────── */

  const [progresUtama, progresVerifikasi] = await Promise.all([
    getLocationProgress(locationId, optProgres),
    getLocationProgress(locationId, { ...optProgres, statusLevel: "terverifikasi" }),
  ]);

  const punyaRab = progresUtama.activeRevisionId != null && progresUtama.grandTotal > 0n;
  const punyaKurva = progresUtama.totalWeeks > 0 && progresUtama.activeBaselineId != null;
  if (!punyaRab) limitations.push("Lokasi ini belum punya RAB aktif – realisasi dan bobot kategori belum bisa dihitung.");
  if (!punyaKurva) limitations.push("Lokasi ini belum punya kurva-S (baseline) aktif – rencana dan deviasi belum bisa diukur.");
  if (!kontrak || !mulai) {
    limitations.push("Paket belum berkontrak / SPMK belum terbit – minggu kontrak, durasi, dan kelengkapan harian belum bisa dihitung.");
  }

  /*
   * Minggu kontrak dari `mingguKontrak()` (lib/mingguan/kirim), BUKAN
   * `progres.weekNumber`: yang terakhir di-clamp ke panjang baseline dan jatuh
   * ke 1 bila baseline belum ada, sehingga lokasi tanpa kurva-S di minggu ke-5
   * akan terbaca "minggu ke-1". Nomor minggu adalah sifat KONTRAK.
   */
  const mingguBerjalan = mulai ? mingguKontrak(mulai, asOf ?? new Date(), weekMode) : 0;

  sumber.push({
    id: `${lokasi.slug}:progress`,
    entityType: "location",
    entityId: lokasi.id,
    label: `${lokasi.name} – progres s.d. ${asOfKey}`,
    value: punyaKurva
      ? `rencana ${progresUtama.planPct.toFixed(1)}% · realisasi ${progresUtama.realizedPct.toFixed(1)}%`
      : `realisasi ${progresUtama.realizedPct.toFixed(1)}% (belum ada kurva-S)`,
    href: `/lokasi/${lokasi.slug}/progress`,
  });

  /* ── Perkembangan mingguan ───────────────────────────────────────────── */

  const mingguan: MingguLaporanLokasi[] = [];
  if (mulai && mingguBerjalan >= 1) {
    const nomor = Array.from({ length: mingguBerjalan }, (_, i) => i + 1);
    const rentangPerMinggu = nomor.map((n) => rentangMingguKontrak(mulai, n, weekMode));
    /*
     * Satu panggilan calculation layer per minggu, DIJALANKAN PARALEL (pola
     * `paparan/snapshot.ts`). Mahal untuk kontrak panjang – laporan ini memang
     * dibuat per lokasi, jangan dipanggil di dalam perulangan lintas lokasi.
     */
    const posisi = await Promise.all(
      nomor.map((n) =>
        getLocationsProgress([locationId], { asOf: asOfMinggu(mulai, n, asOf ?? new Date(), weekMode) }),
      ),
    );
    // Laporan terhitung per minggu – cacah baris, bukan rumus angka.
    const laporanRentang = await db.dailyReport.findMany({
      where: {
        locationId,
        status: { in: [...COUNTED_REPORT_STATUSES] },
        reportDate: { gte: rentangPerMinggu[0].mulai, lte: rentangPerMinggu[rentangPerMinggu.length - 1].akhir },
      },
      select: { reportDate: true },
    });

    let sebelumnya: number | null = 0;
    for (let i = 0; i < nomor.length; i++) {
      const r = rentangPerMinggu[i];
      const p = posisi[i].get(locationId) ?? null;
      const rencanaPct = punyaKurva && p ? p.planPct : null;
      const realisasiPct = p ? p.realizedPct : null;
      const jumlahLaporan = laporanRentang.filter(
        (x) => x.reportDate >= r.mulai && x.reportDate <= r.akhir,
      ).length;
      mingguan.push({
        minggu: nomor[i],
        mulaiKey: dateKey(r.mulai),
        akhirKey: dateKey(r.akhir),
        rencanaPct,
        realisasiPct,
        kenaikanPp: realisasiPct != null && sebelumnya != null ? realisasiPct - sebelumnya : null,
        deviasiPp: realisasiPct != null && rencanaPct != null ? realisasiPct - rencanaPct : null,
        laporanTerhitung: jumlahLaporan,
      });
      sebelumnya = realisasiPct;
    }
  }

  /* ── Kurva-S ─────────────────────────────────────────────────────────── */

  /*
   * Rencana dari `getScurveSeries` (deret baseline kanonik). Realisasinya
   * TIDAK diambil dari `seri.actualPct`: deret itu selalu dihitung sampai HARI
   * INI, sehingga laporan bertanggal lampau akan menggambar garis yang memuat
   * laporan sesudah `asOf` — grafik yang bercerita lain dari angka di
   * sebelahnya, pada dokumen yang sama.
   *
   * Yang dipakai adalah deret `mingguan` di atas: posisi akhir tiap minggu
   * menurut `getLocationsProgress` dengan `asOf` minggu itu — calculation layer
   * yang sama, semantik yang persis, dan ber-`asOf` benar. Minggu yang belum
   * tiba tetap null, bukan 0: nol berarti "tidak ada kemajuan", dan itu bukan
   * yang diketahui tentang minggu depan.
   */
  const seri = await getScurveSeries(locationId);
  let kurva: KurvaLaporanLokasi | null = null;
  if (seri.totalWeeks > 0) {
    const realisasiPerMinggu = new Map(mingguan.map((m) => [m.minggu, m.realisasiPct]));
    const actualPct: (number | null)[] = seri.planPct.map((_, i) => realisasiPerMinggu.get(i + 1) ?? null);
    if (mingguBerjalan > seri.totalWeeks) {
      limitations.push(
        `Minggu kontrak berjalan (ke-${mingguBerjalan}) sudah melewati panjang kurva-S (${seri.totalWeeks} minggu); grafik berhenti di minggu ke-${seri.totalWeeks}, tabel perkembangan mingguan tetap penuh.`,
      );
    }
    kurva = {
      totalMinggu: seri.totalWeeks,
      mingguBerjalan: Math.max(1, Math.min(seri.totalWeeks, mingguBerjalan || seri.currentWeek)),
      planPct: seri.planPct,
      actualPct,
    };
  }

  /* ── Durasi pelaksanaan ──────────────────────────────────────────────── */

  // Akhir kontrak EFEKTIF = endDate + Σ endDateDelta adendum.
  let akhirEfektif: Date | null = kontrak?.endDate ?? null;
  const deltaHari = kontrak?.amendments.reduce((acc, a) => acc + a.endDateDelta, 0) ?? 0;
  if (akhirEfektif && deltaHari !== 0) akhirEfektif = new Date(akhirEfektif.getTime() + deltaHari * HARI_MS);
  if (deltaHari !== 0) {
    limitations.push(`Masa kontrak sudah diperpanjang/dipersingkat adendum (${deltaHari > 0 ? "+" : ""}${deltaHari} hari) – akhir kontrak yang dipakai sudah memperhitungkannya.`);
  }

  const totalHari = kontrak?.durationDays ?? 0;
  const durasi =
    kontrak && mulai && totalHari > 0
      ? (() => {
          const hariBerjalan = Math.max(0, Math.min(totalHari, selisihHari(asOfHari, tengahMalam(mulai)) + 1));
          return {
            totalHari,
            hariBerjalan,
            sisaHari: Math.max(0, totalHari - hariBerjalan),
            pctWaktu: (hariBerjalan / totalHari) * 100,
          };
        })()
      : null;

  /* ── Status per KATEGORI RAB (formula kanonik) ───────────────────────── */

  const kategori: KategoriLaporanLokasi[] = [];
  if (progresUtama.activeRevisionId) {
    const [nodes, volCum] = await Promise.all([
      db.rabNode.findMany({
        where: { revisionId: progresUtama.activeRevisionId, kind: { in: ["kategori", "item"] } },
        orderBy: { sortOrder: "asc" },
        select: { kind: true, name: true, lineageKey: true, volume: true, amount: true },
      }),
      cumulativeVolumeByLineage(locationId, asOf ?? undefined),
    ]);
    const total = Number(progresUtama.grandTotal);
    for (const kat of nodes.filter((n) => n.kind === "kategori")) {
      const akar = kat.lineageKey;
      const items = nodes.filter(
        (n) => n.kind === "item" && (n.lineageKey === akar || n.lineageKey.startsWith(`${akar}#`)),
      );
      kategori.push({
        lineageKey: akar,
        nama: kat.name,
        // Formula realisasi & bobot dari calculation layer — tidak disusun ulang.
        bobotPct: bobotPct(Number(kat.amount), total),
        realisasiPct: realisasiKategoriPct(
          items.map((it) => ({
            volSd: volCum.get(it.lineageKey) ?? 0,
            volK: it.volume ? Number(it.volume.toString()) : 0,
            amount: Number(it.amount),
          })),
          Number(kat.amount),
        ),
        nilai: kat.amount.toString(),
      });
    }
    sumber.push({
      id: `${lokasi.slug}:rab`,
      entityType: "location",
      entityId: lokasi.id,
      label: `${lokasi.name} – RAB revisi aktif (${kategori.length} kategori)`,
      href: `/lokasi/${lokasi.slug}/rab`,
    });
  }

  /* ── Kelengkapan laporan harian (DECISIONS 340) ──────────────────────── */

  /*
   * Hari yang DIHARAPKAN berlaporan = hari kalender dalam masa kontrak yang
   * SUDAH LEWAT: sejak SPMK sampai `asOf`, dipotong akhir kontrak efektif.
   * Hari sebelum SPMK dan hari yang belum tiba TIDAK dihitung (DECISIONS 340 /
   * 202) — hari yang pekerjaannya belum boleh dimulai bukan hari yang
   * terlambat. "Sudah melapor" memakai aturan yang SAMA dengan penagih harian
   * (`sudahLapor`): apa pun selain draf.
   */
  let kelengkapan: KelengkapanLaporanLokasi | null = null;
  if (mulai) {
    const batasAkhir = akhirEfektif && akhirEfektif < asOfHari ? tengahMalam(akhirEfektif) : asOfHari;
    const hariDiharapkan = Math.max(0, selisihHari(batasAkhir, tengahMalam(mulai)) + 1);
    const laporan = await db.dailyReport.findMany({
      where: { locationId, reportDate: { gte: tengahMalam(mulai), lte: batasAkhir } },
      select: { reportDate: true, status: true, noActivity: true },
    });
    const hitung = { final: 0, disetujui: 0, dikirim: 0, draft: 0, perluKoreksi: 0, hariNihil: 0 };
    const hariBerlaporan = new Set<string>();
    for (const r of laporan) {
      if (r.status === "final") hitung.final += 1;
      else if (r.status === "disetujui") hitung.disetujui += 1;
      else if (r.status === "dikirim") hitung.dikirim += 1;
      else if (r.status === "draft") hitung.draft += 1;
      else if (r.status === "perlu_koreksi") hitung.perluKoreksi += 1;
      if (r.noActivity) hitung.hariNihil += 1;
      if (sudahLapor(r.status)) hariBerlaporan.add(dateKey(r.reportDate));
    }
    const terakhir = await db.dailyReport.findFirst({
      where: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] }, reportDate: { lte: batasAkhir } },
      orderBy: { reportDate: "desc" },
      select: { reportDate: true },
    });
    kelengkapan = {
      hariDiharapkan,
      ...hitung,
      hariTanpaLaporan: Math.max(0, hariDiharapkan - hariBerlaporan.size),
      laporanTerakhirKey: terakhir ? dateKey(terakhir.reportDate) : null,
      hariSejakLaporanTerakhir: terakhir ? Math.max(0, selisihHari(asOfHari, tengahMalam(terakhir.reportDate))) : null,
    };
    if (akhirEfektif && akhirEfektif < asOfHari) {
      limitations.push(`Kelengkapan harian dihitung sampai akhir masa kontrak (${dateKey(akhirEfektif)}), bukan sampai ${asOfKey}.`);
    }
    sumber.push({
      id: `${lokasi.slug}:laporan`,
      entityType: "location",
      entityId: lokasi.id,
      label: `${lokasi.name} – laporan harian sejak SPMK s.d. ${asOfKey}`,
      href: `/lokasi/${lokasi.slug}/harian`,
    });
  }

  /* ── Kendala ─────────────────────────────────────────────────────────── */

  // `mergedIntoId: null` WAJIB — kendala kembar yang sudah digabung tidak
  // boleh muncul lagi (DECISIONS 393).
  const issues = await db.issue.findMany({
    where: { locationId, mergedIntoId: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      severity: true,
      status: true,
      source: true,
      createdAt: true,
      closedAt: true,
      dueDate: true,
      picName: true,
      picUserId: true,
    },
  });
  const picIds = [...new Set(issues.map((i) => i.picUserId).filter((v): v is string => !!v))];
  const picNama = new Map(
    picIds.length === 0
      ? []
      : (await db.user.findMany({ where: { id: { in: picIds } }, select: { id: true, fullName: true } })).map(
          (u) => [u.id, u.fullName] as const,
        ),
  );
  const keKendala = (i: (typeof issues)[number]): KendalaLaporanLokasi => {
    const dibuka = jakartaDateKey(i.createdAt);
    const ditutup = i.closedAt ? jakartaDateKey(i.closedAt) : null;
    const terbuka = i.status !== "selesai";
    const tenggatKey = i.dueDate ? dateKey(i.dueDate) : null;
    const sampai = ditutup && !terbuka ? keTanggal(ditutup) : asOfHari;
    return {
      id: i.id,
      judul: i.title,
      tingkat: i.severity,
      status: i.status,
      dibukaKey: dibuka,
      ditutupKey: ditutup,
      // PIC di luar MARLIN memang hanya bernama, tidak berakun (DECISIONS 426).
      pic: (i.picUserId ? picNama.get(i.picUserId) : null) ?? i.picName ?? null,
      tenggatKey,
      lewatTenggat: terbuka && tenggatKey != null && tenggatKey < asOfKey,
      umurHari: Math.max(0, selisihHari(sampai, keTanggal(dibuka))),
      sumber: i.source,
    };
  };
  const kendalaTerbuka = issues.filter((i) => i.status !== "selesai").map(keKendala);
  const kendalaSelesai = issues
    .filter((i) => i.status === "selesai")
    .map(keKendala)
    .sort((a, b) => (b.ditutupKey ?? "").localeCompare(a.ditutupKey ?? ""));
  if (issues.length > 0) {
    limitations.push("Status kendala lampau adalah status TERKINI saat laporan dibuat – Issue tidak menyimpan histori status.");
    sumber.push({
      id: `${lokasi.slug}:kendala`,
      entityType: "location",
      entityId: lokasi.id,
      label: `${lokasi.name} – ${issues.length} kendala tercatat (${kendalaTerbuka.length} terbuka)`,
      href: "/kendala",
    });
  }

  /* ── Kronologi (aturan kanonik `susunKronologi`) ─────────────────────── */

  const hariKronologi = mulai ? Math.max(90, selisihHari(asOfHari, tengahMalam(mulai)) + 1) : 90;
  const kron = await ambilKronologi(locationId, { sampai: asOfKey, hari: hariKronologi, batas: 200 });
  const babak = babakBulanan(kron?.peristiwa ?? []);
  if (kron && kron.dipotong > 0) {
    limitations.push(`${kron.dipotong} peristiwa lampau tidak ikut ditampilkan di kronologi (batas 200 peristiwa); yang masih berjalan selalu ikut.`);
  }

  /* ── Kegiatan lapangan ───────────────────────────────────────────────── */

  const [jumlahKegiatan, kegiatanTerakhir, labelJenis] = await Promise.all([
    db.fieldActivity.count({ where: { locationId, activityDate: { lte: asOfHari } } }),
    db.fieldActivity.findMany({
      where: { locationId, activityDate: { lte: asOfHari } },
      orderBy: { activityDate: "desc" },
      take: 10,
      select: { id: true, activityDate: true, type: true, title: true, status: true, _count: { select: { photos: true } } },
    }),
    getActivityKindLabelMap(),
  ]);
  const kegiatan: KegiatanLaporanLokasi[] = kegiatanTerakhir.map((g) => ({
    id: g.id,
    tanggalKey: dateKey(g.activityDate),
    jenis: labelJenis.get(g.type) ?? g.type,
    judul: g.title,
    status: g.status,
    jumlahFoto: g._count.photos,
  }));

  /* ── Temuan & inspeksi ───────────────────────────────────────────────── */

  const [temuanSemua, jumlahInspeksi, inspeksiTerakhir] = await Promise.all([
    db.finding.findMany({
      where: { locationId, findingDate: { lte: asOfHari } },
      orderBy: [{ severity: "desc" }, { findingDate: "asc" }],
      select: {
        id: true,
        title: true,
        category: true,
        severity: true,
        status: true,
        findingDate: true,
        dueDate: true,
        reopenCount: true,
        assignedName: true,
        assignedToId: true,
      },
    }),
    db.inspection.count({ where: { locationId, inspectionDate: { lte: asOfHari } } }),
    db.inspection.findFirst({
      where: { locationId, inspectionDate: { lte: asOfHari } },
      orderBy: { inspectionDate: "desc" },
      select: { inspectionDate: true },
    }),
  ]);
  // PIC temuan: `Finding` tidak punya relasi ke User (hanya `assignedToId`),
  // jadi namanya dibaca terpisah — pola yang sama dengan PIC kendala.
  const picTemuanIds = [...new Set(temuanSemua.map((t) => t.assignedToId).filter((v): v is string => !!v))];
  const picTemuan = new Map(
    picTemuanIds.length === 0
      ? []
      : (await db.user.findMany({ where: { id: { in: picTemuanIds } }, select: { id: true, fullName: true } })).map(
          (u) => [u.id, u.fullName] as const,
        ),
  );
  const terbukaStatus = new Set<string>(OPEN_FINDING_STATUSES);
  const keTemuan = (t: (typeof temuanSemua)[number]): TemuanLaporanLokasi => {
    const tenggatKey = t.dueDate ? dateKey(t.dueDate) : null;
    return {
      id: t.id,
      judul: t.title,
      // LABEL, bukan enum mentah: renderer hanya memformat.
      kategori: FINDING_CATEGORY_LABEL[t.category],
      tingkat: t.severity,
      status: t.status,
      statusLabel: FINDING_STATUS_LABEL[t.status],
      tanggalKey: dateKey(t.findingDate),
      tenggatKey,
      lewatTenggat: terbukaStatus.has(t.status) && tenggatKey != null && tenggatKey < asOfKey,
      penanggungJawab: (t.assignedToId ? picTemuan.get(t.assignedToId) : null) ?? t.assignedName ?? null,
    };
  };
  const temuanTerbuka = temuanSemua.filter((t) => terbukaStatus.has(t.status)).map(keTemuan);
  const temuanRingkas = {
    total: temuanSemua.length,
    terbuka: temuanTerbuka.length,
    kritis: temuanTerbuka.filter((t) => t.tingkat === "kritis").length,
    lewatTenggat: temuanTerbuka.filter((t) => t.lewatTenggat).length,
    selesai: temuanSemua.filter((t) => t.status === "selesai").length,
    inspeksi: jumlahInspeksi,
    inspeksiTerakhirKey: inspeksiTerakhir ? dateKey(inspeksiTerakhir.inspectionDate) : null,
  };
  if (temuanSemua.length > 0) {
    limitations.push("Status temuan adalah status TERKINI saat laporan dibuat, bukan status pada tanggal laporan.");
    sumber.push({
      id: `${lokasi.slug}:temuan`,
      entityType: "location",
      entityId: lokasi.id,
      label: `${lokasi.name} – ${temuanSemua.length} temuan (${temuanRingkas.terbuka} terbuka)`,
      href: `/temuan?lokasi=${lokasi.slug}`,
    });
  }

  /* ── Administrasi: milestone, dokumen, surat ─────────────────────────── */

  /*
   * Lingkupnya lokasi ini DAN paketnya. Milestone/dokumen/surat tingkat PAKET
   * (`locationId: null`) memang berlaku untuk seluruh lokasi paket — kontrak,
   * jaminan, SPMK bukan milik satu desa — jadi mengeluarkannya akan membuat
   * laporan lokasi terbaca "tidak ada dokumen apa pun". Ikut sertanya disebut
   * di keterbatasan supaya tidak terbaca sebagai milik lokasi ini sendiri.
   */
  const batasSegera = new Date(asOfHari.getTime() + AMBANG.dokKadaluarsaSegeraHari * HARI_MS);
  const [milestones, dokumen, surat, suratTerakhir] = await Promise.all([
    db.adminMilestone.findMany({
      where: { packageId: pkg.id, OR: [{ locationId: null }, { locationId }] },
      select: { phase: true, status: true, dueDate: true },
    }),
    db.document.findMany({
      where: { status: "aktif", OR: [{ packageId: pkg.id, locationId: null }, { locationId }] },
      select: { phase: true, expiryDate: true, title: true },
    }),
    db.letter.findMany({
      where: { packageId: pkg.id, status: { not: "dibatalkan" } },
      select: { direction: true, needsReply: true, status: true, replyDueDate: true },
    }),
    db.letter.findMany({
      where: { packageId: pkg.id, status: { not: "dibatalkan" }, handledDate: { lte: asOfHari } },
      orderBy: { handledDate: "desc" },
      take: 5,
      select: { id: true, direction: true, handledDate: true, subject: true },
    }),
  ]);

  const faseMilestone = new Map<string, MilestoneLaporanLokasi>();
  for (const m of milestones) {
    const row = faseMilestone.get(m.phase) ?? {
      fase: m.phase,
      label: PHASE_LABEL[m.phase],
      total: 0,
      selesai: 0,
      terlambat: 0,
    };
    row.total += 1;
    if (m.status === "selesai") row.selesai += 1;
    else if (m.status !== "tidak_berlaku" && m.dueDate && m.dueDate < asOfHari) row.terlambat += 1;
    faseMilestone.set(m.phase, row);
  }
  const milestoneTerlambat = [...faseMilestone.values()].reduce((a, m) => a + m.terlambat, 0);

  const dokKedaluwarsa = dokumen.filter((d) => d.expiryDate != null && d.expiryDate < asOfHari);
  const dokSegera = dokumen
    .filter((d) => d.expiryDate != null && d.expiryDate >= asOfHari && d.expiryDate < batasSegera)
    .map((d) => ({ title: d.title, hariLagi: selisihHari(d.expiryDate!, asOfHari) }))
    .sort((a, b) => a.hariLagi - b.hariLagi);
  const faseDokumen = new Map<string, { fase: string; label: string; jumlah: number }>();
  for (const d of dokumen) {
    const row = faseDokumen.get(d.phase) ?? { fase: d.phase, label: PHASE_LABEL[d.phase], jumlah: 0 };
    row.jumlah += 1;
    faseDokumen.set(d.phase, row);
  }

  if (milestones.length > 0 || dokumen.length > 0 || surat.length > 0) {
    limitations.push("Administrasi memasukkan milestone, dokumen, dan surat tingkat PAKET (berlaku untuk seluruh lokasi paket), bukan hanya yang khusus lokasi ini.");
    sumber.push({
      id: `${lokasi.slug}:administrasi`,
      entityType: "package",
      entityId: pkg.id,
      label: `${pkg.name} – administrasi (${milestones.length} milestone, ${dokumen.length} dokumen, ${surat.length} surat)`,
      href: `/paket/${pkg.id}/dokumen`,
    });
  }

  const administrasi = {
    milestone: [...faseMilestone.values()],
    dokumen: {
      total: dokumen.length,
      kedaluwarsa: dokKedaluwarsa.length,
      segeraKedaluwarsa: dokSegera.length,
      perFase: [...faseDokumen.values()],
    },
    surat: {
      masuk: surat.filter((s) => s.direction === "masuk").length,
      keluar: surat.filter((s) => s.direction === "keluar").length,
      perluBalas: surat.filter((s) => s.needsReply && (s.status === "baru" || s.status === "perlu_jawaban")).length,
      lewatTenggatBalas: surat.filter(
        (s) =>
          s.needsReply &&
          (s.status === "baru" || s.status === "perlu_jawaban") &&
          s.replyDueDate != null &&
          s.replyDueDate < asOfHari,
      ).length,
      terakhir: suratTerakhir.map((s) => ({
        id: s.id,
        arah: s.direction,
        tanggalKey: dateKey(s.handledDate),
        perihal: s.subject,
      })),
    },
  };

  /* ── Foto ────────────────────────────────────────────────────────────── */

  const [jumlahFoto, fotoRaw] = await Promise.all([
    db.photo.count({ where: { locationId } }),
    db.photo.findMany({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        r2Key: true,
        thumbnailKey: true,
        report: { select: { reportDate: true } },
        activity: { select: { title: true, activityDate: true } },
        reportItem: { select: { lineageKey: true, rabNode: { select: { name: true } } } },
      },
    }),
  ]);
  const semuaFoto: FotoLaporanLokasi[] = fotoRaw.map((f) => {
    const tanggal = f.report?.reportDate ?? f.activity?.activityDate ?? null;
    return {
      id: f.id,
      tanggalKey: tanggal ? dateKey(tanggal) : null,
      keterangan: f.reportItem?.rabNode.name ?? f.activity?.title ?? null,
      lineageKey: f.reportItem?.lineageKey ?? null,
      r2Key: f.r2Key,
      thumbnailKey: f.thumbnailKey,
    };
  });
  // Satu foto per kategori RAB lebih dulu (supaya dokumentasinya mewakili
  // pekerjaan yang berbeda), sisanya terbaru.
  const kandidat: FotoLaporanLokasi[] = [];
  const kategoriTerpakai = new Set<string>();
  for (const f of semuaFoto) {
    if (kandidat.length >= 8) break;
    const akar = f.lineageKey ? f.lineageKey.split("#")[0] : null;
    if (akar && !kategoriTerpakai.has(akar)) {
      kategoriTerpakai.add(akar);
      kandidat.push(f);
    }
  }
  for (const f of semuaFoto) {
    if (kandidat.length >= 8) break;
    if (!kandidat.some((x) => x.id === f.id)) kandidat.push(f);
  }
  if (jumlahFoto > kandidat.length) {
    limitations.push(`Foto yang ditampilkan ${kandidat.length} dari ${jumlahFoto} foto tersimpan (satu per kategori pekerjaan lebih dulu, sisanya terbaru).`);
  }

  /* ── Rencana minggu depan ────────────────────────────────────────────── */

  const rencanaRaw =
    mingguBerjalan >= 1
      ? await db.weeklyPlan.findFirst({
          where: { locationId, weekNumber: mingguBerjalan + 1, items: { some: {} } },
          select: {
            weekNumber: true,
            note: true,
            items: { select: { targetVolume: true, rabNode: { select: { name: true, unit: true } } } },
          },
        })
      : null;
  const rencanaMingguDepan = rencanaRaw
    ? {
        mingguKe: rencanaRaw.weekNumber,
        catatan: rencanaRaw.note,
        item: rencanaRaw.items.map((it) => ({
          nama: it.rabNode.name,
          unit: it.rabNode.unit,
          targetVolume: Number(it.targetVolume.toString()),
        })),
      }
    : null;
  if (!rencanaMingguDepan && mingguBerjalan >= 1) {
    limitations.push(`Rencana minggu ke-${mingguBerjalan + 1} belum diisi di MARLIN.`);
  }

  /* ── Perhatian: rule EWS kanonik, tanpa aturan baru ──────────────────── */

  const perluKoreksiCount = kelengkapan?.perluKoreksi ?? 0;
  const faktaLokasi = {
    locationName: lokasi.name,
    locationSlug: lokasi.slug,
    status: lokasi.status,
    // EWS memakai `weekNumber` dari calculation layer, sama dengan `ews/builder.ts`.
    weekNumber: progresUtama.weekNumber,
    totalWeeks: progresUtama.totalWeeks,
    deviationPct: progresUtama.deviationPct,
    realizedPct: progresUtama.realizedPct,
    hariTanpaLaporan: kelengkapan?.hariSejakLaporanTerakhir ?? null,
    laporanPerluKoreksi: perluKoreksiCount,
    sisaHariKontrak: akhirEfektif ? selisihHari(tengahMalam(akhirEfektif), asOfHari) : null,
    waktuTerpakaiPct:
      mulai && akhirEfektif && akhirEfektif > mulai
        ? (selisihHari(asOfHari, tengahMalam(mulai)) / selisihHari(tengahMalam(akhirEfektif), tengahMalam(mulai))) * 100
        : null,
    temuanKritisTerbuka: temuanRingkas.kritis,
    temuanLewatTenggat: temuanRingkas.lewatTenggat,
    temuanDibukaKembali: temuanSemua.filter((t) => t.status === "dibuka_kembali").length,
    kendalaLewatTenggat: kendalaTerbuka.filter((k) => k.lewatTenggat).length,
  };
  const perhatian: EwsWarning[] = urutkanWarning([
    ...evaluasiEwsLokasi(faktaLokasi),
    ...evaluasiEwsPaket({
      packageId: pkg.id,
      packageName: pkg.name,
      dokSudahKadaluarsa: dokKedaluwarsa.map((d) => ({ title: d.title })),
      dokSegeraKadaluarsa: dokSegera,
      milestoneTerlambat,
    }),
  ]);

  /* ── Rakit ───────────────────────────────────────────────────────────── */

  const tanpaKesimpulan: Omit<LaporanLokasiLengkap, "kesimpulan"> = {
    version: 1,
    asOfKey,
    dibuatPada: new Date().toISOString(),
    identitas: {
      locationId: lokasi.id,
      slug: lokasi.slug,
      nama: lokasi.name,
      desa: lokasi.village,
      kecamatan: lokasi.district,
      kabupaten: lokasi.regency,
      provinsi: lokasi.province,
      gps:
        lokasi.gpsLat != null && lokasi.gpsLng != null
          ? { lat: Number(lokasi.gpsLat.toString()), lng: Number(lokasi.gpsLng.toString()) }
          : null,
      status: lokasi.status,
      statusLabel: LOCATION_STATUS_LABEL[lokasi.status],
      paket: { id: pkg.id, nama: pkg.name, nomor: pkg.packageNumber, instansi: pkg.ownerAgency },
      kontrak: kontrak
        ? {
            nomor: kontrak.contractNumber,
            judulKerja: kontrak.workTitle,
            vendor: kontrak.vendor.name,
            nilai: kontrak.contractValue.toString(),
            mulaiKey: kontrak.startDate ? dateKey(kontrak.startDate) : "",
            akhirKey: akhirEfektif ? dateKey(akhirEfektif) : null,
            durasiHari: kontrak.durationDays,
            weekMode: kontrak.weekMode,
            ppk: kontrak.ppkName,
            // Pengawas per lokasi menimpa milik kontrak (DECISIONS 409).
            pengawas: lokasi.supervisorName ?? kontrak.supervisorName,
            pengawasFirma: lokasi.supervisorName ? lokasi.supervisorFirm : kontrak.supervisorFirm,
          }
        : null,
      pelaksana:
        lokasi.pelaksanaName || pkg.pelaksanaName
          ? {
              nama: (lokasi.pelaksanaName ?? pkg.pelaksanaName)!,
              jabatan: lokasi.pelaksanaName ? lokasi.pelaksanaTitle : pkg.pelaksanaTitle,
            }
          : null,
    },
    progres: {
      // Angka DISIMPAN APA ADANYA (tanpa pembulatan) supaya identik dengan
      // calculation layer; pembulatan urusan penyaji.
      rencanaPct: punyaKurva ? progresUtama.planPct : null,
      realisasiPct: progresUtama.realizedPct,
      deviasiPp: punyaKurva ? progresUtama.deviationPct : null,
      terverifikasiPct: progresVerifikasi.realizedPct,
      nilaiRab: progresUtama.grandTotal.toString(),
      nilaiTerpasang: progresUtama.realizedValue.toString(),
      mingguKe: mingguBerjalan,
      totalMinggu: progresUtama.totalWeeks,
      punyaRab,
      punyaKurva,
    },
    mingguan,
    kurva,
    durasi,
    kategori,
    kelengkapan,
    kendala: {
      ringkas: {
        terbuka: kendalaTerbuka.length,
        kritis: kendalaTerbuka.filter((k) => k.tingkat === "kritis").length,
        lewatTenggat: kendalaTerbuka.filter((k) => k.lewatTenggat).length,
        selesai: kendalaSelesai.length,
        tertuaHari: kendalaTerbuka.length === 0 ? null : Math.max(...kendalaTerbuka.map((k) => k.umurHari)),
      },
      terbuka: kendalaTerbuka,
      selesaiTerbaru: kendalaSelesai.slice(0, 10),
    },
    kronologi: {
      sejakKey: kron?.sejak ?? asOfKey,
      babak,
      kondisi: kron?.kondisi ?? {
        kendalaTerbuka: 0,
        kendalaKritis: 0,
        kendalaLewatTenggat: 0,
        kendalaTertuaHari: null,
        kendalaSelesaiDalamJendela: 0,
        kegiatanDalamJendela: 0,
        drafKegiatan: 0,
        kegiatanTerakhir: null,
        hariTanpaKegiatan: null,
      },
      totalPeristiwa: kron?.peristiwa.length ?? 0,
      dipotong: kron?.dipotong ?? 0,
    },
    kegiatan: { total: jumlahKegiatan, terakhir: kegiatan },
    temuan: { ringkas: temuanRingkas, terbuka: temuanTerbuka },
    administrasi,
    foto: { total: jumlahFoto, kandidat },
    rencanaMingguDepan,
    perhatian,
    limitations,
    sumber,
  };

  return { ...tanpaKesimpulan, kesimpulan: kesimpulanLokasi(tanpaKesimpulan) };
}
