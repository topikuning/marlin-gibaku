import "server-only";
import { db } from "@/lib/db";
import { COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";
import {
  getLocationsProgress,
  volumeDalamRentangByLineage,
  type LocationProgress,
} from "@/lib/progress";
import {
  bobotPct,
  realisasiKategoriPct,
  totalWeeksBetween,
  weightedPct,
} from "@/lib/progress-calc";
import { getScurveSeries } from "@/lib/baseline";
import { asOfMinggu, mingguKontrak, rekapPaket, rentangMingguKontrak } from "@/lib/mingguan/kirim";
import { jakartaDateKey, jakartaToday } from "@/lib/format";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import type { SourceRef } from "@/lib/ai-hub/types";
import type { PaketPaparan } from "./akses";
import type {
  FotoKandidatPaparan,
  KategoriLokasiPaparan,
  KendalaPaparan,
  KurvaPaparan,
  PaparanSnapshot,
  ProgresLokasiPaparan,
} from "./jenis";

/**
 * SOURCE BUILDER PAPARAN (DECISIONS 416) — deterministik, serializable.
 *
 * Seluruh angka slide berasal dari sini; AI dan renderer tidak menghitung
 * apa pun. Formula tidak ditulis ulang: progres dari `getLocationsProgress`
 * (calculation layer), agregat paket dari `rekapPaket` (tertimbang nilai RAB,
 * BUKAN rata-rata sederhana), minggu kontrak dari helper `mingguan/kirim`.
 */

export class PaparanSnapshotError extends Error {}

const HARI_MS = 86_400_000;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Batas timestamptz satu kunci tanggal (hari kerja Asia/Jakarta). */
function awalHariWib(key: string): Date {
  return new Date(`${key}T00:00:00+07:00`);
}
function akhirHariWib(key: string): Date {
  return new Date(`${key}T23:59:59.999+07:00`);
}

export async function buatSnapshotPaparan(
  pkg: PaketPaparan,
  weekNumber: number,
  now = new Date(),
): Promise<PaparanSnapshot> {
  const start = pkg.contract.startDate;
  const mode = pkg.contract.weekMode;
  const berjalanKe = mingguKontrak(start, now, mode);
  if (weekNumber < 1) throw new PaparanSnapshotError("Nomor minggu tidak valid.");
  if (weekNumber > berjalanKe) {
    throw new PaparanSnapshotError(
      `Minggu ke-${weekNumber} belum terjadi – minggu kontrak yang berjalan baru ke-${berjalanKe}.`,
    );
  }
  const berjalan = weekNumber >= berjalanKe;
  const rentang = rentangMingguKontrak(start, weekNumber, mode);
  const asOf = asOfMinggu(start, weekNumber, now, mode);
  const mulaiKey = dateKey(rentang.mulai);
  const akhirKey = dateKey(rentang.akhir);
  const asOfKey = jakartaDateKey(asOf);
  const lokasi = pkg.locations;
  const ids = lokasi.map((l) => l.id);
  const namaLokasi = new Map(lokasi.map((l) => [l.id, l.name]));
  const limitations: string[] = [];
  const sourceRefs: SourceRef[] = [];

  /* ── Progres (calculation layer, asOf akhir minggu) ─────────────────── */

  const kosong = () => Promise.resolve(new Map<string, LocationProgress>());
  const [kini, sebelum, sebelum2] = await Promise.all([
    getLocationsProgress(ids, { asOf }),
    weekNumber > 1
      ? getLocationsProgress(ids, { asOf: rentangMingguKontrak(start, weekNumber - 1, mode).akhir })
      : kosong(),
    // Minggu N−2 — titik ketiga jendela realisasi kurva-S (pola contoh Mataram).
    weekNumber > 2
      ? getLocationsProgress(ids, { asOf: rentangMingguKontrak(start, weekNumber - 2, mode).akhir })
      : kosong(),
  ]);

  const barisLokasi: ProgresLokasiPaparan[] = [];
  const berkurva: LocationProgress[] = [];
  const berkurvaSebelum: LocationProgress[] = [];
  let tanpaKurva = 0;
  for (const l of lokasi) {
    const p = kini.get(l.id);
    if (!p) continue;
    const prev = sebelum.get(l.id) ?? null;
    const belumAdaKurva = p.totalWeeks === 0;
    if (belumAdaKurva) tanpaKurva += 1;
    else {
      berkurva.push(p);
      if (prev) berkurvaSebelum.push(prev);
    }
    const refProgres: SourceRef = {
      id: `${l.slug}:progress`,
      entityType: "location",
      entityId: l.id,
      label: `${l.name} – progres s.d. ${asOfKey}`,
      value: `rencana ${p.planPct.toFixed(1)}% · realisasi ${p.realizedPct.toFixed(1)}%`,
      href: `/lokasi/${l.slug}/progress`,
    };
    sourceRefs.push(refProgres);
    const realisasiSebelum = weekNumber === 1 ? 0 : prev ? prev.realizedPct : null;
    barisLokasi.push({
      locationId: l.id,
      slug: l.slug,
      name: l.name,
      regency: l.regency,
      province: l.province,
      targetPct: belumAdaKurva ? null : p.planPct,
      realisasiPct: p.realizedPct,
      deviasiPp: belumAdaKurva ? null : p.deviationPct,
      realisasiSebelumPct: realisasiSebelum,
      kenaikanPp: realisasiSebelum == null ? null : p.realizedPct - realisasiSebelum,
      grandTotal: p.grandTotal.toString(),
      sourceRefIds: [refProgres.id],
    });
  }
  if (tanpaKurva > 0) {
    limitations.push(
      `${tanpaKurva} lokasi belum punya kurva-S – tidak ikut penyebut target paket, tetap tampil dengan label "belum ada kurva-S".`,
    );
  }

  // Agregat paket: formula kanonik yang SAMA dengan laporan mingguan WA.
  const rekap = rekapPaket(berkurva, tanpaKurva);
  const rekapSebelum =
    weekNumber === 1
      ? { realisasiPct: 0 }
      : berkurvaSebelum.length > 0
        ? rekapPaket(berkurvaSebelum, 0)
        : null;
  const realisasiSebelumPkt = rekapSebelum?.realisasiPct ?? null;
  sourceRefs.push({
    id: "paket:rekap",
    entityType: "package",
    entityId: pkg.id,
    label: `Rekap paket s.d. ${asOfKey} (tertimbang nilai RAB)`,
    value: rekap
      ? `rencana ${rekap.targetPct.toFixed(1)}% · realisasi ${rekap.realisasiPct.toFixed(1)}%`
      : "kurva-S belum ada",
    href: `/paket/${pkg.id}`,
  });

  /* ── Kurva-S paket (contoh Mataram): rencana penuh + jendela realisasi ─ */

  /*
   * Rencana per minggu = gabungan TERTIMBANG deret kanonik tiap lokasi
   * (`getScurveSeries`, formula DECISIONS 151/052), bukan deret baru. Minggu
   * melewati akhir kurva sebuah lokasi memakai titik terakhirnya (kurva wajib
   * berakhir 100%, jadi ekornya rata — sama seperti `planPctAtWeek`).
   */
  const seriPerLokasi = await Promise.all(ids.map((id) => getScurveSeries(id)));
  const seriBerkurva = seriPerLokasi.filter((s) => s.totalWeeks > 0 && s.grandTotal > 0n);
  let kurva: KurvaPaparan | null = null;
  if (seriBerkurva.length > 0) {
    const totalMingguKurva = Math.max(...seriBerkurva.map((s) => s.totalWeeks));
    const planPct: number[] = [];
    for (let w = 1; w <= totalMingguKurva; w++) {
      planPct.push(
        weightedPct(
          seriBerkurva.map((s) => ({
            grandTotal: s.grandTotal,
            pct: s.planPct[Math.min(w, s.totalWeeks) - 1] ?? 0,
          })),
        ),
      );
    }
    // Jendela realisasi: minggu N−2, N−1, N — dari rekap tertimbang asOf
    // masing-masing akhir minggu (formula yang sama dengan angka utama).
    const titik = (m: Map<string, LocationProgress>): number | null => {
      const rows = [...m.values()].filter((p) => p.totalWeeks > 0);
      if (rows.length === 0) return null;
      const r = rekapPaket(rows, 0);
      return r ? r.realisasiPct : null;
    };
    const jendela: KurvaPaparan["jendela"] = [];
    const nilaiMinggu: { minggu: number; nilai: number | null }[] = [
      { minggu: weekNumber - 2, nilai: weekNumber - 2 >= 1 ? titik(sebelum2) : null },
      { minggu: weekNumber - 1, nilai: weekNumber - 1 >= 1 ? titik(sebelum) : null },
      { minggu: weekNumber, nilai: titik(kini) },
    ];
    // Kenaikan tiap titik = selisih dari titik SEBELUM-nya; titik pertama
    // jendela hanya tahu kenaikannya bila ia minggu 1 (basisnya 0) — angka
    // yang tidak diketahui ditulis null, tidak dikarang.
    let dasar: number | null = null;
    for (let i = 0; i < nilaiMinggu.length; i++) {
      const k = nilaiMinggu[i];
      if (k.minggu < 1 || k.nilai == null) continue;
      const basis = jendela.length > 0 ? dasar : k.minggu === 1 ? 0 : null;
      jendela.push({
        minggu: k.minggu,
        realisasiPct: k.nilai,
        kenaikanPp: basis == null ? null : k.nilai - basis,
      });
      dasar = k.nilai;
    }
    kurva = { totalMinggu: totalMingguKurva, planPct, jendela };
  }

  /* ── Durasi pelaksanaan ─────────────────────────────────────────────── */

  const totalHari = pkg.contract.durationDays;
  const hariKontrakBerjalan = Math.max(
    0,
    Math.min(totalHari, Math.floor((jakartaToday().getTime() - start.getTime()) / HARI_MS) + 1),
  );
  const durasi = {
    totalHari,
    hariBerjalan: hariKontrakBerjalan,
    sisaHari: Math.max(0, totalHari - hariKontrakBerjalan),
    pctWaktu: totalHari > 0 ? (hariKontrakBerjalan / totalHari) * 100 : 0,
  };

  /* ── Status pekerjaan per KATEGORI RAB (bar berwarna per lokasi) ────── */

  /*
   * Realisasi kategori = Σ (prestasi item × amount item) / amount kategori —
   * disusun dari `prestasiPct` + `cumulativeVolumeByLineage` yang kanonik
   * (basis sama dengan kurva-S & blanko KKP, DECISIONS 151). asOf minggu
   * paparan: minggu lampau menunjukkan posisi minggu itu, bukan hari ini.
   */
  const kategori: KategoriLokasiPaparan[] = [];
  /*
   * Total RAB paket = Σ grandTotal lokasi (revisi aktif, dari calculation
   * layer). Penyebut bobot kategori — dipakai Action Plan mengurutkan sisa
   * bobot: kategori Rp 3 M yang baru 10% lebih layak dikejar daripada kategori
   * Rp 100 juta yang 0%.
   */
  let totalRabPaket = 0;
  for (const p of kini.values()) totalRabPaket += Number(p.grandTotal);

  /*
   * Tiga query untuk SELURUH lokasi, bukan tiga query per lokasi (audit
   * 2026-08-28, I-7). Memanggil versi satu-lokasi di dalam perulangan membuat
   * biayanya tumbuh linear terhadap jumlah lokasi paket tanpa perlu.
   */
  const lokasiIds = lokasi.map((l) => l.id);
  const revisiAktif = await db.rabRevision.findMany({
    where: { locationId: { in: lokasiIds }, status: "aktif" },
    select: { id: true, locationId: true },
  });
  const semuaNodes = revisiAktif.length
    ? await db.rabNode.findMany({
        where: { revisionId: { in: revisiAktif.map((r) => r.id) }, kind: { in: ["kategori", "item"] } },
        orderBy: { sortOrder: "asc" },
        select: {
          kind: true,
          code: true,
          name: true,
          lineageKey: true,
          volume: true,
          amount: true,
          revisionId: true,
        },
      })
    : [];
  /*
   * Kumulatif s/d `asOf` = rentang sejak awal waktu sampai `asOf`. Memakai
   * `volumeDalamRentangByLineage` — helper banyak-lokasi yang memang ada —
   * alih-alih menghidupkan kembali versi kumulatif-banyak-lokasi yang sengaja
   * dibuang DECISIONS 460: dua helper mirip, satu di antaranya gampang salah
   * dipakai, justru jebakan yang baru saja dirapikan.
   */
  const AWAL_WAKTU = new Date(0);
  const volCumPerLokasi = await volumeDalamRentangByLineage(
    lokasiIds.map((id) => ({ locationId: id, sejak: AWAL_WAKTU, sampai: asOf })),
  );

  const revisiPerLokasi = new Map(revisiAktif.map((r) => [r.locationId, r.id]));
  const nodesPerRevisi = new Map<string, typeof semuaNodes>();
  for (const n of semuaNodes) {
    const daftar = nodesPerRevisi.get(n.revisionId);
    if (daftar) daftar.push(n);
    else nodesPerRevisi.set(n.revisionId, [n]);
  }

  for (const l of lokasi) {
    const revId = revisiPerLokasi.get(l.id);
    if (!revId) continue;
    const nodes = nodesPerRevisi.get(revId) ?? [];
    const volCum = volCumPerLokasi.get(l.id) ?? new Map<string, number>();
    const kelompok: KategoriLokasiPaparan["kelompok"] = [];
    for (const kat of nodes.filter((n) => n.kind === "kategori")) {
      const akar = kat.lineageKey;
      const items = nodes.filter(
        (n) => n.kind === "item" && (n.lineageKey === akar || n.lineageKey.startsWith(`${akar}#`)),
      );
      // Formula realisasi & bobot dari calculation layer — tidak disusun ulang
      // di sini (audit 2026-08-28, I-2 & I-3).
      kelompok.push({
        lineageKey: akar,
        nama: kat.name,
        realisasiPct: realisasiKategoriPct(
          items.map((it) => ({
            volSd: volCum.get(it.lineageKey) ?? 0,
            volK: it.volume ? Number(it.volume.toString()) : 0,
            amount: Number(it.amount),
          })),
          Number(kat.amount),
        ),
        bobotPct: bobotPct(Number(kat.amount), totalRabPaket),
      });
    }
    if (kelompok.length > 0) {
      kategori.push({ locationId: l.id, lokasiNama: l.name, kelompok });
    }
  }

  /* ── Kelengkapan laporan harian dalam minggu ────────────────────────── */

  const akhirTerpakai = new Date(Math.min(rentang.akhir.getTime(), jakartaToday().getTime()));
  const hariBerjalan = Math.max(
    0,
    Math.floor((akhirTerpakai.getTime() - rentang.mulai.getTime()) / HARI_MS) + 1,
  );
  const reports = await db.dailyReport.findMany({
    where: {
      locationId: { in: ids },
      reportDate: { gte: rentang.mulai, lte: akhirTerpakai },
    },
    select: { id: true, locationId: true, status: true, noActivity: true, updatedAt: true },
  });
  const diharapkan = hariBerjalan * lokasi.length;
  let final = 0;
  let diproses = 0;
  let draft = 0;
  let perluKoreksi = 0;
  let hariNihil = 0;
  const punyaLaporan = new Set<string>();
  for (const r of reports) {
    punyaLaporan.add(r.locationId);
    if (r.status === "final") final += 1;
    else if (r.status === "dikirim" || r.status === "disetujui") diproses += 1;
    else if (r.status === "draft") draft += 1;
    else if (r.status === "perlu_koreksi") perluKoreksi += 1;
    if (r.noActivity) hariNihil += 1;
  }
  const lokasiTanpaLaporan = lokasi.filter((l) => !punyaLaporan.has(l.id)).map((l) => l.name);
  if (lokasiTanpaLaporan.length > 0) {
    limitations.push(`${lokasiTanpaLaporan.length} lokasi tanpa laporan harian sama sekali pada minggu ini.`);
  }
  for (const l of lokasi) {
    sourceRefs.push({
      id: `${l.slug}:laporan`,
      entityType: "location",
      entityId: l.id,
      label: `${l.name} – laporan harian ${mulaiKey}..${akhirKey}`,
      href: `/lokasi/${l.slug}/harian`,
    });
  }

  /* ── Capaian pekerjaan (item laporan TERHITUNG, basis aktif) ────────── */

  const countedIds = reports
    .filter((r) => (COUNTED_REPORT_STATUSES as readonly string[]).includes(r.status))
    .map((r) => r.id);
  const items = countedIds.length
    ? await db.dailyReportItem.findMany({
        where: { reportId: { in: countedIds }, basis: "aktif" },
        select: {
          volumeDone: true,
          valueDone: true,
          lineageKey: true,
          report: { select: { locationId: true } },
          rabNode: { select: { name: true, unit: true } },
        },
      })
    : [];
  // Gabungkan pengulangan identik (lokasi, lineage) — volume dijumlah APA
  // ADANYA, satuan tidak diubah (spec §8 slide 5).
  const perItem = new Map<
    string,
    { locationId: string; nama: string; unit: string | null; volume: number; nilai: bigint }
  >();
  for (const it of items) {
    const k = `${it.report.locationId}|${it.lineageKey}`;
    const ada = perItem.get(k);
    const vol = Number(it.volumeDone.toString());
    if (ada) {
      ada.volume += vol;
      ada.nilai += it.valueDone;
    } else {
      perItem.set(k, {
        locationId: it.report.locationId,
        nama: it.rabNode.name,
        unit: it.rabNode.unit,
        volume: vol,
        nilai: it.valueDone,
      });
    }
  }
  const capaian = [...perItem.values()]
    .sort((a, b) => (a.nilai < b.nilai ? 1 : a.nilai > b.nilai ? -1 : 0))
    .slice(0, 8)
    .map((c) => {
      const slug = lokasi.find((l) => l.id === c.locationId)?.slug ?? "";
      return {
        locationId: c.locationId,
        lokasiNama: namaLokasi.get(c.locationId) ?? "",
        pekerjaan: c.nama,
        unit: c.unit,
        volume: Math.round(c.volume * 1000) / 1000,
        sourceRefIds: [`${slug}:laporan`],
      };
    });
  if (perItem.size > 8) {
    limitations.push(`Capaian menampilkan 8 item bernilai terbesar dari ${perItem.size} item minggu ini.`);
  }

  /* ── Kegiatan lapangan FINAL dalam minggu ───────────────────────────── */

  const kindLabel = await getActivityKindLabelMap();
  const activities = await db.fieldActivity.findMany({
    where: {
      locationId: { in: ids },
      status: "final",
      activityDate: { gte: rentang.mulai, lte: akhirTerpakai },
    },
    orderBy: { activityDate: "asc" },
    select: { id: true, locationId: true, activityDate: true, type: true, title: true, notes: true, updatedAt: true },
  });
  const kegiatan = activities.map((a) => ({
    id: a.id,
    locationId: a.locationId,
    lokasiNama: namaLokasi.get(a.locationId) ?? "",
    tanggalKey: dateKey(a.activityDate),
    jenis: kindLabel.get(a.type) ?? a.type,
    judul: a.title,
    hasil: a.notes,
  }));
  for (const a of activities) {
    const slug = lokasi.find((l) => l.id === a.locationId)?.slug ?? "";
    sourceRefs.push({
      id: `kegiatan:${a.id}`,
      entityType: "field_activity",
      entityId: a.id,
      label: `${a.title} (${namaLokasi.get(a.locationId) ?? ""}, ${dateKey(a.activityDate)})`,
      href: `/lokasi/${slug}/kegiatan`,
    });
  }

  /* ── Kendala: jujur soal waktu (spec §7) ────────────────────────────── */

  const issues = await db.issue.findMany({
    where: {
      locationId: { in: ids },
      // Pembaca Issue WAJIB menyaring kembar yang sudah digabung (DECISIONS 393).
      mergedIntoId: null,
      OR: [
        { createdAt: { gte: awalHariWib(mulaiKey), lte: akhirHariWib(akhirKey) } },
        { status: { in: ["terbuka", "ditangani"] } },
      ],
    },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      severity: true,
      status: true,
      locationId: true,
      createdAt: true,
      updatedAt: true,
      actions: {
        select: {
          id: true,
          description: true,
          picName: true,
          dueDate: true,
          status: true,
          picUserId: true,
        },
      },
    },
  });
  const keKendala = (i: (typeof issues)[number]): KendalaPaparan => ({
    id: i.id,
    judul: i.title,
    severity: i.severity,
    status: i.status,
    locationId: i.locationId,
    lokasiNama: namaLokasi.get(i.locationId) ?? "",
    punyaRecovery: i.actions.length > 0,
  });
  const baruMingguIni = issues
    .filter(
      (i) => i.createdAt >= awalHariWib(mulaiKey) && i.createdAt <= akhirHariWib(akhirKey),
    )
    .map(keKendala);
  const terbukaSaatIni = issues
    .filter((i) => i.status === "terbuka" || i.status === "ditangani")
    .map(keKendala);
  const statusTerkini = !berjalan;
  if (statusTerkini && terbukaSaatIni.length > 0) {
    limitations.push(
      "Status kendala terbuka/recovery adalah status TERKINI saat paparan dibuat, bukan status pada akhir minggu tersebut (histori status belum tersedia).",
    );
  }
  for (const i of issues) {
    sourceRefs.push({
      id: `kendala:${i.id}`,
      entityType: "issue",
      entityId: i.id,
      label: `Kendala: ${i.title} (${namaLokasi.get(i.locationId) ?? ""})`,
      href: `/kendala`,
    });
  }

  const todayKey = jakartaDateKey(now);
  const pemulihan = issues
    .filter((i) => i.status === "terbuka" || i.status === "ditangani")
    .flatMap((i) =>
      i.actions
        .filter((a) => a.status !== "batal")
        .map((a) => ({
          issueId: i.id,
          judulKendala: i.title,
          tindakan: a.description,
          pic: a.picName ?? (a.picUserId ? "PIC internal" : null),
          targetKey: a.dueDate ? dateKey(a.dueDate) : null,
          status: a.status,
          overdue: a.status !== "selesai" && a.dueDate != null && dateKey(a.dueDate) < todayKey,
          lokasiNama: namaLokasi.get(i.locationId) ?? "",
        })),
    );

  /* ── Foto kandidat (laporan terhitung + kegiatan final) ─────────────── */

  const sumberFoto: { reportId?: { in: string[] }; activityId?: { in: string[] } }[] = [];
  if (countedIds.length) sumberFoto.push({ reportId: { in: countedIds } });
  if (activities.length) sumberFoto.push({ activityId: { in: activities.map((a) => a.id) } });
  const photos = sumberFoto.length
    ? await db.photo.findMany({
    where: {
      locationId: { in: ids },
      OR: sumberFoto,
    },
    orderBy: { createdAt: "asc" },
    take: 40,
    select: {
      id: true,
      locationId: true,
      r2Key: true,
      thumbnailKey: true,
      exifTakenAt: true,
      report: { select: { reportDate: true } },
      activity: { select: { title: true, activityDate: true } },
      reportItem: { select: { lineageKey: true, rabNode: { select: { name: true } } } },
    },
  })
    : [];
  const fotoKandidat: FotoKandidatPaparan[] = photos.map((p) => {
    const tanggal = p.report?.reportDate ?? p.activity?.activityDate ?? null;
    return {
      id: p.id,
      locationId: p.locationId ?? "",
      lokasiNama: p.locationId ? (namaLokasi.get(p.locationId) ?? "") : "",
      tanggalKey: tanggal ? dateKey(tanggal) : null,
      keterangan: p.reportItem?.rabNode.name ?? p.activity?.title ?? null,
      // Akar lineage = kategori RAB — kunci pengelompokan slide foto per
      // pekerjaan dan sumber persentase di kepala slidenya.
      lineageKey: p.reportItem?.lineageKey ?? null,
      r2Key: p.r2Key,
      thumbnailKey: p.thumbnailKey,
    };
  });
  for (const f of fotoKandidat) {
    sourceRefs.push({
      id: `foto:${f.id}`,
      entityType: "photo",
      entityId: f.id,
      label: `Foto ${f.lokasiNama}${f.tanggalKey ? ` ${f.tanggalKey}` : ""}`,
    });
  }

  /* ── Rencana minggu depan (bila modulnya diisi) ─────────────────────── */

  /*
   * Deck minggu N memaparkan rencana minggu N+1 — itu memang isi Action Plan.
   *
   * Tapi kalimat "belum tersedia" saja terbaca seperti "tidak ada rencana sama
   * sekali", dan itu menyesatkan justru pada keadaan yang paling sering:
   * lapangan MENGISI rencana untuk minggu yang sedang dipaparkan, bukan untuk
   * minggu sesudahnya. User melaporkannya 2026-08-23 — *"padahal rencana
   * mingguan sudah dibuat, apa maksudnya?"*. Maka minggu N ikut dicek, semata
   * untuk MENYEBUTKAN keadaannya; angkanya tidak dipakai sebagai rencana N+1,
   * karena rencana minggu ini bukan rencana minggu depan.
   */
  const pilihRencana = {
    locationId: true,
    weekNumber: true,
    note: true,
    items: { select: { targetVolume: true, rabNode: { select: { name: true, unit: true } } } },
  } as const;
  const [plans, plansMingguIni] = await Promise.all([
    db.weeklyPlan.findMany({
      where: { locationId: { in: ids }, weekNumber: weekNumber + 1, items: { some: {} } },
      select: pilihRencana,
    }),
    db.weeklyPlan.findMany({
      where: { locationId: { in: ids }, weekNumber, items: { some: {} } },
      select: { locationId: true },
    }),
  ]);
  const rencanaMingguDepan =
    plans.length > 0
      ? plans.map((p) => ({
          locationId: p.locationId,
          lokasiNama: namaLokasi.get(p.locationId) ?? "",
          catatan: p.note,
          item: p.items.map((it) => ({
            nama: it.rabNode.name,
            unit: it.rabNode.unit,
            targetVolume: Number(it.targetVolume.toString()),
          })),
        }))
      : null;
  if (!rencanaMingguDepan) {
    // Sebut minggunya. "Minggu berikutnya" memaksa pembaca menghitung sendiri,
    // dan itu persis titik salah pahamnya.
    limitations.push(
      plansMingguIni.length > 0
        ? `Rencana minggu ke-${weekNumber + 1} belum diisi – yang ada baru rencana minggu ke-${weekNumber} (${plansMingguIni.length} lokasi), yaitu minggu yang sedang dipaparkan.`
        : `Rencana minggu ke-${weekNumber + 1} belum diisi di MARLIN.`,
    );
  } else {
    for (const p of plans) {
      const slug = lokasi.find((l) => l.id === p.locationId)?.slug ?? "";
      sourceRefs.push({
        id: `rencana:${slug}`,
        entityType: "weekly_plan",
        entityId: p.locationId,
        label: `Rencana minggu ke-${weekNumber + 1} – ${namaLokasi.get(p.locationId) ?? ""}`,
        href: `/lokasi/${slug}/rab`,
      });
    }
  }

  if (berjalan) {
    limitations.push("Minggu BERJALAN – datanya belum genap tujuh hari; angka masih akan bergerak.");
  }

  /* ── Watermark data ─────────────────────────────────────────────────── */

  const times = [
    ...reports.map((r) => r.updatedAt),
    ...activities.map((a) => a.updatedAt),
    ...issues.map((i) => i.updatedAt),
  ];
  const dataAsOf = times.length ? new Date(Math.max(...times.map((t) => t.getTime()))).toISOString() : null;

  return {
    version: 1,
    // Lingkup ikut disimpan: deck lokasi yang tidak mengaku lokasi akan dibaca
    // sebagai deck kontrak (DECISIONS 420).
    lingkup: pkg.lingkup,
    paket: {
      id: pkg.id,
      name: pkg.name,
      packageNumber: pkg.packageNumber,
      ownerAgency: pkg.ownerAgency,
      province: pkg.province,
    },
    kontrak: {
      contractNumber: pkg.contract.contractNumber,
      workTitle: pkg.contract.workTitle,
      vendorName: pkg.contract.vendor.name,
      contractValue: pkg.contract.contractValue.toString(),
      startDateKey: dateKey(pkg.contract.startDate),
      endDateKey: pkg.contract.endDate ? dateKey(pkg.contract.endDate) : null,
      durationDays: pkg.contract.durationDays,
      ppkName: pkg.contract.ppkName,
      supervisorName: pkg.contract.supervisorName,
      supervisorFirm: pkg.contract.supervisorFirm,
    },
    periode: {
      mingguKe: weekNumber,
      // Total minggu mengikuti mode periode minggu kontrak (DECISIONS 427).
      totalMinggu:
        mode === "senin_minggu" && pkg.contract.endDate
          ? totalWeeksBetween(start, pkg.contract.endDate, "senin_minggu")
          : Math.max(1, Math.ceil(pkg.contract.durationDays / 7)),
      mulaiKey,
      akhirKey,
      berjalan,
      asOfKey,
    },
    dataAsOf,
    progres: {
      paket: {
        targetPct: rekap ? rekap.targetPct : null,
        realisasiPct: rekap ? rekap.realisasiPct : 0,
        deviasiPp: rekap ? rekap.deviasiPct : null,
        realisasiSebelumPct: realisasiSebelumPkt,
        kenaikanPp:
          rekap && realisasiSebelumPkt != null ? rekap.realisasiPct - realisasiSebelumPkt : null,
        lokasiDihitung: berkurva.length,
        lokasiTanpaKurva: tanpaKurva,
      },
      lokasi: barisLokasi,
    },
    kelengkapan: {
      diharapkan,
      final,
      diproses,
      draft,
      perluKoreksi,
      hariNihil,
      lokasiTanpaLaporan,
    },
    capaian,
    kegiatan,
    kendala: { baruMingguIni, terbukaSaatIni, statusTerkini },
    pemulihan,
    fotoKandidat,
    rencanaMingguDepan,
    kurva,
    durasi,
    kategori,
    limitations,
    sourceRefs,
  };
}
