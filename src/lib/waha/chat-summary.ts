import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { aiCall } from "@/lib/ai/client";
import { parseDateKey } from "@/lib/format";
import type { SessionUser } from "@/lib/auth/session";
import {
  buildTranscript,
  describePackageContext,
  isNoiseMessage,
  shortPackageTitle,
  type PackageContext,
} from "./chat-summary-format";

export * from "./chat-summary-format";

/**
 * Ringkasan AI harian percakapan grup WA per paket — Layer B dari penangkap
 * pesan (DECISIONS 119 → 135, diperkuat 137). Sumber = arsip WaMessage (grup
 * tertaut paket); satu ringkasan per (paket, tanggal Jakarta), regenerate
 * menimpa. Pesan uji webhook/basa-basi disaring sebelum masuk prompt, dan
 * konteks paket/pekerjaan/lokasi selalu disertakan supaya ringkasan tidak
 * menyebut "grup" secara generik.
 */

const MAX_MESSAGES = 500;
const MAX_CHARS = 45_000;

/** Batas hari Jakarta (UTC+7): [00:00, 24:00) tanggal tsb. */
export function jakartaDayRange(dateKey: string): { start: Date; end: Date } | null {
  if (!parseDateKey(dateKey)) return null;
  const start = new Date(`${dateKey}T00:00:00.000+07:00`);
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
}

export type ChatDay = { dateKey: string; count: number };

/** Hari-hari (Jakarta) yang punya pesan utk satu paket + jumlahnya (terbaru dulu). */
export async function listChatDays(packageId: string, limit = 30): Promise<ChatDay[]> {
  const rows = await db.$queryRaw<{ d: string; cnt: bigint }[]>`
    SELECT to_char(timestamp AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS d,
           COUNT(*)::bigint AS cnt
    FROM wa_messages
    WHERE package_id = ${packageId}::uuid
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ dateKey: r.d, count: Number(r.cnt) }));
}

export type ChatMessageView = {
  id: string;
  fromName: string | null;
  body: string;
  hasMedia: boolean;
  timeLabel: string; // HH:mm WIB
  /** Kiriman MARLIN sendiri ke grup (laporan/kegiatan otomatis), bukan obrolan anggota. */
  fromMe: boolean;
  /** Disaring sebagai uji sistem/basa-basi — tetap tampil di UI, tidak masuk prompt. */
  noise: boolean;
};

/** Pesan satu hari (Jakarta) utk tampilan + bahan prompt (dgn tanda noise). */
export async function getChatMessages(packageId: string, dateKey: string): Promise<ChatMessageView[]> {
  const range = jakartaDayRange(dateKey);
  if (!range) return [];
  const msgs = await db.waMessage.findMany({
    where: { packageId, timestamp: { gte: range.start, lt: range.end } },
    orderBy: { timestamp: "asc" },
    take: MAX_MESSAGES,
    select: {
      id: true,
      fromName: true,
      fromNumber: true,
      body: true,
      hasMedia: true,
      fromMe: true,
      timestamp: true,
    },
  });
  return msgs.map((m) => ({
    id: m.id,
    fromName: m.fromName ?? m.fromNumber ?? "Anggota",
    body: m.body,
    hasMedia: m.hasMedia,
    timeLabel: m.timestamp.toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
    }),
    fromMe: m.fromMe,
    noise: isNoiseMessage(m.body, { fromMe: m.fromMe }),
  }));
}

/** Konteks paket (pekerjaan, pelaksana, lokasi) — grup WA sering bernama generik. */
export async function getPackageContext(
  user: SessionUser,
  packageId: string,
): Promise<PackageContext | null> {
  const pkg = await db.package.findFirst({
    where: { id: packageId, orgId: user.orgId },
    select: {
      name: true,
      packageNumber: true,
      waGroupName: true,
      contract: { select: { workTitle: true, vendor: { select: { name: true } } } },
      locations: { select: { name: true }, orderBy: { name: "asc" } },
    },
  });
  if (!pkg) return null;
  return {
    packageName: pkg.name,
    packageNumber: pkg.packageNumber,
    workTitle: pkg.contract?.workTitle ?? null,
    vendorName: pkg.contract?.vendor?.name ?? null,
    waGroupName: pkg.waGroupName,
    locationNames: pkg.locations.map((l) => l.name),
  };
}

const SYSTEM_PROMPT = `Anda merangkum percakapan grup WhatsApp proyek konstruksi Kampung Nelayan Merah Putih untuk manajemen.
Aturan:
- Bahasa Indonesia operasional, langsung, tanpa basa-basi.
- HANYA dari isi chat & data kiriman sistem yang diberikan — jangan mengarang progres/angka yang tidak disebut.
- Selalu sebut identitas pekerjaan (paket/lokasi) dari KONTEKS, jangan menulis "grup" secara generik.
- Sebut nama pengirim untuk hal penting. Jika hanya ada nomor telepon tanpa nama, tulis "salah satu anggota" — JANGAN menampilkan nomor telepon mentah di ringkasan.
- ABAIKAN pesan uji coba sistem/webhook dan basa-basi tanpa isi.
- Pesan bertanda [MARLIN] adalah kiriman OTOMATIS dari sistem (laporan harian/kegiatan), bukan obrolan anggota. Perlakukan sebagai "yang sudah dilaporkan sistem", dan sebutkan bila ada yang seharusnya dikirim tapi tidak muncul.
- Bila ada blok "KIRIMAN SISTEM MARLIN", pakai untuk memverifikasi kelengkapan: sebut laporan/kegiatan yang sudah dikirim ke grup hari itu.
- Struktur ringkasan: (1) Laporan resmi yang sudah dikirim MARLIN, (2) Progres & aktivitas yang dilaporkan anggota, (3) Kendala/masalah, (4) Keputusan & instruksi, (5) Permintaan/butuh tindak lanjut (sebut siapa), (6) Catatan lain. Bagian kosong ditiadakan.
- Maksimum ~280 kata.`;

export type MarlinDispatch = { kind: string; label: string; timeLabel: string | null };

/**
 * Apa yang MARLIN kirim ke grup pada tanggal itu menurut DATA DOMAIN
 * (DailyReport.waSentAt, FieldActivity.waSentAt, ReportDispatch). Dipakai
 * merekonsiliasi ringkasan: kiriman sistem tetap terhitung walau webhook
 * belum aktif / pesan keluar tak tertangkap. DECISIONS 137.
 */
export async function getMarlinDispatches(packageId: string, dateKey: string): Promise<MarlinDispatch[]> {
  const range = jakartaDayRange(dateKey);
  if (!range) return [];
  const timeOf = (d: Date) =>
    d.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });

  const [reports, activities] = await Promise.all([
    db.dailyReport.findMany({
      where: {
        location: { packageId },
        waSentAt: { gte: range.start, lt: range.end },
      },
      select: { reportDate: true, waSentAt: true, status: true, location: { select: { name: true } } },
      orderBy: { waSentAt: "asc" },
    }),
    db.fieldActivity.findMany({
      where: { location: { packageId }, waSentAt: { gte: range.start, lt: range.end } },
      select: { title: true, type: true, waSentAt: true, location: { select: { name: true } } },
      orderBy: { waSentAt: "asc" },
    }),
  ]);

  const out: MarlinDispatch[] = [];
  for (const r of reports) {
    out.push({
      kind: "laporan_harian",
      label: `Laporan harian ${r.location.name} tanggal ${r.reportDate.toISOString().slice(0, 10)} (${r.status})`,
      timeLabel: r.waSentAt ? timeOf(r.waSentAt) : null,
    });
  }
  for (const a of activities) {
    out.push({
      kind: "kegiatan",
      label: `Kegiatan ${a.location.name}: ${a.title}`,
      timeLabel: a.waSentAt ? timeOf(a.waSentAt) : null,
    });
  }
  return out;
}

export type SummaryResult = { ok: true; summaryText: string } | { ok: false; error: string };

/**
 * Buat/perbarui ringkasan harian satu paket. Idempotent per (paket, tanggal) —
 * upsert. Pesan noise (uji webhook/basa-basi) disaring lebih dulu.
 */
export async function generateChatSummary(
  user: SessionUser,
  packageId: string,
  dateKey: string,
): Promise<SummaryResult> {
  const ctx = await getPackageContext(user, packageId);
  if (!ctx) return { ok: false, error: "Paket tidak ditemukan." };

  const [all, dispatches] = await Promise.all([
    getChatMessages(packageId, dateKey),
    getMarlinDispatches(packageId, dateKey),
  ]);
  const messages = all.filter((m) => !m.noise);
  // Tetap bisa meringkas bila chat kosong tapi MARLIN mengirim laporan/kegiatan.
  if (messages.length === 0 && dispatches.length === 0) {
    return {
      ok: false,
      error:
        all.length === 0
          ? "Tidak ada pesan maupun kiriman MARLIN pada tanggal ini."
          : `Semua ${all.length} pesan pada tanggal ini adalah uji sistem/basa-basi — tidak ada yang layak diringkas.`,
    };
  }

  const { transcript, truncated } = buildTranscript(
    messages.map((m) => ({
      timeLabel: m.timeLabel,
      // Kiriman sistem ditandai eksplisit supaya tidak dibaca sbg obrolan anggota.
      fromName: m.fromMe ? `[MARLIN] ${m.fromName ?? "sistem"}` : (m.fromName ?? "Anggota"),
      body: m.body,
      hasMedia: m.hasMedia,
    })),
    MAX_CHARS,
  );
  const skipped = all.length - messages.length;

  const dispatchBlock = dispatches.length
    ? `\n\n=== KIRIMAN SISTEM MARLIN KE GRUP (dari data MARLIN, bukan chat) ===\n` +
      dispatches.map((d) => `- ${d.timeLabel ?? "--:--"} ${d.label}`).join("\n")
    : "";

  const result = await aiCall({
    system: SYSTEM_PROMPT,
    prompt:
      `KONTEKS: ${describePackageContext(ctx)}\n` +
      `Tanggal: ${dateKey} · ${messages.length} pesan relevan` +
      (skipped > 0 ? ` (${skipped} pesan uji sistem/basa-basi sudah disaring)` : "") +
      (truncated ? " · sebagian terpotong karena panjang" : "") +
      `\n\n=== TRANSKRIP ===\n${transcript}${dispatchBlock}`,
    maxTokens: 1400,
    timeoutMs: 90_000,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const notes: string[] = [];
  if (truncated) notes.push(`chat sangat panjang — ringkasan dari ${MAX_CHARS.toLocaleString("id-ID")} karakter pertama`);
  if (skipped > 0) notes.push(`${skipped} pesan uji sistem/basa-basi diabaikan`);
  const summaryText = notes.length ? `${result.text}\n\n(Catatan: ${notes.join("; ")}.)` : result.text;

  const summaryDate = new Date(`${dateKey}T00:00:00.000Z`);
  await db.waChatSummary.upsert({
    where: { packageId_summaryDate: { packageId, summaryDate } },
    update: {
      messageCount: messages.length,
      summaryText,
      provider: result.provider,
      model: result.model,
      createdById: user.id,
    },
    create: {
      packageId,
      summaryDate,
      messageCount: messages.length,
      summaryText,
      provider: result.provider,
      model: result.model,
      createdById: user.id,
    },
  });
  await audit(user.id, "wa.chat_summary", "package", packageId, {
    dateKey,
    messages: messages.length,
    skippedNoise: skipped,
    provider: result.provider,
  });
  return { ok: true, summaryText };
}

export type GlobalSummaryRow = {
  packageId: string;
  title: string;
  summaryText: string;
  messageCount: number;
  updatedAt: Date;
};

/** Semua ringkasan tersimpan pada satu tanggal (lintas paket) — untuk menu global. */
export async function listSummariesForDate(user: SessionUser, dateKey: string): Promise<GlobalSummaryRow[]> {
  const summaryDate = new Date(`${dateKey}T00:00:00.000Z`);
  const rows = await db.waChatSummary.findMany({
    where: { summaryDate, package: { orgId: user.orgId } },
    orderBy: { package: { name: "asc" } },
    select: {
      packageId: true,
      messageCount: true,
      summaryText: true,
      updatedAt: true,
      package: {
        select: { name: true, contract: { select: { workTitle: true } } },
      },
    },
  });
  return rows.map((r) => ({
    packageId: r.packageId,
    title: r.package.contract?.workTitle ? `${r.package.name} — ${r.package.contract.workTitle}` : r.package.name,
    summaryText: r.summaryText,
    messageCount: r.messageCount,
    updatedAt: r.updatedAt,
  }));
}

/** Tanggal-tanggal yang punya ringkasan tersimpan (lintas paket). */
export async function listGlobalSummaryDates(user: SessionUser, limit = 30): Promise<{ dateKey: string; packages: number }[]> {
  const rows = await db.waChatSummary.groupBy({
    by: ["summaryDate"],
    where: { package: { orgId: user.orgId } },
    _count: { _all: true },
    orderBy: { summaryDate: "desc" },
    take: limit,
  });
  return rows.map((r) => ({ dateKey: r.summaryDate.toISOString().slice(0, 10), packages: r._count._all }));
}

/** Judul kontekstual satu paket (dipakai UI & pesan WA). */
export function packageTitleOf(ctx: PackageContext): string {
  return shortPackageTitle(ctx);
}
