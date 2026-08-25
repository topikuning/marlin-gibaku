/**
 * SEED KHUSUS buku manual (DECISIONS 432) — bukan seed dev/e2e biasa.
 *
 * Seed dev (`runDemoSeed`) sengaja menampilkan Kedung Mutih dalam keadaan
 * DARURAT (4 hari laporan saja, kontrak sudah lewat tanggal selesai) supaya
 * kasus deviasi kritis punya data uji. Bagus untuk uji fitur, tapi kalau buku
 * manual memotretnya, SETIAP layar {lokasi} menampilkan lencana merah
 * "Kritis" — mengajarkan pembaca baru bahwa keadaan darurat itu NORMAL
 * (docs/manual/README.md, DECISIONS 365).
 *
 * Skrip ini mendandani SATU lokasi yang SUDAH ADA dari seed dev — Purworejo,
 * yang RAB & baseline-nya sudah tergenerate `runDemoSeed` tapi belum punya
 * laporan harian sama sekali — jadi jadi keadaan WAJAR: progres berjalan
 * dekat rencana (deviasi kecil), riwayat laporan beberapa minggu, foto, 1-2
 * kendala, rencana mingguan. Purworejo dipilih karena TIDAK dipakai satu pun
 * uji e2e (beda dengan Kedung Mutih) — aman didandani ulang tanpa menyentuh
 * seed yang uji e2e andalkan.
 *
 * PENTING — tanggal kontrak digeser RELATIF ke saat skrip ini dijalankan
 * (bukan tanggal tetap di JSON RAB), dan baseline di-generate ULANG untuk
 * jendela baru itu. Alasannya sama dengan kenapa gambar buku dibangkitkan
 * skrip, bukan ditempel (DECISIONS 365): kalau tanggalnya tetap, cepat atau
 * lambat "sekarang" akan lewat dari tanggal selesai kontrak dan bug yang
 * sama (rencana 100%, realisasi kecil = deviasi -99%) muncul lagi di lokasi
 * ini. Dengan tanggal relatif, `pnpm manual:seed` selalu menghasilkan
 * lokasi yang "sedang berjalan, minggu ke-13 dari 20" — kapan pun dijalankan.
 *
 * IDEMPOTENT lewat SKIP, bukan lewat timpa-bersih: `daily_report_status_history`
 * APPEND-ONLY (trigger DB menolak UPDATE/DELETE, sama seperti tabel append-only
 * lain di sistem ini), jadi laporan yang sudah dibuat TIDAK BISA dihapus untuk
 * dibangun ulang. Sekali Purworejo punya satu laporan harian, seluruh isi skrip
 * ini (geser kontrak/generate ulang baseline/laporan/rencana/kendala/foto)
 * dilewati apa adanya pada run berikutnya. Untuk regenerasi total (mis. tanggal
 * kontraknya sudah sangat basi), reset database dev/e2e (`pnpm db:reset` lalu
 * `pnpm db:seed`) baru jalankan `pnpm manual:seed` lagi.
 *
 * Foto: perlu R2 (atau tiruan lokal — lihat `scripts/manual/mock-r2.ts`).
 * Tanpa R2 dikonfigurasi, bagian foto dilewati dengan peringatan (skrip tidak
 * gagal) — sisanya (laporan/rencana/kendala/kurva-S) tetap lengkap.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { scheduleFromItems, cumulativeFromCategoryWeekly, autoCategoryWindowFrac } from "@/lib/scurve/sequencing";
import { weeklyFromSegments } from "@/lib/scurve/generate";
import { weekEndFractions, weekOfDate, weekDateRange, type WeekPeriodMode } from "@/lib/progress-calc";
import { valueDone as calcValueDone } from "@/lib/money";
import { buildStampSvg, overlayAlphaFor, type StampRenderData } from "@/lib/photo-stamp/renderer";
import { formatStampDateTime, formatCoordinate, generatePhotoId, locationCodeFromName, DEFAULT_STAMP_TZ } from "@/lib/photo-stamp/format";
import { STAMP_FONT_REGULAR_B64, STAMP_FONT_BOLD_B64 } from "@/lib/stamp-font";
// DEFAULT_STAMP_ACCENT tidak diimpor dari config.ts — file itu `import "server-only"`
// (baca catatan di r2FromEnv di bawah). Nilainya konstanta warna, aman disalin.
const DEFAULT_STAMP_ACCENT = "#FF8A00";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

/**
 * Foto TIDAK memakai `@/lib/photos.ts` / `@/lib/r2.ts` — keduanya (transitif)
 * meng-`import "server-only"`, yang MELEMPAR begitu modulnya dievaluasi di
 * proses Node biasa (skrip `tsx` ini), bukan cuma saat dibundel ke klien.
 * Jadi di sini dipakai ulang bagian yang BERSIH dari batas itu (renderer stamp
 * + util format, keduanya pure/tanpa I/O) dan klien S3 dipasang sendiri,
 * langsung dari env `R2_*` yang sama dipakai aplikasi.
 */
function r2FromEnv(): { client: S3Client; bucket: string } | null {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return {
    client: new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      forcePathStyle: true,
    }),
    bucket: R2_BUCKET,
  };
}
const r2 = r2FromEnv();
async function r2PutLocal(key: string, body: Buffer, contentType: string): Promise<void> {
  if (!r2) throw new Error("R2 tidak dikonfigurasi");
  await r2.client.send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: body, ContentType: contentType }));
}

const DAY = 24 * 3600 * 1000;
// Kalender Asia/Jakarta, BUKAN UTC — "hari ini" untuk laporan harian dinilai
// dari jam WIB (`jakartaToday()`/`jakartaDateKey()` di `lib/format.ts`); dekat
// tengah malam UTC keduanya bisa beda tanggal. Disalin di sini (bukan diimpor)
// karena alasan yang sama dengan `currentWeekNumber`/`planPctAtWeek` di atas —
// modul-modul itu tidak "server-only", tapi menyalin dua baris lebih murah
// daripada menambah satu impor lagi hanya untuk fungsi sekecil ini.
const jakartaDateKeyOf = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const dateOnly = (d: Date) => new Date(`${jakartaDateKeyOf(d)}T00:00:00.000Z`);
const daysFromNow = (n: number) => dateOnly(new Date(Date.now() + n * DAY));
const dateKeyOf = jakartaDateKeyOf;

/**
 * Duplikat SENGAJA dari `src/lib/progress.ts` (`currentWeekNumber`/`planPctAtWeek`)
 * — modul itu punya `import "server-only"`, yang MELEMPAR di proses Node biasa
 * (skrip seed ini, dijalankan `tsx` di luar Next), bukan cuma di bundle klien.
 * `weekOfDate` sendiri diimpor langsung dari `progress-calc.ts` (murni, tanpa
 * `server-only`) — hanya pembungkus "hari ini di Asia/Jakarta" ini yang disalin.
 */
const WEEK_MS = 7 * 24 * 3600 * 1000;
function currentWeekNumber(startDate: Date, totalWeeks: number, mode: WeekPeriodMode, now = new Date()): number {
  if (mode === "senin_minggu") {
    const today = new Date(`${jakartaDateKeyOf(now)}T00:00:00.000Z`);
    const wk = weekOfDate(startDate, today, "senin_minggu");
    return wk === 0 ? 0 : Math.min(wk, Math.max(totalWeeks, 1));
  }
  const wk = Math.floor((now.getTime() - startDate.getTime()) / WEEK_MS) + 1;
  if (wk < 1) return 0;
  return Math.min(wk, Math.max(totalWeeks, 1));
}
function planPctAtWeek(points: number[], weekNumber: number): number {
  if (points.length === 0) return 0;
  if (weekNumber <= 0) return 0;
  const idx = Math.max(0, Math.min(weekNumber - 1, points.length - 1));
  return points[idx]!;
}

/** PRNG deterministik (mulberry32) — seed tetap supaya buku bisa dibanding dua kali build. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RabNodeRow = {
  id: string;
  kind: string;
  lineageKey: string;
  name: string;
  amount: bigint;
  volume: unknown; // Decimal | null
  unitPrice: unknown; // Decimal | null
};

/**
 * Kurva-S baseline — logika PERSIS `src/lib/seed/demo.ts` (jadwal berbasis item,
 * DECISIONS 082), grid minggu mengikuti `Contract.weekMode` lewat `endFracs`
 * (DECISIONS 427b/429) — bukan lagi diasumsikan 7 hari seragam.
 */
function buildBaselinePoints(catNodes: RabNodeRow[], itemNodes: RabNodeRow[], contractDays: number, endFracs: number[]) {
  const totalWeeks = endFracs.length;
  const catKeysS = catNodes
    .map((n) => ({ key: n.lineageKey, name: n.name }))
    .sort((a, b) => b.key.length - a.key.length);
  const catForS = (lk: string): { key: string; name: string } =>
    catKeysS.find((c) => lk === c.key || lk.startsWith(`${c.key}#`)) ?? { key: "", name: "" };
  const schedItems = itemNodes.map((n) => {
    const cat = catForS(n.lineageKey);
    return { name: n.name, categoryKey: cat.key, categoryName: cat.name, amount: n.amount };
  });
  const grandCatS = catNodes.reduce((s, c) => s + (c.amount > 0n ? Number(c.amount) : 0), 0) || 1;
  const catWinS = new Map<string, [number, number]>();
  for (const c of catNodes) {
    const [cs, ce] = autoCategoryWindowFrac(c.name);
    const sW = Math.max(1, Math.min(totalWeeks, Math.floor(cs * totalWeeks) + 1));
    const eW = Math.max(sW, Math.min(totalWeeks, Math.ceil(ce * totalWeeks)));
    catWinS.set(c.lineageKey, [sW, eW]);
  }
  const winFracS = (_name: string, key?: string): [number, number] => {
    const [s, e] = catWinS.get(key ?? "") ?? [1, totalWeeks];
    return [(s - 1) / totalWeeks, e / totalWeeks];
  };
  const schedFromItems = scheduleFromItems(schedItems, contractDays, winFracS, endFracs);
  const weekly = cumulativeFromCategoryWeekly(schedFromItems.categories, totalWeeks);
  const weeklyByKeyS = new Map(schedFromItems.categories.map((c) => [c.categoryKey, c.weekly]));
  const schedule = catNodes
    .filter((c) => c.amount > 0n)
    .map((c) => {
      const [sW, eW] = catWinS.get(c.lineageKey) ?? [1, totalWeeks];
      const weightPct = (Number(c.amount) / grandCatS) * 100;
      return {
        lineageKey: c.lineageKey,
        name: c.name,
        weightPct,
        weekly:
          weeklyByKeyS.get(c.lineageKey) ?? weeklyFromSegments(weightPct, [{ startWeek: sW, endWeek: eW }], totalWeeks, endFracs),
      };
    });
  return { weekly, schedule, catForS };
}

/** Gambar sintetis (bukan foto asli) — cukup untuk mengisi galeri, jelas berlabel ilustrasi. */
async function gambarSintetis(seed: number): Promise<Buffer> {
  const hue = (seed * 47) % 360;
  const hue2 = (hue + 190) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
    <defs>
      <linearGradient id="langit" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="hsl(${hue},50%,80%)"/>
        <stop offset="100%" stop-color="hsl(${hue},25%,93%)"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="740" fill="url(#langit)"/>
    <rect y="740" width="1600" height="460" fill="hsl(${(hue + 35) % 360},22%,42%)"/>
    <rect x="460" y="380" width="680" height="380" fill="hsl(${hue2},14%,58%)"/>
    <rect x="460" y="380" width="680" height="26" fill="hsl(${hue2},14%,42%)"/>
    <rect x="520" y="470" width="90" height="140" fill="hsl(${hue2},10%,30%)"/>
    <rect x="960" y="470" width="90" height="140" fill="hsl(${hue2},10%,30%)"/>
    <text x="800" y="1130" font-family="sans-serif" font-size="32" fill="rgba(255,255,255,0.8)" text-anchor="middle">Ilustrasi contoh – bukan foto lapangan asli</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

// Font dibenamkan ke SVG (sama alasan dengan `photos.ts`: librsvg tak perlu
// fontconfig sistem, jadi cap teks pasti ter-render di host mana pun).
const EMBED_FONTS = Boolean(STAMP_FONT_REGULAR_B64 && STAMP_FONT_BOLD_B64);
const STAMP_FAMILY = EMBED_FONTS ? "MB" : "sans-serif";
const FONT_FACE_CSS = EMBED_FONTS
  ? `<style>@font-face{font-family:'MB';font-weight:400;src:url(data:font/ttf;base64,${STAMP_FONT_REGULAR_B64}) format('truetype');}` +
    `@font-face{font-family:'MB';font-weight:700;src:url(data:font/ttf;base64,${STAMP_FONT_BOLD_B64}) format('truetype');}</style>`
  : "";

let fotoSeed = 0;
async function buatFoto(
  db: PrismaClient,
  opts: {
    locationId: string;
    locationSlug: string;
    locationLabel: string;
    reportId?: string | null;
    reportItemId?: string | null;
    takenAt: Date;
    userId: string;
    reporterName: string;
    companyName: string;
    categoryName: string;
    workName: string;
    lat: number | null;
    lng: number | null;
  },
): Promise<void> {
  fotoSeed += 1;
  const original = await gambarSintetis(fotoSeed);
  const sha256 = createHash("sha256").update(original).digest("hex");
  const dup = await db.photo.findUnique({ where: { locationId_sha256: { locationId: opts.locationId, sha256 } } });
  if (dup) return; // byte identik sudah ada di lokasi ini — lewati (bukan galat)

  const resized = await sharp(original).resize(1600, 1600, { fit: "inside" }).toBuffer({ resolveWithObject: true });
  const prefix = `photos/${opts.locationSlug}/${dateKeyOf(opts.takenAt)}/`;
  const seq = (await db.photo.count({ where: { r2Key: { startsWith: prefix } } })) + 1;
  const photoId = generatePhotoId(locationCodeFromName(opts.locationLabel), opts.takenAt, seq, DEFAULT_STAMP_TZ);

  const stampData: StampRenderData = {
    companyName: opts.companyName || null,
    locationName: opts.locationLabel || "–",
    categoryName: opts.categoryName || null,
    workName: opts.workName || null,
    dateTimeText: formatStampDateTime(opts.takenAt, DEFAULT_STAMP_TZ),
    coordinateText: formatCoordinate(opts.lat, opts.lng),
    reporterName: opts.reporterName || null,
    photoId,
    accentColor: DEFAULT_STAMP_ACCENT,
    overlayAlpha: overlayAlphaFor("auto"),
    sizeScale: 1,
    timeNote: null,
    coordNote: opts.lat == null ? "titik proyek" : null,
  };
  const svg = buildStampSvg(resized.info.width, resized.info.height, stampData, {
    fontFamily: STAMP_FAMILY,
    fontFaceCss: FONT_FACE_CSS,
  });
  const main = await sharp(resized.data)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .webp({ quality: 80 })
    .toBuffer();
  const thumb = await sharp(main).resize(480, 480, { fit: "inside" }).webp({ quality: 68 }).toBuffer();

  const uuid = randomUUID();
  const key = `${prefix}${uuid}.webp`;
  const thumbnailKey = `${prefix}${uuid}.thumb.webp`;
  const originalKey = `${prefix}${uuid}.asli.jpg`;
  await r2PutLocal(key, main, "image/webp");
  await r2PutLocal(thumbnailKey, thumb, "image/webp");
  await r2PutLocal(originalKey, original, "image/jpeg");

  await db.photo.create({
    data: {
      locationId: opts.locationId,
      reportId: opts.reportId ?? null,
      reportItemId: opts.reportItemId ?? null,
      r2Key: key,
      thumbnailKey,
      originalKey,
      originalBytes: original.length,
      sha256,
      bytes: main.length,
      widthPx: resized.info.width,
      heightPx: resized.info.height,
      exifTakenAt: opts.takenAt,
      stampPhotoId: photoId,
      exifGpsLat: opts.lat,
      exifGpsLng: opts.lng,
      gpsSource: opts.lat == null ? "none" : "device",
      metadataSource: "device",
      uploadedById: opts.userId,
    },
  });
}

export async function runManualSeed(db: PrismaClient): Promise<void> {
  console.log("Seed khusus buku manual (Purworejo)…");

  const [admin, sm, mandor] = await Promise.all([
    db.user.findUnique({ where: { username: "admin" } }),
    db.user.findUnique({ where: { username: "sm-01" } }),
    db.user.findUnique({ where: { username: "mandor-01" } }),
  ]);
  if (!admin || !sm || !mandor) {
    throw new Error("User dasar belum ada – jalankan `pnpm db:seed` dulu, baru `pnpm manual:seed`.");
  }

  const loc = await db.location.findUnique({
    where: { slug: "purworejo" },
    include: { package: { include: { contract: true } } },
  });
  if (!loc || !loc.package.contract) {
    throw new Error("Lokasi purworejo (+ kontrak) belum ada – jalankan `pnpm db:seed` dulu, baru `pnpm manual:seed`.");
  }
  const contract = loc.package.contract;
  const vendor = await db.vendor.findUnique({ where: { id: contract.vendorId } });

  // sm-01 dipakai memotret bab lapangan (daftar-gambar.ts) — seed dev menugaskan
  // Purworejo ke sm-02, bukan sm-01. Tambahkan, jangan lepas yang lama.
  await db.locationAssignment.upsert({
    where: { userId_locationId: { userId: sm.id, locationId: loc.id } },
    update: { unassignedAt: null },
    create: { userId: sm.id, locationId: loc.id },
  });

  // Sekali jadi, selamanya jadi: `daily_report_status_history` APPEND-ONLY
  // (trigger DB menolak UPDATE/DELETE — lihat DECISIONS 432) jadi laporan yang
  // sudah dibuat tidak bisa ditimpa ulang. Skrip ini idempotent lewat SKIP, bukan
  // lewat hapus-lalu-buat-ulang: kalau Purworejo sudah pernah di-seed, lewati
  // seluruh bagian di bawah (kontrak/baseline/laporan/rencana/kendala/foto) apa
  // adanya. Untuk regenerasi total (mis. tanggalnya sudah sangat basi), reset
  // database dev/e2e dulu (`pnpm db:reset` lalu `pnpm db:seed`).
  const sudahAda = await db.dailyReport.count({ where: { locationId: loc.id } });
  if (sudahAda > 0) {
    console.log(`  purworejo sudah punya ${sudahAda} laporan dari seed sebelumnya – dilewati (append-only).`);
    return;
  }

  // ── Kontrak digeser relatif ke SEKARANG — lihat catatan di atas kenapa.
  const WEEKS_PAST = 12;
  const WEEKS_FUTURE = 8;
  const startDate = daysFromNow(-WEEKS_PAST * 7);
  const endDate = daysFromNow(WEEKS_FUTURE * 7);
  const contractDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / DAY));
  await db.contract.update({
    where: { id: contract.id },
    data: { startDate, endDate, durationDays: contractDays, signedDate: daysFromNow(-WEEKS_PAST * 7 - 7) },
  });
  // Grid minggu ikut `Contract.weekMode` (default `senin_minggu`, DECISIONS 429)
  // — sama seperti demo.ts, supaya baseline manual tidak menyimpang dari grid
  // yang benar-benar dipakai layar. `contract.weekMode` sudah pasti ada (kontrak
  // diverifikasi non-null di atas).
  const weekMode: WeekPeriodMode = contract.weekMode as WeekPeriodMode;
  const endFracs = weekEndFractions(startDate, endDate, weekMode);
  const totalWeeks = endFracs.length;
  const weekRange = (w: number) => weekDateRange(startDate, w, weekMode, endDate);

  const revision = await db.rabRevision.findFirstOrThrow({ where: { locationId: loc.id, status: "aktif" } });
  const allNodes = await db.rabNode.findMany({
    where: { revisionId: revision.id },
    select: { id: true, kind: true, lineageKey: true, name: true, amount: true, volume: true, unitPrice: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });
  const catNodes = allNodes.filter((n) => n.kind === "kategori");
  const itemNodes = allNodes.filter((n) => n.kind === "item" && n.amount > 0n && Number(n.volume ?? 0) > 0);

  // ── Baseline (kurva-S) digenerate ULANG untuk jendela kontrak baru ────────
  const baseline = await db.baseline.findFirstOrThrow({ where: { locationId: loc.id, status: "aktif" } });
  const { weekly: planCurve, schedule, catForS } = buildBaselinePoints(catNodes, itemNodes, contractDays, endFracs);
  await db.baseline.update({ where: { id: baseline.id }, data: { contractDays } });
  await db.baselinePoint.deleteMany({ where: { baselineId: baseline.id } });
  await db.baselinePoint.createMany({
    data: planCurve.map((pctVal, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: pctVal })),
  });
  await db.baselineScheduleItem.deleteMany({ where: { baselineId: baseline.id } });
  if (schedule.length > 0) {
    await db.baselineScheduleItem.createMany({
      data: schedule.map((s) => ({
        baselineId: baseline.id,
        lineageKey: s.lineageKey,
        name: s.name,
        weightPct: Math.round(s.weightPct * 1000) / 1000,
        weekly: s.weekly.map((v) => Math.round(v * 1e6) / 1e6),
      })),
    });
  }

  const now = new Date();
  const currentWeek = currentWeekNumber(startDate, totalWeeks, weekMode, now);
  const planPctNow = planPctAtWeek(planCurve, currentWeek);
  console.log(`  minggu ke-${currentWeek}/${totalWeeks} – rencana kumulatif ${planPctNow.toFixed(1)}%`);

  // ── Target penyelesaian PER ITEM (SEMUA item, bukan sebagian — realisasi
  // keseluruhan lokasi adalah rata-rata TERTIMBANG nilai semua item, jadi
  // "wajar" di angka portofolio hanya tercapai kalau progres tersebar ke
  // hampir semua item, bukan segelintir item saja sampai 100%). Faktor per
  // item dijitter tipis (0,90–1,02) supaya deviasi antar item tidak seragam.
  const rnd = mulberry32(20260819);
  const itemFactor = new Map(itemNodes.map((n) => [n.id, 0.9 + rnd() * 0.12]));
  const targetVolume = new Map(
    itemNodes.map((n) => {
      const frac = Math.min(0.995, Math.max(0, itemFactor.get(n.id)! * (planPctNow / 100)));
      return [n.id, frac * Number(n.volume)];
    }),
  );
  // 8 item "sorotan" (tersebar lintas kategori) — HANYA untuk penamaan di
  // rencana mingguan/foto contoh; realisasi portofolio dihitung dari SEMUA item.
  const stepHi = Math.max(1, Math.floor(itemNodes.length / 8));
  const tracked = itemNodes.filter((_, i) => i % stepHi === 0).slice(0, 8);

  // ── 15 tanggal riwayat, tua → baru. Tiap ITEM dikerjakan TUNTAS pada SATU
  // tanggal saja (bukan disebar tipis ke semua tanggal): laporan sungguhan
  // tidak menyentuh 1.700 item sekaligus tiap hari — satu laporan wajar berisi
  // puluhan-ratusan item (bagian RAB yang sedang dikerjakan minggu itu).
  // Urutan RAB (sortOrder) dipetakan ke tanggal secara merata & deterministik,
  // supaya jumlah item per laporan seimbang dan hasilnya sama tiap kali digenerate.
  const HIST_OFFSETS = [55, 51, 47, 43, 39, 35, 31, 27, 23, 19, 16, 13, 10, 7, 4]; // hari lalu
  const N = HIST_OFFSETS.length;
  const bucketSize = Math.max(1, Math.ceil(itemNodes.length / N));

  type Delta = { offset: number; date: Date; perNode: Map<string, number> };
  const deltas: Delta[] = HIST_OFFSETS.map((off) => ({ offset: off, date: daysFromNow(-off), perNode: new Map<string, number>() }));
  itemNodes.forEach((n, idx) => {
    const bucket = Math.min(N - 1, Math.floor(idx / bucketSize));
    const vol = targetVolume.get(n.id)!;
    if (vol > 0.001) deltas[bucket]!.perNode.set(n.id, vol);
  });

  const kategoriNama = (n: RabNodeRow) => catForS(n.lineageKey).name || "Pekerjaan";

  // ── Pekerja/material/alat khas — divariasi tipis per laporan supaya tak seragam.
  const workerSets: { role: "mandor" | "tukang_batu" | "tukang_besi" | "tukang_kayu" | "tenaga" | "operator"; count: number }[][] = [
    [
      { role: "mandor", count: 1 },
      { role: "tukang_batu", count: 4 },
      { role: "tenaga", count: 6 },
    ],
    [
      { role: "mandor", count: 1 },
      { role: "tukang_besi", count: 3 },
      { role: "tenaga", count: 5 },
    ],
    [
      { role: "mandor", count: 1 },
      { role: "tukang_kayu", count: 2 },
      { role: "operator", count: 1 },
      { role: "tenaga", count: 4 },
    ],
  ];
  const materialSets = [
    { name: "Semen PCC 50kg", unit: "zak", qty: 45 },
    { name: "Batu belah 15/20", unit: "m3", qty: 12 },
    { name: "Pasir pasang", unit: "m3", qty: 8 },
    { name: "Besi beton D13", unit: "batang", qty: 30 },
  ];
  const equipmentSets = [
    { name: "Concrete mixer", count: 1 },
    { name: "Stamper", count: 1 },
    { name: "Pompa air", count: 2 },
  ];

  async function buatLaporan(opts: {
    date: Date;
    status: "draft" | "dikirim" | "disetujui" | "final" | "perlu_koreksi";
    items: { node: RabNodeRow; volume: number }[];
    reason?: string;
    varIdx: number;
  }): Promise<{ reportId: string; itemIds: Map<string, string> }> {
    const report = await db.dailyReport.create({
      data: {
        locationId: loc!.id,
        reportDate: opts.date,
        status: opts.status,
        weather: "cerah",
        weatherSource: "manual",
        workStart: "07:30",
        workEnd: "16:00",
        createdById: mandor!.id,
        submittedById: opts.status === "draft" ? null : mandor!.id,
        submittedAt: opts.status === "draft" ? null : new Date(opts.date.getTime() + 10 * 3600 * 1000),
        verifiedById: ["disetujui", "final"].includes(opts.status) ? sm!.id : null,
        verifiedAt: ["disetujui", "final"].includes(opts.status) ? new Date(opts.date.getTime() + 12 * 3600 * 1000) : null,
        finalizedById: opts.status === "final" ? sm!.id : null,
        finalizedAt: opts.status === "final" ? new Date(opts.date.getTime() + 13 * 3600 * 1000) : null,
      },
    });
    // createManyAndReturn (bukan create per baris) — laporan riwayat bisa
    // memuat ratusan item sekaligus (progres portofolio tersebar ke hampir
    // semua item RAB, bukan segelintir); satu baris per create akan lambat.
    const rows = opts.items
      .filter((x) => x.volume > 0)
      .map((x) => ({
        reportId: report.id,
        rabNodeId: x.node.id,
        lineageKey: x.node.lineageKey,
        volumeDone: Math.round(x.volume * 1000) / 1000,
        valueDone: calcValueDone(x.volume, Number(x.node.unitPrice ?? 0)),
        reportedById: mandor!.id,
      }));
    const itemIds = new Map<string, string>();
    if (rows.length > 0) {
      const created = await db.dailyReportItem.createManyAndReturn({
        data: rows,
        select: { id: true, rabNodeId: true },
      });
      for (const c of created) itemIds.set(c.rabNodeId, c.id);
    }
    const ws = workerSets[opts.varIdx % workerSets.length]!;
    await db.dailyReportWorker.createMany({ data: ws.map((w) => ({ reportId: report.id, role: w.role as never, count: w.count })) });
    const mat = materialSets[opts.varIdx % materialSets.length]!;
    await db.dailyReportMaterial.create({ data: { reportId: report.id, name: mat.name, unit: mat.unit, qtyReceived: mat.qty } });
    const eq = equipmentSets[opts.varIdx % equipmentSets.length]!;
    await db.dailyReportEquipment.create({ data: { reportId: report.id, name: eq.name, count: eq.count } });

    const flowByStatus: Record<string, [string | null, string][]> = {
      draft: [],
      dikirim: [[null, "dikirim"]],
      perlu_koreksi: [
        [null, "dikirim"],
        ["dikirim", "perlu_koreksi"],
      ],
      disetujui: [
        [null, "dikirim"],
        ["dikirim", "disetujui"],
      ],
      final: [
        [null, "dikirim"],
        ["dikirim", "disetujui"],
        ["disetujui", "final"],
      ],
    };
    for (const [from, to] of flowByStatus[opts.status]!) {
      await db.dailyReportStatusHistory.create({
        data: {
          reportId: report.id,
          fromStatus: (from ?? undefined) as never,
          toStatus: to as never,
          changedById: to === "dikirim" ? mandor!.id : sm!.id,
          reason: to === "perlu_koreksi" ? (opts.reason ?? null) : null,
        },
      });
    }
    return { reportId: report.id, itemIds };
  }

  // ── Riwayat "beberapa minggu" ──────────────────────────────────────────────
  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i]!;
    if (d.perNode.size === 0) continue;
    const status = d.offset >= 20 ? "final" : d.offset >= 8 ? "disetujui" : "dikirim";
    const items = itemNodes.filter((n) => d.perNode.has(n.id)).map((n) => ({ node: n, volume: d.perNode.get(n.id)! }));
    const { reportId, itemIds } = await buatLaporan({ date: d.date, status, items, varIdx: i });

    // Foto pada dua laporan riwayat (satu "final" lama, satu "disetujui" baru)
    // — ditempel pada salah satu item SOROTAN supaya keterangannya dikenali.
    if (r2 !== null && (d.offset === 43 || d.offset === 13)) {
      const first = tracked.find((n) => itemIds.has(n.id)) ?? items[0]?.node;
      if (first) {
        const itemId = itemIds.get(first.id) ?? null;
        for (let k = 0; k < 2; k++) {
          await buatFoto(db, {
            locationId: loc.id,
            locationSlug: loc.slug,
            locationLabel: loc.name,
            reportId,
            reportItemId: itemId,
            takenAt: new Date(d.date.getTime() + (9 + k) * 3600 * 1000),
            userId: mandor.id,
            reporterName: mandor.fullName,
            companyName: vendor?.name ?? "Kontraktor Pelaksana",
            categoryName: kategoriNama(first),
            workName: first.name,
            lat: loc.gpsLat ? Number(loc.gpsLat) : null,
            lng: loc.gpsLng ? Number(loc.gpsLng) : null,
          });
        }
      }
    }
  }

  // ── Tiga layar demo bab lapangan: hari ini (draft), menunggu verifikasi, koreksi ──
  const remainingRoom = (node: RabNodeRow, already: number) => Math.max(0, Number(node.volume) - already);
  const usedTotal = new Map<string, number>();
  for (const d of deltas) for (const [id, v] of d.perNode) usedTotal.set(id, (usedTotal.get(id) ?? 0) + v);

  const demoItems = (count: number, offset: number) =>
    tracked
      .slice(0, count)
      .map((node) => {
        const room = remainingRoom(node, usedTotal.get(node.id) ?? 0);
        const vol = Math.min(room, Math.max(0.3, Number(node.volume) * 0.01));
        return { node, volume: Math.round(vol * 1000) / 1000 };
      })
      .filter((x) => x.volume > 0);

  // Perlu koreksi — 3 hari lalu, alasan realistis (dipakai bab lapangan: alur koreksi).
  const koreksiItems = demoItems(2, 3);
  const koreksi = await buatLaporan({
    date: daysFromNow(-3),
    status: "perlu_koreksi",
    items: koreksiItems,
    reason: "Foto pasangan batu talud belum menunjukkan sambungan antar segmen – mohon difoto ulang dari sisi laut, dan volume dicek kembali.",
    varIdx: 3,
  });
  if ((r2 !== null) && koreksiItems[0]) {
    const itemId = koreksi.itemIds.get(koreksiItems[0].node.id) ?? null;
    await buatFoto(db, {
      locationId: loc.id,
      locationSlug: loc.slug,
      locationLabel: loc.name,
      reportId: koreksi.reportId,
      reportItemId: itemId,
      takenAt: new Date(daysFromNow(-3).getTime() + 9 * 3600 * 1000),
      userId: mandor.id,
      reporterName: mandor.fullName,
      companyName: vendor?.name ?? "Kontraktor Pelaksana",
      categoryName: kategoriNama(koreksiItems[0].node),
      workName: koreksiItems[0].node.name,
      lat: loc.gpsLat ? Number(loc.gpsLat) : null,
      lng: loc.gpsLng ? Number(loc.gpsLng) : null,
    });
  }

  // Dikirim, menunggu verifikasi SM — kemarin.
  await buatLaporan({ date: daysFromNow(-1), status: "dikirim", items: demoItems(2, 1), varIdx: 1 });

  // Draft hari ini — belum dikirim, contoh "mengisi laporan langkah demi langkah".
  const draft = await buatLaporan({ date: daysFromNow(0), status: "draft", items: demoItems(2, 0), varIdx: 0 });
  if (r2 !== null) {
    const [node1] = tracked;
    const itemId = node1 ? draft.itemIds.get(node1.id) : null;
    if (itemId) {
      await buatFoto(db, {
        locationId: loc.id,
        locationSlug: loc.slug,
        locationLabel: loc.name,
        reportId: draft.reportId,
        reportItemId: itemId,
        takenAt: new Date(),
        userId: mandor.id,
        reporterName: mandor.fullName,
        companyName: vendor?.name ?? "Kontraktor Pelaksana",
        categoryName: kategoriNama(node1!),
        workName: node1!.name,
        lat: loc.gpsLat ? Number(loc.gpsLat) : null,
        lng: loc.gpsLng ? Number(loc.gpsLng) : null,
      });
    }
    // Dua foto lepas (Foto Cepat) — belum ditempel item mana pun.
    for (let k = 0; k < 2; k++) {
      await buatFoto(db, {
        locationId: loc.id,
        locationSlug: loc.slug,
        locationLabel: loc.name,
        reportId: null,
        reportItemId: null,
        takenAt: new Date(Date.now() - (2 + k) * 3600 * 1000),
        userId: mandor.id,
        reporterName: mandor.fullName,
        companyName: vendor?.name ?? "Kontraktor Pelaksana",
        categoryName: "Dokumentasi lapangan",
        workName: "Foto cepat",
        lat: loc.gpsLat ? Number(loc.gpsLat) : null,
        lng: loc.gpsLng ? Number(loc.gpsLng) : null,
      });
    }
  }

  // ── Rencana mingguan: minggu lalu (evaluasi PPC) + minggu ini (target) ────
  // Rentang tanggal tiap minggu ikut grid `weekMode` (M1/minggu akhir bisa
  // pendek pada mode kalender senin_minggu) — BUKAN offset 7-hari seragam.
  const actualInWeek = (w: number, nodeId: string) => {
    const { start: s0, end: e0 } = weekRange(w);
    const s = s0.getTime();
    const e = e0.getTime();
    let sum = 0;
    for (const d of deltas) if (d.date.getTime() >= s && d.date.getTime() <= e) sum += d.perNode.get(nodeId) ?? 0;
    return sum;
  };
  if (currentWeek > 1) {
    const lastWeek = currentWeek - 1;
    const lastWeekRange = weekRange(lastWeek);
    const plan = await db.weeklyPlan.create({
      data: { locationId: loc.id, weekNumber: lastWeek, weekStart: lastWeekRange.start, weekEnd: lastWeekRange.end, createdById: sm.id },
    });
    // Item yang BENAR-BENAR ada laporannya minggu lalu (bukan "tracked" acak —
    // targetnya harus nyambung dengan realisasi supaya PPC tidak 0/kosong).
    const worked = itemNodes.filter((n) => actualInWeek(lastWeek, n.id) > 0).slice(0, 3);
    for (const [idx, node] of worked.entries()) {
      const actual = actualInWeek(lastWeek, node.id);
      // item terakhir sengaja target sedikit di atas realisasi → satu "belum tuntas" yang realistis
      const target = idx === worked.length - 1 ? actual * 1.3 + 0.2 : Math.max(0.1, actual * 0.9);
      await db.weeklyPlanItem.create({
        data: { weeklyPlanId: plan.id, rabNodeId: node.id, targetVolume: Math.round(target * 1000) / 1000, priority: idx + 1 },
      });
    }
  }
  const thisWeekRange = weekRange(currentWeek);
  const thisWeekPlan = await db.weeklyPlan.create({
    data: { locationId: loc.id, weekNumber: currentWeek, weekStart: thisWeekRange.start, weekEnd: thisWeekRange.end, createdById: sm.id },
  });
  for (const [idx, node] of tracked.slice(0, 4).entries()) {
    const target = Math.max(0.2, Number(node.volume) * 0.02);
    await db.weeklyPlanItem.create({
      data: { weeklyPlanId: thisWeekPlan.id, rabNodeId: node.id, targetVolume: Math.round(target * 1000) / 1000, priority: idx + 1, picName: mandor.fullName },
    });
  }

  // ── Kendala: satu masih berjalan, satu sudah selesai ───────────────────────
  const isuAktif = await db.issue.create({
    data: {
      locationId: loc.id,
      title: "Pasokan batu belah terlambat dari pemasok",
      description: "Pengiriman batu belah untuk talud molor 3 hari dari jadwal – stok di lokasi tinggal cukup untuk 1 hari kerja.",
      severity: "sedang",
      status: "terbuka",
      raisedById: sm.id,
      createdAt: daysFromNow(-4),
    },
  });
  await db.recoveryAction.create({
    data: {
      issueId: isuAktif.id,
      description: "Cari pemasok cadangan di Kudus, percepat pengiriman lewat jalur darat",
      picUserId: sm.id,
      dueDate: daysFromNow(3),
      status: "berjalan",
      createdById: sm.id,
    },
  });
  const isuSelesai = await db.issue.create({
    data: {
      locationId: loc.id,
      title: "Akses jalan kerja becek saat hujan",
      description: "Jalur masuk material becek dan licin sesudah hujan – mobilisasi dump truck sempat tertunda setengah hari.",
      severity: "sedang",
      status: "selesai",
      raisedById: sm.id,
      createdAt: daysFromNow(-35),
    },
  });
  const aksiSelesai = await db.recoveryAction.create({
    data: {
      issueId: isuSelesai.id,
      description: "Cor rabat beton sementara sepanjang 40 meter di jalur akses",
      status: "selesai",
      createdById: sm.id,
      createdAt: daysFromNow(-33),
    },
  });
  await db.recoveryUpdate.create({
    data: { actionId: aksiSelesai.id, note: "Rabat selesai dicor – akses lancar kembali, tidak ada penundaan lagi.", createdById: sm.id, createdAt: daysFromNow(-30) },
  });

  if (r2 === null) {
    console.log("  (R2 tidak dikonfigurasi – foto contoh DILEWATI. Lihat scripts/manual/mock-r2.ts.)");
  }
  console.log(`  purworejo: ${deltas.filter((d) => d.perNode.size > 0).length + 3} laporan, 2 rencana mingguan, 2 kendala.`);
  console.log("Seed manual selesai.");
}
