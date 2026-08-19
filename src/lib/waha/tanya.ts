import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { jakartaDateKey, jakartaToday, formatTanggal, parseDateKey } from "@/lib/format";
import type { SessionUser } from "@/lib/auth/session";
import { accessibleLocationIds } from "@/lib/auth/session";
import { aiStructured } from "@/lib/ai/structured";
import {
  AiGuardError,
  checkAiGuard,
  estimateCostUsd,
  getAiPricing,
  type PemakaiAi,
} from "@/lib/ai-hub/guard";
import { getIdentitasMarlin, sendText } from "./client";
import { medanJidPayload, parseWaEvent, type ParsedWaMessage } from "./ingest-parse";
import { kanonikGrupId } from "./grup-id";
import { bersihkanMention, cocokkanNomorPengguna, diajakBicara } from "./tanya-izin";
import { putuskanLayanan } from "./resolver-kanal";
import {
  PETUNJUK_SKEMA,
  SISTEM_PROMPT,
  resolusiLokasi,
  skemaNiat,
  type LokasiKatalog,
} from "./tanya-niat";
import {
  balasAmbigu,
  balasBantuan,
  balasDeviasi,
  balasDitolak,
  balasKelengkapan,
  balasKendala,
  balasLaporan,
  balasMingguan,
  balasProgress,
  balasTidakMengerti,
  type OpsiKaki,
} from "./tanya-format";
import {
  dataDeviasi,
  dataKelengkapan,
  dataKendala,
  dataLaporan,
  dataMingguan,
  dataProgress,
  katalogLokasi,
} from "./tanya-data";
import { bacaPeriode, pekanDari } from "./tanya-tanggal";

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
    const petunjuk = senderLid && !fromNumber
      ? ` — chat ber-@lid, isi kolom "ID WhatsApp (@lid)" pengguna dengan ${senderLid}`
      : "";
    return { user: null, alasan: `nomor ${siapa} tidak cocok dengan pengguna mana pun${petunjuk}` };
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
    return DIAM(`grup tanpa mention ke MARLIN — ${rinci}`);
  }

  const teks = bersihkanMention(m.body).slice(0, BATAS_TANYA);

  // (3) Siapa penanyanya — nomor, bukan nama tampilan.
  const { user, alasan: alasanNomor0 } = await cariPengguna(m.fromNumber, m.senderLid);
  /*
   * Pengirim ber-@lid yang TIDAK ketemu: catat medan JID apa saja yang benar-
   * benar ada di payload (DECISIONS 347). Tanpa ini, menutup celahnya berarti
   * menebak nama medan satu per satu lewat rilis WAHA — satu tebakan per hari,
   * karena satu-satunya cara mengujinya adalah menunggu pesan asli berikutnya.
   * Isi pesan TIDAK ikut tercatat; hanya nama medan + nilai berbentuk JID.
   */
  const alasanNomor =
    !user && m.senderLid && !m.fromNumber
      ? `${alasanNomor0} · medan payload: ${medanJidPayload(body).slice(0, 300) || "(tidak ada medan berbentuk JID)"}`
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
    await sendText(m.chatId, balasDitolak(keputusan.pesan));
    await audit(user?.id ?? null, "waha.tanya.tolak", "wa_message", m.waMessageId, {
      chatId: m.chatId,
      grup,
      alasan: keputusan.alasan,
    });
    return { dijawab: true, alasan: keputusan.alasan };
  }

  if (!teks) {
    await sendText(m.chatId, balasTidakMengerti());
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

  // (4) Guard AI — kill-switch & kuota, SEBELUM provider dipanggil. Untuk
  // penanya tak terdaftar, kuncinya CHAT-nya: satu grup ramai tidak boleh
  // menghabiskan anggaran AI sepanjang hari (DECISIONS 351).
  const pemakaiAi: PemakaiAi = user ?? { jenis: "grup", orgId: pkg!.orgId, chatId: m.chatId };
  try {
    await checkAiGuard(pemakaiAi, {
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
  await catatRun(pemakaiAi, katalog, hasil, Date.now() - mulai);

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
  if (resolusi.ambigu.length > 0 || resolusi.ambiguWilayah.length > 0) {
    await sendText(m.chatId, balasAmbigu(resolusi.ambigu, resolusi.ambiguWilayah));
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
  // Satu hari → tanggal itu. Rentang → ujung akhirnya, karena angka kumulatif
  // (progress/deviasi) selalu "posisi PADA suatu hari", bukan penjumlahan hari.
  const dateKey = periode.akhir;
  const tanggal = periode.label;
  opts.catatanPeriode = periode.catatan;
  let balasan: string;

  if (niat.niat === "bantuan") {
    balasan = balasBantuan();
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
    balasan = balasLaporan(
      { tanggal: formatTanggal(parseDateKey(dateKey) ?? jakartaToday(), "d MMMM yyyy"), baris: d.baris },
      {
        ...opts,
        catatanBatas: d.catatanBatas,
        catatanPeriode: rentangDiminta
          ? `Laporan harian selalu satu tanggal. Anda menyebut ${periode.label}, jadi saya ambil hari terakhirnya. Untuk rekap sepekan, tanya "laporan mingguan".`
          : periode.catatan,
      },
    );
  } else if (niat.niat === "kendala") {
    const d = await dataKendala(sasaran, sekarang);
    balasan = balasKendala(
      { tanggal, baris: d.baris, lokasiDiperiksa: d.lokasiDiperiksa },
      {
        ...opts,
        catatanBatas: d.catatanBatas,
        /*
         * Kendala yang didaftar adalah yang MASIH TERBUKA sekarang — sistem
         * tidak menyimpan riwayat "kendala apa yang terbuka pada hari X". Kalau
         * penanya menyebut hari lain, itu HARUS dikatakan; menjawab angka hari
         * ini di bawah judul "kemarin" adalah jawaban benar untuk hari yang
         * salah, dan penerimanya tidak punya cara mengetahuinya.
         */
        catatanPeriode: periode.satuHari && dateKey === hariIniKey
          ? periode.catatan
          : `Daftar kendala ini yang masih TERBUKA sekarang, bukan keadaan pada ${periode.label}.`,
      },
    );
  } else if (niat.niat === "progress") {
    const d = await dataProgress(sasaran, dateKey);
    balasan = balasProgress({ tanggal, baris: d.baris }, { ...opts, catatanBatas: d.catatanBatas });
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
  } else {
    const d = await dataKelengkapan(penyaring, sasaran.map((l) => l.id), dateKey);
    balasan = balasKelengkapan(
      { tanggal, perlu: d.perlu, total: d.total },
      { ...opts, catatanBatas: d.catatanBatas },
    );
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
  await sendText(
    m.chatId,
    keputusan.penandaLingkup ? `${keputusan.penandaLingkup}\n\n${balasan}` : balasan,
  );
  await audit(user?.id ?? null, "waha.tanya", "wa_message", m.waMessageId, {
    chatId: m.chatId,
    grup,
    // Penanya tak terdaftar dicatat apa adanya — bukan diisi pengguna karangan.
    penanyaTerdaftar: !!user,
    niat: niat.niat,
    lokasiDisebut: niat.lokasiDisebut,
    lokasiDijawab: sasaran.length,
    dipotongKeGrup: keputusan.catatanPemotongan !== null,
    // Jejak keputusan resolver — brief 5A menuntut audit menyebut asal scope.
    asalScope: keputusan.asalScope,
    peranDipakai: keputusan.peranDipakai,
    scopeIds: lokasiIds ? lokasiIds.length : null,
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
  pemakai: PemakaiAi,
  katalog: LokasiKatalog[],
  hasil: Awaited<ReturnType<typeof aiStructured<unknown>>>,
  latencyMs: number,
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
