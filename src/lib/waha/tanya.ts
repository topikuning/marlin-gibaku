import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { jakartaDateKey, jakartaToday, formatTanggal } from "@/lib/format";
import type { SessionUser } from "@/lib/auth/session";
import { accessibleLocationIds } from "@/lib/auth/session";
import { aiStructured } from "@/lib/ai/structured";
import { AiGuardError, checkAiGuard, estimateCostUsd, getAiPricing } from "@/lib/ai-hub/guard";
import { getNomorMarlin, sendText } from "./client";
import { parseWaEvent, type ParsedWaMessage } from "./ingest-parse";
import {
  bersihkanMention,
  cocokkanNomorPengguna,
  diajakBicara,
  lingkupJawaban,
  type LingkupJawaban,
} from "./tanya-izin";
import {
  PETUNJUK_SKEMA,
  SISTEM_PROMPT,
  resolusiLokasi,
  skemaNiat,
  type LokasiKatalog,
} from "./tanya-niat";
import {
  balasAmbigu,
  balasDeviasi,
  balasDitolak,
  balasKelengkapan,
  balasKendala,
  balasProgress,
  balasTidakMengerti,
  type OpsiKaki,
} from "./tanya-format";
import {
  dataDeviasi,
  dataKelengkapan,
  dataKendala,
  dataProgress,
  katalogLokasi,
} from "./tanya-data";

/**
 * TANYA-JAWAB WHATSAPP BEBAS — perangkai (DECISIONS 339).
 *
 * Satu pesan masuk melewati urutan tetap, dan urutannya BUKAN selera:
 *
 *   1. bukan pesan kita sendiri  → kalau tidak, MARLIN membalas balasannya
 *   2. diajakBicara()            → di grup: hanya kalau di-mention
 *   3. siapa penanyanya          → nomor, BUKAN nama tampilan
 *   4. guard AI                  → kill-switch + kuota, SEBELUM provider dipanggil
 *   5. AI → struktur niat        → AI tidak pernah menyentuh data
 *   6. lingkupJawaban()          → apa yang boleh disebut DI SANA
 *   7. katalog lokasi (sudah dipotong izin) → cocokkan nama
 *   8. pengambil angka (calc layer) → perangkai kata → kirim
 *
 * Langkah 6 tidak boleh ditukar dengan 7: katalog nama HARUS lahir dari lingkup
 * yang sudah dipotong, supaya lokasi di luar hak penanya tidak sekadar tidak
 * dijawab — namanya tidak pernah bisa dicocokkan, sehingga keberadaannya pun
 * tidak terkonfirmasi lewat balasan "tidak saya kenali" vs "ambigu".
 *
 * ### Kenapa DIAM adalah jawaban yang sah
 *
 * Nomor tak dikenal yang mengirim chat pribadi TIDAK dibalas. Balasan apa pun —
 * termasuk "Anda belum terdaftar" — mengkonfirmasi bahwa nomor ini milik sistem
 * proyek dan mengundang percobaan berikutnya. Di grup berbeda: grupnya sudah
 * tertaut paket dan orangnya sengaja me-mention, jadi keterangan singkat lebih
 * menolong daripada diam yang terlihat seperti kerusakan.
 */

export type HasilTanya = {
  dijawab: boolean;
  /** Untuk log hit webhook di Sistem — bukan untuk dikirim ke penanya. */
  alasan: string;
};

const DIAM = (alasan: string): HasilTanya => ({ dijawab: false, alasan });

/** Panjang pertanyaan yang masih masuk akal; sisanya bukan pertanyaan. */
const BATAS_TANYA = 500;

/* ------------------------------------------------------------------ */
/* Identitas penanya                                                   */
/* ------------------------------------------------------------------ */

/**
 * Cari pengguna MARLIN dari nomor WhatsApp pengirim.
 *
 * Nama tampilan WhatsApp TIDAK PERNAH dipakai — siapa pun bisa mengubahnya jadi
 * "Hery". Nomor disimpan dalam beberapa bentuk historis (`0…`, `+62…`, `62…`),
 * jadi dicari lewat semua varian yang menormalkan ke nomor yang sama.
 */
async function cariPengguna(
  fromNumber: string | null,
): Promise<{ user: SessionUser | null; alasan: string }> {
  /*
   * Dibandingkan di MEMORI setelah dinormalkan, bukan lewat `IN` berisi tebakan
   * bentuk (DECISIONS 345). Nomor telepon tidak pernah boleh dibandingkan
   * sebagai teks: `waNumber` tersimpan "628…@c.us", dan `phone` bisa berisi
   * apa saja yang diketik orang.
   *
   * Yang ditarik hanya tiga kolom dari pengguna AKTIF yang punya nomor —
   * puluhan sampai ratusan baris untuk program 83 lokasi, dan hanya sekali per
   * pesan masuk.
   */
  const daftar = await db.user.findMany({
    where: {
      isActive: true,
      OR: [{ waNumber: { not: null } }, { phone: { not: null } }],
    },
    select: { id: true, waNumber: true, phone: true },
  });
  const c = cocokkanNomorPengguna(daftar, fromNumber);
  if (c.jenis === "tidak_ada") {
    return { user: null, alasan: `nomor ${fromNumber ?? "?"} tidak cocok dengan pengguna mana pun` };
  }
  if (c.jenis === "ganda") {
    return {
      user: null,
      alasan: `nomor ${fromNumber ?? "?"} dipakai ${c.ids.length} pengguna aktif — tidak dijawab, betulkan datanya`,
    };
  }
  const u = await db.user.findUnique({
    where: { id: c.id },
    select: {
      id: true,
      orgId: true,
      fullName: true,
      username: true,
      email: true,
      role: true,
      mustChangePassword: true,
    },
  });
  return { user: u, alasan: u ? "dikenali" : "pengguna hilang saat dibaca ulang" };
}

/* ------------------------------------------------------------------ */
/* Lingkup grup                                                        */
/* ------------------------------------------------------------------ */

type PaketGrup = { id: string; nama: string; lokasiIds: string[] } | null;

/**
 * Paket yang tertaut grup ini — dan HANYA bila paketnya seorganisasi dengan
 * penanya.
 *
 * Tanpa syarat organisasi, seorang super admin yang di-mention di grup milik
 * tenant lain akan dilayani dengan data tenant itu: `lingkupJawaban` hanya
 * meng-irisan lokasi grup dengan izin penanya, dan izin super admin adalah
 * "tanpa batas" — irisannya jadi seluruh lokasi grup asing.
 */
async function paketGrup(chatId: string, orgId: string): Promise<PaketGrup> {
  const p = await db.package.findFirst({
    where: { waGroupId: chatId, orgId },
    select: {
      id: true,
      name: true,
      locations: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!p) return null;
  return { id: p.id, nama: p.name, lokasiIds: p.locations.map((l) => l.id) };
}

/* ------------------------------------------------------------------ */
/* Perangkai                                                           */
/* ------------------------------------------------------------------ */

export async function jawabPertanyaanWa(body: unknown): Promise<HasilTanya> {
  const m = parseWaEvent(body);
  if (!m) return DIAM("bukan pesan yang bisa dibaca");

  // (1) Pesan KITA SENDIRI tidak pernah dijawab. Tanpa pagar ini, balasan MARLIN
  // masuk lagi lewat `message.any` dan MARLIN membalas dirinya sendiri.
  if (m.fromMe) return DIAM("pesan dari MARLIN sendiri");
  if (m.hasMedia && !m.body.trim()) return DIAM("media tanpa teks");

  const grup = m.chatId.endsWith("@g.us");

  // (2) Diajak bicara? Di grup: hanya kalau JID kita di-mention.
  const nomorKita = grup ? await getNomorMarlin() : null;
  const asal = {
    grup,
    senderJid: m.senderJid,
    fromNumber: m.fromNumber,
    mentionedJids: m.mentionedJids,
    body: m.body,
  };
  if (!diajakBicara(asal, { nomor: nomorKita })) {
    return DIAM(grup ? "grup tanpa mention ke MARLIN" : "tidak diajak bicara");
  }

  const teks = bersihkanMention(m.body).slice(0, BATAS_TANYA);

  // (3) Siapa penanyanya — nomor, bukan nama tampilan.
  const { user, alasan: alasanNomor } = await cariPengguna(m.fromNumber);
  if (!user) {
    if (!grup) return DIAM(`didiamkan — ${alasanNomor}`);
    await sendText(
      m.chatId,
      "Maaf, nomor Anda belum terdaftar sebagai pengguna MARLIN, jadi saya belum boleh menjawab pertanyaan data. Hubungi admin untuk mendaftarkan nomor WhatsApp Anda.",
    );
    return { dijawab: true, alasan: `nomor tidak terdaftar — ${alasanNomor}` };
  }

  if (!teks) {
    await sendText(m.chatId, balasTidakMengerti());
    return { dijawab: true, alasan: "mention tanpa pertanyaan" };
  }

  // (6) Apa yang boleh disebut DI SANA — dihitung sebelum katalog nama dibuat.
  const pkg = grup ? await paketGrup(m.chatId, user.orgId) : null;
  const lokasiPengguna = await accessibleLocationIds(user);
  const lingkup: LingkupJawaban = lingkupJawaban({
    grup,
    lokasiPengguna,
    lokasiGrup: pkg?.lokasiIds ?? null,
    namaPaketGrup: pkg?.nama ?? null,
  });
  if (!lingkup.boleh) {
    await sendText(m.chatId, balasDitolak(lingkup.alasan));
    await audit(user.id, "waha.tanya.tolak", "wa_message", m.waMessageId, {
      chatId: m.chatId,
      alasan: lingkup.alasan,
    });
    return { dijawab: true, alasan: "lingkup ditolak" };
  }

  const katalog = await katalogLokasi(user, lingkup.lokasiIds);

  // (4) Guard AI — kill-switch & kuota, SEBELUM provider dipanggil.
  try {
    await checkAiGuard(user, {
      kind: "waha.tanya",
      locationCount: katalog.length,
      inputChars: teks.length,
    });
  } catch (err) {
    if (err instanceof AiGuardError) {
      await sendText(m.chatId, `Maaf, permintaan tidak bisa saya proses: ${err.message}`);
      return { dijawab: true, alasan: `guard AI menolak (${err.code})` };
    }
    throw err;
  }

  // (5) AI → struktur niat. AI TIDAK PERNAH menyentuh data.
  const mulai = Date.now();
  const hasil = await aiStructured(skemaNiat, {
    system: SISTEM_PROMPT,
    prompt: `Pertanyaan:\n"""${teks}"""`,
    schemaHint: PETUNJUK_SKEMA,
    maxTokens: 300,
    timeoutMs: 25_000,
  });
  await catatRun(user, katalog, hasil, Date.now() - mulai);

  if (!hasil.ok) {
    await sendText(
      m.chatId,
      "Maaf, saya sedang tidak bisa membaca pertanyaan bebas (layanan AI tidak merespons). Coba lagi sebentar lagi, atau buka MARLIN langsung.",
    );
    return { dijawab: true, alasan: `AI gagal (${hasil.errorCode})` };
  }

  const niat = hasil.data;
  if (niat.niat === null) {
    await sendText(m.chatId, balasTidakMengerti());
    return { dijawab: true, alasan: "niat tidak dikenali" };
  }

  // (7) Cocokkan nama terhadap katalog yang SUDAH dipotong izin.
  const resolusi = resolusiLokasi(niat.lokasiDisebut, katalog);
  if (resolusi.ambigu.length > 0) {
    await sendText(m.chatId, balasAmbigu(resolusi.ambigu));
    return { dijawab: true, alasan: "nama lokasi ambigu — balik bertanya" };
  }
  // Nama disebut tapi TIDAK SATU PUN dikenali: jangan diam-diam melebar jadi
  // "semua lokasi" — itu menjawab pertanyaan yang tidak ditanyakan.
  if (niat.lokasiDisebut.length > 0 && resolusi.cocok.length === 0) {
    await sendText(
      m.chatId,
      `Saya tidak menemukan lokasi: ${resolusi.tidakDikenal.join(", ")}. Mungkin salah ketik, atau di luar penugasan Anda.`,
    );
    return { dijawab: true, alasan: "lokasi tidak dikenal" };
  }

  const sasaran: LokasiKatalog[] = resolusi.cocok.length > 0 ? resolusi.cocok : katalog;
  const opts: OpsiKaki = {
    catatanPemotongan: lingkup.catatanPemotongan,
    resolusi,
  };

  // (8) Angka dari calc layer → kata → kirim.
  const sekarang = new Date();
  const dateKey = jakartaDateKey(sekarang);
  const tanggal = formatTanggal(jakartaToday(), "d MMMM yyyy");
  let balasan: string;

  if (niat.niat === "kendala") {
    const d = await dataKendala(sasaran, sekarang);
    balasan = balasKendala(
      { tanggal, baris: d.baris, lokasiDiperiksa: d.lokasiDiperiksa },
      { ...opts, catatanBatas: d.catatanBatas },
    );
  } else if (niat.niat === "progress") {
    const d = await dataProgress(sasaran, dateKey);
    balasan = balasProgress({ tanggal, baris: d.baris }, { ...opts, catatanBatas: d.catatanBatas });
  } else if (niat.niat === "deviasi") {
    const d = await dataDeviasi(sasaran);
    balasan = balasDeviasi(
      { tanggal, negatif: d.negatif, diperiksa: d.diperiksa },
      { ...opts, catatanBatas: d.catatanBatas },
    );
  } else {
    const d = await dataKelengkapan(user, sasaran.map((l) => l.id), dateKey);
    balasan = balasKelengkapan(
      { tanggal, perlu: d.perlu, total: d.total },
      { ...opts, catatanBatas: d.catatanBatas },
    );
  }

  await sendText(m.chatId, balasan);
  await audit(user.id, "waha.tanya", "wa_message", m.waMessageId, {
    chatId: m.chatId,
    grup,
    niat: niat.niat,
    lokasiDisebut: niat.lokasiDisebut,
    lokasiDijawab: sasaran.length,
    dipotongKeGrup: lingkup.catatanPemotongan !== null,
  });
  return { dijawab: true, alasan: `dijawab (${niat.niat})` };
}

/**
 * Catat pemakaian AI ke `ai_runs` — itulah yang dihitung guard sebagai kuota.
 *
 * Tanpa baris ini, tanya-jawab WhatsApp memakai provider tanpa pernah menambah
 * hitungan kuota: satu grup ramai bisa menghabiskan anggaran AI sepanjang hari
 * dan panel AI Hub tetap melaporkan nol pemakaian.
 */
async function catatRun(
  user: SessionUser,
  katalog: LokasiKatalog[],
  hasil: Awaited<ReturnType<typeof aiStructured<unknown>>>,
  latencyMs: number,
): Promise<void> {
  try {
    const hariIni = jakartaToday();
    const usage = hasil.meta && hasil.meta.ok ? hasil.meta.usage : null;
    await db.aiRun.create({
      data: {
        userId: user.id,
        runKind: "tanya",
        status: hasil.ok ? "siap" : "gagal",
        scopeType: "all",
        scopeIds: katalog.map((l) => l.id),
        periodStart: hariIni,
        periodEnd: hariIni,
        provider: hasil.meta?.provider ?? null,
        model: hasil.meta?.model ?? null,
        promptVersion: "waha-tanya-1",
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        latencyMs,
        estimatedCostUsd: usage
          ? (estimateCostUsd(await getAiPricing(), usage)?.toFixed(6) ?? null)
          : null,
        errorCode: hasil.ok ? null : hasil.errorCode,
        errorMessage: hasil.ok ? null : hasil.error.slice(0, 500),
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    // Pencatatan yang gagal tidak boleh menelan jawabannya.
    console.error("[waha/tanya] gagal catat ai_run:", err);
  }
}

/** Dipakai uji: bentuk pesan yang sudah diparse (tanpa webhook). */
export type PesanTanya = ParsedWaMessage;
