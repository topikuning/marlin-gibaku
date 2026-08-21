import type { NoActivityReason } from "@/generated/prisma/enums";
import { alasanTidakBisaNihil } from "./nihil";
import { db } from "@/lib/db";
import { audit, auditIn } from "@/lib/audit";
import { requestIp } from "@/lib/auth/session";
import { canTransitionReport } from "@/lib/lifecycle";
import { cumulativeVolumeByLineage, getLocationProgress, COUNTED_REPORT_STATUSES } from "@/lib/progress";
import { valueDone as calcValueDone } from "@/lib/money";
import { prestasiPct } from "@/lib/progress-calc";
import { formatNumber, jakartaDateKey, parseDateKey } from "@/lib/format";
import { dominantWeatherCode, parseHourlyWeather, type HourlyWeather } from "@/lib/weather/hourly";
import { Prisma } from "@/generated/prisma/client";
import type {
  DailyReportStatus,
  IssueSeverity,
  WeatherCode,
  WorkerRole,
} from "@/generated/prisma/enums";
import { VOLUME_EPSILON } from "./constants";

/**
 * Logika inti laporan harian TERPADU (satu entitas menggantikan 4 menu lama).
 * Semua transisi status HANYA lewat fungsi di file ini:
 *   validasi canTransitionReport + DailyReportStatusHistory dalam $transaction,
 *   lalu audit() (helper non-transaksional by design — gagal audit tidak
 *   menggagalkan aksi utama).
 *
 * Otorisasi (requireCapability / requireLocationAccess) dilakukan di
 * actions.ts — file ini menerima userId eksplisit supaya bisa diuji langsung.
 *
 * Perbaikan bug lama: reportDate SELALU tanggal kerja dari parameter saat
 * draft dibuat, dan TIDAK PERNAH disentuh lagi oleh transisi mana pun
 * (dulu tanggal ikut waktu approve).
 */

export class DailyReportError extends Error {}

export const EDITABLE_STATUSES: DailyReportStatus[] = ["draft", "perlu_koreksi"];
const ENRICHABLE_STATUSES: DailyReportStatus[] = ["draft", "perlu_koreksi", "dikirim"];
/**
 * Status yang boleh di-enrich oleh PEMBUAT (daily_report.create saja).
 * "dikirim" hanya boleh dilengkapi reviewer — SM melengkapi data KKP saat
 * verifikasi; UI memang menyembunyikannya dari mandor, tapi backend dulu tidak
 * (audit 2026-07-27, B16b: frontend ≠ backend permission).
 */
export const CREATOR_ENRICHABLE_STATUSES: DailyReportStatus[] = ["draft", "perlu_koreksi"];

async function getReportOrThrow(reportId: string) {
  const report = await db.dailyReport.findUnique({
    where: { id: reportId },
    include: { location: { select: { id: true, slug: true, name: true } } },
  });
  if (!report) throw new DailyReportError("Laporan tidak ditemukan");
  return report;
}

/**
 * Ambil laporan (lokasi, tanggal) atau buat draft baru.
 * Hanya tanggal ≤ hari ini (Asia/Jakarta). Anti-double lewat uniq DB
 * (locationId, reportDate) — race pembuatan paralel di-recover dengan refetch.
 */
export async function getOrCreateDraft(locationId: string, dateKey: string, userId: string) {
  const reportDate = parseDateKey(dateKey);
  if (!reportDate) throw new DailyReportError("Format tanggal tidak valid");
  if (dateKey > jakartaDateKey(new Date())) {
    throw new DailyReportError("Tidak bisa membuat laporan untuk tanggal yang belum terjadi");
  }

  const existing = await db.dailyReport.findUnique({
    where: { locationId_reportDate: { locationId, reportDate } },
  });
  if (existing) return existing;

  try {
    const created = await db.$transaction(async (tx) => {
      const report = await tx.dailyReport.create({
        data: { locationId, reportDate, status: "draft", createdById: userId },
      });
      await tx.dailyReportStatusHistory.create({
        data: { reportId: report.id, fromStatus: null, toStatus: "draft", changedById: userId },
      });
      return report;
    });
    await audit(userId, "daily_report.create", "daily_report", created.id, { locationId, dateKey });
    return created;
  } catch (err) {
    // Race double-submit: baris sudah dibuat request lain → pakai yang ada.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.dailyReport.findUnique({
        where: { locationId_reportDate: { locationId, reportDate } },
      });
      if (raced) return raced;
    }
    throw err;
  }
}

export type UpsertItemInput = {
  rabNodeId: string;
  volumeDone: number;
  notes?: string | null;
};

/**
 * Tambah/ubah item laporan. Idempotent & anti-dobel via uniq (reportId, lineageKey).
 * lineageKey + valueDone diturunkan dari RabNode revisi AKTIF (node revisi
 * non-aktif ditolak). Guard kumulatif: Σ volume counted lineage (di luar
 * kontribusi report ini) + volumeDone ≤ volume RAB + epsilon.
 */
export async function upsertItem(reportId: string, input: UpsertItemInput, userId: string) {
  const report = await getReportOrThrow(reportId);
  if (!EDITABLE_STATUSES.includes(report.status)) {
    throw new DailyReportError("Item hanya bisa diubah saat laporan berstatus Draft atau Perlu Koreksi");
  }
  if (!Number.isFinite(input.volumeDone) || input.volumeDone <= 0) {
    throw new DailyReportError("Volume harus lebih dari 0");
  }
  const volumeDone = Math.round(input.volumeDone * 1000) / 1000; // presisi kolom Decimal(15,3)

  const node = await db.rabNode.findUnique({
    where: { id: input.rabNodeId },
    include: { revision: { select: { status: true, locationId: true } } },
  });
  if (!node || node.kind !== "item") throw new DailyReportError("Item RAB tidak ditemukan");
  if (node.revision.locationId !== report.locationId) {
    throw new DailyReportError("Item RAB bukan milik lokasi laporan ini");
  }
  /**
   * Basis laporan (DECISIONS 210). Item boleh berasal dari revisi AKTIF
   * (angka resmi) atau dari DRAFT adendum yang sedang diajukan. Revisi
   * `digantikan` tetap ditolak — itu masa lalu, bukan pengajuan.
   *
   * Di lapangan pekerjaan sering jalan lebih dulu dan adendumnya menyusul.
   * Sebelum ini satu-satunya pilihan adalah menolak laporannya (pekerjaan
   * nyata jadi tak tercatat) atau mengaktifkan adendum yang belum sah (angka
   * resmi jadi bohong). Sekarang dicatat apa adanya, dengan penanda.
   */
  const basis: "aktif" | "draft_adendum" =
    node.revision.status === "aktif"
      ? "aktif"
      : node.revision.status === "draft"
        ? "draft_adendum"
        : (() => {
            throw new DailyReportError(
              "Item RAB berasal dari revisi lama yang sudah digantikan – muat ulang halaman",
            );
          })();

  // Guard volume kumulatif ≤ volume RAB.
  //
  // Basis DRAFT dibandingkan dengan SELURUH realisasi (aktif + draft), karena
  // volume draft adalah volume kontrak SEANDAINYA adendum disetujui — pekerjaan
  // yang sudah dilaporkan di basis aktif sudah termasuk di dalamnya. Kalau
  // hanya menghitung basis draft, volume total bisa terlampaui diam-diam.
  const nodeVolume = node.volume != null ? Number(node.volume) : null;
  if (nodeVolume != null) {
    const cumulative =
      (await cumulativeVolumeByLineage(
        report.locationId,
        undefined,
        basis === "draft_adendum" ? "semua" : "aktif",
      )).get(node.lineageKey) ?? 0;
    // Kontribusi report INI dikeluarkan dulu (defensif; status editable memang tidak counted).
    let ownContribution = 0;
    if ((COUNTED_REPORT_STATUSES as readonly string[]).includes(report.status)) {
      const own = await db.dailyReportItem.findUnique({
        where: { reportId_lineageKey: { reportId, lineageKey: node.lineageKey } },
        select: { volumeDone: true },
      });
      ownContribution = own ? Number(own.volumeDone) : 0;
    }
    const others = cumulative - ownContribution;
    if (others + volumeDone > nodeVolume + VOLUME_EPSILON) {
      const sisa = Math.max(0, Math.round((nodeVolume - others) * 1000) / 1000);
      throw new DailyReportError(
        `Volume melebihi sisa RAB. Sisa yang masih bisa dilaporkan: ${formatNumber(sisa)} ${node.unit ?? ""}`.trim(),
      );
    }
  }

  const valueDone = calcValueDone(volumeDone, node.unitPrice != null ? Number(node.unitPrice) : 0);
  const notes = input.notes?.trim() || null;

  const item = await db.dailyReportItem.upsert({
    where: { reportId_lineageKey: { reportId, lineageKey: node.lineageKey } },
    update: { rabNodeId: node.id, basis, volumeDone, valueDone, notes, reportedById: userId },
    create: {
      reportId,
      rabNodeId: node.id,
      lineageKey: node.lineageKey,
      basis,
      volumeDone,
      valueDone,
      notes,
      reportedById: userId,
    },
  });
  await audit(userId, "daily_report.item_upsert", "daily_report_item", item.id, {
    reportId,
    lineageKey: node.lineageKey,
    basis,
    volumeDone,
    valueDone,
  });
  return item;
}

/** Hapus item saat draft/perlu_koreksi. Foto item tetap menempel di laporan. */
export async function removeItem(reportId: string, itemId: string, userId: string) {
  const report = await getReportOrThrow(reportId);
  if (!EDITABLE_STATUSES.includes(report.status)) {
    throw new DailyReportError("Item hanya bisa dihapus saat laporan berstatus Draft atau Perlu Koreksi");
  }
  const item = await db.dailyReportItem.findUnique({ where: { id: itemId } });
  if (!item || item.reportId !== reportId) throw new DailyReportError("Item tidak ditemukan di laporan ini");

  await db.$transaction(async (tx) => {
    // Foto bukti tidak ikut hilang — lepaskan dari item, biarkan di laporan.
    await tx.photo.updateMany({ where: { reportItemId: itemId }, data: { reportItemId: null } });
    await tx.dailyReportItem.delete({ where: { id: itemId } });
  });
  await audit(userId, "daily_report.item_remove", "daily_report_item", itemId, {
    reportId,
    lineageKey: item.lineageKey,
  });
}

export type EnrichmentInput = {
  /**
   * `undefined` = form TIDAK mengirim field cuaca (pemilih manual dimatikan,
   *  DECISIONS 177) → isian cuaca dibiarkan APA ADANYA, termasuk hasil ambil
   *  otomatis. `null` = dikosongkan secara sengaja. Membedakan keduanya wajib:
   *  menyamakan "tidak dikirim" dengan "kosongkan" akan menghapus cuaca
   *  otomatis setiap kali pelengkap KKP disimpan.
   */
  weather?: WeatherCode | null;
  workStart: string | null;
  workEnd: string | null;
  notes: string | null;
  workers: { role: WorkerRole; count: number }[];
  /**
   * `id` = baris yang SUDAH ada (dari form); kosong/null = baris baru.
   *
   * Identitas baris material & alat WAJIB bertahan sejak foto bisa ditempel
   * padanya (DECISIONS 304). Sebelum itu blok ini memakai hapus-semua lalu
   * buat-ulang, jadi ID berganti tiap kali form pelengkap disimpan — bahkan
   * saat yang diubah cuma cuaca. Dengan foto tertaut, pola itu akan MELEPAS
   * bukti setiap penyimpanan berikutnya, dan hilangnya baru terasa besok.
   */
  materials: { id?: string | null; name: string; unit: string | null; qty: number | null }[];
  equipment: { id?: string | null; name: string; count: number }[];
};

/**
 * Simpan pelengkap KKP (cuaca, jam kerja, tenaga, material, alat) dalam satu
 * $transaction. Boleh saat draft/perlu_koreksi/dikirim (SM melengkapi saat
 * verifikasi).
 *
 * Tenaga kerja masih wipe+recreate — barisnya diturunkan dari daftar peran
 * tetap, tidak ada yang menempel padanya. Material & alat TIDAK boleh begitu
 * lagi sejak foto bisa ditempel per baris; lihat catatan di dalam transaksi.
 */
export async function setEnrichment(reportId: string, input: EnrichmentInput, userId: string) {
  const report = await getReportOrThrow(reportId);
  if (!ENRICHABLE_STATUSES.includes(report.status)) {
    throw new DailyReportError("Pelengkap laporan tidak bisa diubah setelah laporan disetujui");
  }

  const workers = input.workers.filter((w) => Number.isFinite(w.count) && w.count > 0);
  /*
   * Indeks ASLI dibawa serta (DECISIONS 343).
   *
   * Baris tanpa nama dibuang di sini, jadi posisi sesudah penyaringan tidak
   * lagi sama dengan posisi di form. Foto yang ikut dikirim bersama simpanan
   * dipasangkan menurut posisi FORM — tanpa membawa indeks aslinya, foto baris
   * ke-3 bisa menempel ke baris ke-2. Itu bukan galat yang terbit; itu bukti
   * yang menempel pada barang yang salah.
   */
  const materials = input.materials
    .map((m, i) => ({ ...m, asli: i }))
    .filter((m) => m.name.trim().length > 0);
  const equipment = input.equipment
    .map((e, i) => ({ ...e, asli: i }))
    .filter((e) => e.name.trim().length > 0 && e.count > 0);
  /** id hasil simpan, sejajar dengan larik MASUKAN (null = baris dibuang). */
  const idMaterial: (string | null)[] = input.materials.map(() => null);
  const idAlat: (string | null)[] = input.equipment.map(() => null);

  // Cuaca yang dipilih tangan = PENGAMATAN lapangan → tandai `manual` supaya
  // pengambilan otomatis tidak pernah menimpanya. Deret per jam hasil ambil
  // otomatis hanya dipertahankan bila masih sepadan dengan pilihan itu;
  // kalau tidak, dibuang supaya blanko tidak mencetak dua cerita berbeda.
  // Field cuaca yang TIDAK dikirim sama sekali → kolom cuaca tidak disentuh.
  const existingHourly = parseHourlyWeather(report.weatherHourly);
  const keepHourly =
    existingHourly != null && input.weather != null && dominantWeatherCode(existingHourly) === input.weather;
  const weatherData =
    input.weather === undefined
      ? {}
      : {
          weather: input.weather,
          weatherSource: input.weather != null ? ("manual" as const) : null,
          weatherHourly: keepHourly ? undefined : Prisma.DbNull,
        };

  await db.$transaction(async (tx) => {
    await tx.dailyReport.update({
      where: { id: reportId },
      data: {
        ...weatherData,
        workStart: input.workStart?.trim() || null,
        workEnd: input.workEnd?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });
    await tx.dailyReportWorker.deleteMany({ where: { reportId } });
    if (workers.length) {
      await tx.dailyReportWorker.createMany({
        data: workers.map((w) => ({ reportId, role: w.role, count: Math.round(w.count) })),
      });
    }
    /*
     * Material & alat: baris yang sudah ada DIPERBARUI di tempat, bukan
     * dihapus lalu dibuat ulang (DECISIONS 304) — foto menempel pada ID-nya.
     *
     * ID dari form TIDAK dipercaya begitu saja: hanya yang benar-benar milik
     * laporan ini yang dianggap baris lama. ID asing diperlakukan sebagai
     * baris BARU, bukan diabaikan — mengabaikannya akan membuang isian orang
     * tanpa sepatah kata pun.
     */
    const milikMaterial = new Set(
      (await tx.dailyReportMaterial.findMany({ where: { reportId }, select: { id: true } })).map(
        (r) => r.id,
      ),
    );
    const barisMaterial = materials.map((m) => ({
      asli: m.asli,
      id: m.id && milikMaterial.has(m.id) ? m.id : null,
      name: m.name.trim(),
      unit: m.unit?.trim() || null,
      qtyReceived: m.qty != null && Number.isFinite(m.qty) ? Math.round(m.qty * 1000) / 1000 : null,
    }));
    const simpanMaterial = barisMaterial.map((m) => m.id).filter((x): x is string => x != null);
    await tx.dailyReportMaterial.deleteMany({
      // Tanpa daftar yang dipertahankan, `notIn: []` ambigu antar versi Prisma —
      // jadi cabangnya ditulis eksplisit, bukan diserahkan pada perilaku default.
      where: { reportId, ...(simpanMaterial.length ? { id: { notIn: simpanMaterial } } : {}) },
    });
    for (const m of barisMaterial) {
      if (m.id) {
        await tx.dailyReportMaterial.update({
          where: { id: m.id },
          data: { name: m.name, unit: m.unit, qtyReceived: m.qtyReceived },
        });
        idMaterial[m.asli] = m.id;
      } else {
        const baru = await tx.dailyReportMaterial.create({
          data: { reportId, name: m.name, unit: m.unit, qtyReceived: m.qtyReceived },
          select: { id: true },
        });
        idMaterial[m.asli] = baru.id;
      }
    }

    const milikAlat = new Set(
      (await tx.dailyReportEquipment.findMany({ where: { reportId }, select: { id: true } })).map(
        (r) => r.id,
      ),
    );
    const barisAlat = equipment.map((e) => ({
      asli: e.asli,
      id: e.id && milikAlat.has(e.id) ? e.id : null,
      name: e.name.trim(),
      count: Math.round(e.count),
    }));
    const simpanAlat = barisAlat.map((e) => e.id).filter((x): x is string => x != null);
    await tx.dailyReportEquipment.deleteMany({
      where: { reportId, ...(simpanAlat.length ? { id: { notIn: simpanAlat } } : {}) },
    });
    for (const e of barisAlat) {
      if (e.id) {
        await tx.dailyReportEquipment.update({ where: { id: e.id }, data: { name: e.name, count: e.count } });
        idAlat[e.asli] = e.id;
      } else {
        const baru = await tx.dailyReportEquipment.create({
          data: { reportId, name: e.name, count: e.count },
          select: { id: true },
        });
        idAlat[e.asli] = baru.id;
      }
    }
  });
  await audit(userId, "daily_report.enrich", "daily_report", reportId, {
    weather: input.weather,
    workers: workers.length,
    materials: materials.length,
    equipment: equipment.length,
  });
  // Dikembalikan supaya foto yang ikut dikirim bersama simpanan bisa langsung
  // ditempelkan ke barisnya — tanpa menyuruh orangnya menyimpan dulu.
  return { idMaterial, idAlat };
}

/**
 * Guard volume saat laporan MASUK ke status counted (audit 2026-07-27, B1).
 *
 * Guard di `upsertItem` hanya berjalan saat item DISIMPAN, dan hanya melihat
 * laporan yang SUDAH counted. Dua draft di dua tanggal masing-masing lolos
 * guard itu, lalu keduanya dikirim — kumulatif melampaui RAB tanpa satu pun
 * error. Jalur yang sama terbuka lewat `perlu_koreksi` (laporan keluar dari
 * counted selama dikoreksi, laporan lain bisa mengisi sisa volumenya).
 *
 * Karena itu volume di-RE-VALIDASI di sini, DI DALAM transaksi transisi
 * `→ dikirim`: kumulatif counted laporan LAIN + item laporan ini ≤ volume RAB.
 */
async function assertVolumeWithinRab(
  tx: Prisma.TransactionClient,
  report: { id: string; locationId: string },
) {
  const items = await tx.dailyReportItem.findMany({
    where: { reportId: report.id },
    select: {
      lineageKey: true,
      basis: true,
      volumeDone: true,
      rabNode: { select: { code: true, name: true, unit: true, volume: true } },
    },
  });
  if (items.length === 0) return;

  // Dikelompokkan PER BASIS, bukan hanya per lineage — pembandingnya berbeda
  // (DECISIONS 210): baris basis aktif diadu dengan volume RAB aktif sehingga
  // hanya realisasi basis aktif yang boleh ikut dijumlahkan; baris basis draft
  // diadu dengan volume draft, yang sudah mencakup pekerjaan yang dilaporkan
  // di basis aktif, jadi KEDUA basis dihitung. Menjumlahkan semua basis untuk
  // baris aktif akan menolak laporan yang sebetulnya sah.
  const counted = await tx.dailyReportItem.groupBy({
    by: ["lineageKey", "basis"],
    where: {
      lineageKey: { in: items.map((it) => it.lineageKey) },
      report: {
        locationId: report.locationId,
        status: { in: [...COUNTED_REPORT_STATUSES] },
        id: { not: report.id },
      },
    },
    _sum: { volumeDone: true },
  });
  const othersByLineageBasis = new Map(
    counted.map((c) => [`${c.lineageKey}|${c.basis}`, Number(c._sum.volumeDone ?? 0)]),
  );
  const othersFor = (lineageKey: string, basis: string) => {
    const aktif = othersByLineageBasis.get(`${lineageKey}|aktif`) ?? 0;
    if (basis === "aktif") return aktif;
    return aktif + (othersByLineageBasis.get(`${lineageKey}|draft_adendum`) ?? 0);
  };

  const offending: string[] = [];
  for (const it of items) {
    const volK = it.rabNode.volume != null ? Number(it.rabNode.volume) : null;
    if (volK == null) continue;
    const others = othersFor(it.lineageKey, it.basis);
    const total = others + Number(it.volumeDone);
    if (total > volK + VOLUME_EPSILON) {
      const sisa = Math.max(0, Math.round((volK - others) * 1000) / 1000);
      offending.push(
        `${it.rabNode.code} ${it.rabNode.name}: total ${formatNumber(total)} > RAB ${formatNumber(volK)} ${it.rabNode.unit ?? ""} (sisa ${formatNumber(sisa)})`.trim(),
      );
    }
  }
  if (offending.length > 0) {
    throw new DailyReportError(
      `Volume kumulatif melebihi RAB – laporan lain sudah terkirim lebih dulu. Perbaiki item berikut: ${offending.join("; ")}`,
    );
  }
}

/**
 * Transisi generik: validasi lifecycle + update + history APPEND-ONLY + AUDIT
 * dalam satu $transaction.
 *
 * Auditnya sengaja ditulis DI DALAM transaksi (AUDIT-01): sebelumnya ia
 * dipanggil setelah commit dan kegagalannya ditelan, jadi status laporan bisa
 * berpindah tanpa jejak. Sekarang keduanya sehidup-semati.
 */
async function transition(
  reportId: string,
  to: DailyReportStatus,
  userId: string,
  extra: Prisma.DailyReportUpdateInput,
  jejak: { action: string; payload?: Record<string, unknown> },
  reason?: string | null,
) {
  const report = await getReportOrThrow(reportId);
  if (!canTransitionReport(report.status, to)) {
    throw new DailyReportError(`Transisi status ${report.status} → ${to} tidak diizinkan`);
  }
  const ip = (await requestIp()) ?? null;
  const updated = await db.$transaction(async (tx) => {
    // Masuk ke counted = mulai memengaruhi progress/kurva/blanko — volume
    // wajib dicek ulang di sini, bukan hanya saat item diketik (B1).
    if (to === "dikirim") {
      // Guard di atas membaca AGREGAT laporan lain lalu menulis status laporan
      // ini. Optimistic lock `where: {id, status}` hanya melindungi baris yang
      // sama, jadi dua laporan BERBEDA pada lokasi yang sama bisa lolos
      // bersamaan dan total counted melampaui volume RAB (audit Codex
      // 2026-07-28, CALC-02). Advisory lock per LOKASI membuat submit
      // bersamaan di satu lokasi antre — pola yang sama dengan `FOR UPDATE`
      // di jalur keuangan. Lock otomatis lepas saat transaksi selesai.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${report.locationId}::text, 0))`;
      await assertVolumeWithinRab(tx, { id: report.id, locationId: report.locationId });
    }
    const row = await tx.dailyReport.update({
      where: { id: reportId, status: report.status }, // optimistic lock: status tidak berubah di tengah
      data: { status: to, ...extra },
    });
    await tx.dailyReportStatusHistory.create({
      data: {
        reportId,
        fromStatus: report.status,
        toStatus: to,
        changedById: userId,
        reason: reason?.trim() || null,
      },
    });
    await auditIn(tx, userId, jejak.action, "daily_report", reportId, jejak.payload, ip);
    return row;
  });
  return { report, updated };
}

/**
 * draft | perlu_koreksi → dikirim.
 *
 * Wajib berisi SESUATU: minimal satu item pekerjaan, ATAU satu material, ATAU
 * satu alat.
 *
 * Dulu syaratnya ≥1 item pekerjaan. Kebutuhan lapangan user 2026-08-08:
 * *"kadang ada hari dimana tidak ada kegiatan yang berhubungan dengan item
 * pekerjaan (RAB), tapi ada material masuk. saat ini kondisi tersebut tidak
 * bisa diinput."* Betul — dan akibatnya bukan sekadar merepotkan: kedatangan
 * material jadi TIDAK TERCATAT sama sekali di hari itu, padahal itu kejadian
 * yang perlu dibuktikan.
 *
 * Pagarnya dilonggarkan, BUKAN dibuang: laporan yang benar-benar kosong tetap
 * ditolak, supaya laporan hampa tidak masuk antrean verifikasi dan memakan
 * waktu orang yang memeriksanya.
 *
 * Hari nol-item TIDAK menggerakkan progres apa pun — tidak ada baris item
 * berarti tidak ada nilai yang dihitung. Itu memang yang diinginkan; angkanya
 * tetap jujur.
 */
export async function submitReport(reportId: string, userId: string) {
  const [itemCount, materialCount, equipmentCount, laporan] = await Promise.all([
    db.dailyReportItem.count({ where: { reportId } }),
    db.dailyReportMaterial.count({ where: { reportId } }),
    db.dailyReportEquipment.count({ where: { reportId } }),
    db.dailyReport.findUnique({
      where: { id: reportId },
      select: { noActivity: true, noActivityReason: true },
    }),
  ]);
  if (itemCount === 0 && materialCount === 0 && equipmentCount === 0) {
    /*
     * Hari nihil BOLEH dikirim — tapi hanya kalau dinyatakan, berikut sebabnya
     * (DECISIONS 396). Pagarnya tidak dilonggarkan, melainkan diberi satu pintu
     * yang harus dilewati dengan sadar: laporan yang LUPA diisi tetap ditolak,
     * dan itulah yang membuat hari nihil bisa dipercaya sebagai pernyataan.
     */
    if (!laporan?.noActivity) {
      throw new DailyReportError(
        "Laporan masih kosong – isi minimal satu item pekerjaan, material masuk, atau alat. " +
          "Kalau hari ini memang tidak ada kegiatan, centang \"Tidak ada kegiatan\" dan sebutkan sebabnya.",
      );
    }
    if (!laporan.noActivityReason) {
      /*
       * Tanpa sebab, hari nihil tidak bisa dibedakan satu sama lain — padahal
       * hujan adalah dasar klaim perpanjangan waktu, libur netral, dan
       * "menunggu" adalah kendala yang harus ditagih. Di kurva-S ketiganya 0%;
       * di manajemen ketiganya berbeda.
       */
      throw new DailyReportError("Sebab tidak ada kegiatan wajib dipilih.");
    }
  }
  const { updated } = await transition(
    reportId,
    "dikirim",
    userId,
    { submittedById: userId, submittedAt: new Date() },
    { action: "daily_report.submit", payload: { items: itemCount, materials: materialCount, equipment: equipmentCount } },
  );
  return updated;
}

/** dikirim → perlu_koreksi. Alasan WAJIB — SM lapangan harus tahu apa yang salah. */
export async function returnReport(reportId: string, reason: string, userId: string) {
  if (!reason || reason.trim().length === 0) {
    throw new DailyReportError("Alasan pengembalian wajib diisi");
  }
  const { updated } = await transition(
    reportId,
    "perlu_koreksi",
    userId,
    {},
    { action: "daily_report.return", payload: { reason: reason.trim() } },
    reason,
  );
  return updated;
}

/**
 * Pemisahan tugas — pagar berbasis ORANG, bukan peran (DECISIONS 218).
 *
 * Sengaja TIDAK diletakkan di `authz`: peran menjawab "boleh menyentuh apa",
 * pemisahan tugas menjawab "tidak boleh mengesahkan pekerjaan sendiri". Dulu
 * pagar ini tidak ada sama sekali, sehingga satu Site Manager bisa membuat,
 * mengirim, menyetujui, DAN memfinalkan laporan yang sama seorang diri —
 * progres resmi naik dan dasar termin terbentuk tanpa satu pun mata kedua.
 *
 * Bisa dimatikan lewat halaman Sistem karena di awal pemakaian sering hanya
 * ada satu orang aktif per lokasi (permintaan user). Yang penting: keadaannya
 * TERBACA, bukan jadi asumsi diam-diam.
 */
async function assertPemisahanTugas(
  reportId: string,
  userId: string,
  langkah: "approve" | "finalize",
) {
  const { getPolicy } = await import("@/lib/policy");
  const policy = await getPolicy();
  const aktif = langkah === "approve" ? policy.approverMustDiffer : policy.finalizerMustDiffer;
  if (!aktif) return;

  const rep = await db.dailyReport.findUniqueOrThrow({
    where: { id: reportId },
    select: { submittedById: true, verifiedById: true, createdById: true },
  });
  if (langkah === "approve") {
    // Pembanding utama = PENGIRIM. `createdById` ikut diperiksa untuk laporan
    // yang dikirim orang lain tapi seluruh isinya diketik penyetuju sendiri.
    const sendiri = rep.submittedById === userId || (rep.submittedById == null && rep.createdById === userId);
    if (sendiri) {
      throw new DailyReportError(
        "Laporan ini kamu sendiri yang mengirim – penyetujunya harus orang lain. " +
          "Setelan ini bisa diubah di menu Sistem → Kebijakan pengendalian.",
      );
    }
    return;
  }
  if (rep.verifiedById === userId) {
    throw new DailyReportError(
      "Laporan ini kamu sendiri yang menyetujui – pemfinalnya harus orang lain. " +
        "Setelan ini bisa diubah di menu Sistem → Kebijakan pengendalian.",
    );
  }
}

/** dikirim → disetujui. */
export async function approveReport(reportId: string, userId: string) {
  await assertPemisahanTugas(reportId, userId, "approve");
  const { updated } = await transition(
    reportId,
    "disetujui",
    userId,
    { verifiedById: userId, verifiedAt: new Date() },
    { action: "daily_report.approve" },
  );
  return updated;
}

/** Snapshot immutable untuk cetak — dibekukan saat finalisasi. */
export type FinalSnapshot = {
  version: 1;
  generatedAt: string;
  reportDate: string; // YYYY-MM-DD
  location: { name: string; slug: string; village: string; regency: string; province: string };
  weekNo: number | null;
  tahunAnggaran: number;
  weather: WeatherCode | null;
  /** Kondisi per jam 07–21 (bila diambil otomatis) — dibekukan bersama laporan. */
  weatherHourly: HourlyWeather[] | null;
  workStart: string | null;
  workEnd: string | null;
  notes: string | null;
  items: {
    lineageKey: string;
    code: string;
    name: string;
    unit: string | null;
    volumeContract: number | null;
    volumeBefore: number; // s/d laporan lalu
    volumeToday: number; // hari ini
    volumeCumulative: number; // s/d hari ini
    pctCumulative: number | null;
    valueDone: string; // BigInt rupiah sebagai string
    notes: string | null;
  }[];
  /**
   * Berapa baris laporan hari itu yang basisnya DRAFT ADENDUM dan karena itu
   * TIDAK ikut `items` (DECISIONS 215). Opsional: snapshot yang dibekukan
   * sebelum aturan ini ada tidak punya field ini — pembacanya menghitung ulang
   * dari baris laporan yang masih tersimpan, jadi laporan lama tetap benar.
   */
  itemsDraftAdendum?: number;
  totalValueToday: string;
  progress: {
    grandTotal: string;
    realizedValue: string;
    realizedPct: number;
    planPct: number;
    deviationPct: number;
  };
  workers: { role: WorkerRole; count: number }[];
  totalWorkers: number;
  materials: { name: string; unit: string | null; qty: number | null }[];
  equipment: { name: string; count: number }[];
  photos: {
    id: string;
    r2Key: string;
    thumbnailKey: string | null;
    takenAt: string | null;
    lat: number | null;
    lng: number | null;
  }[];
};

/** Bangun isi finalSnapshot dari data live (dipanggil saat finalisasi, status masih counted). */
export async function buildFinalSnapshot(reportId: string): Promise<FinalSnapshot> {
  const report = await db.dailyReport.findUniqueOrThrow({
    where: { id: reportId },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          slug: true,
          village: true,
          regency: true,
          province: true,
          package: { select: { contract: { select: { startDate: true } } } },
        },
      },
      // Urut RAB (sortOrder), BUKAN urutan input — supaya baris laporan
      // konsisten antar hari & sama dengan tabel KKP lain.
      items: { include: { rabNode: true }, orderBy: { rabNode: { sortOrder: "asc" } } },
      workers: true,
      materials: { orderBy: { name: "asc" } },
      equipment: { orderBy: { name: "asc" } },
      photos: { orderBy: { createdAt: "asc" } },
    },
  });

  const [cumulative, progress] = await Promise.all([
    // WAJIB dibatasi s/d tanggal laporan: tanpa batas ini snapshot membeku
    // dengan kumulatif SELURUH WAKTU (termasuk hari-hari SESUDAHNYA yang sudah
    // counted), sehingga "s/d" langsung mentok 100% dan "s/d lalu" ikut
    // salah karena diturunkan dari pengurangan. DECISIONS 147.
    cumulativeVolumeByLineage(report.locationId, report.reportDate),
    // Sama seperti kumulatif volume di atas: blok progress SNAPSHOT juga wajib
    // as-of TANGGAL LAPORAN. Tanpa `asOf`, laporan 1 Juli yang difinalkan 20
    // Juli membekukan realisasi 20 Juli, bobot revisi RAB terbaru, dan minggu
    // rencana ke-20 — dokumen bertanggal 1 Juli memuat angka masa depan
    // (audit Codex 2026-07-28, CALC-01).
    getLocationProgress(report.locationId, { asOf: report.reportDate }),
  ]);

  const dateKey = jakartaDateKey(report.reportDate);
  const startDate = report.location.package.contract?.startDate ?? null;
  const weekNo = startDate
    ? Math.max(1, Math.floor((report.reportDate.getTime() - startDate.getTime()) / (7 * 86_400_000)) + 1)
    : null;

  // Blanko harian KKP adalah DOKUMEN RESMI ⇒ hanya baris basis aktif
  // (DECISIONS 215). Pekerjaan yang dilaporkan atas usulan adendum belum punya
  // dasar kontrak; mencetaknya di blanko sama saja menyatakan ia sudah sah.
  // Jumlahnya tetap dicatat supaya penghilangannya TIDAK diam-diam.
  const itemsAktif = report.items.filter((it) => it.basis === "aktif");
  const itemsDraftAdendum = report.items.length - itemsAktif.length;

  let totalValueToday = 0n;
  const items = itemsAktif.map((it) => {
    const volumeToday = Number(it.volumeDone);
    const volumeCumulative = cumulative.get(it.lineageKey) ?? volumeToday;
    const volumeContract = it.rabNode.volume != null ? Number(it.rabNode.volume) : null;
    totalValueToday += it.valueDone;
    return {
      lineageKey: it.lineageKey,
      code: it.rabNode.code,
      name: it.rabNode.name,
      unit: it.rabNode.unit,
      volumeContract,
      volumeBefore: Math.max(0, Math.round((volumeCumulative - volumeToday) * 1000) / 1000),
      volumeToday,
      volumeCumulative,
      // Dibatasi 100% memakai formula yang sama dengan blanko mingguan/bulanan
      // (DECISIONS 151) — item yang sama tidak boleh 110% di harian tapi 100%
      // di mingguan.
      pctCumulative:
        volumeContract != null && volumeContract > 0 ? prestasiPct(volumeCumulative, volumeContract) : null,
      valueDone: it.valueDone.toString(),
      notes: it.notes,
    };
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    reportDate: dateKey,
    location: {
      name: report.location.name,
      slug: report.location.slug,
      village: report.location.village,
      regency: report.location.regency,
      province: report.location.province,
    },
    weekNo,
    tahunAnggaran: (startDate ?? report.reportDate).getUTCFullYear(),
    weather: report.weather,
    weatherHourly: parseHourlyWeather(report.weatherHourly),
    workStart: report.workStart,
    workEnd: report.workEnd,
    notes: report.notes,
    items,
    itemsDraftAdendum,
    totalValueToday: totalValueToday.toString(),
    progress: {
      grandTotal: progress.grandTotal.toString(),
      realizedValue: progress.realizedValue.toString(),
      realizedPct: progress.realizedPct,
      planPct: progress.planPct,
      deviationPct: progress.deviationPct,
    },
    workers: report.workers.map((w) => ({ role: w.role, count: w.count })),
    totalWorkers: report.workers.reduce((n, w) => n + w.count, 0),
    materials: report.materials.map((m) => ({
      name: m.name,
      unit: m.unit,
      qty: m.qtyReceived != null ? Number(m.qtyReceived) : null,
    })),
    equipment: report.equipment.map((e) => ({ name: e.name, count: e.count })),
    photos: report.photos.map((p) => ({
      id: p.id,
      r2Key: p.r2Key,
      thumbnailKey: p.thumbnailKey,
      takenAt: p.exifTakenAt ? p.exifTakenAt.toISOString() : null,
      lat: p.exifGpsLat != null ? Number(p.exifGpsLat) : null,
      lng: p.exifGpsLng != null ? Number(p.exifGpsLng) : null,
    })),
  };
}

/** disetujui → final. Membekukan finalSnapshot lengkap untuk cetak. */
export async function finalizeReport(reportId: string, userId: string) {
  // Snapshot dibangun SEBELUM transisi — status disetujui sudah counted,
  // jadi kumulatif di snapshot sudah termasuk volume laporan ini.
  const current = await getReportOrThrow(reportId);
  if (!canTransitionReport(current.status, "final")) {
    throw new DailyReportError(`Transisi status ${current.status} → final tidak diizinkan`);
  }
  // Diperiksa SEBELUM snapshot dibangun: membangun snapshot itu mahal, dan
  // menolak sesudahnya berarti kerja itu terbuang percuma.
  await assertPemisahanTugas(reportId, userId, "finalize");
  const snapshot = await buildFinalSnapshot(reportId);
  const { updated } = await transition(
    reportId,
    "final",
    userId,
    {
      finalizedById: userId,
      finalizedAt: new Date(),
      finalSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
    {
      action: "daily_report.finalize",
      payload: { items: snapshot.items.length, totalValueToday: snapshot.totalValueToday },
    },
  );

  // Laporan final = dokumen yang memang harus ada di Drive KKP, jadi niat itu
  // dicatat di sini — di SATU tempat yang dilewati semua jalur finalisasi.
  // Hanya MENGANTRE, tidak mengunggah: finalisasi tidak boleh ikut gagal atau
  // menggantung karena Google sedang lambat (DECISIONS 313).
  const { antrekanLaporanHarian } = await import("@/lib/gdrive/antrean");
  await antrekanLaporanHarian(updated.id);
  return updated;
}

/**
 * final → disetujui: BUKA KUNCI laporan yang sudah final agar bisa dikoreksi.
 * Untuk salah input yang baru ketahuan setelah finalisasi. Bukan alur normal —
 * pemanggil WAJIB menggerbang `daily_report.unfinalize` (super_admin saja).
 *
 * `finalSnapshot` dikosongkan karena sudah tidak sah: begitu laporan bisa
 * diedit, angka beku itu bisa berbeda dari data sebenarnya. Snapshot dibangun
 * ulang saat difinalkan kembali. Progres & kurva-S TIDAK berubah oleh aksi ini
 * — status `disetujui` tetap terhitung (COUNTED_REPORT_STATUSES); yang mengubah
 * angka adalah editan setelahnya. DECISIONS 149.
 */
export async function unfinalizeReport(reportId: string, userId: string, reason: string) {
  const current = await getReportOrThrow(reportId);
  if (current.status !== "final") {
    throw new DailyReportError("Laporan ini tidak berstatus final.");
  }
  const alasan = reason.trim();
  if (alasan.length < 10) {
    throw new DailyReportError("Alasan koreksi wajib diisi (minimal 10 karakter).");
  }
  const { updated } = await transition(
    reportId,
    "disetujui",
    userId,
    { finalizedById: null, finalizedAt: null, finalSnapshot: Prisma.DbNull },
    { action: "daily_report.unfinalize", payload: { reason: alasan } },
    alasan,
  );
  return updated;
}

export type IssueInput = {
  title: string;
  description?: string | null;
  severity: IssueSeverity;
};

/** Catat kendala lapangan yang menempel ke laporan harian. */
export async function addIssueFromReport(reportId: string, input: IssueInput, userId: string) {
  const report = await getReportOrThrow(reportId);
  // Laporan final beku — kendala baru dicatat lewat menu Kendala lokasi, bukan
  // menempel diam-diam ke dokumen yang sudah final (audit 2026-07-27, B16c).
  if (report.status === "final") {
    throw new DailyReportError("Laporan sudah final – catat kendala lewat menu Kendala lokasi");
  }
  if (!input.title || input.title.trim().length === 0) {
    throw new DailyReportError("Judul kendala wajib diisi");
  }
  const issue = await db.issue.create({
    data: {
      locationId: report.locationId,
      reportId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      severity: input.severity,
      raisedById: userId,
      // Ditulis TEGAS, bukan mengandalkan default `manual` di skema. Tanpa ini
      // kendala dari laporan harian berlabel "Dicatat langsung" di papan, dan
      // saringan Sumber diam-diam salah – label yang salah lebih buruk
      // daripada label yang tidak ada. DECISIONS 392.
      source: "laporan_harian",
    },
  });
  await audit(userId, "issue.create", "issue", issue.id, { reportId, severity: input.severity });
  return issue;
}

/**
 * Nyatakan / batalkan "hari ini tidak ada kegiatan" (DECISIONS 396).
 *
 * Sengaja BUKAN sekadar menulis kolom: penjaganya memastikan pernyataan ini
 * tidak pernah berdiri bersama item pekerjaan, material, atau alat. Dua
 * pernyataan yang saling menyangkal membuat laporan mengatakan dua hal
 * sekaligus, dan pembacanya yang disuruh memilih mana yang benar.
 */
export async function setHariNihil(
  reportId: string,
  input: { nihil: boolean; alasan?: NoActivityReason | null; catatan?: string | null },
  userId: string,
) {
  const report = await getReportOrThrow(reportId);
  if (report.status === "final") {
    throw new DailyReportError("Laporan sudah final – tidak bisa diubah.");
  }

  if (input.nihil) {
    if (!input.alasan) throw new DailyReportError("Sebab tidak ada kegiatan wajib dipilih.");
    const [jumlahItem, jumlahMaterial, jumlahAlat] = await Promise.all([
      db.dailyReportItem.count({ where: { reportId } }),
      db.dailyReportMaterial.count({ where: { reportId } }),
      db.dailyReportEquipment.count({ where: { reportId } }),
    ]);
    const halangan = alasanTidakBisaNihil({ jumlahItem, jumlahMaterial, jumlahAlat });
    if (halangan) throw new DailyReportError(halangan);
  }

  const updated = await db.dailyReport.update({
    where: { id: reportId },
    data: {
      noActivity: input.nihil,
      // Dikosongkan saat pembatalan, bukan dibiarkan menggantung: sebab yang
      // tertinggal dari pernyataan yang sudah dicabut akan terbaca lagi oleh
      // laporan periodik dan hitungan hari hujan.
      noActivityReason: input.nihil ? (input.alasan ?? null) : null,
      noActivityNote: input.nihil ? (input.catatan?.trim() || null) : null,
    },
  });
  await audit(userId, "daily_report.set_nihil", "daily_report", reportId, {
    locationId: report.locationId,
    nihil: input.nihil,
    alasan: input.nihil ? input.alasan : null,
  });
  return updated;
}
