/**
 * KEBIJAKAN ANTREAN UNGGAH — modul murni (DECISIONS 257).
 *
 * Permintaan user: *"lalu perlu solusi juga jika jaringan jelek, atau offline"*.
 *
 * Sampai sekarang hasil jepretan hanya ada di MEMORI sampai unggahannya
 * berhasil. Di kampung nelayan dengan sinyal putus-putus itu berarti: rana
 * ditekan, foto tampak masuk, lalu halaman ditutup atau sinyal hilang — dan
 * buktinya lenyap tanpa pernah ada yang tahu. Cacat paling mahal di seluruh
 * fitur ini, dan paling senyap.
 *
 * Karena itu tiap jepretan DISIMPAN DI PERANGKAT lebih dulu, baru diunggah dari
 * antrean. Berkas ini memuat ATURAN antreannya saja — tanpa IndexedDB, tanpa
 * jaringan — supaya bisa diuji langsung.
 */

export type StatusAntrean =
  /** Belum pernah dicoba, atau menunggu jadwal percobaan berikutnya. */
  | "menunggu"
  /** Sedang diunggah. */
  | "kirim"
  /** Gagal karena JARINGAN — akan dicoba lagi, selamanya. */
  | "gagal_jaringan"
  /** Server MENOLAK (mis. duplikat, wajib-GPS). Berhenti; butuh keputusan orang. */
  | "ditolak"
  /**
   * Isi fotonya HILANG dari simpanan perangkat — tidak ada yang bisa dikirim.
   *
   * Bukan kegagalan yang bisa dicoba lagi, dan bukan penolakan server: bytenya
   * memang tidak ada lagi. Dibedakan supaya pemiliknya tahu fotonya benar-benar
   * hilang dan bisa membuangnya, bukan menunggu selamanya sesuatu yang tak akan
   * pernah terkirim. Bukti dari perangkat user, 2026-08-07:
   * `UnknownError: Error preparing Blob/File data to be stored in object store`.
   */
  | "rusak";

export type ItemAntrean = {
  id: string;
  percobaan: number;
  /** Kapan percobaan terakhir dimulai (epoch ms). 0 = belum pernah. */
  terakhirCoba: number;
  status: StatusAntrean;
  pesan?: string;
};

/**
 * Jeda sebelum percobaan berikutnya, per jumlah percobaan yang sudah gagal.
 *
 * Naik bertahap lalu MENDATAR di 5 menit — tidak pernah menyerah. Menyerah
 * berarti membuang bukti lapangan hanya karena sinyalnya sedang jelek, dan
 * sinyal jelek adalah keadaan NORMAL di lokasi KNMP, bukan kasus tepi.
 */
const TANGGA_JEDA_MS = [2_000, 5_000, 15_000, 60_000, 300_000];

export function jedaBerikutnya(percobaan: number): number {
  if (percobaan <= 0) return 0;
  return TANGGA_JEDA_MS[Math.min(percobaan, TANGGA_JEDA_MS.length) - 1];
}

/**
 * Boleh dicoba sekarang?
 *
 * `online` ikut diperiksa supaya antrean tidak membakar baterai memanggil
 * jaringan yang jelas-jelas mati. Tapi `navigator.onLine` TIDAK dipercaya
 * sebagai bukti ADA jaringan — nilai `true` cuma berarti "ada antarmuka
 * jaringan", dan di lapangan itu sering berarti terhubung ke menara tanpa data
 * sama sekali. Jadi ia hanya dipakai untuk MENUNDA, tidak untuk menjamin.
 */
export function bolehCoba(item: ItemAntrean, sekarang: number, online: boolean): boolean {
  if (item.status === "kirim" || item.status === "ditolak" || item.status === "rusak") return false;
  if (!online) return false;
  if (item.percobaan === 0) return true;
  return sekarang - item.terakhirCoba >= jedaBerikutnya(item.percobaan);
}

/**
 * Berapa lama status "kirim" boleh bertahan sebelum dianggap MACET.
 *
 * Laporan user 2026-08-07: *"ini ambil banyak data, ada beberapa yang
 * terupload. tapi ada yg stuck. sudah coba logout, ganti user, tetap muncul di
 * hp awal. coba ambil foto berhasil terupload langsung, tapi foto yang gantung
 * ini stuck"*.
 *
 * Sebabnya persis ini: "kirim" adalah satu-satunya status yang HANYA bisa
 * dibereskan oleh halaman yang menyetelnya. `bolehCoba` menolak mencoba baris
 * ber-status "kirim" (benar — supaya satu foto tidak dikirim dua kali
 * bersamaan), tapi kalau halamannya mati di tengah unggahan — tab ditutup,
 * peramban membunuh halaman latar belakang, HP terkunci, aplikasi di-swipe —
 * tidak ada lagi yang menurunkan statusnya. Barisnya tinggal di IndexedDB
 * bertuliskan "kirim…" SELAMANYA.
 *
 * Itu juga sebabnya logout dan ganti user tidak menolong: antreannya milik
 * PERANGKAT, bukan milik sesi. Dan sebabnya foto baru tetap lancar: foto baru
 * masuk dengan status "menunggu", bukan "kirim".
 *
 * Ambangnya 2 menit — jauh lebih lama daripada unggahan satu foto di sinyal
 * jelek, jadi ia tidak akan memotong unggahan yang sungguh masih berjalan (mis.
 * di tab lain), tapi cukup pendek untuk membereskan diri sendiri tanpa siapa
 * pun perlu tahu apa itu IndexedDB.
 */
export const BATAS_KIRIM_MACET_MS = 120_000;

export function kirimMacet(item: ItemAntrean, sekarang: number): boolean {
  return item.status === "kirim" && sekarang - item.terakhirCoba >= BATAS_KIRIM_MACET_MS;
}

/**
 * Batas waktu SATU percobaan unggah.
 *
 * Perbaikan pertama (membebaskan baris "kirim" yang macet) ternyata belum cukup:
 * user melaporkan foto tetap tersangkut SESUDAH versi itu naik. Sebabnya ada di
 * lapis yang lebih dalam — **tidak ada satu pun batas waktu di sepanjang jalur
 * itu**. Kalau `await` pengiriman tidak pernah selesai (permintaan menggantung
 * di jaringan seluler yang setengah hidup, atau IndexedDB iOS yang berhenti
 * menjawab sesudah halaman kembali dari latar belakang), maka:
 *
 * - status tidak pernah turun dari "kirim", DAN
 * - `finally` yang melepas kunci antrean tidak pernah dijalankan.
 *
 * Antreannya berhenti total, layarnya membeku pada label terakhir, dan "Coba
 * kirim sekarang" tidak berbuat apa-apa karena kuncinya masih dipegang. Persis
 * yang terlihat: tiga baris "kirim…" yang tidak berubah sama sekali selama
 * sejam.
 *
 * `Promise` yang menggantung tidak bisa dibatalkan, tapi bisa DIABAIKAN. Dua
 * batas di bawah memastikan tidak ada keadaan yang bertahan selamanya.
 */
export const BATAS_SATU_KIRIM_MS = 60_000;

/**
 * Batas satu putaran antrean sebelum kuncinya dianggap ditinggalkan.
 *
 * Sengaja lebih longgar dari `BATAS_SATU_KIRIM_MS`: putaran yang sehat memang
 * boleh lebih lama dari satu pengiriman (ia mengirim beberapa foto berturut-
 * turut). Yang dijaga di sini cuma satu hal — kunci yang pemegangnya sudah
 * tidak ada tidak boleh menyandera antrean selamanya.
 */
export const BATAS_PUTARAN_MS = 180_000;

export function putaranDitinggalkan(mulai: number | null, sekarang: number): boolean {
  if (mulai == null) return false;
  return sekarang - mulai >= BATAS_PUTARAN_MS;
}

/**
 * Apakah kegagalan ini soal JARINGAN (coba lagi) atau KEPUTUSAN SERVER (berhenti)?
 *
 * Bedanya menentukan nasib foto. Kegagalan jaringan bersifat sementara —
 * mencoba lagi akhirnya berhasil. Penolakan server tidak: foto duplikat akan
 * ditolak seribu kali dengan hasil yang sama, dan mencobanya terus hanya
 * menghabiskan baterai sambil menyembunyikan sebab sebenarnya dari pelapor.
 */
export function statusDariKegagalan(jenis: "jaringan" | "server"): StatusAntrean {
  return jenis === "jaringan" ? "gagal_jaringan" : "ditolak";
}

/**
 * Batas jumlah foto yang boleh menumpuk di perangkat.
 *
 * Ada batasnya karena penyimpanan peramban terbatas dan bisa PENUH — dan
 * penyimpanan penuh yang tidak diberitahukan berarti jepretan berikutnya hilang
 * diam-diam. Kalau antrean sudah sepanjang ini, pelapor diberi tahu untuk
 * mencari sinyal dulu, bukan dibiarkan terus memotret ke dalam ember bocor.
 */
export const MAKS_ANTREAN = 100;

/**
 * Ringkasan untuk ditampilkan — satu tempat, supaya kalimatnya tidak beranak.
 *
 * Hanya butuh `status`, jadi tipenya sengaja longgar: baris yang ditampilkan UI
 * membawa URL pratinjau tapi tidak membawa hitungan percobaan, dan memaksanya
 * menyeret bidang yang tidak dipakai hanya menambah tempat untuk salah.
 */
export function ringkasAntrean(items: Pick<ItemAntrean, "status">[]): {
  menunggu: number;
  ditolak: number;
  rusak: number;
  perluPerhatian: boolean;
} {
  // "rusak" TIDAK ikut dihitung menunggu: ia tidak sedang menunggu apa pun.
  // Menghitungnya membuat "3 foto menunggu terkirim" berbohong tentang tiga
  // foto yang tidak akan pernah terkirim.
  const menunggu = items.filter((i) => i.status !== "ditolak" && i.status !== "rusak").length;
  const ditolak = items.filter((i) => i.status === "ditolak").length;
  const rusak = items.filter((i) => i.status === "rusak").length;
  return { menunggu, ditolak, rusak, perluPerhatian: menunggu + ditolak + rusak > 0 };
}
