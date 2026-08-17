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
  /** Isi pesan apa adanya. */
  body: string;
};

/** Identitas MARLIN sendiri di WhatsApp. */
export type IdentitasMarlin = {
  /** Nomor sesi WAHA, mis. "6281234567890". null = belum diketahui. */
  nomor: string | null;
};

/**
 * Apakah MARLIN diajak bicara?
 *
 * Di grup, penyebutan dibaca dari **daftar JID**, bukan dari teks "@marlin" di
 * badan pesan: nama tampilan bisa diubah siapa saja, JID tidak. Kalau nomor
 * MARLIN belum diketahui, grup TIDAK dilayani — lebih baik diam daripada
 * membalas setiap pesan grup.
 */
export function diajakBicara(asal: AsalPesan, marlin: IdentitasMarlin): boolean {
  if (!asal.grup) return true;
  const kita = normalizePhone(marlin.nomor);
  if (!kita) return false;
  return asal.mentionedJids.some((j) => normalizePhone(j.replace(/@.*$/, "")) === kita);
}

/** Buang penyebutan "@62812…" dari badan pesan supaya tidak mengotori niat. */
export function bersihkanMention(body: string): string {
  return body
    .replace(/@\d{6,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Lingkup jawaban                                                     */
/* ------------------------------------------------------------------ */

export type LingkupJawaban =
  | {
      boleh: true;
      /**
       * Lokasi yang boleh disebut. null = seluruh lingkup pengguna (chat
       * pribadi). Larik = dipotong ke paket grup.
       */
      lokasiIds: string[] | null;
      /** Disebutkan di balasan bila jawaban dipotong. null = tidak dipotong. */
      catatanPemotongan: string | null;
    }
  | { boleh: false; alasan: string };

export type KonteksLingkup = {
  grup: boolean;
  /** Lokasi yang boleh diakses PENANYA. null = lintas lokasi (mis. super admin). */
  lokasiPengguna: string[] | null;
  /**
   * Lokasi milik paket tempat grup ini tertaut. null = grup tidak tertaut paket
   * mana pun (mis. grup pribadi berisi beberapa orang).
   */
  lokasiGrup: string[] | null;
  /** Nama paket grup, untuk kalimat pemotongan. */
  namaPaketGrup: string | null;
};

/**
 * Tentukan lokasi mana yang boleh disebut dalam balasan.
 *
 * Aturannya berlapis dan tiap lapis bisa MEMPERSEMPIT, tidak pernah melebarkan:
 *
 *   lingkup akhir = lokasi pengguna ∩ (grup ? lokasi paket grup : semua)
 *
 * Grup yang tidak tertaut paket TIDAK dilayani sama sekali: tanpa tautan, tidak
 * ada dasar memutuskan apa yang pantas dibaca anggotanya.
 */
export function lingkupJawaban(k: KonteksLingkup): LingkupJawaban {
  if (!k.grup) {
    // Chat pribadi: seluruh lingkup penggunanya sendiri.
    return { boleh: true, lokasiIds: k.lokasiPengguna, catatanPemotongan: null };
  }

  if (k.lokasiGrup === null || k.lokasiGrup.length === 0) {
    return {
      boleh: false,
      alasan:
        "Grup ini belum tertaut paket mana pun, jadi saya tidak tahu data apa yang pantas dibagikan di sini. Silakan tanya lewat chat pribadi.",
    };
  }

  // Potong ke lokasi paket grup, lalu potong lagi ke izin penggunanya.
  const izin = k.lokasiPengguna;
  const irisan = izin === null ? k.lokasiGrup : k.lokasiGrup.filter((id) => izin.includes(id));

  if (irisan.length === 0) {
    return {
      boleh: false,
      alasan: "Anda tidak punya akses ke lokasi paket ini.",
    };
  }

  return {
    boleh: true,
    lokasiIds: irisan,
    // Pemotongan SELALU disebut: jawaban sebagian yang tidak mengaku sebagian
    // akan dibaca sebagai jawaban lengkap.
    catatanPemotongan: `Jawaban ini hanya mencakup ${k.namaPaketGrup ?? "paket grup ini"}. Untuk lintas paket, tanya saya lewat chat pribadi.`,
  };
}

/**
 * Apakah niat ini bersifat LINTAS lokasi (tanpa lokasi disebut)?
 *
 * Dipakai memutuskan apakah perlu mengingatkan bahwa jawabannya dipotong.
 * Pertanyaan yang menyebut lokasi tertentu tidak perlu peringatan itu.
 */
export function niatLintasLokasi(lokasiDiminta: string[] | null): boolean {
  return lokasiDiminta === null || lokasiDiminta.length === 0;
}
