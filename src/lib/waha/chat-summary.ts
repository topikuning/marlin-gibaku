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
import {
  normalizePhone,
  resolveSender,
  type ResolvedSender,
  type SenderDirectory,
} from "./sender-identity";
import { classifyMessage, type MessageClass } from "./message-classify";
import {
  computeConfidence,
  orderByRelevance,
  transitionSummary,
  type SummaryViewStatus,
} from "./summary-lifecycle";

export * from "./chat-summary-format";
export * from "./sender-identity";
export * from "./message-classify";
export * from "./summary-lifecycle";

/**
 * Direktori pengenal pengirim: alias manual + pengguna MARLIN (cocok nomor) +
 * kontak WA. Dibangun sekali per pemanggilan, dipakai semua pesan. DECISIONS 138.
 */
export async function buildSenderDirectory(orgId: string): Promise<SenderDirectory> {
  const [aliases, users, contacts] = await Promise.all([
    db.waSenderAlias.findMany({ where: { orgId }, select: { senderKey: true, displayName: true, role: true } }),
    db.user.findMany({
      where: { orgId, phone: { not: null } },
      select: { fullName: true, role: true, phone: true },
    }),
    db.waContact.findMany({ select: { name: true, chatId: true } }),
  ]);
  const aliasByKey = new Map(
    aliases.map((a) => [a.senderKey.toLowerCase(), { displayName: a.displayName, role: a.role }]),
  );
  const userByPhone = new Map<string, { fullName: string; role: string }>();
  for (const u of users) {
    const p = normalizePhone(u.phone);
    if (p) userByPhone.set(p, { fullName: u.fullName, role: u.role });
  }
  const contactByPhone = new Map<string, string>();
  for (const c of contacts) {
    const p = normalizePhone(c.chatId);
    if (p) contactByPhone.set(p, c.name);
  }
  return { aliasByKey, userByPhone, contactByPhone };
}

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
  /** Nama aman + sumbernya (alias/pengguna/kontak/whatsapp/anonim). */
  sender: ResolvedSender;
  /** Bobot relevansi + kategori informasi (deterministik, DECISIONS 139). */
  class: MessageClass;
};

/** Pesan satu hari (Jakarta) utk tampilan + bahan prompt (dgn tanda noise). */
export async function getChatMessages(
  packageId: string,
  dateKey: string,
  dir?: SenderDirectory,
): Promise<ChatMessageView[]> {
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
      senderJid: true,
      body: true,
      hasMedia: true,
      fromMe: true,
      timestamp: true,
    },
  });
  return msgs.map((m) => {
    const noise = isNoiseMessage(m.body, { fromMe: m.fromMe });
    return {
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
      noise,
      sender: resolveSender(
        { senderJid: m.senderJid, fromNumber: m.fromNumber, fromName: m.fromName, fromMe: m.fromMe },
        dir,
      ),
      class: classifyMessage({ body: m.body, hasMedia: m.hasMedia, noise, fromMe: m.fromMe }),
    };
  });
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
- Sebut nama pengirim untuk hal penting, PERSIS seperti tertulis di transkrip (sudah dipetakan ke nama asli bila diketahui). Bila pengirim tertulis "Anggota grup (belum dikenali)" atau "Anggota (…1234)", sebut begitu saja — JANGAN mengarang nama dan JANGAN menampilkan nomor/kode identitas.
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
 * Buat/perbarui DRAF ringkasan harian satu paket. Idempotent per (paket,
 * tanggal) — upsert. Hasil selalu berstatus `draft_ai`: keluaran AI tidak
 * pernah otomatis final (DECISIONS 139). Pesan berkonteks rendah disaring dan
 * pesan penting (kendala/tindak lanjut) didahulukan bila transkrip terpotong.
 */
export async function generateChatSummary(
  user: SessionUser,
  packageId: string,
  dateKey: string,
): Promise<SummaryResult> {
  const ctx = await getPackageContext(user, packageId);
  if (!ctx) return { ok: false, error: "Paket tidak ditemukan." };

  const summaryDate = new Date(`${dateKey}T00:00:00.000Z`);
  const existing = await db.waChatSummary.findUnique({
    where: { packageId_summaryDate: { packageId, summaryDate } },
    select: { status: true, version: true },
  });
  const gate = transitionSummary((existing?.status ?? "belum_dibuat") as SummaryViewStatus, "draft_ai");
  if (!gate.ok) return { ok: false, error: gate.error };

  const dir = await buildSenderDirectory(user.orgId);
  const [all, dispatches] = await Promise.all([
    getChatMessages(packageId, dateKey, dir),
    getMarlinDispatches(packageId, dateKey),
  ]);
  const messages = all.filter((m) => m.class.useForSummary);
  // Tetap bisa meringkas bila chat kosong tapi MARLIN mengirim laporan/kegiatan.
  if (messages.length === 0 && dispatches.length === 0) {
    return {
      ok: false,
      error:
        all.length === 0
          ? "Tidak ada pesan maupun kiriman MARLIN pada tanggal ini."
          : `Semua ${all.length} pesan pada tanggal ini berkonteks rendah (uji sistem/basa-basi) — tidak ada yang layak diringkas.`,
    };
  }

  // Prioritas konteks: kendala & tindak lanjut lebih dulu saat harus dipotong,
  // lalu dikembalikan ke urutan waktu supaya transkrip tetap terbaca kronologis.
  const prioritized = orderByRelevance(messages);
  const { transcript, truncated } = buildTranscript(
    prioritized.map((m) => ({
      timeLabel: m.timeLabel,
      // Kiriman sistem ditandai eksplisit supaya tidak dibaca sbg obrolan anggota.
      fromName: m.fromMe ? `[MARLIN] ${m.sender.displayName}` : m.sender.displayName,
      body: m.body,
      hasMedia: m.hasMedia,
    })),
    MAX_CHARS,
  );
  const skipped = all.length - messages.length;
  const marlinCount = all.filter((m) => m.fromMe).length;
  const confidence = computeConfidence({
    usedCount: messages.length,
    excludedCount: skipped,
    needsInterpretationCount: messages.filter((m) => m.class.relevance === "perlu_interpretasi").length,
    marlinCount: dispatches.length,
    truncated,
  });

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
  if (skipped > 0) notes.push(`${skipped} pesan berkonteks rendah diabaikan`);
  const summaryText = notes.length ? `${result.text}\n\n(Catatan: ${notes.join("; ")}.)` : result.text;

  const now = new Date();
  const lifecycle = {
    status: gate.status,
    aiText: summaryText,
    confidence,
    marlinCount,
    excludedCount: skipped,
    generatedById: user.id,
    generatedAt: now,
    // Draf baru menghapus jejak sunting/final lama — status kembali ke awal.
    editedById: null,
    editedAt: null,
    finalizedById: null,
    finalizedAt: null,
  };
  await db.waChatSummary.upsert({
    where: { packageId_summaryDate: { packageId, summaryDate } },
    update: {
      messageCount: messages.length,
      summaryText,
      provider: result.provider,
      model: result.model,
      createdById: user.id,
      version: (existing?.version ?? 0) + 1,
      ...lifecycle,
    },
    create: {
      packageId,
      summaryDate,
      messageCount: messages.length,
      summaryText,
      provider: result.provider,
      model: result.model,
      createdById: user.id,
      version: 1,
      ...lifecycle,
    },
  });
  await audit(user.id, "wa.chat_summary", "package", packageId, {
    dateKey,
    messages: messages.length,
    skippedLowContext: skipped,
    marlinDispatches: dispatches.length,
    confidence,
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
  /** Hanya yang `final`/`sent` boleh ikut terkirim ke pimpinan (DECISIONS 139). */
  status: SummaryViewStatus;
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
      status: true,
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
    status: r.status as SummaryViewStatus,
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
