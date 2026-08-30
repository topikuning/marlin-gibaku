import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { jakartaDateKey, jakartaToday, formatTanggal, parseDateKey } from "@/lib/format";
import type { SessionUser } from "@/lib/auth/session";
import { accessibleLocationIds } from "@/lib/auth/session";
import { aiStructured } from "@/lib/ai/structured";
import { conversationContextBlock } from "@/lib/ai/conversation";
import {
  AiGuardError,
  checkAiGuard,
  estimateCostUsd,
  getAiPricing,
  type PemakaiAi,
} from "@/lib/ai-hub/guard";
import type { SourceRef } from "@/lib/ai-hub/types";
import { getIdentitasMarlin } from "./client";
import { balasFileWa, balasWa } from "./kirim";
import {
  keteranganBerkas,
  namaBerkasTabel,
  perluPdf,
  petaLokasi,
  tabelDeviasi,
  tabelKelengkapan,
  tabelKendala,
  tabelLaporan,
  tabelMingguan,
  tabelProgress,
  type OpsiTabel,
  type TabelWa,
} from "./tanya-tabel";
import { medanJidPayload, parseWaEvent, type ParsedWaMessage } from "./ingest-parse";
import { kanonikGrupId } from "./grup-id";
import { bersihkanMention, cocokkanNomorPengguna, diajakBicara } from "./tanya-izin";
import { putuskanLayanan } from "./resolver-kanal";
import { potongPesan } from "./potong-pesan";
import {
  PETUNJUK_SKEMA,
  SISTEM_PROMPT,
  resolusiLokasi,
  skemaNiat,
  type LokasiKatalog,
  type Niat,
} from "./tanya-niat";
import {
  bacaBatas,
  bacaBentukDokumen,
  bacaUrutan,
  mintaPekanDepan,
  frasaSisa,
  mintaLupakanKonteks,
  mintaSebab,
  rencanaDeterministik,
  type BentukDokumen,
  type UrutanJawaban,
} from "./parser-niat";
import {
  UMUR_KLARIFIKASI_MENIT,
  ambilPilihan,
  catatIdTawaran,
  simpanTawaran,
} from "./klarifikasi";
import { ambilKonteks, lupakanKonteks, simpanKonteks } from "./konteks-lanjutan";
import { LABEL_JENIS, cariNarasiAman } from "@/lib/narasi/cari";
import {
  balasAmbigu,
  balasBantuan,
  barisTafsir,
  balasProduksi,
  balasProduksiBerkas,
  balasDeviasi,
  balasKronologi,
  balasKronologiTanpaLokasi,
  balasDitolak,
  balasKelengkapan,
  balasKendala,
  balasLupakan,
  balasLaporan,
  balasMingguan,
  balasRencana,
  balasNarasi,
  balasPilihan,
  balasPilihanKedaluwarsa,
  balasPilihanTakAda,
  balasProgress,
  balasTidakMengerti,
  judulProgress,
  type OpsiKaki,
} from "./tanya-format";
import {
  dataDeviasi,
  dataKelengkapan,
  dataKendala,
  dataLaporan,
  dataMingguan,
  dataRencana,
  dataProgress,
  katalogLokasi,
  type SaringKendala,
} from "./tanya-data";
import { bacaPeriode, bulanDari, pekanDari, type PeriodeDiminta } from "./tanya-tanggal";
import { jawabPertanyaanBebasTergrounding } from "./tanya-bebas";

/**
 * TANYA-JAWAB WHATSAPP BEBAS — perangkai (DECISIONS 339).
 *
 * Satu pesan masuk melewati urutan tetap, dan urutannya BUKAN selera:
 *
 *   1. bukan pesan kita sendiri  → kalau tidak, MARLIN membalas balasannya
 *   2. diajakBicara()            → di grup: hanya kalau di-mention
 *   3. siapa penanyanya          → nomor, BUKAN nama tampilan
 *   4. putuskanLayanan()         → apa yang boleh disebut DI SANA
 *   5. katalog lokasi (sudah dipotong izin)
 *   6. membaca pertanyaan, berurutan:
 *        a. jawaban tawaran klarifikasi → tanpa AI (DECISIONS 376)
 *        b. parser deterministik        → tanpa AI (DECISIONS 375)
 *        c. guard AI + AI → struktur niat; AI tidak pernah menyentuh data
 *   7. cocokkan nama ke katalog
 *   8. pengambil angka (calc layer) → perangkai kata → kirim
 *
 * Langkah 4 tidak boleh ditukar dengan 5: katalog nama HARUS lahir dari lingkup
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
 *
 * Sebagian chat tiba dengan identitas privasi `…@lid` yang TIDAK memuat nomor
 * sama sekali. Itu dicoba SESUDAH nomor, lewat kolom `waLid` yang dipetakan
 * admin (DECISIONS 347) — angka di dalam LID bukan nomor telepon dan tidak
 * pernah boleh dicocokkan ke kolom nomor.
 */
async function cariPengguna(
  fromNumber: string | null,
  senderLid: string | null,
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
      OR: [{ waNumber: { not: null } }, { phone: { not: null } }, { waLid: { not: null } }],
    },
    select: { id: true, waNumber: true, phone: true, waLid: true },
  });
  const c = cocokkanNomorPengguna(daftar, fromNumber, senderLid);
  if (c.jenis === "tidak_ada") {
    const siapa = fromNumber ?? senderLid ?? "?";
    /*
     * TIDAK menyuruh siapa pun mengisi LID (DECISIONS 445): tak seorang pun
     * tahu LID-nya sendiri. Yang disebut adalah hal yang MEMANG diketahui
     * manusia — nomor WhatsApp-nya.
     */
    const petunjuk = senderLid && !fromNumber
      ? " – chat ini datang tanpa nomor (identitas privasi WhatsApp) dan WAHA belum bisa memadankannya; pastikan nomor WA orang ini terisi di Master → Pengguna"
      : " – isi nomor WhatsApp orang ini di Master → Pengguna";
    return { user: null, alasan: `nomor ${siapa} tidak cocok dengan pengguna mana pun${petunjuk}` };
  }
  if (c.jenis === "ganda") {
    return {
      user: null,
      alasan: `nomor ${fromNumber ?? "?"} dipakai ${c.ids.length} pengguna aktif – tidak dijawab, betulkan datanya`,
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

type PaketGrup = { id: string; nama: string; orgId: string; lokasiIds: string[] } | null;

/**
 * Paket yang tertaut grup ini — GRUPNYA yang menentukan, termasuk organisasinya
 * (DECISIONS 351).
 *
 * Versi sebelumnya menyaring dengan `orgId` penanya, karena lingkup jawaban
 * di-irisan dengan izin penanya dan izin super admin "tanpa batas" akan
 * melahap seluruh lokasi grup asing. Sejak lingkup grup ditentukan PAKET
 * GRUPNYA (bukan penanya), syarat itu tidak lagi diperlukan — dan tidak lagi
 * mungkin, karena penanya boleh tidak terdaftar sama sekali.
 *
 * Yang menggantikannya lebih kuat: satu grup tertaut ke tepat satu paket, dan
 * paket itu milik tepat satu organisasi. Jawabannya berisi data paket itu, dan
 * dikirim ke grup itu — data tenant tidak pernah keluar dari grup tenant itu.
 */
async function paketGrup(chatId: string): Promise<PaketGrup> {
  /*
   * `findUnique` atas bentuk KANONIK — bukan lagi `findFirst` atas daftar varian
   * (DECISIONS 370).
   *
   * Pencocokan varian dulu perlu karena baris lama tersimpan dalam bentuk apa
   * pun yang kebetulan datang (DECISIONS 348). Sesudah migration
   * `20260819120000_wa_group_unik` mengkanonikkan seluruh baris DAN memasang
   * indeks unik, dua hal itu hilang sekaligus: bentuknya tunggal, dan satu grup
   * paling banyak dimiliki satu paket.
   *
   * Bedanya bukan kerapian. `findFirst` atas beberapa varian berarti paket mana
   * yang menjawab ditentukan urutan baris — data paket A bisa terkirim ke grup
   * paket B, tanpa galat apa pun.
   */
  const kanonik = kanonikGrupId(chatId);
  if (!kanonik) return null;
  const p = await db.package.findUnique({
    where: { waGroupId: kanonik },
    select: {
      id: true,
      name: true,
      orgId: true,
      locations: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!p) return null;
  return { id: p.id, nama: p.name, orgId: p.orgId, lokasiIds: p.locations.map((l) => l.id) };
}

/**
 * Penanya yang dipakai lapisan data — SEBAGAI PENYARING LINGKUP, bukan identitas.
 *
 * Fungsi data (`katalogLokasi`, `getStatusHarian`) menerima `SessionUser` dan
 * meneruskannya ke `locationScopeWhere`, yang hanya membaca `orgId` — dan itu
 * pun HANYA ketika daftar lokasinya `null`. Untuk jawaban grup daftarnya tidak
 * pernah null (selalu lokasi paket grup), jadi nilai ini murni penyaring.
 *
 * Sengaja TIDAK disimpan ke audit atau `ai_runs`: di sana penanya tak terdaftar
 * dicatat sebagai null + chatId-nya. Pengguna karangan di jejak audit menunjuk
 * orang yang tidak melakukan apa-apa.
 */
function penyaringGrup(orgId: string): SessionUser {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    orgId,
    fullName: "Anggota grup WhatsApp",
    username: null,
    email: null,
    role: "field_supervisor",
    mustChangePassword: false,
  };
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

  // (2) Diajak bicara? Di grup: hanya kalau JID kita di-mention (atau pesan kita
  // yang dibalas). Nomor DAN LID, karena mention kini berisi @lid (DECISIONS 349).
  const kita = grup ? await getIdentitasMarlin() : { nomor: null, lid: null };
  const asal = {
    grup,
    senderJid: m.senderJid,
    fromNumber: m.fromNumber,
    mentionedJids: m.mentionedJids,
    balasanKepada: m.balasanKepada,
    body: m.body,
  };
  if (!diajakBicara(asal, kita)) {
    /*
     * Sebut APA YANG DILIHAT, bukan cuma kesimpulannya (DECISIONS 349).
     *
     * Log lama hanya berbunyi "grup tanpa mention ke MARLIN". Ketika user
     * mengirim tangkapan layar grup yang JELAS me-mention MARLIN, baris itu
     * tidak bisa membedakan tiga hal yang sangat berbeda: daftar mention kosong
     * (medan payload-nya tidak terbaca), daftar berisi tapi bukan kita
     * (identitas kita salah), atau identitas kita belum diketahui sama sekali
     * (sesi WAHA belum WORKING). Ketiganya butuh tindakan yang berbeda.
     */
    if (!grup) return DIAM("tidak diajak bicara");
    const siapaKita = kita.nomor ?? (kita.lid ? `${kita.lid}@lid` : null);
    const rinci = !siapaKita
      ? "identitas sesi WAHA belum terbaca (sesi belum WORKING?)"
      : m.mentionedJids.length === 0
        ? `tidak ada mention terbaca di payload · medan: ${medanJidPayload(body).slice(0, 200) || "(tidak ada)"}`
        : `mention terbaca [${m.mentionedJids.join(", ")}] ≠ kita (${siapaKita})`;
    return DIAM(`grup tanpa mention ke MARLIN – ${rinci}`);
  }

  const teks = bersihkanMention(m.body).slice(0, BATAS_TANYA);

  // (3) Siapa penanyanya — nomor, bukan nama tampilan.
  /*
   * Nomor di balik `@lid` DITANYAKAN ke WAHA lebih dulu (DECISIONS 444).
   *
   * Sejak WhatsApp memakai identitas privasi `@lid`, `payload.from` chat
   * pribadi sering tidak memuat nomor — pada engine mana pun, WEBJS termasuk.
   * Tanpa langkah ini, orang yang SAMA dijawab di grup tapi didiamkan di chat
   * pribadi, dan tidak ada yang bisa dilakukannya selain menunggu admin
   * menyalin LID-nya dengan tangan.
   *
   * Sengaja hanya untuk yang BELUM punya nomor: pesan yang sudah membawa nomor
   * tidak perlu menunggu satu panggilan jaringan tambahan.
   */
  let nomorPengirim = m.fromNumber;
  if (!nomorPengirim && m.senderLid) {
    const { nomorDariLid } = await import("./lid");
    nomorPengirim = await nomorDariLid(m.senderLid);
  }
  const { user, alasan: alasanNomor0 } = await cariPengguna(nomorPengirim, m.senderLid);

  /*
   * MARLIN mengingat padanannya SENDIRI (DECISIONS 445).
   *
   * Begitu satu `@lid` terbukti milik seorang pengguna — lewat nomor yang
   * dipadankan WAHA — padanan itu ditulis ke akunnya. Pesan berikutnya cocok
   * tanpa jaringan, dan tidak ada manusia yang pernah diminta mengetik LID
   * yang memang tidak bisa diketahuinya.
   */
  if (user && m.senderLid && !m.fromNumber) {
    try {
      await db.user.updateMany({
        where: { id: user.id, waLid: null },
        data: { waLid: m.senderLid },
      });
    } catch {
      /* gagal mengingat tidak boleh menggagalkan jawaban */
    }
  }
  /*
   * Pengirim ber-@lid yang TIDAK ketemu: catat medan JID apa saja yang benar-
   * benar ada di payload (DECISIONS 347). Tanpa ini, menutup celahnya berarti
   * menebak nama medan satu per satu lewat rilis WAHA — satu tebakan per hari,
   * karena satu-satunya cara mengujinya adalah menunggu pesan asli berikutnya.
   * Isi pesan TIDAK ikut tercatat; hanya nama medan + nilai berbentuk JID.
   */
  const alasanNomor =
    !user && m.senderLid && !nomorPengirim
      ? `${alasanNomor0} · WAHA juga tidak mengenali @lid ini · medan payload: ${medanJidPayload(body).slice(0, 300) || "(tidak ada medan berbentuk JID)"}`
      : alasanNomor0;

  /*
   * Di GRUP, pengirim TIDAK perlu terdaftar (DECISIONS 351).
   *
   * Instruksi user 2026-08-17. Alasannya kuat: balasannya dikirim ke GRUP, dan
   * seluruh anggota membacanya siapa pun yang mengetik — jadi identitas si
   * pengetik tidak pernah menentukan siapa yang melihat jawabannya. Yang
   * menentukan adalah penautan grup↔paket, dan itu dilakukan admin dengan
   * sadar. Menuntut pendaftaran hanya memblokir mandor lapangan dari data
   * paketnya sendiri, di grup paketnya sendiri.
   *
   * Chat PRIBADI tidak berubah: di sana tidak ada grup yang membatasi apa pun,
   * jadi identitas penanya satu-satunya dasar — dan nomor tak dikenal tetap
   * DIDIAMKAN (balasan apa pun mengkonfirmasi bahwa nomor ini milik sistem).
   */
  /*
   * (4) SATU resolver memutuskan kanal + identitas + scope (DECISIONS 371).
   *
   * Sebelumnya keputusan ini tersebar di tiga tempat — `diajakBicara()`,
   * potongan `if (!user && !grup)` di sini, dan `lingkupJawaban()` — sehingga
   * aturan bisa berubah di satu tempat dan diam-diam ditutupi tempat lain.
   */
  const pkg = grup ? await paketGrup(m.chatId) : null;
  const keputusan = putuskanLayanan({
    grup,
    diajakBicara: true, // sudah diperiksa di langkah (2) di atas
    penanya: user ? { id: user.id, orgId: user.orgId, role: user.role } : null,
    alasanIdentitas: alasanNomor,
    paketGrup: pkg
      ? { id: pkg.id, nama: pkg.nama, orgId: pkg.orgId, lokasiIds: pkg.lokasiIds }
      : null,
  });

  if (keputusan.jenis === "diam") return DIAM(keputusan.alasan);
  if (keputusan.jenis === "tolak") {
    await balasWa(m.chatId, balasDitolak(keputusan.pesan));
    await audit(user?.id ?? null, "waha.tanya.tolak", "wa_message", m.waMessageId, {
      chatId: m.chatId,
      grup,
      alasan: keputusan.alasan,
    });
    return { dijawab: true, alasan: keputusan.alasan };
  }

  if (!teks) {
    await balasWa(m.chatId, balasTidakMengerti());
    return { dijawab: true, alasan: "mention tanpa pertanyaan" };
  }

  /*
   * Penyaring lingkup untuk lapisan data. Di grup ia berasal dari PAKET GRUP,
   * bukan dari penanya — termasuk ketika penanyanya justru pengguna terdaftar,
   * supaya jawaban di satu grup tidak berubah-ubah tergantung siapa mengetik.
   */
  const penyaring: SessionUser = pkg ? penyaringGrup(keputusan.orgId) : user!;

  /*
   * `lokasiIds = null` berarti "seluruh lokasi yang boleh diakses penanya di
   * organisasinya" — dan itu harus BENAR-BENAR dihitung dari penugasannya,
   * bukan diartikan "semua". Untuk peran istimewa `accessibleLocationIds`
   * mengembalikan null (lintas lokasi), dan `katalogLokasi` menyaringnya dengan
   * `orgId` — jadi batas organisasi tetap berlaku (brief 5A: `super_admin`
   * BUKAN akses seluruh basis data).
   */
  const lokasiIds =
    keputusan.lokasiIds ?? (user ? await accessibleLocationIds(user) : null);
  const katalog = await katalogLokasi(penyaring, lokasiIds);

  /*
   * (6) MEMBACA PERTANYAAN — tiga jalur, diperiksa berurutan.
   *
   *   a. jawaban atas tawaran klarifikasi  → tanpa AI (DECISIONS 376)
   *   b. parser deterministik              → tanpa AI (DECISIONS 375)
   *   c. AI                                → hanya untuk sisanya
   *
   * Urutannya mengikat. Ketiganya diperiksa SEBELUM guard AI, dan itu bukan
   * penghematan baris — tiga akibatnya nyata:
   *
   * 1. **Tidak memakai kuota.** Guard menolak pada kuota yang habis; kalau ia
   *    dilewati lebih dulu, "progress hari ini" ikut mati hanya karena grup
   *    lain menghabiskan anggaran AI hari itu.
   * 2. **Tetap hidup saat provider mati.** Perintah paling sering dipakai
   *    seharusnya tidak ikut jatuh setiap kali layanan AI bermasalah.
   * 3. **Tidak menunggu 1–3 detik** untuk yang tidak punya tafsir kedua.
   *
   * Jalur (b) hanya menerima kalimat yang SELURUH katanya terjelaskan — lihat
   * `rencanaDeterministik`. Sisanya jatuh ke AI persis seperti dulu, jadi ini
   * hanya bisa menghemat, tidak bisa memperluas jawaban.
   */
  type Terbaca = {
    niat: Niat;
    lokasiDisebut: string[];
    periode: PeriodeDiminta;
    /**
     * Urutan yang diminta penanya (DECISIONS 390). Hanya lahir dari parser
     * deterministik: AI TIDAK diminta menebaknya, karena kata superlatif yang
     * salah baca menghasilkan daftar yang berkebalikan tanpa satu pun tanda.
     */
    urutan?: UrutanJawaban | null;
    /** Banyak baris yang diminta ("5 terbaik"); null = batas bawaan. */
    batas?: number | null;
  };

  // `m` sudah dipastikan ada di awal fungsi, tapi penyempitan itu tidak ikut
  // masuk ke dalam closure di bawah. Diikat sekali di sini supaya jalur AI
  // tidak perlu ditaburi `!`.
  const pesan: ParsedWaMessage = m;
  // Sama alasannya dengan `pesan`: penyempitan `keputusan` ke varian "jawab"
  // tidak ikut masuk ke dalam closure di bawah.
  const catatanPemotongan = keputusan.catatanPemotongan;
  let konteksCache: Awaited<ReturnType<typeof ambilKonteks>> | undefined;
  const konteksAktif = async () => {
    if (konteksCache === undefined) konteksCache = await ambilKonteks(pesan);
    return konteksCache;
  };

  /**
   * Jalur AI — guard, provider, pencatatan kuota.
   *
   * Mengembalikan `HasilTanya` bila perangkai harus BERHENTI (AI mati, niat
   * tidak dikenali, kuota habis). Dibuat begitu, bukan melempar, supaya
   * alasan yang dicatat webhook tetap sama persis seperti sebelum Fase D.
   */
  async function bacaLewatAi(): Promise<Terbaca | HasilTanya> {
    // Guard AI — kill-switch & kuota, SEBELUM provider dipanggil. Untuk
    // penanya tak terdaftar, kuncinya CHAT-nya: satu grup ramai tidak boleh
    // menghabiskan anggaran AI sepanjang hari (DECISIONS 351).
    const pemakaiAi: PemakaiAi = user ?? { jenis: "grup", orgId: pkg!.orgId, chatId: pesan.chatId };
    try {
      await checkAiGuard(pemakaiAi, {
        kind: "waha.tanya",
        locationCount: katalog.length,
        inputChars: teks.length,
      });
    } catch (err) {
      if (err instanceof AiGuardError) {
        await balasWa(pesan.chatId, `Maaf, permintaan tidak bisa saya proses: ${err.message}`);
        return { dijawab: true, alasan: `guard AI menolak (${err.code})` };
      }
      throw err;
    }

    // AI → struktur niat. AI TIDAK PERNAH menyentuh data.
    const mulai = Date.now();
    const konteks = await konteksAktif();
    const historyBlock = conversationContextBlock(konteks?.history ?? [], { maxTurns: 8, maxChars: 4_000 });
    const hasil = await aiStructured(skemaNiat, {
      system: SISTEM_PROMPT,
      prompt: `${historyBlock ? `${historyBlock}\n\n` : ""}Pertanyaan terbaru (selalu menang atas riwayat):\n"""${teks}"""`,
      schemaHint: PETUNJUK_SKEMA,
      maxTokens: 300,
      timeoutMs: 25_000,
    });
    await catatRun(pemakaiAi, katalog, hasil, Date.now() - mulai);

    if (!hasil.ok) {
      /*
       * AI mati — TAPI catatan lapangan tetap bisa dicari (DECISIONS 383).
       *
       * Pencarian narasi tidak memanggil provider mana pun, jadi justru di
       * saat seperti inilah ia paling berguna. Menyerah tanpa mencobanya
       * berarti membuang jawaban yang sudah ada di tangan.
       */
      const narasi = await jawabDariCatatan();
      if (narasi) return narasi;
      await balasWa(
        pesan.chatId,
        "Maaf, saya sedang tidak bisa membaca pertanyaan bebas (layanan AI tidak merespons). Coba lagi sebentar lagi, atau buka MARLIN langsung.",
      );
      return { dijawab: true, alasan: `AI gagal (${hasil.errorCode})` };
    }

    const d = hasil.data;
    if (d.niat === null) {
      // Pertanyaan di luar sembilan intent lama tidak lagi otomatis ditolak.
      // Model kedua boleh menyusun jawaban dari snapshot MARLIN + kutipan,
      // tetapi validator kode membuang setiap bagian tanpa bukti yang sah.
      const resolusiBebas = resolusiLokasi(d.lokasiDisebut, katalog);
      if (resolusiBebas.ambigu.length > 0 || resolusiBebas.ambiguWilayah.length > 0) {
        await balasWa(pesan.chatId, balasAmbigu(resolusiBebas.ambigu, resolusiBebas.ambiguWilayah));
        return { dijawab: true, alasan: "pertanyaan bebas – lokasi ambigu" };
      }
      if (d.lokasiDisebut.length > 0 && resolusiBebas.cocok.length === 0) {
        await balasWa(
          pesan.chatId,
          `Saya tidak menemukan lokasi: ${resolusiBebas.tidakDikenal.join(", ")}. Mungkin salah ketik, atau di luar penugasan Anda.`,
        );
        return { dijawab: true, alasan: "pertanyaan bebas – lokasi tidak dikenal" };
      }
      const lokasiBebas = resolusiBebas.cocok.length > 0 ? resolusiBebas.cocok : katalog;
      const hariIni = jakartaDateKey(new Date());
      const periodeBebas = bacaPeriode(d.periode, hariIni);
      try {
        await checkAiGuard(pemakaiAi, {
          kind: "waha.jawab_bebas",
          locationCount: lokasiBebas.length,
          inputChars: teks.length + (historyBlock?.length ?? 0),
        });
      } catch (err) {
        if (err instanceof AiGuardError) {
          const narasi = await jawabDariCatatan();
          if (narasi) return narasi;
          await balasWa(pesan.chatId, `Maaf, jawaban lanjutan tidak bisa diproses: ${err.message}`);
          return { dijawab: true, alasan: `guard jawaban bebas menolak (${err.code})` };
        }
        throw err;
      }
      const mulaiBebas = Date.now();
      const bebas = await jawabPertanyaanBebasTergrounding({
        user: penyaring,
        locationIds: lokasiBebas.map((location) => location.id),
        question: teks,
        startKey: periodeBebas.mulai,
        endKey: periodeBebas.akhir,
        history: konteks?.history ?? [],
        adapterUser: grup ? undefined : user ?? undefined,
        // Di grup penahanannya DIKATAKAN, bukan dibiarkan terbaca sebagai
        // "datanya tidak ada" (DECISIONS 459).
        ditahanKarenaGrup: grup,
      });
      await catatRun(pemakaiAi, lokasiBebas, bebas.providerResult, Date.now() - mulaiBebas, {
        promptVersion: "waha-bebas-1",
        startKey: periodeBebas.mulai,
        endKey: periodeBebas.akhir,
        outputJson: bebas.output ? { tanya: bebas.output } : undefined,
        sourcesJson: bebas.sourceRefs,
      });
      if (bebas.text) {
        for (const bagian of potongPesan(bebas.text).bagian) await balasWa(pesan.chatId, bagian);
        await simpanKonteks(pesan, null, d.lokasiDisebut, new Date(), { question: teks, answer: bebas.text });
        await audit(user?.id ?? null, "waha.tanya.bebas", "wa_message", pesan.waMessageId, {
          chatId: pesan.chatId,
          lokasiDijawab: lokasiBebas.length,
          periode: `${periodeBebas.mulai}..${periodeBebas.akhir}`,
          bagianLolos: bebas.output?.answerParts.length ?? 0,
        });
        return { dijawab: true, alasan: "dijawab fleksibel dari sumber MARLIN" };
      }
      const narasi = await jawabDariCatatan();
      if (narasi) return narasi;
      await balasWa(pesan.chatId, balasTidakMengerti());
      return { dijawab: true, alasan: "jawaban bebas tidak memiliki bagian tergrounding" };
    }
    /*
     * URUTAN & CACAHAN TIDAK IKUT HILANG DI JALUR AI (DECISIONS 449).
     *
     * Keberatan user 2026-08-26: *"'progress hari ini' dan 'progress 5
     * terbaik' sama sekali tidak memberikan perbedaan hasil"*. Sebabnya: kata
     * "5" bukan nama lokasi, jadi seluruh kalimat diserahkan ke AI — dan
     * jalur AI dulu mengembalikan niat/lokasi/periode SAJA. Superlatifnya
     * lenyap tanpa satu pun tanda, jadi jawabannya identik dengan pertanyaan
     * yang tidak menyebutnya.
     *
     * Yang ditambahkan BUKAN tebakan AI: keduanya dibaca dari teks aslinya
     * oleh pembaca deterministik yang sama dengan jalur cepat. Alasan lama
     * ("AI tidak diminta menebak superlatif") tetap dihormati — yang berubah
     * hanya bahwa kata yang JELAS tertulis tidak lagi dibuang.
     */
    const bisaDiurut = d.niat === "progress" || d.niat === "deviasi";
    const urutan = bisaDiurut ? bacaUrutan(teks) : null;
    return {
      niat: d.niat,
      lokasiDisebut: d.lokasiDisebut,
      periode: d.periode,
      urutan,
      batas: urutan ? bacaBatas(teks) : null,
    };
  }

  /**
   * Jawab dari KUTIPAN catatan lapangan — tanpa AI sama sekali (DECISIONS 383).
   *
   * Yang dikirim kalimat yang benar-benar ditulis pelapor, disalin bulat-bulat.
   * Tidak ada model yang merangkum, jadi tidak ada yang bisa mengarang — bukan
   * karena dilarang di prompt, melainkan karena tidak ada langkah yang bisa
   * mengarang.
   *
   * `null` = tidak ada catatan yang cocok; pemanggil melanjutkan ke jalur
   * menyerah yang lama.
   */
  async function jawabDariCatatan(): Promise<HasilTanya | null> {
    /*
     * Nama lokasi di pertanyaan DIHORMATI juga di jalur ini (DECISIONS 390).
     *
     * Dilaporkan user 2026-08-20 dengan tangkapan layar: *"kenapa randu putih
     * deviasi negatifnya tinggi"* dijawab catatan dari Betahwalang,
     * Kedungmutih, dan Purworejo – *"malah daerahnya kemana-mana"*. Dua sebab:
     * "randu putih" tidak cocok ke "Randuputih" (diperbaiki di
     * `cocokkanLokasi`), dan jalur ini mencari ke SELURUH katalog tanpa peduli
     * penanya menyebut lokasi.
     *
     * Yang paling merusak bukan cakupannya, melainkan diamnya: balasan itu
     * tidak menyebut satu kata pun bahwa nama yang ditulis penanya tidak
     * dikenali, jadi ia terbaca sebagai jawaban ATAS Randu Putih.
     */
    const resolusiNarasi = resolusiLokasi(frasaSisa(teks), katalog);
    const lingkup = resolusiNarasi.cocok.length > 0 ? resolusiNarasi.cocok : katalog;

    const potongan = await cariNarasiAman({
      locationIds: lingkup.map((l) => l.id),
      pertanyaan: teks,
      batas: 5,
    });
    if (potongan.length === 0) return null;

    await balasWa(
      pesan.chatId,
      balasNarasi(
        {
          pertanyaan: teks,
          baris: potongan.map((p) => ({
            lokasi: p.namaLokasi,
            jenis: LABEL_JENIS[p.jenis],
            tanggal: p.tanggal,
            teks: p.teks,
          })),
        },
        // `resolusi` membawa nama yang TIDAK dikenali ke kaki balasan — itulah
        // yang hilang di layar user.
        { catatanPemotongan, resolusi: resolusiNarasi },
      ),
    );
    await audit(user?.id ?? null, "waha.tanya.narasi", "wa_message", pesan.waMessageId, {
      chatId: pesan.chatId,
      pertanyaan: teks,
      potongan: potongan.length,
      lokasi: [...new Set(potongan.map((p) => p.locationId))].length,
    });
    return { dijawab: true, alasan: `dijawab dari catatan lapangan (${potongan.length})` };
  }

  let niat: Terbaca;
  let jalur: "klarifikasi" | "lanjutan" | "deterministik" | "ai";

  /*
   * (6a) JAWABAN atas tawaran klarifikasi — diperiksa PALING DULU.
   *
   * "2" tidak punya niat maupun periode; jalur mana pun sesudah ini akan
   * membacanya sebagai pertanyaan yang tidak dimengerti. Kandidatnya sudah
   * dihitung saat tawaran dibuat dan disimpan utuh, jadi menjawabnya TIDAK
   * memanggil AI lagi — itu inti butir 22 brief.
   */
  /*
   * (6-0) "abaikan" / "lupakan" — perintah, bukan pertanyaan (DECISIONS 390).
   *
   * Diperiksa PALING DULU, sebelum tawaran klarifikasi maupun parser: begitu
   * penanya minta melupakan, tidak ada satu pun sisa percakapan yang boleh
   * ikut menentukan balasan berikutnya. User mengetik ini secara alami setelah
   * menerima jawaban yang melenceng, dan sebelumnya dijawab "belum mengerti"
   * sambil TETAP memegang konteks yang salah.
   */
  if (mintaLupakanKonteks(teks)) {
    const adaKonteks = await lupakanKonteks(m);
    await balasWa(m.chatId, balasLupakan(adaKonteks));
    await audit(user?.id ?? null, "waha.tanya.lupakan", "wa_message", m.waMessageId, {
      chatId: m.chatId,
      adaKonteks,
    });
    return { dijawab: true, alasan: "konteks dilepas atas permintaan" };
  }

  const pilihan = await ambilPilihan(m, teks);
  if (pilihan.jenis === "kedaluwarsa") {
    // DIKATAKAN, bukan didiamkan: penanya baru saja mengetik angka dan berhak
    // tahu kenapa tidak terjadi apa-apa. Diam terbaca seperti sistem rusak.
    await balasWa(m.chatId, balasPilihanKedaluwarsa(pilihan.pertanyaan, UMUR_KLARIFIKASI_MENIT));
    return { dijawab: true, alasan: "pilihan klarifikasi kedaluwarsa" };
  }
  if (pilihan.jenis === "di_luar_daftar") {
    await balasWa(m.chatId, balasPilihanTakAda(pilihan.jumlah));
    return { dijawab: true, alasan: "pilihan di luar daftar" };
  }

  if (pilihan.jenis === "ambil") {
    jalur = "klarifikasi";
    niat = {
      niat: pilihan.kandidat.niat,
      lokasiDisebut: pilihan.kandidat.lokasiDisebut,
      periode: pilihan.kandidat.periode,
    };
    await audit(user?.id ?? null, "waha.tanya.klarifikasi", "wa_message", m.waMessageId, {
      chatId: m.chatId,
      pertanyaan: pilihan.pertanyaan,
      pilihan: pilihan.indeks + 1,
      niat: niat.niat,
    });
  } else {
    const rencana = rencanaDeterministik(teks, katalog);

    if (rencana.jenis === "jalan") {
      jalur = "deterministik";
      niat = {
        niat: rencana.niat,
        lokasiDisebut: rencana.lokasiDisebut,
        periode: rencana.periode,
        urutan: rencana.urutan,
        batas: rencana.batas,
      };
    } else if (rencana.jenis === "ambigu") {
      /*
       * (6b) PERTANYAAN SUSULAN — dilengkapi dari konteks, bukan ditanya balik
       * (DECISIONS 377).
       *
       * Percakapan lapangan tidak mengulang subjeknya: *"progress hari ini di
       * Kedung Mutih"* lalu *"kalau kemarin?"*. Menawarkan daftar pilihan di
       * situ berarti menanyakan sesuatu yang BARU SAJA kita jawab sendiri.
       *
       * Yang dipinjam hanya bagian yang HILANG. Nama lokasi yang ditulis di
       * susulan SELALU menang: konteks tidak pernah menambahi lokasi pada
       * pertanyaan yang sudah menyebut lokasinya sendiri.
       */
      /*
       * Konteks hanya dipinjam bila penanya BENAR-BENAR tidak menyebut
       * maksudnya (`sebab === "tanpa_niat"`).
       *
       * Cacat produksi 2026-08-20, dilaporkan user dengan tangkapan layar:
       *
       *   "siapa yang belum lapor kemarin?"  → Kelengkapan laporan, kemarin ✓
       *   "kendala minggu lalu"              → Kelengkapan laporan, minggu lalu ✗
       *
       * Pertanyaan kedua menyebut "kendala" sejelas-jelasnya; yang bercabang
       * cuma cara membacanya (DECISIONS 381). Tapi kedua bentuk ambigu dulu
       * bertipe sama, jadi cabang ini meminjam niat lama dan MEMBUANG kata
       * yang baru saja ditulis penanya — lalu menjawabnya dengan percaya diri.
       *
       * Ini kelas kesalahan terburuk di seluruh fitur: bukan "tidak bisa
       * menjawab", melainkan menjawab pertanyaan yang tidak diajukan, dengan
       * angka yang benar untuk pertanyaan yang salah.
       */
      const konteks = rencana.sebab === "tanpa_niat" ? await konteksAktif() : null;
      if (konteks?.niat) {
        jalur = "lanjutan";
        const disebutSusulan = rencana.kandidat[0].lokasiDisebut;
        niat = {
          niat: konteks.niat,
          lokasiDisebut: disebutSusulan.length > 0 ? disebutSusulan : konteks.lokasiDisebut,
          // Periodenya SELALU dari pertanyaan susulan — itu yang ia sebut
          // sendiri, dan satu-satunya alasan ia bertanya lagi.
          periode: rencana.kandidat[0].periode,
        };
        await audit(user?.id ?? null, "waha.tanya.lanjutan", "wa_message", m.waMessageId, {
          chatId: m.chatId,
          pertanyaan: teks,
          niatDipinjam: konteks.niat,
          lokasiDipinjam: niat.lokasiDisebut,
        });
      } else {
        /*
         * TAFSIRNYA lebih dari satu dan tidak ada konteks — TAWARKAN, jangan
         * menyerah.
         *
         * Keberatan user 2026-08-19: `niat = null → balasTidakMengerti()`
         * terlalu cepat menyerah dan membuang waktu penanya. Tawarannya durable
         * dan terikat CHAT + PENGIRIM, jadi `1` benar-benar bisa dijawab — dan
         * tidak bisa dibajak orang lain di grup yang sama.
         */
        const simpan = await simpanTawaran(m, teks, rencana.kandidat);
        if (simpan.jenis === "sudah") {
          // Webhook yang sama diproses ulang: tawarannya sudah dikirim.
          // Mengirim lagi berarti dua daftar pilihan untuk satu pertanyaan.
          return { dijawab: false, alasan: "tawaran klarifikasi sudah pernah dikirim" };
      }
      if (simpan.jenis === "disimpan") {
        const idPesan = await balasWa(
          m.chatId,
          balasPilihan(teks, rencana.kandidat, UMUR_KLARIFIKASI_MENIT),
        );
        await catatIdTawaran(simpan.id, idPesan);
        await audit(user?.id ?? null, "waha.tanya.tawar", "wa_message", m.waMessageId, {
          chatId: m.chatId,
          pertanyaan: teks,
          kandidat: rencana.kandidat.map((k) => k.niat),
        });
        return {
          dijawab: true,
          alasan: `tawaran klarifikasi (${rencana.kandidat.length} pilihan)`,
        };
      }
      /*
       * `tak_bisa` — pengirim di grup tidak bisa dibedakan dari peserta lain.
       * Menawarkan pilihan di situ berarti membuka `1` untuk siapa pun yang
       * membaca, dan jawabannya akan tampak seperti jawaban penanya aslinya.
       * Diteruskan ke AI, persis perilaku sebelum DECISIONS 376.
       */
      jalur = "ai";
      const t = await bacaLewatAi();
      if ("dijawab" in t) return t;
      niat = t;
      }
    } else {
      jalur = "ai";
      const t = await bacaLewatAi();
      if ("dijawab" in t) return t;
      niat = t;
    }
  }


  // (7) Cocokkan nama terhadap katalog yang SUDAH dipotong izin.
  const resolusi = resolusiLokasi(niat.lokasiDisebut, katalog);
  if (resolusi.ambigu.length > 0 || resolusi.ambiguWilayah.length > 0) {
    await balasWa(m.chatId, balasAmbigu(resolusi.ambigu, resolusi.ambiguWilayah));
    return { dijawab: true, alasan: "nama lokasi ambigu – balik bertanya" };
  }
  // Nama disebut tapi TIDAK SATU PUN dikenali: jangan diam-diam melebar jadi
  // "semua lokasi" — itu menjawab pertanyaan yang tidak ditanyakan.
  if (niat.lokasiDisebut.length > 0 && resolusi.cocok.length === 0) {
    await balasWa(
      m.chatId,
      `Saya tidak menemukan lokasi: ${resolusi.tidakDikenal.join(", ")}. Mungkin salah ketik, atau di luar penugasan Anda.`,
    );
    return { dijawab: true, alasan: "lokasi tidak dikenal" };
  }

  const sasaran: LokasiKatalog[] = resolusi.cocok.length > 0 ? resolusi.cocok : katalog;
  const opts: OpsiKaki = {
    catatanPemotongan: keputusan.catatanPemotongan,
    resolusi,
  };

  /*
   * (8) PERIODE → tanggal nyata, lalu angka dari calc layer → kata → kirim.
   *
   * Tanggalnya dihitung DI SINI dari bentuk yang dibaca AI (DECISIONS 356). AI
   * tidak pernah menghitung tanggal: ia tidak tahu hari ini tanggal berapa di
   * Asia/Jakarta, tidak tahu panjang bulan, dan akan menebak tahun untuk
   * "17 Agustus".
   */
  const sekarang = new Date();
  const hariIniKey = jakartaDateKey(sekarang);
  const periode = bacaPeriode(niat.periode, hariIniKey);
  // Penanda "ke depan" dibaca dari TEKS ASLINYA, bukan dari `periode`: modul
  // tanggal sengaja menolak tanggal depan (lihat catatan di parser-niat).
  const pekanDepan = mintaPekanDepan(teks);
  // Satu hari → tanggal itu. Rentang → ujung akhirnya, karena angka kumulatif
  // (progress/deviasi) selalu "posisi PADA suatu hari", bukan penjumlahan hari.
  const dateKey = periode.akhir;
  /*
   * Kepala balasan menyebut TANGGAL NYATA, bukan cuma labelnya (DECISIONS 390).
   *
   * Permintaan user 2026-08-20: *"jawaban sudah lumayan oke, tapi seharusnya
   * jawaban ini disertai tanggal"*. Alasannya lebih dari kerapian: balasan
   * WhatsApp di-screenshot lalu diteruskan ke PPK berhari-hari kemudian, dan
   * di situ "kemarin lusa" tidak lagi berarti apa-apa – bahkan menyesatkan,
   * karena "kemarin"-nya pembaca bukan "kemarin"-nya penanya.
   *
   * Untuk RENTANG ditulis "posisi <tanggal>", karena angka kumulatif memang
   * posisi pada hari terakhir rentang, bukan penjumlahan sepanjang rentang.
   */
  const tglAkhir = parseDateKey(dateKey) ?? jakartaToday();
  const tanggalNyata = formatTanggal(tglAkhir, "d MMMM yyyy");
  const tanggal =
    periode.label === tanggalNyata
      ? periode.label
      : periode.satuHari
        ? `${periode.label} · ${tanggalNyata}`
        : `${periode.label} · posisi ${tanggalNyata}`;
  opts.catatanPeriode = periode.catatan;
  let balasan: string;
  /*
   * Bentuk TABEL dari jawaban yang sama (DECISIONS 448) — dipakai hanya bila
   * barisnya banyak, dan berisi data yang PERSIS sama dengan balasan teksnya.
   * `null` = niat yang memang bukan daftar (mis. bantuan).
   */
  let tabel: TabelWa | null = null;
  /**
   * Blanko harian yang harus IKUT terkirim sebagai berkas (DECISIONS 469).
   *
   * Disimpan dulu, dikirim belakangan bersama jalur berkas yang sudah ada —
   * bukan dikirim di tengah cabang niat, supaya urutan "teks dulu, berkas
   * menyusul" tetap satu tempat dan kegagalan berkas tidak menelan balasannya.
   */
  let berkasHarian: {
    lokasi: LokasiKatalog;
    dateKey: string;
    /** Blanko KKP atau ringkasan bacaan — dibaca dari kalimatnya, bukan ditebak. */
    bentuk: BentukDokumen;
  } | null = null;
  const peta = petaLokasi(katalog);
  const optTabel = (o: OpsiTabel = {}): OpsiTabel => ({
    catatanPemotongan: keputusan.catatanPemotongan,
    penandaLingkup: keputusan.penandaLingkup,
    ...o,
  });

  if (niat.niat === "bantuan") {
    balasan = balasBantuan();
  } else if (niat.niat === "produksi") {
    /*
     * PERINTAH, bukan pertanyaan — tetapi tidak semua artefak sama.
     *
     * Keluhan user 2026-08-29: *"aku mengharapkan laporan dalam bentuk file yg
     * komprehensif mulai dari laporan dan kendala"*, dan yang ia terima adalah
     * penolakan. Penolakan itu benar untuk laporan EKSEKUTIF — angkanya
     * ditandatangani, jadi harus lewat review→setujui→beku (DECISIONS 193).
     * Tetapi BLANKO HARIAN bukan artefak yang dijaga gerbang itu: ia sudah
     * dibentuk tiap hari dan diunggah sendiri ke Drive tanpa persetujuan siapa
     * pun. Menolak mengirim berkas yang setiap malam dikirim otomatis adalah
     * pagar yang tidak menjaga apa-apa.
     *
     * Jadi batasnya digeser ke tempat yang benar:
     *   - satu lokasi + satu tanggal → blanko hariannya DIKIRIM, lengkap
     *     dengan pekerjaan, tenaga, material, alat, foto, dan KENDALA;
     *   - selain itu (lintas lokasi, rentang tanggal, laporan eksekutif) →
     *     tetap mengaku dan menunjukkan jalannya.
     */
    const satuLokasi = resolusi.cocok.length === 1 ? resolusi.cocok[0] : null;
    if (satuLokasi && periode.satuHari) {
      /*
       * Bawaannya RINGKASAN, dan itu keputusan lama yang dipertahankan: berkas
       * ini paling sering diminta untuk dibaca di grup, bukan untuk disetorkan.
       * Yang berubah adalah "versi kkp" kini benar-benar dibaca, dan balasannya
       * menyebut bentuk yang dipakai — jadi bawaan yang keliru bisa dikoreksi
       * penanya dalam satu pesan berikutnya.
       */
      const bentuk = bacaBentukDokumen(teks) ?? "ringkas";
      berkasHarian = { lokasi: satuLokasi, dateKey, bentuk };
      balasan = balasProduksiBerkas(satuLokasi.nama, dateKey, bentuk);
    } else {
      balasan = balasProduksi();
    }
  } else if (niat.niat === "laporan_mingguan") {
    // Berapa pun bentuk periode yang ditulis penanya, jawabannya satu PEKAN
    // penuh — "laporan mingguan 17 agustus" berarti pekan yang memuat 17
    // Agustus, bukan tanggal 17 saja (DECISIONS 358).
    const pekan = pekanDari(periode, hariIniKey);
    const d = await dataMingguan(sasaran, pekan.mulai, pekan.akhir);
    balasan = balasMingguan(
      { periode: pekan.label, baris: d.baris },
      { ...opts, catatanBatas: d.catatanBatas, catatanPeriode: pekan.catatan },
    );
    tabel = tabelMingguan(
      { judul: "Laporan mingguan", periode: pekan.label, baris: d.baris },
      peta,
      optTabel({ catatanBatas: d.catatanBatas, catatanPeriode: pekan.catatan }),
    );
  } else if (niat.niat === "laporan_bulanan") {
    /*
     * Rekap BULANAN memakai pengambil data dan perakit balasan yang SAMA
     * dengan mingguan — `dataMingguan` menerima rentang apa pun, dan tidak ada
     * satu pun rumus baru di sini (audit 2026-08-28). Yang berbeda hanya batas
     * tanggalnya, dan itu memang satu-satunya yang boleh berbeda: dua rekap
     * dengan aturan hitung berlainan akan menyebut dua angka untuk hal yang
     * sama, dan pembacanya tidak punya cara menebak mana yang benar.
     */
    const bulan = bulanDari(periode, hariIniKey);
    const d = await dataMingguan(sasaran, bulan.mulai, bulan.akhir);
    balasan = balasMingguan(
      // Judul & sebutan DISEBUT: perakitnya sama dengan mingguan, dan yang
      // dipatok "mingguan" akan membuat chat berbunyi "Laporan mingguan"
      // sementara PDF lampirannya berjudul "Laporan bulanan".
      { periode: bulan.label, baris: d.baris, judul: "Laporan bulanan", sebutan: "sepanjang bulan" },
      { ...opts, catatanBatas: d.catatanBatas, catatanPeriode: bulan.catatan },
    );
    tabel = tabelMingguan(
      { judul: "Laporan bulanan", periode: bulan.label, baris: d.baris },
      peta,
      optTabel({ catatanBatas: d.catatanBatas, catatanPeriode: bulan.catatan }),
    );
  } else if (niat.niat === "rencana") {
    /*
     * Satu-satunya niat yang menghadap KE DEPAN (DECISIONS 458), jadi ia TIDAK
     * memakai `periode` sama sekali: seluruh modul tanggal dibangun menghadap
     * ke belakang dan dengan sengaja menolak tanggal depan. Yang dipakai
     * penanda "ke depan" dari teks aslinya, dan datanya bernomor PEKAN
     * (`WeeklyPlan`), bukan bertanggal laporan.
     */
    const d = await dataRencana(sasaran, pekanDepan);
    balasan = balasRencana(
      { pekanDepan, baris: d.baris },
      { ...opts, catatanBatas: d.catatanBatas },
    );
  } else if (niat.niat === "laporan") {
    const d = await dataLaporan(sasaran, dateKey);
    /*
     * Judulnya TANGGAL yang benar-benar ditampilkan, bukan label periodenya
     * (DECISIONS 358).
     *
     * Keluhan user 2026-08-18: kotak berjudul "Laporan harian — minggu lalu"
     * yang isinya SATU hari. Ini laporan harian: ia selalu satu tanggal. Kalau
     * penanya menyebut rentang, yang jujur adalah menyebut hari mana yang
     * diambil, bukan meminjam label rentang yang tidak dijawab.
     */
    const rentangDiminta = !periode.satuHari;
    const tglLaporan = formatTanggal(parseDateKey(dateKey) ?? jakartaToday(), "d MMMM yyyy");
    const catatanPeriodeLaporan = rentangDiminta
      ? `Laporan harian selalu satu tanggal. Anda menyebut ${periode.label}, jadi saya ambil hari terakhirnya. Untuk rekap sepekan, tanya "laporan mingguan".`
      : periode.catatan;
    balasan = balasLaporan(
      { tanggal: tglLaporan, baris: d.baris },
      { ...opts, catatanBatas: d.catatanBatas, catatanPeriode: catatanPeriodeLaporan },
    );
    tabel = tabelLaporan(
      { judul: "Laporan harian", tanggal: tglLaporan, baris: d.baris },
      peta,
      optTabel({ catatanBatas: d.catatanBatas, catatanPeriode: catatanPeriodeLaporan }),
    );
  } else if (
    niat.niat === "kendala" ||
    niat.niat === "kendala_dibuka" ||
    niat.niat === "kendala_periode_terbuka"
  ) {
    /*
     * TIGA cara membaca "kendala", dan penanya yang memilih (DECISIONS 381).
     *
     * Dua yang bertumpu periode memakai `Issue.createdAt` — kapan kendalanya
     * DIBUKA — plus status terkini. Keduanya bisa dijawab tanpa riwayat status,
     * yang memang belum dicatat. Yang tetap TIDAK bisa dijawab: "kendala apa
     * yang berstatus terbuka PADA hari X"; tidak satu pun cabang di sini
     * berpura-pura bisa.
     */
    const saring: SaringKendala =
      niat.niat === "kendala_dibuka"
        ? "dibuka_periode"
        : niat.niat === "kendala_periode_terbuka"
          ? "dibuka_periode_masih_terbuka"
          : "terbuka_sekarang";
    const rentang =
      saring === "terbuka_sekarang"
        ? undefined
        : {
            mulai: parseDateKey(periode.mulai) ?? jakartaToday(),
            akhir: parseDateKey(periode.akhir) ?? jakartaToday(),
          };
    const d = await dataKendala(sasaran, sekarang, saring, rentang);

    const judul =
      saring === "dibuka_periode"
        ? "Kendala yang dibuka"
        : saring === "dibuka_periode_masih_terbuka"
          ? "Kendala yang dibuka & masih terbuka"
          : "Kendala belum selesai";
    /*
     * Catatan lama ("ini keadaan sekarang, bukan pada periode itu") hanya
     * dipakai untuk cabang `terbuka_sekarang`. Untuk dua cabang periode ia
     * berubah dari pengakuan jujur menjadi keterangan yang SALAH — dan
     * keterangan salah yang terdengar berhati-hati lebih merusak daripada
     * tidak ada keterangan sama sekali.
     */
    const catatanPeriodeKendala =
      saring !== "terbuka_sekarang"
        ? periode.catatan
        : periode.satuHari && dateKey === hariIniKey
          ? periode.catatan
          : `Daftar kendala ini yang masih TERBUKA sekarang, bukan keadaan pada ${periode.label}.`;
    balasan = balasKendala(
      { tanggal, baris: d.baris, lokasiDiperiksa: d.lokasiDiperiksa, judul },
      { ...opts, catatanBatas: d.catatanBatas, catatanPeriode: catatanPeriodeKendala },
    );
    tabel = tabelKendala(
      { judul, tanggal, baris: d.baris },
      peta,
      optTabel({ catatanBatas: d.catatanBatas, catatanPeriode: catatanPeriodeKendala }),
    );
  } else if (niat.niat === "progress") {
    const d = await dataProgress(sasaran, dateKey, niat.urutan ?? null, niat.batas ?? null);
    balasan = balasProgress(
      { tanggal, baris: d.baris, urutan: niat.urutan ?? null, batas: niat.batas ?? null },
      { ...opts, catatanBatas: d.catatanBatas },
    );
    tabel = tabelProgress(
      { judul: judulProgress(niat.urutan ?? null, niat.batas ?? null), tanggal, baris: d.baris },
      peta,
      // Diminta "terbaik/terburuk dulu" → itu PERINGKAT; urutannya tidak boleh
      // ditimpa pengelompokan perusahaan, karena judulnya sudah menjanjikannya.
      optTabel({ catatanBatas: d.catatanBatas, peringkat: niat.urutan != null }),
    );
  } else if (niat.niat === "deviasi") {
    const d = await dataDeviasi(sasaran, dateKey);
    balasan = balasDeviasi(
      { tanggal, negatif: d.negatif, diperiksa: d.diperiksa },
      {
        ...opts,
        catatanBatas: d.catatanBatas,
        /*
         * Catatan "deviasi ini posisi HARI INI" DIHAPUS, bukan dilunakkan.
         *
         * Ia dulu benar: angkanya memang posisi hari ini, apa pun periode yang
         * ditanya. Sekarang `dataDeviasi` menerima `dateKey` dan meneruskannya
         * sebagai `asOf`, jadi kalimat itu berubah dari pengakuan jujur menjadi
         * keterangan yang salah — dan keterangan salah yang terdengar
         * berhati-hati lebih merusak daripada tidak ada keterangan sama sekali.
         */
        catatanPeriode: periode.catatan,
      },
    );
    tabel = tabelDeviasi(
      {
        // Judul yang SAMA dengan balasan teksnya — dokumen dan gelembung
        // WhatsApp tidak boleh menyebut dirinya dengan dua nama berbeda.
        judul: `Deviasi negatif – ${d.negatif.length} dari ${d.diperiksa} lokasi`,
        tanggal,
        baris: d.negatif,
      },
      peta,
      optTabel({ catatanBatas: d.catatanBatas, catatanPeriode: periode.catatan, peringkat: true }),
    );
  } else if (niat.niat === "kronologi") {
    /*
     * KRONOLOGI menuntut TEPAT SATU lokasi (permintaan user 2026-08-31).
     *
     * Bukan pembatasan teknis: kronologi lintas lokasi bukan cerita, ia
     * tumpukan. Kalau lokasinya tidak tunggal, MARLIN menyebutkan pilihannya
     * dan berhenti — menebak satu di antaranya berarti menceritakan riwayat
     * tempat yang tidak ditanyakan, dengan sangat meyakinkan.
     */
    const satu = resolusi.cocok.length === 1 ? resolusi.cocok[0]! : null;
    if (!satu) {
      balasan = balasKronologiTanpaLokasi(
        sasaran.slice(0, 12).map((l) => l.nama),
        sasaran.length,
      );
    } else {
      const { ambilKronologi } = await import("@/lib/kronologi/queries");
      /*
       * Batas 25 peristiwa untuk WhatsApp, bukan 60 seperti bawaannya:
       * pemotong pesan memuat 8 × 1.400 aksara, dan kronologi yang menghabiskan
       * kuota itu sendirian menutup jawaban lain yang menyusul di belakangnya.
       * Yang tidak muat DISEBUT jumlahnya, tidak dihilangkan diam-diam.
       */
      const k = await ambilKronologi(satu.id, { sampai: dateKey, hari: 90, batas: 25 });
      balasan = k
        ? balasKronologi(
            {
              lokasi: k.lokasi.nama,
              wilayah: k.lokasi.wilayah,
              sampai: k.sampai,
              hari: 90,
              peristiwa: k.peristiwa,
              kondisi: k.kondisi,
              dipotong: k.dipotong,
            },
            opts,
          )
        : `Lokasi ${satu.nama} tidak saya temukan lagi saat menyusun kronologinya.`;
    }
  } else {
    const d = await dataKelengkapan(penyaring, sasaran.map((l) => l.id), dateKey);
    balasan = balasKelengkapan(
      { tanggal, perlu: d.perlu, total: d.total },
      { ...opts, catatanBatas: d.catatanBatas },
    );
    tabel = tabelKelengkapan(
      {
        judul: `Kelengkapan laporan – ${d.total - d.perlu.length} dari ${d.total} beres`,
        tanggal,
        baris: d.perlu,
      },
      peta,
      optTabel({ catatanBatas: d.catatanBatas }),
    );
  }

  /*
   * Menyebut BENTUK dokumen berarti meminta BERKASNYA.
   *
   * "laporan harian versi kkp danasari" bisa jatuh ke niat `laporan` (isi
   * laporan, dijawab sebagai teks) alih-alih `produksi` — pembedanya kata
   * kerja, dan tidak semua orang menulisnya. Padahal menyebut nama sebuah
   * BENTUK BERKAS adalah permintaan berkas: tidak ada arti lain dari "versi
   * kkp" selain dokumennya.
   *
   * Teksnya tidak diganti — jawabannya tetap terbaca di chat; berkasnya
   * MENAMBAH, tidak menggantikan.
   */
  if (!berkasHarian && niat.niat === "laporan" && periode.satuHari) {
    const bentuk = bacaBentukDokumen(teks);
    const satu = resolusi.cocok.length === 1 ? resolusi.cocok[0] : null;
    if (bentuk && satu) berkasHarian = { lokasi: satu, dateKey, bentuk };
  }

  /*
   * Penanda lingkup ditaruh DI DEPAN balasan, bukan di kakinya (brief 5A).
   *
   * Ia menjawab "kenapa data ini muncul di grup yang tidak tertaut paket apa
   * pun", dan pertanyaan itu harus terjawab SEBELUM angkanya terbaca — bukan
   * sesudah, di antara catatan-catatan kecil yang sering dilewati.
   *
   * Belum ada penekan pengulangan: brief meminta penanda ini tidak diulang
   * pada setiap balasan dalam satu konteks aktif, dan itu butuh konteks
   * per-chat yang durable — dibangun di Fase D. Sampai itu ada, penanda muncul
   * setiap kali. Mengulang keterangan yang benar jauh lebih ringan daripada
   * menghilangkannya lewat tebakan "sudah pernah dikirim".
   */
  /*
   * Dikirim BERTAHAP bila panjang (DECISIONS 390).
   *
   * Semua balasan berdata melewati satu titik ini, jadi pemotongannya cukup
   * dipasang sekali — bukan di tujuh perakit balasan yang masing-masing bisa
   * lupa.
   *
   * Berurutan (`for await`), bukan `Promise.all`: WhatsApp tidak menjamin
   * urutan tiba untuk kiriman yang berangkat bersamaan, dan "bagian 2/3" yang
   * mendarat sebelum "bagian 1/3" lebih membingungkan daripada satu pesan
   * panjang.
   */
  /*
   * Tafsir ditulis HANYA bila niatnya dibaca AI (`jalur === "ai"`).
   *
   * Jalur deterministik tidak perlu: ia cocok kata demi kata, dan yang tidak
   * yakin sudah ditawari pilihan lebih dulu. Jalur klarifikasi malah sudah
   * MEMINTA penanya memilih sendiri. Menempelkan baris ini di ketiganya cuma
   * menambah kalimat yang selalu benar dan karena itu berhenti dibaca —
   * padahal justru di jalur AI ia harus tetap dibaca (audit 2026-08-28).
   */
  const tafsir = jalur === "ai" ? barisTafsir(niat.niat) : null;
  const utuh = [tafsir, keputusan.penandaLingkup, balasan].filter(Boolean).join("\n\n");
  const { bagian } = potongPesan(utuh);

  /*
   * DAFTAR PANJANG DIKIRIM SEBAGAI PDF, bukan lima gelembung (DECISIONS 448).
   *
   * Permintaan user 2026-08-26: *"kalau dalam data yang banyak begitu, misal
   * kendala hari ini, alih-alih ngasih chat panjang lebar, wa merespon dengan
   * format pdf rapi"*. Isinya SAMA PERSIS dengan balasan teks — baris yang
   * sama, angka yang diformat fungsi yang sama — hanya wadahnya berbeda.
   *
   * Keterangan berkas tetap memuat kepala jawaban dan seluruh catatan
   * "jawaban ini sebagian", supaya pengakuan itu terbaca tanpa membuka
   * lampiran. Berkas justru LEBIH mudah diteruskan daripada gelembung teks,
   * jadi catatan itu tidak boleh hanya ada di dalamnya.
   *
   * Kalau pembuatan atau pengiriman berkasnya gagal, jawabannya TETAP
   * berangkat sebagai teks. Balasan panjang jauh lebih baik daripada tidak ada
   * balasan sama sekali — dan kegagalannya tercatat, tidak ditelan.
   */
  /*
   * BLANKO HARIAN dikirim sebagai berkas (DECISIONS 469).
   *
   * Ditaruh SEBELUM jalur PDF tabel dan tidak mematikan pengiriman teks:
   * teksnya menyebut lokasi dan tanggal, jadi berguna sendiri walau berkasnya
   * gagal dibentuk. Kegagalan dicatat, tidak ditelan — dan penanya diberi tahu,
   * karena "tidak ada berkas" tanpa sepatah kata terbaca sebagai "tidak ada
   * laporannya".
   */
  if (berkasHarian) {
    try {
      const { db } = await import("@/lib/db");
      const lok = await db.location.findUnique({
        where: { id: berkasHarian.lokasi.id },
        select: { slug: true },
      });
      const kkp = berkasHarian.bentuk === "kkp";
      const render = kkp
        ? (await import("@/lib/pdf/harian-kkp")).renderHarianKkpPdf
        : (await import("@/lib/pdf/harian-ringkas")).renderHarianRingkasPdf;
      const hasil = lok ? await render(lok.slug, berkasHarian.dateKey) : null;
      const namaDokumen = kkp ? "Blanko harian KKP" : "Ringkasan pelaksanaan harian";
      if (!hasil) {
        await balasWa(
          m.chatId,
          `Tidak ada laporan harian ${berkasHarian.lokasi.nama} untuk ${berkasHarian.dateKey}, jadi tidak ada berkas yang bisa saya kirim.`,
        );
      } else {
        await balasFileWa(
          m.chatId,
          {
            mimetype: "application/pdf",
            // Nama berkasnya ikut membedakan: dua dokumen harian yang bernama
            // sama di daftar berkas WhatsApp tidak bisa dibedakan lagi setelah
            // diteruskan.
            filename: `laporan-harian-${kkp ? "kkp-" : ""}${lok!.slug}-${berkasHarian.dateKey}.pdf`,
            data: hasil.buffer.toString("base64"),
          },
          `${namaDokumen} ${berkasHarian.lokasi.nama} – ${berkasHarian.dateKey}`,
        );
        await audit(user?.id ?? null, "waha.tanya.blanko_harian", "wa_message", m.waMessageId, {
          chatId: m.chatId,
          lokasi: berkasHarian.lokasi.nama,
          tanggal: berkasHarian.dateKey,
          bentuk: berkasHarian.bentuk,
        });
      }
    } catch (err) {
      console.error("[waha/tanya] gagal mengirim blanko harian:", err);
      await balasWa(
        m.chatId,
        "Berkasnya gagal saya bentuk. Angkanya tetap bisa ditanyakan di chat ini, atau buka MARLIN langsung.",
      );
    }
  }

  let lewatPdf = false;
  if (tabel && perluPdf(bagian.length, tabel.jumlahIsi)) {
    try {
      const { buildTabelWaPdf } = await import("@/lib/pdf/wa-tabel");
      const pdf = await buildTabelWaPdf(tabel, { untuk: user?.fullName ?? null });
      await balasFileWa(
        m.chatId,
        {
          mimetype: "application/pdf",
          filename: namaBerkasTabel(tabel, dateKey),
          data: pdf.toString("base64"),
        },
        keteranganBerkas(tabel),
      );
      lewatPdf = true;
      await audit(user?.id ?? null, "waha.tanya.pdf", "wa_message", m.waMessageId, {
        chatId: m.chatId,
        niat: niat.niat,
        baris: tabel.baris.length,
      });
    } catch (err) {
      console.error("[waha/tanya] gagal mengirim jawaban sebagai PDF:", err);
    }
  }

  if (!lewatPdf) {
    for (const b of bagian) {
      await balasWa(m.chatId, b);
    }
  }

  /*
   * Pertanyaan "KENAPA" mendapat SEBABNYA, bukan cuma angkanya (DECISIONS 390).
   *
   * Keberatan user 2026-08-20: *"kenapa randuputih tertinggal, malah cuma
   * jawab progress"*. Balasannya benar – deviasi −30,93% – tapi menjawab
   * "berapa", bukan "kenapa". Angkanya justru sudah diketahui penanya; itulah
   * sebabnya ia bertanya.
   *
   * Yang ditambahkan BUKAN karangan model: kutipan catatan pelapor apa adanya,
   * lewat jalur yang sama dengan DECISIONS 383, lengkap dengan penandanya
   * ("kutipan pelapor, bukan angka resmi MARLIN"). Angka resmi tetap di depan
   * dan tidak tersentuh — pertanyaan "kenapa" tidak boleh menjadi celah bagi
   * angka yang tidak lewat calculation layer.
   *
   * Dikirim sebagai pesan TERPISAH supaya batas antara "angka MARLIN" dan
   * "kata pelapor" terlihat, bukan menyatu dalam satu gelembung.
   */
  if (mintaSebab(teks) && niat.niat !== "bantuan") {
    const catatan = await cariNarasiAman({
      locationIds: sasaran.map((l) => l.id),
      pertanyaan: teks,
      batas: 3,
    });
    if (catatan.length > 0) {
      const teksSebab = balasNarasi(
        {
          pertanyaan: teks,
          baris: catatan.map((p) => ({
            lokasi: p.namaLokasi,
            jenis: LABEL_JENIS[p.jenis],
            tanggal: p.tanggal,
            teks: p.teks,
          })),
        },
        {},
      );
      for (const b of potongPesan(teksSebab).bagian) {
        await balasWa(m.chatId, b);
      }
      await audit(user?.id ?? null, "waha.tanya.sebab", "wa_message", m.waMessageId, {
        chatId: m.chatId,
        niat: niat.niat,
        potongan: catatan.length,
      });
    }
  }

  /*
   * Pertanyaan ini menjadi KONTEKS untuk susulan berikutnya (DECISIONS 377).
   *
   * Disimpan SESUDAH balasannya berangkat, bukan sebelum: konteks yang
   * tersimpan padahal jawabannya gagal terkirim akan membuat "kalau kemarin?"
   * menyambung ke percakapan yang — dari sisi penanya — tidak pernah terjadi.
   *
   * Yang disimpan nama lokasi APA ADANYA seperti ia ketik, bukan id hasil
   * resolusi. Nama harus dicocokkan ulang terhadap katalog yang berlaku saat
   * susulan datang; menyimpan id akan mengawetkan izin lama.
   */
  await simpanKonteks(m, niat.niat, niat.lokasiDisebut, new Date(), { question: teks, answer: utuh });

  await audit(user?.id ?? null, "waha.tanya", "wa_message", m.waMessageId, {
    chatId: m.chatId,
    grup,
    // Penanya tak terdaftar dicatat apa adanya — bukan diisi pengguna karangan.
    penanyaTerdaftar: !!user,
    niat: niat.niat,
    // Jalur mana yang membaca pertanyaannya — inilah yang membuktikan
    // penghematan AI benar-benar terjadi, bukan sekadar diklaim.
    jalur,
    lokasiDisebut: niat.lokasiDisebut,
    lokasiDijawab: sasaran.length,
    dipotongKeGrup: keputusan.catatanPemotongan !== null,
    // Jejak keputusan resolver — brief 5A menuntut audit menyebut asal scope.
    asalScope: keputusan.asalScope,
    peranDipakai: keputusan.peranDipakai,
    scopeIds: lokasiIds ? lokasiIds.length : null,
  });
  return { dijawab: true, alasan: `dijawab (${niat.niat}, ${jalur})` };
}

/**
 * Catat pemakaian AI ke `ai_runs` — itulah yang dihitung guard sebagai kuota.
 *
 * Tanpa baris ini, tanya-jawab WhatsApp memakai provider tanpa pernah menambah
 * hitungan kuota: satu grup ramai bisa menghabiskan anggaran AI sepanjang hari
 * dan panel AI Hub tetap melaporkan nol pemakaian.
 */
async function catatRun(
  pemakai: PemakaiAi,
  katalog: LokasiKatalog[],
  hasil: Awaited<ReturnType<typeof aiStructured<unknown>>>,
  latencyMs: number,
  detail?: {
    promptVersion?: string;
    startKey?: string;
    endKey?: string;
    outputJson?: unknown;
    sourcesJson?: SourceRef[];
  },
): Promise<void> {
  try {
    const hariIni = jakartaToday();
    const usage = hasil.meta && hasil.meta.ok ? hasil.meta.usage : null;
    // Penanya grup tak terdaftar: userId null + chatId-nya (DECISIONS 351).
    // Kolom `orgId` yang membuat pemakaian ini tetap terhitung kuota harian
    // organisasi — dulu kuota itu diturunkan dari daftar id pengguna.
    const grup = "jenis" in pemakai ? pemakai : null;
    await db.aiRun.create({
      data: {
        userId: "jenis" in pemakai ? null : pemakai.id,
        orgId: pemakai.orgId,
        waChatId: grup?.chatId ?? null,
        runKind: "tanya",
        status: hasil.ok ? "siap" : "gagal",
        scopeType: "all",
        scopeIds: katalog.map((l) => l.id),
        periodStart: detail?.startKey ? new Date(`${detail.startKey}T00:00:00.000Z`) : hariIni,
        periodEnd: detail?.endKey ? new Date(`${detail.endKey}T00:00:00.000Z`) : hariIni,
        provider: hasil.meta?.provider ?? null,
        model: hasil.meta?.model ?? null,
        promptVersion: detail?.promptVersion ?? "waha-tanya-2",
        outputJson: detail?.outputJson ? JSON.parse(JSON.stringify(detail.outputJson)) : undefined,
        sourcesJson: detail?.sourcesJson ? JSON.parse(JSON.stringify(detail.sourcesJson)) : undefined,
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
