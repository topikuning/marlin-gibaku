import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";
import { hasLocationAccess } from "@/lib/access";
import { getReportableItems } from "@/lib/rab";
import { getScurveSeries } from "@/lib/scurve-data";
import { buildPhotoViews } from "@/lib/photos";
import type { UserRole } from "@prisma/client";

const jkDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });

export type PeriodKind = "mingguan" | "bulanan";

/** Satu baris item pekerjaan pada tabel rincian (per item RAB). */
export type PeriodItemRow = {
  no: number;
  name: string;
  unit: string;
  volumeKontrak: number;
  bobot: number; // % dari nilai RAB
  volLalu: number;
  prestasiLalu: number; // % thd volume kontrak item
  bobotLalu: number; // kontribusi bobot (%)
  volIni: number;
  prestasiIni: number;
  bobotIni: number;
  volSd: number;
  prestasiSd: number;
  bobotSd: number;
  sisaVol: number;
  sisaPrestasi: number;
};

/** Kelompok pekerjaan (kategori RAB) + subtotal bobot. */
export type PeriodCategory = {
  roman: string;
  name: string;
  bobot: number;
  bobotSd: number;
  rows: PeriodItemRow[];
};

/** Foto untuk halaman dokumentasi. */
export type PeriodPhoto = {
  id: string;
  thumbUrl?: string;
  fullUrl?: string;
  caption: string;
  bobot: number;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
};

export type PeriodReport = {
  kind: PeriodKind;
  n: number;
  totalWeeks: number;
  totalMonths: number;
  paketName: string;
  locationName: string;
  village: string;
  regency: string;
  province: string;
  contractNumber: string;
  contractorName: string;
  contractValueStr: string;
  masaPelaksanaanHari: number;
  tahunAnggaran: number;
  periodeStart: Date;
  periodeEnd: Date;
  planPct: number;
  actualPct: number;
  deviationPct: number;
  categories: PeriodCategory[];
  totalBobotIni: number;
  totalBobotSd: number;
  totalBobotRencanaSd: number;
  scurve: {
    weeks: number[];
    plannedPct: number[];
    actualPct: (number | null)[];
    currentWeek: number;
  };
  photos: PeriodPhoto[];
  deviations: { cause: string; recovery: string | null; at: Date }[];
};

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function addMonths(base: Date, months: number): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()));
}

/** "I. PEKERJAAN X › Sub" → { roman: "I", name: "PEKERJAAN X" }. */
function splitCategory(label: string): { roman: string; name: string } {
  const top = label.split("›")[0].trim();
  const m = top.match(/^([IVXLCDM]+)\.\s*(.*)$/i);
  if (m) return { roman: m[1], name: m[2] };
  return { roman: "", name: top };
}

/** Nilai angka dari angka Romawi (untuk urutkan kategori). */
function romanToInt(s: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const r = s.toUpperCase();
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const cur = map[r[i]] ?? 0;
    const next = map[r[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total || 9999;
}

export async function getPeriodReport(
  slug: string,
  kind: PeriodKind,
  n: number,
  userId: string,
  role: UserRole
): Promise<PeriodReport | "notfound" | "forbidden"> {
  if (!Number.isInteger(n) || n < 1) return "notfound";

  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      village: true,
      regency: true,
      province: true,
      contract: {
        select: {
          contractNumber: true,
          contractValue: true,
          startDate: true,
          endDate: true,
          contractor: { select: { name: true } },
        },
      },
    },
  });
  if (!location) return "notfound";
  if (!isCrossLocation(role) && !(await hasLocationAccess(userId, role, location.id)))
    return "forbidden";

  const start = location.contract.startDate;
  const scurve = await getScurveSeries(location.id, start);
  const totalWeeks = scurve.totalWeeks;
  const totalMonths = Math.max(1, Math.ceil(totalWeeks / 4.345));

  let periodeStart: Date;
  let periodeEnd: Date;
  let weekIndex: number;
  if (kind === "mingguan") {
    periodeStart = new Date(start.getTime() + (n - 1) * 7 * 86_400_000);
    periodeEnd = new Date(periodeStart.getTime() + 6 * 86_400_000);
    weekIndex = n;
  } else {
    periodeStart = addMonths(start, n - 1);
    periodeEnd = new Date(addMonths(start, n).getTime() - 86_400_000);
    weekIndex = Math.min(
      totalWeeks,
      Math.max(1, Math.floor((periodeEnd.getTime() - start.getTime()) / (7 * 86_400_000)) + 1)
    );
  }

  const idx = Math.min(scurve.plannedPct.length, Math.max(1, weekIndex)) - 1;
  const planPct = scurve.plannedPct[idx] ?? 0;
  const actualPct = scurve.actualPct[idx] ?? 0;

  // Item RAB (leaf, punya volume+satuan) + bobot per item.
  const reportable = await getReportableItems(location.id);
  const withValue = reportable.map((it) => {
    const vol = it.volume ?? 0;
    const price = it.unitPrice?.toNumber() ?? 0;
    return { ...it, vol, value: vol * price };
  });
  const rabTotal = withValue.reduce((s, it) => s + it.value, 0) || 1;

  // Realisasi per lineage, dibucket lalu (< periode) vs ini (dalam periode).
  const lineages = [...new Set(withValue.map((i) => i.lineageId))];
  const sStr = jkDay.format(periodeStart);
  const eStr = jkDay.format(periodeEnd);
  const realRows = lineages.length
    ? await db.dailyReportItem.findMany({
        where: { state: { in: ["approved", "sent"] }, rabItem: { lineageId: { in: lineages } } },
        select: {
          volumeDone: true,
          approvedAt: true,
          suggestedAt: true,
          createdAt: true,
          rabItem: { select: { lineageId: true } },
        },
      })
    : [];
  const lalu = new Map<string, number>();
  const ini = new Map<string, number>();
  for (const r of realRows) {
    const lin = r.rabItem.lineageId;
    const d = jkDay.format(r.approvedAt ?? r.suggestedAt ?? r.createdAt);
    const v = r.volumeDone.toNumber();
    if (d < sStr) lalu.set(lin, (lalu.get(lin) ?? 0) + v);
    else if (d <= eStr) ini.set(lin, (ini.get(lin) ?? 0) + v);
  }

  // Susun tabel rincian, dikelompokkan per kategori (top-level).
  const catMap = new Map<string, PeriodCategory>();
  let totalBobotIni = 0;
  let totalBobotSd = 0;
  for (const it of withValue) {
    const { roman, name } = splitCategory(it.category);
    const key = `${roman}||${name}`;
    let cat = catMap.get(key);
    if (!cat) {
      cat = { roman, name, bobot: 0, bobotSd: 0, rows: [] };
      catMap.set(key, cat);
    }
    const bobot = (it.value / rabTotal) * 100;
    const volLalu = lalu.get(it.lineageId) ?? 0;
    const volIni = ini.get(it.lineageId) ?? 0;
    const volSd = volLalu + volIni;
    const vk = it.vol || 0;
    const prestasi = (v: number) => (vk > 0 ? Math.min(100, (v / vk) * 100) : 0);
    const prestasiLalu = prestasi(volLalu);
    const prestasiIni = prestasi(volIni);
    const prestasiSd = prestasi(volSd);
    const bobotLalu = (prestasiLalu / 100) * bobot;
    const bobotIni = (prestasiIni / 100) * bobot;
    const bobotSd = (prestasiSd / 100) * bobot;
    totalBobotIni += bobotIni;
    totalBobotSd += bobotSd;
    cat.bobot += bobot;
    cat.bobotSd += bobotSd;
    cat.rows.push({
      no: 0,
      name: it.name,
      unit: it.unit,
      volumeKontrak: vk,
      bobot,
      volLalu,
      prestasiLalu,
      bobotLalu,
      volIni,
      prestasiIni,
      bobotIni,
      volSd,
      prestasiSd,
      bobotSd,
      sisaVol: Math.max(0, vk - volSd),
      sisaPrestasi: Math.max(0, 100 - prestasiSd),
    });
  }
  // Urutkan kategori per angka Romawi & nomori item berurutan.
  const categories = [...catMap.values()].sort((a, b) => romanToInt(a.roman) - romanToInt(b.roman));
  let seq = 0;
  for (const c of categories) for (const row of c.rows) row.no = ++seq;

  // Dokumentasi foto pada periode (maks 12 untuk cetak).
  const photoRows = lineages.length
    ? await db.photo.findMany({
        where: {
          reportItem: {
            state: { in: ["approved", "sent"] },
            rabItem: { lineageId: { in: lineages } },
          },
        },
        select: {
          id: true,
          r2Key: true,
          thumbnailKey: true,
          exifTakenAt: true,
          exifGpsLat: true,
          exifGpsLng: true,
          createdAt: true,
          reportItem: {
            select: {
              approvedAt: true,
              suggestedAt: true,
              createdAt: true,
              rabItem: { select: { name: true, lineageId: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const bobotByLineage = new Map<string, number>();
  for (const it of withValue)
    bobotByLineage.set(it.lineageId, (bobotByLineage.get(it.lineageId) ?? 0) + (it.value / rabTotal) * 100);
  const inPeriod = photoRows.filter((p) => {
    const ri = p.reportItem;
    const d = jkDay.format(ri?.approvedAt ?? ri?.suggestedAt ?? ri?.createdAt ?? p.createdAt);
    return d >= sStr && d <= eStr;
  });
  const views = await buildPhotoViews(inPeriod);
  const viewById = new Map(views.map((v) => [v.id, v]));
  const photos: PeriodPhoto[] = inPeriod.slice(0, 12).map((p) => {
    const v = viewById.get(p.id);
    const lin = p.reportItem?.rabItem.lineageId ?? "";
    return {
      id: p.id,
      thumbUrl: v?.thumbUrl,
      fullUrl: v?.fullUrl,
      caption: p.reportItem?.rabItem.name ?? "Dokumentasi",
      bobot: bobotByLineage.get(lin) ?? 0,
      takenAt: v?.takenAt ?? (p.exifTakenAt ? p.exifTakenAt.toISOString() : null),
      lat: v?.lat ?? null,
      lng: v?.lng ?? null,
    };
  });

  const deviationRows = await db.deviationNote.findMany({
    where: {
      locationId: location.id,
      createdAt: { gte: periodeStart, lte: new Date(periodeEnd.getTime() + 86_400_000) },
    },
    orderBy: { createdAt: "desc" },
  });

  const masaPelaksanaanHari = Math.max(
    1,
    Math.round((location.contract.endDate.getTime() - start.getTime()) / 86_400_000)
  );

  return {
    kind,
    n,
    totalWeeks,
    totalMonths,
    paketName: `Pembangunan Kampung Nelayan Merah Putih — ${location.name}`,
    locationName: location.name,
    village: location.village,
    regency: location.regency,
    province: location.province,
    contractNumber: location.contract.contractNumber,
    contractorName: location.contract.contractor.name,
    contractValueStr: rupiah.format(location.contract.contractValue),
    masaPelaksanaanHari,
    tahunAnggaran: start.getFullYear(),
    periodeStart,
    periodeEnd,
    planPct,
    actualPct,
    deviationPct: actualPct - planPct,
    categories,
    totalBobotIni,
    totalBobotSd,
    totalBobotRencanaSd: planPct,
    scurve: {
      weeks: scurve.weeks,
      plannedPct: scurve.plannedPct,
      actualPct: scurve.actualPct,
      currentWeek: scurve.currentWeek,
    },
    photos,
    deviations: deviationRows.map((d) => ({ cause: d.cause, recovery: d.recovery, at: d.createdAt })),
  };
}
