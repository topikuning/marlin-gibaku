"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess, requireUser, ForbiddenError } from "@/lib/auth/session";
import { totalWeeksFor, activateRevision, contractDaysFor, discardDraft, regenerateBaseline } from "@/lib/rab/import";
import {
  cabutPersetujuan,
  pastikanBolehAktivasi,
  PersetujuanError,
  setujuiRevisi,
} from "@/lib/rab/persetujuan";
import {
  restoreBaseline,
  saveCategorySchedule,
  hitungJadwalBaru,
  saveCategoryWeekly,
  updateBaselinePoints,
  validateBaselinePoints,
  type ModeJadwal,
} from "@/lib/baseline";
import { parseJadwalWorkbook } from "@/lib/scurve/jadwal-import";
import { ringkasApaAdanya } from "@/lib/scurve/jadwal-verbatim";
import { suggestWeeklyPlan, type WeeklySuggestionResult } from "@/lib/plan/suggest";

export type RabActionState = { error?: string; success?: string } | undefined;

export type SuggestState =
  | { error?: string; result?: WeeklySuggestionResult }
  | undefined;

function fail(err: unknown): RabActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

function revalidateRab(slug: string): void {
  // Header lokasi (plan/aktual) ikut berubah → revalidate seluruh subtree.
  revalidatePath(`/lokasi/${slug}`, "layout");
  revalidatePath("/lokasi");
}

/**
 * Ganti judul KATEGORI RAB — mis. memperbaiki kategori yang di file tak punya
 * baris judul (placeholder "PEKERJAAN (kategori … judul tidak ada di file)").
 *
 * Nilai & `lineageKey` tidak disentuh, jadi ANGKA baseline tidak berubah. Yang
 * ikut disegarkan hanyalah CUPLIKAN nama pada `BaselineScheduleItem` — kolom itu
 * hanya salinan untuk keperluan tampilan riwayat; membiarkannya usang membuat
 * daftar baseline lama menyebut judul yang sudah tidak ada di RAB mana pun.
 * (Penjodohan kategori sendiri memakai `lineageKey`, bukan nama — CALC-04 —
 * jadi laporan tetap benar walau cuplikan ini tertinggal.)
 */
export async function renameRabCategoryAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsedId = z.uuid().safeParse(formData.get("nodeId"));
  if (!parsedId.success) return { error: "Node RAB tidak valid." };
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Judul minimal 2 karakter." };
  try {
    const user = await requireCapability("rab.manage");
    const node = await db.rabNode.findUniqueOrThrow({
      where: { id: parsedId.data },
      select: {
        id: true,
        kind: true,
        lineageKey: true,
        revision: { select: { locationId: true, location: { select: { slug: true } } } },
      },
    });
    if (node.kind !== "kategori") return { error: "Hanya judul kategori yang bisa diganti di sini." };
    await requireLocationAccess(user, node.revision.locationId);
    const judul = name.slice(0, 200);
    await db.$transaction([
      db.rabNode.update({ where: { id: node.id }, data: { name: judul } }),
      // Cuplikan nama pada jadwal baseline lokasi ini — disegarkan agar riwayat
      // baseline tidak menyebut judul yang sudah tidak ada.
      db.baselineScheduleItem.updateMany({
        where: { lineageKey: node.lineageKey, baseline: { locationId: node.revision.locationId } },
        data: { name: judul },
      }),
    ]);
    await audit(user.id, "rab.rename_category", "rab_node", node.id, { name: judul });
    revalidateRab(node.revision.location.slug);
    return { success: "Judul kategori diperbarui." };
  } catch (err) {
    return fail(err);
  }
}

/** Aktifkan revisi draft → revisi aktif lama digantikan + baseline di-regenerate. */
export async function activateDraftAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = z.uuid().safeParse(formData.get("revisionId"));
  if (!parsed.success) return { error: "Revisi tidak valid." };
  try {
    const user = await requireCapability("rab.manage");
    const rev = await db.rabRevision.findUniqueOrThrow({
      where: { id: parsed.data },
      select: { id: true, locationId: true, revisionNo: true, source: true, location: { select: { slug: true } } },
    });
    await requireLocationAccess(user, rev.locationId);
    // GERBANG EMPAT MATA (DECISIONS 234) — sebelum apa pun berubah. Adendum
    // mengganti RAB kontrak yang berlaku; tidak ada peran, termasuk Super
    // Admin, yang boleh melakukannya sendirian.
    await pastikanBolehAktivasi(rev.id);
    await activateRevision(rev.id, user.id);
    // Revisi sudah aktif — kegagalan regenerate baseline TIDAK boleh tampil
    // sebagai error generik seolah aktivasi batal (audit 2026-07-27, B17).
    try {
      await regenerateBaseline(rev.locationId, {
        source: rev.source === "adendum" ? "adendum" : "auto",
        rabRevisionId: rev.id,
        note: `Regenerate otomatis (aktivasi revisi #${rev.revisionNo})`,
        userId: user.id,
      });
    } catch (e) {
      console.error("[rab] regenerate baseline gagal (revisi sudah aktif):", e);
      revalidateRab(rev.location.slug);
      return {
        error:
          `Revisi #${rev.revisionNo} SUDAH AKTIF, tetapi kurva-S GAGAL di-regenerate ` +
          `(${e instanceof Error ? e.message : "kesalahan tak dikenal"}). ` +
          `Buka tab Kurva-S lalu tekan "Hitung ulang kurva-S" untuk menyelaraskan.`,
      };
    }
    revalidateRab(rev.location.slug);
    return { success: `Revisi #${rev.revisionNo} aktif. Baseline kurva-S di-regenerate.` };
  } catch (err) {
    return fail(err);
  }
}

/** Buang revisi draft (beserta seluruh node-nya). */
export async function discardDraftAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = z.uuid().safeParse(formData.get("revisionId"));
  if (!parsed.success) return { error: "Revisi tidak valid." };
  try {
    const user = await requireCapability("rab.manage");
    const rev = await db.rabRevision.findUniqueOrThrow({
      where: { id: parsed.data },
      select: { id: true, locationId: true, location: { select: { slug: true } } },
    });
    await requireLocationAccess(user, rev.locationId);
    const discarded = await discardDraft(rev.id, user.id);
    revalidateRab(rev.location.slug);
    return { success: `Draft revisi #${discarded.revisionNo} dibuang.` };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Hitung ulang kurva-S (baseline) dari revisi RAB aktif — versi baru (append-only,
 * baseline lama jadi "digantikan"). Dipakai bila jadwal perlu disegarkan tanpa
 * mengganti RAB. Realisasi tetap tersambung by lineage.
 */
export async function recalcBaselineAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = z.uuid().safeParse(formData.get("locationId"));
  if (!parsed.success) return { error: "Lokasi tidak valid." };
  try {
    const user = await requireCapability("baseline.manage");
    await requireLocationAccess(user, parsed.data);
    const loc = await db.location.findUniqueOrThrow({
      where: { id: parsed.data },
      select: { slug: true },
    });
    const active = await db.rabRevision.findFirst({
      where: { locationId: parsed.data, status: "aktif" },
      select: { id: true },
    });
    if (!active) return { error: "Belum ada revisi RAB aktif – import RAB dulu." };
    const baseline = await regenerateBaseline(parsed.data, {
      source: "auto",
      rabRevisionId: active.id,
      note: "Hitung ulang kurva-S manual",
      userId: user.id,
    });
    revalidateRab(loc.slug);
    revalidatePath(`/lokasi/${loc.slug}/progress`);
    if (baseline.unchanged) {
      return {
        success: `Tidak ada perubahan – hasil hitung identik dengan baseline #${baseline.baselineNo} yang aktif, versi baru tidak dibuat.`,
      };
    }
    return {
      success: `Kurva-S dihitung ulang – baseline #${baseline.baselineNo} aktif. Versi sebelumnya tersimpan di kartu "Riwayat baseline" di bawah.`,
    };
  } catch (err) {
    return fail(err);
  }
}

const saveManualBaselineSchema = z.object({
  baselineId: z.uuid(),
  locationId: z.uuid(),
  points: z
    .array(z.number())
    .min(1, "Deret rencana kosong.")
    .max(520, "Terlalu banyak minggu."),
});

/**
 * Simpan kurva-S hasil edit manual → baseline BARU source "manual" (append-only,
 * baseline lama digantikan). Server memvalidasi ulang deret (monoton, 0..100,
 * akhir 100) — tidak percaya klien.
 */
export async function saveManualBaselineAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  let pointsRaw: unknown;
  try {
    pointsRaw = JSON.parse(String(formData.get("points") ?? "[]"));
  } catch {
    return { error: "Data kurva tidak valid." };
  }
  const parsed = saveManualBaselineSchema.safeParse({
    baselineId: formData.get("baselineId"),
    locationId: formData.get("locationId"),
    points: pointsRaw,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { baselineId, locationId, points } = parsed.data;

  // Validasi bentuk kurva sebelum menyentuh DB (pesan lebih informatif).
  const invalid = validateBaselinePoints(points);
  if (invalid) return { error: invalid };

  try {
    const user = await requireCapability("baseline.manage");
    await requireLocationAccess(user, locationId);
    // Baseline acuan harus milik lokasi ini (cegah lintas-lokasi).
    const ref = await db.baseline.findUniqueOrThrow({
      where: { id: baselineId },
      select: { locationId: true, location: { select: { slug: true } } },
    });
    if (ref.locationId !== locationId) return { error: "Baseline bukan milik lokasi ini." };

    const baseline = await updateBaselinePoints(baselineId, points, user.id);
    revalidateRab(ref.location.slug);
    revalidatePath(`/lokasi/${ref.location.slug}/progress`);
    return { success: `Kurva-S manual disimpan – baseline #${baseline.baselineNo} aktif.` };
  } catch (err) {
    return fail(err);
  }
}

const segmentSchema = z.object({
  startWeek: z.number().int().min(1).max(520),
  endWeek: z.number().int().min(1).max(520),
});

const scheduleRowSchema = z.object({
  lineageKey: z.string().min(1).max(200),
  // Boleh >1 segmen = minggu terputus (jeda). DECISIONS 103.
  segments: z.array(segmentSchema).min(1, "Minimal satu rentang minggu.").max(52, "Terlalu banyak rentang."),
});

const saveScheduleSchema = z.object({
  locationId: z.uuid(),
  rows: z.array(scheduleRowSchema).min(1, "Jadwal kosong.").max(200, "Terlalu banyak kategori."),
});

/**
 * Simpan jadwal per pekerjaan (kategori) → baseline baru. Klien hanya mengirim
 * SEGMEN minggu (boleh berjeda); bobot dihitung ulang server dari RAB aktif.
 */
export async function saveCategoryScheduleAction(
  _prev: RabActionState,
  formData: FormData,
): Promise<RabActionState> {
  let rowsRaw: unknown;
  try {
    rowsRaw = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "Data jadwal tidak valid." };
  }
  const parsed = saveScheduleSchema.safeParse({
    locationId: formData.get("locationId"),
    rows: rowsRaw,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { locationId, rows } = parsed.data;

  try {
    const user = await requireCapability("baseline.manage");
    await requireLocationAccess(user, locationId);
    const loc = await db.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { slug: true },
    });
    const result = await saveCategorySchedule(locationId, rows, user.id);
    revalidateRab(loc.slug);
    revalidatePath(`/lokasi/${loc.slug}/progress`);
    if (result.unchanged) {
      return { success: `Tidak ada perubahan – jadwal identik dengan baseline #${result.baselineNo} yang aktif.` };
    }
    return {
      success: `Jadwal tersimpan – baseline #${result.baselineNo} aktif. Versi sebelumnya ada di Riwayat baseline.`,
    };
  } catch (err) {
    return fail(err);
  }
}

const IMPORT_XLSX_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

const norm = (s: string): string => s.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();

/**
 * Impor Time Schedule Excel yang diedit sipil → jadwal (matriks mingguan per
 * kategori) → baseline BARU. Cocokkan kategori via kode, fallback nama.
 *
 * DEFAULT: angka Excel dipakai APA ADANYA — jadwal yang diunggah orang adalah
 * pernyataan rencananya, dan sistem mengikutinya (DECISIONS 203). Renormalisasi
 * bobot ke RAB hanya terjadi bila DIMINTA lewat centang `sesuaikanRab`.
 */
/**
 * Semua pemeriksaan berkas + pencocokan kategori, SEKALI (DECISIONS 364).
 *
 * Dipakai bersama oleh pratinjau dan penerapan. Kalau keduanya memeriksa
 * sendiri-sendiri, suatu saat pratinjau meloloskan berkas yang ditolak
 * penerapan — dan orang membaca "valid" tepat sebelum menekan tombol yang
 * gagal.
 */
type SiapImpor = {
  user: Awaited<ReturnType<typeof requireCapability>>;
  location: { id: string; slug: string };
  input: { lineageKey: string; weekly: number[] }[];
  catNodes: { code: string | null; name: string; lineageKey: string }[];
  mode: ModeJadwal;
  namaBerkas: string;
};

async function siapkanImporJadwal(formData: FormData): Promise<{ error: string } | SiapImpor> {
  const locId = z.uuid().safeParse(formData.get("locationId"));
  if (!locId.success) return { error: "Lokasi tidak valid." };

  const user = await requireCapability("baseline.manage");
  await requireLocationAccess(user, locId.data);
  const location = await db.location.findUniqueOrThrow({
    where: { id: locId.data },
    select: { id: true, slug: true },
  });

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "File jadwal (.xlsx) wajib dipilih." };
  if (file.size > 15 * 1024 * 1024) return { error: "File terlalu besar (maks 15 MB)." };
  if (!IMPORT_XLSX_MIME.includes(file.type) && !/\.xlsx?$/i.test(file.name)) {
    return { error: "File harus Excel (.xlsx)." };
  }

  let parsed;
  try {
    parsed = await parseJadwalWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gagal membaca file jadwal." };
  }

  // Jumlah kolom minggu mengikuti MODE periode minggu kontrak (DECISIONS 427)
  // — pada mode senin_minggu M1 pendek menambah satu kolom, dan Excel yang
  // benar justru berkolom segitu; ceil(hari/7) akan MENOLAK berkas yang benar.
  const { totalWeeks } = await totalWeeksFor(location.id);
  if (parsed.totalWeeks !== totalWeeks) {
    return {
      error: `Jumlah minggu di Excel (${parsed.totalWeeks}) ≠ durasi kontrak lokasi ini (${totalWeeks} minggu). Pastikan file berasal dari lokasi & durasi yang sama.`,
    };
  }

  // Kategori RAB aktif utk pencocokan (kode → nama).
  const revision = await db.rabRevision.findFirst({ where: { locationId: location.id, status: "aktif" }, select: { id: true } });
  if (!revision) return { error: "Belum ada revisi RAB aktif – impor RAB dulu." };
  const catNodes = await db.rabNode.findMany({
    where: { revisionId: revision.id, kind: "kategori", amount: { gt: 0n } },
    select: { code: true, name: true, lineageKey: true },
  });

  const byCode = new Map<string, string>(); // norm(code) → lineageKey
  const byName = new Map<string, string>(); // norm(name) → lineageKey
  for (const c of catNodes) {
    if (c.code) byCode.set(norm(c.code), c.lineageKey);
    byName.set(norm(c.name), c.lineageKey);
  }
  const input: { lineageKey: string; weekly: number[] }[] = [];
  const usedKeys = new Set<string>();
  for (const pc of parsed.categories) {
    const key = (pc.code ? byCode.get(norm(pc.code)) : undefined) ?? byName.get(norm(pc.name));
    if (!key || usedKeys.has(key)) continue;
    usedKeys.add(key);
    input.push({ lineageKey: key, weekly: pc.weekly });
  }
  if (input.length === 0) {
    return { error: "Tak satu pun pekerjaan di Excel cocok dengan kategori RAB (kode/nama) lokasi ini." };
  }

  // Tanpa centang = apa adanya. Tidak ada mode "otomatis" yang menebak: yang
  // tidak diminta tidak dilakukan.
  const mode: ModeJadwal = formData.get("sesuaikanRab") === "1" ? "rab" : "apaadanya";

  return { user, location, input, catNodes, mode, namaBerkas: file.name };
}

export async function importJadwalAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  try {
    const siap = await siapkanImporJadwal(formData);
    if ("error" in siap) return siap;
    const { user, location, input, catNodes, mode } = siap;

    const note =
      mode === "apaadanya"
        ? "Impor jadwal dari Excel (angka Excel apa adanya)"
        : "Impor jadwal dari Excel (bobot disesuaikan ke RAB)";

    const result = await saveCategoryWeekly(location.id, input, user.id, note, mode);
    revalidateRab(location.slug);
    revalidatePath(`/lokasi/${location.slug}/progress`);
    const rincian = result.verbatim
      ? ` ${ringkasApaAdanya(result.verbatim)}`
      : ` ${result.matched} dari ${catNodes.length} pekerjaan cocok; bobot mengikuti RAB.`;
    if (result.unchanged) {
      return { success: `Tidak ada perubahan – jadwal identik dengan baseline #${result.baselineNo} yang aktif.${rincian}` };
    }
    return {
      success: `Jadwal terimpor – baseline #${result.baselineNo} aktif.${rincian} Versi sebelumnya ada di Riwayat baseline.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/** Satu baris pemeriksaan di layar pratinjau. */
export type PeriksaJadwal = { lolos: boolean; judul: string; rincian: string };

export type PratinjauJadwal = {
  namaBerkas: string;
  baselineAktif: number | null;
  totalMinggu: number;
  cocok: number;
  totalKategori: number;
  /** Sama sekali tidak berubah dari baseline aktif — tidak perlu diterapkan. */
  samaSaja: boolean;
  periksa: PeriksaJadwal[];
  /** Per minggu: %-kumulatif baseline aktif vs berkas. Hanya yang BERUBAH. */
  perubahan: { minggu: number; lama: number | null; baru: number }[];
  jumlahMingguBerubah: number;
};

export type PratinjauState = { error?: string; data?: PratinjauJadwal } | undefined;

/**
 * PRATINJAU impor jadwal — menghitung, tidak menulis (DECISIONS 364).
 *
 * Langkah yang selama ini hilang. Tanpa ini, satu-satunya cara tahu apa yang
 * akan berubah adalah MENERAPKANNYA, lalu memulihkan versi lama kalau ternyata
 * salah — memperbaiki dengan cara merusak dulu.
 *
 * Angkanya datang dari `hitungJadwalBaru`, jalur yang sama persis dengan yang
 * dipakai saat menerapkan. Pratinjau yang menghitung sendiri adalah pratinjau
 * yang suatu saat berbohong.
 */
export async function pratinjauJadwalAction(
  _prev: PratinjauState,
  formData: FormData,
): Promise<PratinjauState> {
  try {
    const siap = await siapkanImporJadwal(formData);
    if ("error" in siap) return { error: siap.error };
    const { location, input, mode, namaBerkas } = siap;

    const h = await hitungJadwalBaru(location.id, input, mode);
    const lama = h.aktif?.points ?? null;

    const perubahan: { minggu: number; lama: number | null; baru: number }[] = [];
    h.weekly.forEach((baru, i) => {
      const sebelum = lama?.[i] ?? null;
      // Ambang 0,005 pp = sama dengan ambang yang dipakai saat memutuskan
      // "tidak ada perubahan" pada penerapan. Dua ambang berbeda akan membuat
      // pratinjau menyebut perubahan yang lalu tidak jadi disimpan.
      if (sebelum == null || Math.abs(sebelum - baru) >= 0.005) {
        perubahan.push({ minggu: i + 1, lama: sebelum, baru });
      }
    });

    const totalExcel = h.verbatim ? h.verbatim.totalExcel : null;
    const periksa: PeriksaJadwal[] = [
      {
        lolos: true,
        judul: `${h.totalWeeks} minggu terbaca`,
        rincian: "Jumlah minggu di berkas sama dengan durasi kontrak lokasi ini.",
      },
      {
        lolos: h.matched === h.jumlahKategori,
        judul: `${h.matched} dari ${h.jumlahKategori} pekerjaan cocok`,
        rincian:
          h.matched === h.jumlahKategori
            ? "Semua pekerjaan RAB punya jadwal di berkas."
            : mode === "apaadanya"
              ? "Pekerjaan yang tidak ada di berkas TIDAK dijadwalkan – kurvanya mengikuti berkas Anda."
              : "Pekerjaan yang tidak ada di berkas diisi jadwal otomatis agar kurva tuntas 100%.",
      },
      {
        lolos: true,
        judul: "Kurva tuntas di 100%",
        rincian:
          totalExcel != null && Math.abs(totalExcel - 100) >= 0.01
            ? `Total berkas ${totalExcel.toFixed(2)}% – diskalakan seragam ke 100% supaya kurva-S tuntas. Bentuk dan jeda dari berkas tetap dipakai.`
            : "Total bobot mingguan berjumlah 100%.",
      },
      {
        lolos: !h.unchanged,
        judul: h.unchanged ? "Tidak ada yang berubah" : `${perubahan.length} minggu berubah`,
        rincian: h.unchanged
          ? "Berkas ini menghasilkan kurva yang identik dengan baseline aktif – tidak perlu diterapkan."
          : "Bandingkan di tabel bawah sebelum menerapkan.",
      },
    ];

    return {
      data: {
        namaBerkas,
        baselineAktif: h.aktif?.baselineNo ?? null,
        totalMinggu: h.totalWeeks,
        cocok: h.matched,
        totalKategori: h.jumlahKategori,
        samaSaja: h.unchanged,
        periksa,
        perubahan: perubahan.slice(0, 60),
        jumlahMingguBerubah: perubahan.length,
      },
    };
  } catch (err) {
    return { error: fail(err)?.error ?? "Gagal membaca berkas jadwal." };
  }
}



/** Pulihkan baseline lama → versi baru aktif (append-only, riwayat utuh). */
export async function restoreBaselineAction(
  _prev: RabActionState,
  formData: FormData,
): Promise<RabActionState> {
  const parsed = z.uuid().safeParse(formData.get("baselineId"));
  if (!parsed.success) return { error: "Baseline tidak valid." };
  try {
    const user = await requireCapability("baseline.manage");
    const ref = await db.baseline.findUniqueOrThrow({
      where: { id: parsed.data },
      select: { locationId: true, location: { select: { slug: true } } },
    });
    await requireLocationAccess(user, ref.locationId);
    const result = await restoreBaseline(parsed.data, user.id);
    revalidateRab(ref.location.slug);
    revalidatePath(`/lokasi/${ref.location.slug}/progress`);
    if (result.unchanged) {
      return { success: `Baseline #${result.baselineNo} sudah aktif – tidak ada yang dipulihkan.` };
    }
    return { success: `Dipulihkan – baseline #${result.baselineNo} aktif (salinan dari versi lama, riwayat tetap utuh).` };
  } catch (err) {
    return fail(err);
  }
}

// ── Rencana mingguan ────────────────────────────────────────────────────────

const DAY_MS = 24 * 3600 * 1000;

const addPlanItemSchema = z.object({
  locationId: z.uuid(),
  weekNumber: z.coerce.number().int().min(1).max(520),
  rabNodeId: z.uuid("Pilih item pekerjaan dari daftar."),
  targetVolume: z.coerce.number().positive("Target volume harus > 0"),
  priority: z.coerce.number().int().min(1).max(9).default(5),
  picName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Tambah/perbarui item rencana mingguan (upsert by minggu + item RAB). */
export async function addWeeklyPlanItem(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = addPlanItemSchema.safeParse({
    locationId: formData.get("locationId"),
    weekNumber: formData.get("weekNumber"),
    rabNodeId: formData.get("rabNodeId"),
    targetVolume: formData.get("targetVolume"),
    priority: formData.get("priority") || 5,
    picName: String(formData.get("picName") ?? "").trim() || undefined,
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("weekly_plan.manage");
    await requireLocationAccess(user, d.locationId);

    const location = await db.location.findUniqueOrThrow({
      where: { id: d.locationId },
      select: {
        slug: true,
        package: { select: { contract: { select: { startDate: true } } } },
      },
    });
    const startDate = location.package.contract?.startDate;
    if (!startDate) {
      return { error: "Paket belum punya kontrak – periode minggu tidak bisa dihitung." };
    }

    // Item harus milik revisi RAB AKTIF lokasi ini dan berjenis leaf item.
    const node = await db.rabNode.findFirst({
      where: {
        id: d.rabNodeId,
        kind: "item",
        revision: { locationId: d.locationId, status: "aktif" },
      },
      select: { id: true, name: true, code: true },
    });
    if (!node) return { error: "Item RAB tidak ditemukan di revisi aktif lokasi ini." };

    const weekStart = new Date(startDate.getTime() + (d.weekNumber - 1) * 7 * DAY_MS);
    const weekEnd = new Date(weekStart.getTime() + 6 * DAY_MS);

    const plan = await db.weeklyPlan.upsert({
      where: { locationId_weekNumber: { locationId: d.locationId, weekNumber: d.weekNumber } },
      update: {},
      create: {
        locationId: d.locationId,
        weekNumber: d.weekNumber,
        weekStart,
        weekEnd,
        createdById: user.id,
      },
    });
    const item = await db.weeklyPlanItem.upsert({
      where: { weeklyPlanId_rabNodeId: { weeklyPlanId: plan.id, rabNodeId: node.id } },
      update: {
        targetVolume: d.targetVolume,
        priority: d.priority,
        picName: d.picName ?? null,
        note: d.note ?? null,
      },
      create: {
        weeklyPlanId: plan.id,
        rabNodeId: node.id,
        targetVolume: d.targetVolume,
        priority: d.priority,
        picName: d.picName ?? null,
        note: d.note ?? null,
      },
    });
    await audit(user.id, "weekly_plan.item_upsert", "weekly_plan_item", item.id, {
      locationId: d.locationId,
      weekNumber: d.weekNumber,
      rabNodeId: node.id,
      targetVolume: d.targetVolume,
    });
    revalidatePath(`/lokasi/${location.slug}/rab`);
    revalidatePath(`/lokasi/${location.slug}`);
    return { success: `${node.code} ${node.name} masuk rencana minggu ${d.weekNumber}.` };
  } catch (err) {
    return fail(err);
  }
}

const suggestSchema = z.object({
  locationId: z.uuid(),
  weekNumber: z.coerce.number().int().min(1).max(520),
});

/** Hitung saran rencana mingguan otomatis (tanpa menyimpan) — utk pratinjau. */
export async function getWeeklySuggestions(_prev: SuggestState, formData: FormData): Promise<SuggestState> {
  const parsed = suggestSchema.safeParse({
    locationId: formData.get("locationId"),
    weekNumber: formData.get("weekNumber"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await requireCapability("weekly_plan.manage");
    await requireLocationAccess(user, parsed.data.locationId);
    const result = await suggestWeeklyPlan(parsed.data.locationId, parsed.data.weekNumber);
    if (!result) return { error: "Belum ada revisi RAB aktif – impor RAB dulu." };
    if (result.suggestions.length === 0) {
      return { error: "Tidak ada pekerjaan yang perlu disarankan untuk minggu ini (semua sesuai/selesai)." };
    }
    return { result };
  } catch (err) {
    const e = fail(err);
    return { error: e?.error };
  }
}

/**
 * Terapkan saran otomatis → upsert WeeklyPlanItem utk minggu itu. Saran
 * DIHITUNG ULANG di server (tidak percaya payload klien). Item yang sudah ada
 * di rencana minggu itu di-update targetnya; sisanya dibuat.
 */
export async function applyWeeklySuggestions(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = suggestSchema.safeParse({
    locationId: formData.get("locationId"),
    weekNumber: formData.get("weekNumber"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { locationId, weekNumber } = parsed.data;
  try {
    const user = await requireCapability("weekly_plan.manage");
    await requireLocationAccess(user, locationId);

    const location = await db.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { slug: true, package: { select: { contract: { select: { startDate: true } } } } },
    });
    const startDate = location.package.contract?.startDate;
    if (!startDate) return { error: "Paket belum punya kontrak – periode minggu tidak bisa dihitung." };

    const result = await suggestWeeklyPlan(locationId, weekNumber);
    if (!result || result.suggestions.length === 0) {
      return { error: "Tidak ada saran untuk diterapkan." };
    }

    const weekStart = new Date(startDate.getTime() + (weekNumber - 1) * 7 * DAY_MS);
    const weekEnd = new Date(weekStart.getTime() + 6 * DAY_MS);
    const plan = await db.weeklyPlan.upsert({
      where: { locationId_weekNumber: { locationId, weekNumber } },
      update: {},
      create: { locationId, weekNumber, weekStart, weekEnd, createdById: user.id },
    });

    for (const s of result.suggestions) {
      await db.weeklyPlanItem.upsert({
        where: { weeklyPlanId_rabNodeId: { weeklyPlanId: plan.id, rabNodeId: s.rabNodeId } },
        update: { targetVolume: s.targetVolume, priority: s.priority, note: s.reason },
        create: {
          weeklyPlanId: plan.id,
          rabNodeId: s.rabNodeId,
          targetVolume: s.targetVolume,
          priority: s.priority,
          note: s.reason,
        },
      });
    }
    await audit(user.id, "weekly_plan.apply_suggestions", "weekly_plan", plan.id, {
      locationId,
      weekNumber,
      count: result.suggestions.length,
      behind: result.behind,
      deviationPct: result.deviationPct,
    });
    revalidatePath(`/lokasi/${location.slug}/rab`);
    revalidatePath(`/lokasi/${location.slug}`);
    return {
      success: `${result.suggestions.length} pekerjaan disarankan masuk rencana minggu ${weekNumber}${
        result.behind ? ` (mengejar deviasi ${result.deviationPct}%)` : ""
      }. Silakan sesuaikan bila perlu.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/** Hapus item rencana mingguan. */
export async function removeWeeklyPlanItem(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = z.uuid().safeParse(formData.get("itemId"));
  if (!parsed.success) return { error: "Item tidak valid." };
  try {
    const user = await requireCapability("weekly_plan.manage");
    const item = await db.weeklyPlanItem.findUniqueOrThrow({
      where: { id: parsed.data },
      select: {
        id: true,
        plan: { select: { weekNumber: true, locationId: true, location: { select: { slug: true } } } },
      },
    });
    await requireLocationAccess(user, item.plan.locationId);
    await db.weeklyPlanItem.delete({ where: { id: item.id } });
    await audit(user.id, "weekly_plan.item_remove", "weekly_plan_item", item.id, {
      locationId: item.plan.locationId,
      weekNumber: item.plan.weekNumber,
    });
    revalidatePath(`/lokasi/${item.plan.location.slug}/rab`);
    revalidatePath(`/lokasi/${item.plan.location.slug}`);
    return { success: "Item rencana dihapus." };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Setujui / cabut persetujuan aktivasi revisi (DECISIONS 234).
 *
 * Sengaja TIDAK memakai `requireCapability("rab.manage")`: yang menentukan hak
 * di sini JABATAN, bukan kemampuan mengelola RAB. Super admin punya rab.manage
 * penuh dan tetap tidak boleh menandatangani — kalau gerbangnya capability, ia
 * lolos.
 */
export async function approveRevisionAction(
  _prev: RabActionState,
  formData: FormData,
): Promise<RabActionState> {
  const parsed = z.uuid().safeParse(formData.get("revisionId"));
  if (!parsed.success) return { error: "Revisi tidak valid." };
  const cabut = formData.get("cabut") === "1";
  try {
    const user = await requireUser();
    const rev = await db.rabRevision.findUniqueOrThrow({
      where: { id: parsed.data },
      select: { locationId: true, revisionNo: true, location: { select: { slug: true } } },
    });
    await requireLocationAccess(user, rev.locationId);
    if (cabut) {
      await cabutPersetujuan(parsed.data, user);
    } else {
      await setujuiRevisi(parsed.data, user);
    }
    revalidateRab(rev.location.slug);
    return {
      success: cabut
        ? `Persetujuan Anda atas revisi #${rev.revisionNo} dicabut.`
        : `Revisi #${rev.revisionNo} Anda setujui.`,
    };
  } catch (err) {
    if (err instanceof PersetujuanError) return { error: err.message };
    return fail(err);
  }
}
