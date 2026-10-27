import { PERAN_PENUGASAN, type StatusPersetujuan } from "./persetujuan-aturan";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * PERSETUJUAN AKTIVASI ADENDUM LEWAT WHATSAPP – aturan MURNI (DECISIONS 714).
 *
 * Permintaan user 2026-10-27: *"saat ada yg minta aktivasi draft rab/adendum,
 * program director dapat notifikasi wa, dan bisa approve by wa"*. Pilihan user:
 * dikirim begitu AM/PM/SM menyetujui; balasan SETUJU dari PD langsung
 * mengaktifkan draft bila persetujuannya jadi lengkap; hanya nomor yang sudah
 * DIVERIFIKASI yang bisa menyetujui.
 *
 * Aturan empat mata (DECISIONS 234) tidak berubah sedikit pun: balasan WA
 * hanyalah cara lain mencatat suara PD, dan suara itu tetap diperiksa
 * `nilaiPersetujuan` yang sama.
 */

/**
 * Perlu mengirim WA ke Program Director? Hanya untuk ADENDUM (HPS awal tidak
 * menuntut empat mata), hanya ketika yang baru menyetujui pengisi kursi
 * penugasan, dan hanya selama suara PD belum ada.
 */
export function perluNotifikasiPd(o: { adendum: boolean; peranPenyetuju: UserRole; status: StatusPersetujuan }): boolean {
  return o.adendum && PERAN_PENUGASAN.includes(o.peranPenyetuju) && !o.status.adaDirektur;
}

/**
 * Balasan persetujuan: "SETUJU 4821" (boleh huruf kecil, boleh "#", titik
 * dua, atau tanpa spasi). "setuju" tanpa kode → `kode: null`, supaya bisa
 * diminta kodenya. Selain itu `null` – bukan urusan persetujuan.
 *
 * Kode WAJIB untuk mencatat suara: satu PD bisa punya beberapa draft yang
 * menunggu, dan "setuju" yang menempel ke draft yang salah mengaktifkan
 * adendum yang salah.
 */
export function bacaBalasanSetuju(teks: string): { kode: string | null } | null {
  const t = teks.replace(/\s+/g, " ").trim();
  const m = /^setuju(?:\s*[:#-]?\s*(\d{4}))?\s*[.!]?$/i.exec(t);
  if (!m) return null;
  return { kode: m[1] ?? null };
}

/** Kode empat angka 1000–9999 – mudah diketik dari HP, tanpa nol di depan. */
export function buatKodePersetujuan(acak: () => number = Math.random): string {
  return String(1000 + Math.floor(acak() * 9000));
}

/** Kunci "satu kode menunggu per PD" (`wa_persetujuan.kunci_menunggu`). */
export function kunciMenungguPersetujuan(untukUserId: string, kode: string): string {
  return `${untukUserId}:${kode}`;
}

/* ── Teks ───────────────────────────────────────────────────────────────── */

export type IsiNotifikasi = {
  lokasi: string;
  paket: string;
  revisionNo: number;
  /** Nilai draft, pra-PPN, sudah diformat. */
  nilaiDraft: string;
  /** Ringkasan perubahan dari `diffRevisions`, sudah diformat; null bila tak ada pembanding. */
  perubahan: string | null;
  sudahSetuju: string[];
  kode: string;
};

export const teksPersetujuanWa = {
  notifikasi: (o: IsiNotifikasi) =>
    `*Persetujuan aktivasi adendum*\n` +
    `Lokasi: *${o.lokasi}* (${o.paket})\n` +
    `Draft revisi #${o.revisionNo}: ${o.nilaiDraft} (pra-PPN)\n` +
    (o.perubahan ? `Perubahan dari RAB berlaku: ${o.perubahan}\n` : "") +
    `Sudah disetujui: ${o.sudahSetuju.join(", ")}.\n\n` +
    `Balas *SETUJU ${o.kode}* untuk menyetujui. Begitu Anda setujui, draft langsung diaktifkan ` +
    `dan menggantikan RAB yang berlaku.\n` +
    `Kode ini batal kalau draftnya diubah sesudah pesan ini. Rinciannya ada di aplikasi: ` +
    `Lokasi › ${o.lokasi} › RAB › Adendum.`,

  mintaKode: (kode: string[]) =>
    kode.length === 1
      ? `Sebut kodenya supaya tidak salah draft: balas *SETUJU ${kode[0]}*.`
      : `Ada ${kode.length} draft yang menunggu persetujuan Anda. Balas dengan kodenya, mis. *SETUJU ${kode[0]}*. ` +
        `Kode-kodenya: ${kode.join(", ")}.`,

  kodeTidakDikenal: (kode: string) =>
    `Kode ${kode} tidak ada di antara persetujuan yang menunggu Anda. Periksa lagi angkanya di pesan permintaan.`,

  belumVerifikasi:
    "Nomor WhatsApp ini belum diverifikasi di akun MARLIN Anda, jadi persetujuan lewat WA belum bisa diterima. " +
    "Verifikasi dulu di halaman Verifikasi WhatsApp yang muncul saat Anda masuk ke aplikasi, atau setujui langsung di aplikasi.",

  bukanDirektur:
    "Persetujuan lewat WA hanya untuk Program Director. Setujui lewat aplikasi kalau Anda berhak.",

  tanpaAkses: (lokasi: string) =>
    `Akun Anda sudah tidak punya akses ke *${lokasi}*, jadi persetujuannya tidak dicatat.`,

  draftBerubah: (revisionNo: number, lokasi: string) =>
    `Draft revisi #${revisionNo} *${lokasi}* sudah diubah sesudah pesan permintaan itu, jadi kode tadi tidak berlaku. ` +
    `Permintaan baru dikirim begitu draft yang baru disetujui lagi oleh AM/PM/SM.`,

  bukanDraft: (revisionNo: number, lokasi: string) =>
    `Revisi #${revisionNo} *${lokasi}* sudah bukan draft (sudah diaktifkan atau dibuang), jadi tidak ada yang perlu disetujui.`,

  tercatatMenunggu: (revisionNo: number, lokasi: string, kurang: string[]) =>
    `Persetujuan Anda atas draft revisi #${revisionNo} *${lokasi}* tercatat. ` +
    `Belum bisa diaktifkan: masih menunggu ${kurang.join(" + ")}.`,

  aktif: (kabar: string) => `Persetujuan Anda tercatat. ${kabar}`,

  aktifGagal: (revisionNo: number, lokasi: string, sebab: string) =>
    `Persetujuan Anda atas draft revisi #${revisionNo} *${lokasi}* tercatat, tetapi aktivasinya gagal: ${sebab} ` +
    `Draft belum aktif. Yang memegang RAB lokasi ini bisa menekan Aktifkan di aplikasi.`,

  kabarPemohon: (o: { pd: string; revisionNo: number; lokasi: string; kabar: string }) =>
    `${o.pd} menyetujui draft revisi #${o.revisionNo} *${o.lokasi}* lewat WhatsApp. ${o.kabar}`,

  kabarPemohonGagal: (o: { pd: string; revisionNo: number; lokasi: string; sebab: string }) =>
    `${o.pd} menyetujui draft revisi #${o.revisionNo} *${o.lokasi}* lewat WhatsApp, tetapi aktivasinya gagal: ` +
    `${o.sebab} Tekan Aktifkan di aplikasi setelah penyebabnya dibereskan.`,
};

/**
 * Kabar untuk orang yang baru menyetujui di web: kepada siapa WA permintaan
 * terkirim, dan siapa yang tidak bisa dikirimi beserta sebabnya. Kosong bila
 * memang tidak ada yang perlu dikabarkan.
 */
export function kabarKirimNotifikasi(o: {
  terkirim: string[];
  /** Sudah dikirimi permintaan untuk isi draft yang sama – tidak dikirim ulang. */
  sudah: string[];
  tidak: { nama: string; sebab: string }[];
}): string {
  const bagian: string[] = [];
  if (o.terkirim.length > 0) bagian.push(`Permintaan persetujuan dikirim lewat WhatsApp ke ${o.terkirim.join(", ")}.`);
  if (o.sudah.length > 0) bagian.push(`${o.sudah.join(", ")} sudah dikirimi permintaan WA untuk isi draft ini.`);
  for (const t of o.tidak) bagian.push(`${t.nama} tidak dikirimi WA: ${t.sebab}.`);
  if (o.terkirim.length === 0 && o.sudah.length === 0 && o.tidak.length === 0)
    bagian.push("Belum ada Program Director yang memegang lokasi ini, jadi tidak ada yang dikirimi WA.");
  return bagian.join(" ");
}
