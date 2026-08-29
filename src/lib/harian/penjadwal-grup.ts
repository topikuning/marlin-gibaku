import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formatTanggal, jakartaDateKey, parseDateKey } from "@/lib/format";
import { isWahaConfigured } from "@/lib/waha/client";
import { sendText } from "@/lib/waha/kirim";
import { tagihanPerPaket } from "./belum-lapor";
import { pesanPengingatGrup } from "./pesan-grup";
import { getPengingatGrupAktif } from "./setelan-grup";

/**
 * Pengingat laporan harian ke GRUP WhatsApp paket (ketetapan user 2026-08-29).
 *
 * ### Kenapa antrean, bukan perulangan kirim
 *
 * Jeda antar grup minimal SATU MENIT — permintaan user, dan alasannya nyata:
 * 19 pesan yang meluncur beruntun ke 19 grup adalah pola yang membuat nomor
 * ditandai spam oleh WhatsApp. Tetapi 19 grup × 1 menit = 19 menit, sedangkan
 * satu route hanya punya `maxDuration` 300 detik. Karena itu gilirannya
 * disimpan di basis data (`send_after` bertingkat) dan dikuras putaran demi
 * putaran — jeda ditegakkan oleh JAM, bukan oleh proses yang harus tetap hidup.
 *
 * Pembagian tugasnya:
 *   `antrekanPengingatGrup` — dipanggil putaran harian (18.00 WIB), membuat
 *     satu baris per paket dengan giliran berjarak satu menit.
 *   `kurasPengingatGrup`    — dipanggil putaran WAHA (tiap 5 menit), mengirim
 *     yang sudah tiba gilirannya.
 */

/** Jarak giliran antar grup. Ketetapan user: minimal satu menit. */
export const JEDA_ANTAR_GRUP_MS = 60_000;

/**
 * Batas kirim satu putaran. Empat pesan berjeda satu menit = tiga menit, masih
 * di bawah `maxDuration` 300 detik dengan sisa untuk kueri dan galat.
 */
export const MAKS_KIRIM_PER_PUTARAN = 4;

/** Sesudah gagal, giliran berikutnya paling cepat segini. */
const MUNDUR_MS = 5 * 60_000;

/** Sesudah tiga kali gagal, barisnya berhenti dicoba hari itu. */
const MAKS_PERCOBAAN = 3;

export type HasilAntreGrup = {
  aktif: boolean;
  /** Paket yang punya grup & sedang berjalan hari itu. */
  diperiksa: number;
  /** Baris giliran yang BARU dibuat (yang sudah ada tidak digandakan). */
  dibuat: number;
};

/**
 * Buat giliran hari ini untuk semua paket berjalan yang punya grup.
 *
 * Barisnya dibuat untuk SEMUA paket, termasuk yang saat ini sudah lengkap:
 * isi pesan ditentukan saat kirim, bukan saat antre (lihat catatan di model
 * `GroupReminderJob`). Paket yang keburu beres akan ditandai `dilewati` tanpa
 * pesan.
 *
 * Aman dipicu berkali-kali: UNIQUE `(package_id, date_key)` + `skipDuplicates`.
 */
export async function antrekanPengingatGrup(now = new Date()): Promise<HasilAntreGrup> {
  if (!(await getPengingatGrupAktif())) return { aktif: false, diperiksa: 0, dibuat: 0 };

  const dateKey = jakartaDateKey(now);
  const paket = await tagihanPerPaket(now);
  if (paket.length === 0) return { aktif: true, diperiksa: 0, dibuat: 0 };

  const baris = paket.map((p, i) => ({
    packageId: p.packageId,
    dateKey,
    sendAfter: new Date(now.getTime() + i * JEDA_ANTAR_GRUP_MS),
  }));
  const { count } = await db.groupReminderJob.createMany({ data: baris, skipDuplicates: true });
  return { aktif: true, diperiksa: paket.length, dibuat: count };
}

export type HasilKurasGrup = {
  aktif: boolean;
  dikerjakan: number;
  terkirim: number;
  dilewati: number;
  gagal: number;
  /** Diisi bila putaran berhenti sebelum antreannya habis. */
  berhenti?: string;
};

const tidurBawaan = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Kirim giliran yang sudah tiba waktunya.
 *
 * `tidur` bisa diganti pemanggil supaya uji tidak perlu menunggu satu menit
 * sungguhan — yang diuji adalah bahwa jedanya ADA dan sepanjang yang dijanjikan,
 * bukan kesabaran mesin uji.
 */
export async function kurasPengingatGrup(
  opts: {
    now?: Date;
    maks?: number;
    tidur?: (ms: number) => Promise<void>;
  } = {},
): Promise<HasilKurasGrup> {
  const now = opts.now ?? new Date();
  const maks = opts.maks ?? MAKS_KIRIM_PER_PUTARAN;
  const tidur = opts.tidur ?? tidurBawaan;
  const hasil: HasilKurasGrup = { aktif: true, dikerjakan: 0, terkirim: 0, dilewati: 0, gagal: 0 };

  if (!(await getPengingatGrupAktif())) return { ...hasil, aktif: false };

  /*
   * WAHA belum dikonfigurasi bukan kegagalan barisnya. Kalau tetap dijalankan,
   * tiap giliran menabung satu percobaan gagal lalu MENYERAH — dan pengingat
   * hari itu hilang bukan karena grupnya sudah lengkap.
   */
  if (!(await isWahaConfigured())) return { ...hasil, berhenti: "WAHA belum dikonfigurasi." };

  const antre = await db.groupReminderJob.findMany({
    where: { status: "menunggu", sendAfter: { lte: now } },
    orderBy: { sendAfter: "asc" },
    take: maks,
    select: { id: true, packageId: true, dateKey: true, attempts: true },
  });
  if (antre.length === 0) return hasil;

  /*
   * Jeda dibayar SEBELUM pesan berikutnya, dan hanya bila memang ada pesan yang
   * baru keluar. Grup yang dilewati (sudah lengkap) tidak menekan WhatsApp,
   * jadi menunggu satu menit sesudahnya hanya menahan route tanpa melindungi
   * apa pun — dan membuat sisa antrean tertunda tanpa sebab.
   */
  let perluJeda = false;

  for (const job of antre) {
    if (perluJeda) {
      await tidur(JEDA_ANTAR_GRUP_MS);
      perluJeda = false;
    }

    // Klaim atomik: dua putaran yang berbarengan tidak boleh mengirim pesan
    // yang sama dua kali ke grup pemberi kerja.
    const klaim = await db.groupReminderJob.updateMany({
      where: { id: job.id, status: "menunggu" },
      data: { status: "jalan", attempts: job.attempts + 1 },
    });
    if (klaim.count !== 1) continue;
    hasil.dikerjakan += 1;

    const tanggal = parseDateKey(job.dateKey);
    const [tagihan] = await tagihanPerPaket(tanggal ?? now, { packageId: job.packageId });
    const teks = tagihan
      ? pesanPengingatGrup({
          namaPaket: tagihan.namaPaket,
          tanggalTampil: formatTanggal(tanggal ?? now),
          belum: tagihan.belum,
          sudah: tagihan.sudah,
        })
      : null;

    if (!teks || !tagihan) {
      // Sudah lengkap saat gilirannya tiba — atau paketnya tidak lagi berjalan.
      await db.groupReminderJob.update({
        where: { id: job.id },
        data: { status: "dilewati", locations: 0, lastError: null },
      });
      hasil.dilewati += 1;
      continue;
    }

    try {
      const waMessageId = await sendText(tagihan.waGroupId, teks);
      await db.groupReminderJob.update({
        where: { id: job.id },
        data: {
          status: "terkirim",
          locations: tagihan.belum.length,
          waMessageId,
          chatId: tagihan.waGroupId,
          lastError: null,
          sentAt: new Date(),
        },
      });
      hasil.terkirim += 1;
      await audit(null, "reminder.group_sent", "package", job.packageId, {
        dateKey: job.dateKey,
        lokasi: tagihan.belum.length,
        waMessageId,
      });
    } catch (err) {
      const pesan = err instanceof Error ? err.message : "Gagal mengirim.";
      const percobaan = job.attempts + 1;
      const menyerah = percobaan >= MAKS_PERCOBAAN;
      await db.groupReminderJob.update({
        where: { id: job.id },
        data: {
          status: menyerah ? "gagal" : "menunggu",
          lastError: pesan,
          sendAfter: new Date(now.getTime() + MUNDUR_MS),
        },
      });
      hasil.gagal += 1;
    }

    perluJeda = true;
  }

  return hasil;
}
