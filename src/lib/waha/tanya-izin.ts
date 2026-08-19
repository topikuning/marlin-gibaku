import { normalizePhone } from "./sender-identity";

/**
 * SIAPA yang boleh bertanya, DI MANA, dan tentang APA (DECISIONS 338).
 *
 * MURNI — tanpa DB, tanpa AI — supaya seluruh keputusan izin bisa diuji
 * langsung. Ini bagian paling berbahaya dari tanya-jawab WhatsApp bebas, dan
 * satu kebocoran di sini bukan kesalahan tampilan: ia mengirim angka kontrak
 * orang lain ke telepon yang salah, lewat saluran yang di-screenshot dan
 * diteruskan.
 *
 * ### Tiga pertanyaan yang HARUS dijawab terpisah
 *
 * 1. **Apakah MARLIN diajak bicara?** Di chat pribadi: selalu. Di grup: hanya
 *    kalau di-mention (keputusan user 2026-08-17).
 * 2. **Siapa penanyanya?** Nomor WhatsApp BUKAN sesi login. Hanya nomor yang
 *    cocok dengan pengguna MARLIN aktif yang dilayani. Nama tampilan WhatsApp
 *    TIDAK PERNAH dipakai — siapa pun bisa mengubahnya jadi "Hery".
 * 3. **Apa yang boleh dibocorkan di sana?** Ini pertanyaan TERPISAH dari (1).
 *    Mention menjawab "kapan membalas", bukan "apa yang boleh disebut".
 *
 * ### Kenapa (3) tidak selesai oleh mention
 *
 * Kalau seseorang bertanya *"mana yang deviasinya negatif"* di grup Paket A,
 * jawaban jujurnya menyebut Paket B dan C — dan SELURUH anggota grup Paket A
 * ikut membacanya, termasuk vendor paket itu. Mention tidak mengubah apa pun
 * soal itu. Karena itu di grup, jawaban dipotong ke lokasi paket grup tersebut,
 * dan bila pertanyaannya lintas paket, penanya diarahkan ke chat pribadi.
 *
 * Pemotongan itu SELALU DISEBUTKAN — "hanya untuk paket ini" — supaya jawaban
 * sebagian tidak terbaca sebagai jawaban lengkap.
 */

/** Konteks tempat pesan datang. */
export type AsalPesan = {
  /** true = grup, false = chat pribadi. */
  grup: boolean;
  /** JID pengirim. */
  senderJid: string | null;
  fromNumber: string | null;
  /** JID yang di-mention pada pesan itu. */
  mentionedJids: string[];
  /** JID pemilik pesan yang DIBALAS (quote), bila pesan ini balasan. */
  balasanKepada?: string | null;
  /** Isi pesan apa adanya. */
  body: string;
};

/** Identitas MARLIN sendiri di WhatsApp. */
export type IdentitasMarlin = {
  /** Nomor sesi WAHA, mis. "6281234567890". null = belum diketahui. */
  nomor: string | null;
  /** Identitas privasi sesi (`…@lid`) — DECISIONS 349. null = belum diketahui. */
  lid?: string | null;
};

/**
 * Apakah MARLIN diajak bicara?
 *
 * Di grup, penyebutan dibaca dari **daftar JID**, bukan dari teks "@marlin" di
 * badan pesan: nama tampilan bisa diubah siapa saja, JID tidak. Kalau identitas
 * MARLIN belum diketahui sama sekali, grup TIDAK dilayani — lebih baik diam
 * daripada membalas setiap pesan grup.
 *
 * ### Kenapa LID ikut dicocokkan (DECISIONS 349)
 *
 * Laporan user 2026-08-17 dengan tangkapan layar: pesan grup yang JELAS
 * me-mention MARLIN tercatat *"diam — grup tanpa mention ke MARLIN"*.
 *
 * Sejak WhatsApp memakai identitas privasi, yang masuk ke daftar mention adalah
 * `…@lid` MARLIN, bukan JID bernomornya. Mencocokkan lewat nomor saja berarti
 * membandingkan LID dengan nomor telepon — tidak akan pernah sama, sehingga
 * SETIAP mention terbaca "tidak ada mention" dan seluruh fitur tanya-jawab grup
 * mati diam-diam. Ini cacat yang sama dengan DECISIONS 347, satu lapis di atas.
 *
 * LID dibandingkan dengan LID, nomor dengan nomor — TIDAK pernah bersilang.
 *
 * ### Kenapa MEMBALAS pesan MARLIN juga dihitung
 *
 * Membalas (quote) pesan MARLIN adalah cara orang benar-benar meneruskan
 * percakapan, dan WhatsApp tidak selalu menyertakan mention di situ. Yang
 * dihitung hanya balasan ke pesan MILIK KITA, jadi ia tidak melebarkan siapa
 * pun yang boleh memicu jawaban.
 */
export function diajakBicara(asal: AsalPesan, marlin: IdentitasMarlin): boolean {
  if (!asal.grup) return true;
  const nomorKita = normalizePhone(marlin.nomor);
  const lidKita = samakanLid(marlin.lid);
  if (!nomorKita && !lidKita) return false;

  const menyebutKita = (jid: string | null | undefined): boolean => {
    if (!jid) return false;
    const t = jid.trim();
    if (/@lid$/i.test(t)) return !!lidKita && samakanLid(t) === lidKita;
    return !!nomorKita && normalizePhone(t.replace(/@.*$/, "")) === nomorKita;
  };

  if (asal.mentionedJids.some(menyebutKita)) return true;
  return menyebutKita(asal.balasanKepada);
}

/** Buang penyebutan "@62812…" dari badan pesan supaya tidak mengotori niat. */
export function bersihkanMention(body: string): string {
  return body
    .replace(/@\d{6,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Lingkup jawaban — PINDAH ke resolver-kanal.ts (DECISIONS 371)        */
/* ------------------------------------------------------------------ */

/*
 * `lingkupJawaban()` dan `KonteksLingkup` DIHAPUS dari sini, tidak sekadar
 * berhenti dipakai.
 *
 * Aturannya sekarang tinggal di `putuskanLayanan()` (resolver-kanal.ts)
 * bersama keputusan kanal dan identitas. Membiarkan fungsi lama tetap ada
 * "untuk jaga-jaga" persis melahirkan cacat yang brief 2026-08-19 minta
 * ditutup: dua tempat yang saling menutupi, sehingga melanggar aturan di satu
 * tempat tidak membuat satu uji pun merah.
 *
 * `niatLintasLokasi()` tetap di sini — ia soal ISI pertanyaan (menyebut lokasi
 * atau tidak), bukan soal siapa boleh dijawab di mana.
 */

/**
 * Apakah niat ini bersifat LINTAS lokasi (tanpa lokasi disebut)?
 *
 * Dipakai memutuskan apakah perlu mengingatkan bahwa jawabannya dipotong.
 * Pertanyaan yang menyebut lokasi tertentu tidak perlu peringatan itu.
 */
export function niatLintasLokasi(lokasiDiminta: string[] | null): boolean {
  return lokasiDiminta === null || lokasiDiminta.length === 0;
}

/* ------------------------------------------------------------------ */
/* Mencocokkan nomor pengirim ke pengguna MARLIN                       */
/* ------------------------------------------------------------------ */

export type CalonPengguna = {
  id: string;
  waNumber: string | null;
  phone: string | null;
  /** Identitas privasi WhatsApp (`…@lid`) yang dipetakan admin (DECISIONS 347). */
  waLid?: string | null;
};

export type HasilCocokNomor =
  | { jenis: "tepat"; id: string }
  | { jenis: "tidak_ada" }
  /** Lebih dari satu pengguna aktif memakai nomor yang sama. */
  | { jenis: "ganda"; ids: string[] };

/**
 * Cocokkan nomor pengirim ke pengguna — lewat NORMALISASI, bukan pencocokan
 * teks (DECISIONS 345).
 *
 * ### Cacat yang diperbaiki
 *
 * Versi pertama merakit tiga varian teks (`62…`, `+62…`, `0…`) lalu mencarinya
 * dengan `IN`. Itu tidak pernah cocok, karena `waNumber` disimpan
 * `normalizeWaTarget` sebagai **`6281234567890@c.us`** — LENGKAP DENGAN
 * SUFIKS. Kolom `phone` lebih longgar lagi: tak ada normalisasi sama sekali,
 * jadi isinya bisa "0812-3456-7890" atau "+62 812 3456 7890".
 *
 * Akibatnya SELURUH pengguna tidak dikenali, dan chat pribadi dari nomor tak
 * dikenal memang sengaja DIDIAMKAN — jadi gejalanya "tidak ada respon sama
 * sekali", tanpa satu pun galat. Laporan user 2026-08-17.
 *
 * Pelajarannya: nomor telepon TIDAK PERNAH boleh dibandingkan sebagai teks.
 * Satu-satunya perbandingan yang benar adalah antar-bentuk ternormalisasi.
 *
 * ### Kenapa dua pengguna dengan nomor sama TIDAK dijawab
 *
 * Menjawab berarti memilih lingkup lokasi salah satunya. Kalau keduanya orang
 * yang berbeda, jawabannya benar untuk orang yang salah — dan penerimanya tidak
 * punya cara mengetahuinya. Prinsip yang sama dengan nama lokasi ambigu: jangan
 * menebak, dan sebutkan keadaannya di log supaya datanya bisa dibetulkan.
 */
export function cocokkanNomorPengguna(
  daftar: CalonPengguna[],
  nomorPengirim: string | null,
  /**
   * JID `…@lid` pengirim, bila chat-nya memakai identitas privasi WhatsApp.
   * Dicoba SESUDAH nomor: nomor lebih dipercaya karena ia dinormalkan, sedangkan
   * LID hanya sekuat pemetaan yang disetel admin.
   */
  lidPengirim?: string | null,
): HasilCocokNomor {
  const n = normalizePhone(nomorPengirim);
  if (n) {
    const cocok = daftar.filter(
      (u) => normalizePhone(u.waNumber) === n || normalizePhone(u.phone) === n,
    );
    if (cocok.length === 1) return { jenis: "tepat", id: cocok[0].id };
    if (cocok.length > 1) return { jenis: "ganda", ids: cocok.map((u) => u.id) };
  }
  const lid = samakanLid(lidPengirim);
  if (lid) {
    const cocok = daftar.filter((u) => samakanLid(u.waLid) === lid);
    if (cocok.length === 1) return { jenis: "tepat", id: cocok[0].id };
    if (cocok.length > 1) return { jenis: "ganda", ids: cocok.map((u) => u.id) };
  }
  return { jenis: "tidak_ada" };
}

/**
 * Samakan bentuk LID untuk dibandingkan: sufiks & spasi dibuang, huruf dikecilkan.
 *
 * Admin menyalinnya dari log hit, dan salinan manusia selalu datang dalam
 * berbagai bentuk — dengan atau tanpa `@lid`, kadang berspasi. Membandingkannya
 * apa adanya mengulang persis cacat nomor telepon di DECISIONS 345.
 */
function samakanLid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.trim().toLowerCase().replace(/@lid$/, "").replace(/[^0-9]/g, "");
  return d.length >= 6 ? d : null;
}
