import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  buatFrasa,
  buatKode,
  cocokkanKode,
  frasaDariPesan,
  keadaanVerifikasi,
  MAKS_PERCOBAAN,
  MENIT_BERLAKU,
  type KeadaanVerifikasi,
} from "./verifikasi-aturan";
import { normalizePhone, senderKeyOf } from "./sender-identity";

/**
 * VERIFIKASI NOMOR WHATSAPP — sisi database (DECISIONS 570).
 *
 * Aturannya di `verifikasi-aturan.ts` (modul murni, diuji langsung); di sini
 * hanya pembacaan, penulisan, dan balasan WhatsApp-nya.
 *
 * Alurnya dua arah, dan itu yang membedakannya dari sekadar "kirim kode ke
 * nomor yang diketik":
 *
 *   1. layar memberi FRASA sekali-pakai
 *   2. orangnya mengirim frasa itu DARI nomornya  → membuktikan ia memegangnya
 *   3. MARLIN membalas KODE ke nomor itu juga
 *   4. orangnya mengetikkan kodenya di layar      → membuktikan ia membacanya
 *
 * Nomor yang diketik di layar tidak pernah cukup: salah ketik satu angka
 * berarti laporan orang ini dikirimkan ke nomor orang lain, dan tidak ada satu
 * pun langkah berikutnya yang akan menyadarinya.
 */

export class VerifikasiError extends Error {}

/** Satu percobaan berjalan per orang; yang lama ditimpa, bukan ditumpuk. */
export async function mulaiVerifikasi(userId: string): Promise<{ frasa: string; kedaluwarsa: Date }> {
  const frasa = buatFrasa();
  const kedaluwarsa = new Date(Date.now() + MENIT_BERLAKU * 60_000);
  await db.waVerification.upsert({
    where: { userId },
    create: { userId, phrase: frasa, expiresAt: kedaluwarsa },
    // Mengulang berarti MULAI LAGI: kode, identitas pengirim, dan percobaan
    // yang lama ikut dibuang. Menyisakan salah satunya membuat frasa baru bisa
    // dipakai menyelesaikan percobaan lama milik nomor yang berbeda.
    update: {
      phrase: frasa,
      expiresAt: kedaluwarsa,
      code: null,
      senderKey: null,
      waNumber: null,
      waLid: null,
      attempts: 0,
    },
  });
  return { frasa, kedaluwarsa };
}

export async function bacaKeadaan(userId: string): Promise<KeadaanVerifikasi> {
  const [baris, user] = await Promise.all([
    db.waVerification.findUnique({ where: { userId } }),
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { waNumber: true, waVerifiedAt: true },
    }),
  ]);
  return keadaanVerifikasi(baris, user.waVerifiedAt, user.waNumber);
}

export type HasilPesanMasuk =
  | { ditangani: false }
  | { ditangani: true; hasil: "kode-dikirim" | "kedaluwarsa" | "nomor-dipakai-orang-lain" };

/**
 * Pesan WhatsApp masuk yang memuat frasa verifikasi.
 *
 * Dipanggil dari webhook SEBELUM jalur tanya-jawab: frasa verifikasi bukan
 * pertanyaan, dan membiarkannya masuk ke AI berarti membayar satu panggilan
 * model untuk membalas "maaf saya tidak paham" atas pesan yang justru paling
 * kita mengerti.
 */
export async function tanganiPesanVerifikasi(pesan: {
  body: string;
  chatId: string;
  senderJid: string | null;
  senderLid: string | null;
  fromNumber: string | null;
  fromMe: boolean;
}): Promise<HasilPesanMasuk> {
  if (pesan.fromMe) return { ditangani: false };
  const frasa = frasaDariPesan(pesan.body);
  if (!frasa) return { ditangani: false };

  const baris = await db.waVerification.findUnique({ where: { phrase: frasa } });
  if (!baris) return { ditangani: false };

  const { balasWa } = await import("./kirim");
  if (baris.expiresAt.getTime() <= Date.now()) {
    await balasWa(
      pesan.chatId,
      "Frasa ini sudah kedaluwarsa. Buka lagi halaman verifikasi di MARLIN untuk mendapatkan frasa baru.",
    );
    return { ditangani: true, hasil: "kedaluwarsa" };
  }

  const nomor = normalizePhone(pesan.fromNumber);
  const kunci = senderKeyOf({ senderJid: pesan.senderJid, fromNumber: pesan.fromNumber });

  /*
   * SATU NOMOR = SATU ORANG.
   *
   * Kalau nomor yang sama sudah terverifikasi milik akun lain, ini harus
   * BERHENTI, bukan menimpa. Jawaban WhatsApp, pengingat laporan, dan penagih
   * tenggat semuanya mencari orang dari nomor pengirim; dua akun yang mengaku
   * nomor sama membuat semua itu menjawab orang yang salah — diam-diam, dan
   * baru ketahuan ketika ada yang menerima laporan yang bukan haknya.
   */
  if (nomor) {
    const lain = await db.user.findFirst({
      where: { waNumber: nomor, waVerifiedAt: { not: null }, id: { not: baris.userId } },
      select: { fullName: true },
    });
    if (lain) {
      await balasWa(
        pesan.chatId,
        "Nomor ini sudah terdaftar atas nama pengguna MARLIN yang lain. " +
          "Hubungi admin kalau nomornya memang berpindah tangan – satu nomor hanya boleh dipakai satu akun.",
      );
      await audit(baris.userId, "user.wa_verify_bentrok", "user", baris.userId, { nomor });
      return { ditangani: true, hasil: "nomor-dipakai-orang-lain" };
    }
  }

  const kode = buatKode();
  await db.waVerification.update({
    where: { id: baris.id },
    data: { code: kode, senderKey: kunci, waNumber: nomor, waLid: pesan.senderLid, attempts: 0 },
  });
  await balasWa(
    pesan.chatId,
    `Kode verifikasi MARLIN: *${kode}*\n\n` +
      `Ketikkan kode ini di layar verifikasi. Berlaku ${MENIT_BERLAKU} menit. ` +
      "Kalau Anda tidak sedang membuka MARLIN, abaikan pesan ini dan jangan berikan kodenya kepada siapa pun.",
  );
  return { ditangani: true, hasil: "kode-dikirim" };
}

export type HasilKonfirmasi =
  | { ok: true; nomor: string | null; nomorLama: string | null }
  | { ok: false; pesan: string };

/**
 * Kode yang diketik di layar. Inilah satu-satunya tempat `waVerifiedAt` diisi.
 *
 * Sekaligus tempat `waNumber` terisi/diperbarui — permintaan user: *"itu
 * sekaligus jadi informasi nomor wa jika nomor masih kosong/atau update nomor
 * wa sebelumnya"*. Yang dipakai nomor dari PESAN MASUK, bukan yang diketik.
 */
export async function konfirmasiKode(userId: string, diketik: string): Promise<HasilKonfirmasi> {
  const baris = await db.waVerification.findUnique({ where: { userId } });
  const hasil = cocokkanKode(baris, diketik);
  if (!hasil.ok) {
    if (hasil.sebab === "kode-salah" && baris) {
      await db.waVerification.update({ where: { id: baris.id }, data: { attempts: { increment: 1 } } });
      const sisa = MAKS_PERCOBAAN - (baris.attempts + 1);
      return {
        ok: false,
        pesan:
          sisa > 0
            ? `Kode salah. Sisa ${sisa} percobaan.`
            : "Kode salah dan percobaannya habis. Mulai lagi dari awal untuk mendapatkan frasa baru.",
      };
    }
    const pesan: Record<typeof hasil.sebab, string> = {
      kedaluwarsa: "Percobaan ini sudah kedaluwarsa. Mulai lagi untuk mendapatkan frasa baru.",
      "belum-ada-pesan": "Pesan WhatsApp-nya belum sampai. Kirim dulu frasanya dari nomor Anda.",
      "habis-percobaan": "Percobaannya sudah habis. Mulai lagi dari awal untuk mendapatkan frasa baru.",
      "kode-salah": "Kode salah.",
    };
    return { ok: false, pesan: pesan[hasil.sebab] };
  }

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { waNumber: true },
  });
  const nomorLama = user.waNumber;
  const nomor = baris!.waNumber ?? nomorLama;

  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: {
        waNumber: nomor,
        // LID hanya ditimpa kalau pesannya memang membawanya — sebagian payload
        // WAHA tidak, dan menghapus pemetaan yang sudah benar lebih merugikan
        // daripada tidak memperbaruinya.
        ...(baris!.waLid ? { waLid: baris!.waLid } : {}),
        waVerifiedAt: new Date(),
      },
    }),
    db.waVerification.delete({ where: { id: baris!.id } }),
  ]);
  await audit(userId, "user.wa_verify", "user", userId, {
    nomor,
    nomorLama,
    berubah: nomorLama !== nomor,
  });
  return { ok: true, nomor, nomorLama };
}
