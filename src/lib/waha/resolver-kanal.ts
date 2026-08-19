import type { UserRole } from "@/generated/prisma/enums";
import { ROLE_LABEL } from "@/lib/authz";

/**
 * SATU resolver: kanal + identitas + scope → keputusan terstruktur
 * (DECISIONS 371).
 *
 * MURNI — tanpa DB, tanpa AI. Seluruh pencarian sudah dikerjakan pemanggil dan
 * hasilnya diserahkan ke sini sebagai fakta. Itu disengaja: aturan siapa-boleh-
 * dijawab-di-mana-tentang-apa adalah bagian paling berbahaya dari tanya-jawab
 * WhatsApp, dan satu-satunya cara mengujinya secara menyeluruh adalah membuatnya
 * fungsi biasa yang bisa dipanggil ribuan kali tanpa basis data.
 *
 * ### Kenapa harus SATU tempat
 *
 * Instruksi brief 2026-08-19: *"Jangan menaruh aturan ini di dua tempat yang
 * saling menutupi."* Sebelumnya keputusannya tersebar: `diajakBicara()`
 * menjawab "kapan membalas", `lingkupJawaban()` menjawab "apa yang boleh
 * disebut", dan `tanya.ts` menyisipkan sendiri aturan "di grup pengirim tidak
 * perlu terdaftar" di antara keduanya. Aturan yang tersebar begitu bisa
 * berubah di satu tempat dan diam-diam ditutupi tempat lain — dan yang
 * tertutupi di sini bukan tampilan, melainkan data paket orang lain.
 *
 * ### Aturan baru dari user: Super Admin & Program Director dilayani di mana pun
 *
 * Keputusan user untuk pekerjaan ini (brief 5A). Yang PENTING dan gampang
 * salah dibaca: ini bukan pelonggaran untuk seluruh anggota grup. Pengecualian
 * hanya berlaku bila PENGIRIMNYA terverifikasi lewat nomor/LID tersimpan.
 * **Nama tampilan WhatsApp tidak pernah menjadi bukti identitas** — siapa pun
 * bisa menamai dirinya "Program Director".
 *
 * Dan scope-nya tetap dibatasi organisasi penggunanya. `super_admin` di MARLIN
 * berarti "seluruh lokasi dalam organisasinya", BUKAN seluruh basis data.
 */

/** Peran yang dilayani di kanal mana pun, termasuk grup tak tertaut (brief 5A). */
const PERAN_ISTIMEWA: ReadonlySet<UserRole> = new Set<UserRole>([
  "super_admin",
  "program_director",
]);

export function peranIstimewa(role: UserRole): boolean {
  return PERAN_ISTIMEWA.has(role);
}

/** Identitas pengirim yang SUDAH diverifikasi lewat nomor/LID. */
export type PenanyaTerverifikasi = {
  id: string;
  orgId: string;
  role: UserRole;
};

export type PaketGrupTertaut = {
  id: string;
  nama: string;
  orgId: string;
  lokasiIds: string[];
};

export type MasukanKeputusan = {
  grup: boolean;
  /** Hasil `diajakBicara()` — di grup: mention/balasan ke MARLIN. */
  diajakBicara: boolean;
  /**
   * Pengirim yang cocok dengan pengguna AKTIF. null = tidak dikenal, ganda,
   * nonaktif, atau LID tak terpetakan — semuanya diperlakukan sama: bukan
   * identitas.
   */
  penanya: PenanyaTerverifikasi | null;
  /** Kalimat untuk log; tidak pernah dikirim ke penanya. */
  alasanIdentitas: string;
  /** Paket yang tertaut grup ini. null = grup tak tertaut / bukan grup. */
  paketGrup: PaketGrupTertaut | null;
};

/** Dari mana batas lokasi jawaban berasal — ikut dicatat di audit. */
export type AsalScope = "package_group" | "privileged_user" | "pengguna";

export type KeputusanLayanan =
  /** Tidak membalas apa pun. Balasan apa pun mengonfirmasi keberadaan sistem. */
  | { jenis: "diam"; alasan: string }
  /** Membalas penolakan yang bisa ditindaklanjuti. */
  | { jenis: "tolak"; pesan: string; alasan: string }
  | {
      jenis: "jawab";
      asalScope: AsalScope;
      /** null = seluruh lokasi yang boleh diakses penanya dalam organisasinya. */
      lokasiIds: string[] | null;
      /** Organisasi yang membatasi seluruh query. TIDAK PERNAH null. */
      orgId: string;
      /** Disebut di kaki balasan bila jawaban dipotong. */
      catatanPemotongan: string | null;
      /**
       * Penanda lingkup untuk balasan PERTAMA di grup tak tertaut. Di sana
       * jawabannya memakai lingkup organisasi, dan anggota grup lain berhak
       * tahu atas dasar apa data itu muncul di grup mereka.
       */
      penandaLingkup: string | null;
      /** Peran istimewa yang sedang dipakai — untuk audit. */
      peranDipakai: UserRole | null;
    };

export function putuskanLayanan(m: MasukanKeputusan): KeputusanLayanan {
  if (!m.diajakBicara) {
    return { jenis: "diam", alasan: m.grup ? "grup tanpa mention ke MARLIN" : "tidak diajak bicara" };
  }

  const istimewa = m.penanya != null && peranIstimewa(m.penanya.role);

  /* ---------------- Chat pribadi ---------------- */
  if (!m.grup) {
    if (!m.penanya) {
      /*
       * DIAM, bukan "Anda belum terdaftar". Balasan apa pun mengonfirmasi
       * bahwa nomor ini milik sistem proyek dan mengundang percobaan
       * berikutnya. Perilaku ini TIDAK diubah oleh aturan 5A.
       */
      return { jenis: "diam", alasan: `didiamkan — ${m.alasanIdentitas}` };
    }
    return {
      jenis: "jawab",
      asalScope: istimewa ? "privileged_user" : "pengguna",
      // null = seluruh lokasi yang boleh diakses penanya. Untuk peran istimewa
      // itu berarti seluruh organisasinya — dibatasi `orgId`, bukan tanpa batas.
      lokasiIds: null,
      orgId: m.penanya.orgId,
      catatanPemotongan: null,
      penandaLingkup: null,
      peranDipakai: istimewa ? m.penanya.role : null,
    };
  }

  /* ---------------- Grup TERTAUT paket ---------------- */
  if (m.paketGrup) {
    /*
     * Default TETAP paket grup, termasuk untuk peran istimewa (brief 5A).
     *
     * Alasannya sama seperti DECISIONS 351 dan tidak berubah: balasannya
     * dikirim ke GRUP dan dibaca seluruh anggotanya, siapa pun yang mengetik.
     * Melebarkan jawaban hanya karena kebetulan yang bertanya seorang direktur
     * berarti data paket lain terbaca vendor paket ini.
     */
    return {
      jenis: "jawab",
      asalScope: "package_group",
      lokasiIds: m.paketGrup.lokasiIds,
      orgId: m.paketGrup.orgId,
      catatanPemotongan: `Jawaban ini hanya mencakup ${m.paketGrup.nama}. Untuk lintas paket, tanya saya lewat chat pribadi.`,
      penandaLingkup: null,
      peranDipakai: istimewa && m.penanya ? m.penanya.role : null,
    };
  }

  /* ---------------- Grup TIDAK tertaut paket ---------------- */
  if (!m.penanya || !istimewa) {
    return {
      jenis: "tolak",
      pesan:
        "Grup ini belum tertaut paket mana pun, jadi saya tidak tahu data apa yang pantas dibagikan di sini. Minta admin menautkannya di Paket → Grup WhatsApp.",
      alasan: "grup tidak tertaut paket",
    };
  }

  /*
   * Peran istimewa TERVERIFIKASI di grup tak tertaut: dilayani dengan lingkup
   * ORGANISASINYA, bukan lingkup grup — grupnya memang tidak menyatakan apa pun.
   *
   * Penandanya wajib: anggota grup lain melihat data proyek muncul di grup yang
   * tidak tertaut paket apa pun, dan berhak tahu atas dasar apa.
   */
  return {
    jenis: "jawab",
    asalScope: "privileged_user",
    lokasiIds: null,
    orgId: m.penanya.orgId,
    catatanPemotongan: null,
    penandaLingkup: `Saya mengenali Anda sebagai ${ROLE_LABEL[m.penanya.role]}. Grup ini tidak tertaut paket; jawaban memakai lingkup organisasi Anda.`,
    peranDipakai: m.penanya.role,
  };
}
