import type { WaOutboundStatus } from "@/generated/prisma/enums";

/**
 * MESIN STATUS kiriman WhatsApp — murni, tanpa DB (DECISIONS 374).
 *
 * ### Bedanya "diterima WAHA" dan "terkirim", dan kenapa itu inti semuanya
 *
 * HTTP 2xx dari WAHA hanya membuktikan **WAHA menerima permintaannya**. Ia
 * menjawab 2xx juga saat sesinya belum login — pesannya tidak pernah keluar.
 * Adanya ID pesan pun belum bukti sampai; ia bukti bahwa WAHA sudah mendaftarkan
 * pesan itu. Satu-satunya bukti pesan benar-benar bergerak datang dari event
 * `message.ack` WhatsApp.
 *
 * Karena itu enum-nya sengaja memisahkan keduanya, dan kata-kata di UI
 * mengikuti pemisahan itu — bukan sebaliknya.
 *
 * ### Kenapa status tidak boleh mundur
 *
 * Ack tiba lewat jaringan dan TIDAK dijamin berurutan: `read` bisa mendarat
 * sebelum `delivered`. Kalau tiap ack ditulis apa adanya, satu pesan yang sudah
 * dibaca bisa "turun" jadi terkirim, lalu naik lagi — dan riwayat status yang
 * berkedip membuat orang berhenti mempercayainya sama sekali.
 *
 * Jadi status hanya boleh NAIK, dengan satu pengecualian yang memang final:
 * kegagalan/penolakan. Itu bukan urutan yang sama — ia jalur akhir yang punya
 * bukti sendiri (galat dari WAHA), dan menyembunyikannya karena "sudah pernah
 * terkirim" berarti melaporkan pesan hilang sebagai pesan sampai.
 */

/** Makin besar = makin jauh perjalanannya. Jalur gagal punya peringkatnya sendiri. */
const PERINGKAT: Record<WaOutboundStatus, number> = {
  antre: 0,
  diterima_waha: 1,
  terkirim: 2,
  sampai: 3,
  dibaca: 4,
  // Jalur akhir — dibandingkan terpisah, lihat `statusBerikutnya`.
  gagal: -1,
  ditolak: -1,
};

const FINAL: ReadonlySet<WaOutboundStatus> = new Set<WaOutboundStatus>(["gagal", "ditolak"]);

/**
 * Kode ack WAHA → status kita.
 *
 * WAHA meneruskan angka ack WhatsApp: 1 = sampai server, 2 = sampai perangkat,
 * 3 = dibaca, 4 = diputar (audio). `-1`/`ERROR` = gagal kirim.
 * 0 (PENDING) sengaja TIDAK dipetakan: ia tidak menambah apa pun di atas
 * "diterima WAHA", dan memetakannya hanya menambah tulisan status yang berubah
 * tanpa arti baru.
 */
export function statusDariAck(ack: number | string | null | undefined): WaOutboundStatus | null {
  const n = typeof ack === "string" ? Number(ack) : ack;
  if (n == null || Number.isNaN(n)) {
    const s = String(ack ?? "").toLowerCase();
    if (s === "error" || s === "failed") return "gagal";
    if (s === "server") return "terkirim";
    if (s === "device") return "sampai";
    if (s === "read") return "dibaca";
    if (s === "played") return "dibaca";
    return null;
  }
  if (n < 0) return "gagal";
  if (n === 1) return "terkirim";
  if (n === 2) return "sampai";
  if (n >= 3) return "dibaca";
  return null;
}

/**
 * Status berikutnya bila `usul` tiba pada baris yang sekarang `sekarang`.
 *
 * Mengembalikan `null` bila tidak ada yang berubah — dan itu jawaban yang
 * sering: ack duplikat dan ack yang datang terlambat memang seharusnya tidak
 * mengubah apa pun.
 */
export function statusBerikutnya(
  sekarang: WaOutboundStatus,
  usul: WaOutboundStatus,
): WaOutboundStatus | null {
  if (sekarang === usul) return null;

  // Kegagalan/penolakan menang atas status maju mana pun: ia punya bukti
  // sendiri, dan pesan yang gagal tidak boleh dilaporkan sudah sampai.
  if (FINAL.has(usul)) return usul;

  // Sesudah final, ack maju tidak menghidupkannya kembali. Kalau WhatsApp
  // benar-benar mengirimkannya belakangan, yang perlu diperbaiki adalah
  // sebab kegagalannya — bukan menutupinya dengan status baru.
  if (FINAL.has(sekarang)) return null;

  return PERINGKAT[usul] > PERINGKAT[sekarang] ? usul : null;
}

export const LABEL_STATUS_KIRIM: Record<WaOutboundStatus, string> = {
  antre: "Antre",
  // Sengaja BUKAN "Terkirim". Ini yang dulu ditulis UI begitu HTTP 2xx.
  diterima_waha: "Diterima WAHA",
  terkirim: "Terkirim",
  sampai: "Sampai",
  dibaca: "Dibaca",
  gagal: "Gagal",
  ditolak: "Ditolak",
};

export const NADA_STATUS_KIRIM: Record<
  WaOutboundStatus,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  antre: "neutral",
  diterima_waha: "info",
  terkirim: "info",
  sampai: "success",
  dibaca: "success",
  gagal: "danger",
  ditolak: "danger",
};

/**
 * Kalimat untuk pengguna — JUJUR terhadap apa yang benar-benar diketahui.
 *
 * "Diterima WAHA" tidak boleh dibaca sebagai "sampai", dan itu harus terbaca
 * dari kalimatnya sendiri, bukan dari pengetahuan pembacanya.
 */
export function kalimatStatusKirim(status: WaOutboundStatus): string {
  switch (status) {
    case "antre":
      return "Antre dikirim.";
    case "diterima_waha":
      return "Sudah diserahkan ke WhatsApp – menunggu tanda terima. Belum tentu sampai.";
    case "terkirim":
      return "Terkirim ke server WhatsApp.";
    case "sampai":
      return "Sampai di perangkat tujuan.";
    case "dibaca":
      return "Sudah dibaca.";
    case "gagal":
      return "Gagal dikirim.";
    case "ditolak":
      return "Ditolak WhatsApp – periksa nomor/grup tujuannya.";
  }
}
