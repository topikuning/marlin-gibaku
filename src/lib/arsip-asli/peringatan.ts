import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { createHash } from "node:crypto";

/**
 * PERINGATAN ARSIP DINGIN — lapis TERAKHIR, bukan lapis pertama.
 *
 * Permintaan user 2026-09-11: peringatan WhatsApp, bisa dihidup-matikan, *"dan
 * yang lebih penting kamu harus handle jika ada masalah secara otomatis"*.
 * Urutan itu yang dipakai: sebagian besar kerusakan sudah ditangani sendiri di
 * `antrean.ts` dan tidak pernah sampai ke sini —
 *
 *   arsip tidak bisa dihubungi  → tidak ada yang dihapus, dicoba lagi nanti
 *   pengiriman gagal di putaran → pembuangan salinan R2 DITAHAN seluruhnya
 *   berkas lenyap dari arsip    → catatannya dibatalkan, dikirim ulang, R2 aman
 *   gagal 5 kali                → dicoba lagi sendiri sesudah masa pulih
 *
 * Yang tersisa untuk peringatan hanya yang TIDAK BISA diselesaikan sendiri oleh
 * mesin: keadaan yang butuh orang datang ke mesinnya. Pemberitahuan untuk hal
 * yang sudah beres sendiri bukan kewaspadaan — ia melatih orang mengabaikan
 * pesan, dan pesan yang diabaikan sama saja dengan tidak ada.
 */

/** Sisa ruang di bawah ini = arsip akan berhenti menerima, dan itu butuh orang. */
export const AMBANG_DISK_BYTE = 20 * 1024 ** 3;

/** Selama ini tidak ada satu pun yang berhasil, padahal ada antrean = macet. */
export const AMBANG_MACET_JAM = 24;

export type FaktaPeringatan = {
  aktif: boolean;
  terkonfigurasi: boolean;
  menunggu: number;
  gagalTerus: number;
  terakhirBerhasil: Date | null;
  galatTerakhir: string | null;
  sisaBytes: number | null;
};

export type Masalah = { kode: string; teks: string };

/**
 * Aturan MURNI (tanpa DB, tanpa jaringan) supaya bisa diuji apa adanya.
 *
 * Diam adalah jawaban yang benar untuk dua hal, dan keduanya sering keliru
 * dianggap masalah: fitur yang memang DIMATIKAN orang, dan alamat arsip yang
 * memang belum diisi. Keduanya keadaan yang disengaja, bukan kerusakan.
 */
export function kenaliMasalah(f: FaktaPeringatan, now = new Date()): Masalah[] {
  if (!f.aktif || !f.terkonfigurasi) return [];
  const m: Masalah[] = [];

  // Paling gawat lebih dulu: ini satu-satunya yang bisa berakhir dengan berkas
  // hilang dari kedua tempat kalau dibiarkan.
  if (f.galatTerakhir && /TIDAK ADA di arsip/i.test(f.galatTerakhir)) {
    m.push({
      kode: "hilang-dari-arsip",
      teks:
        "Ada berkas yang tercatat sudah diarsipkan tapi TIDAK ADA di mesin arsip. " +
        "Salinan R2-nya ditahan (tidak dibuang) dan berkasnya dikirim ulang otomatis. " +
        "Periksa mesinnya: disk terganti, direktori ter-mount ulang, atau ada yang menghapus manual.",
    });
  }

  const jamDiam =
    f.terakhirBerhasil == null
      ? Infinity
      : (now.getTime() - f.terakhirBerhasil.getTime()) / 3_600_000;
  if (f.menunggu > 0 && jamDiam >= AMBANG_MACET_JAM) {
    m.push({
      kode: "macet",
      teks:
        `${f.menunggu} berkas asli menunggu dan tidak ada satu pun yang berhasil dipindahkan ` +
        `${f.terakhirBerhasil ? `sejak ${Math.floor(jamDiam)} jam lalu` : "sama sekali"}. ` +
        "Periksa mesin arsip, Tunnel, dan penjadwal di GitHub Actions.",
    });
  }

  if (f.gagalTerus > 0) {
    m.push({
      kode: "berhenti-dicoba",
      teks:
        `${f.gagalTerus} berkas berhenti dicoba karena gagal berulang. ` +
        "Berkasnya tetap aman di R2 – yang berhenti hanya pemindahannya. " +
        `Akan dicoba lagi sendiri, tapi kalau angkanya terus naik berarti ada sebab tetap: ${f.galatTerakhir ?? "-"}`,
    });
  }

  if (f.sisaBytes != null && f.sisaBytes < AMBANG_DISK_BYTE) {
    m.push({
      kode: "disk-menipis",
      teks:
        `Sisa ruang di mesin arsip tinggal ${(f.sisaBytes / 1024 ** 3).toFixed(1)} GB. ` +
        "Di bawah ambangnya, arsip berhenti menerima berkas baru.",
    });
  }

  return m;
}

const AKSI = "system.arsip_asli_peringatan";

/**
 * Peredam pengulangan: satu pesan per HARI untuk keadaan yang SAMA.
 *
 * Pola yang sama dengan penagih tenggat temuan — sidik jari keadaan disimpan di
 * `audit_logs`, bukan di tabel baru. Tanpa peredam ini, masalah yang menetap
 * mengirim pesan tiap jam mengikuti jadwal cron, dan yang dibaca orang pada
 * pesan ke-20 bukan isinya melainkan kejengkelannya.
 *
 * Keadaan BERUBAH mengirim ulang seketika, tidak menunggu jeda: masalah yang
 * bertambah adalah kabar baru, bukan pengulangan.
 */
const JEDA_JAM = 24;

function sidik(masalah: Masalah[]): string {
  return createHash("sha256")
    .update(masalah.map((m) => m.kode).sort().join("|"))
    .digest("hex")
    .slice(0, 16);
}

async function bolehKirim(s: string, now: Date): Promise<boolean> {
  const row = await db.auditLog.findFirst({
    where: { action: AKSI },
    orderBy: { createdAt: "desc" },
    select: { payload: true, createdAt: true },
  });
  if (!row) return true;
  const p = row.payload as { sidik?: unknown } | null;
  if (!p || typeof p.sidik !== "string" || p.sidik !== s) return true;
  return (now.getTime() - row.createdAt.getTime()) / 3_600_000 >= JEDA_JAM;
}

export type HasilPeringatan = {
  masalah: number;
  terkirim: boolean;
  alasan: "tidak-ada-masalah" | "wa-mati" | "tanpa-tujuan" | "diredam" | "terkirim" | "gagal";
};

/**
 * Periksa keadaan arsip, kirim peringatan bila perlu.
 *
 * Dipanggil dari DUA jadwal yang berbeda, dan itu disengaja: putaran arsip tiap
 * jam, DAN tugas harian. Kalau ia hanya menumpang di putaran arsip, maka
 * penjadwal arsip yang MATI TOTAL — `APP_URL`/`CRON_SECRET` belum diisi,
 * workflow dinonaktifkan GitHub karena repo 60 hari tanpa commit — menghasilkan
 * kesunyian sempurna: tidak ada yang berjalan, jadi tidak ada yang melapor
 * bahwa tidak ada yang berjalan.
 */
export async function periksaDanPeringatkan(now = new Date()): Promise<HasilPeringatan> {
  const { arsipAktif } = await import("./setelan");
  const { waArsipAktif, waArsipTujuan } = await import("./setelan");
  const { setelanDingin, statusDingin } = await import("./dingin");
  const { ringkasArsipAsli } = await import("./antrean");

  const setelan = setelanDingin();
  const ringkas = await ringkasArsipAsli();

  let sisaBytes: number | null = null;
  if (setelan) {
    try {
      sisaBytes = (await statusDingin(setelan)).freeBytes;
    } catch {
      // Sisa disk hanya salah satu gejala; kegagalan membacanya tidak boleh
      // menghalangi peringatan tentang gejala lain yang sudah diketahui.
    }
  }

  const masalah = kenaliMasalah(
    {
      aktif: await arsipAktif(),
      terkonfigurasi: setelan != null,
      menunggu: ringkas.menunggu,
      gagalTerus: ringkas.gagalTerus,
      terakhirBerhasil: ringkas.terakhirBerhasil,
      galatTerakhir: ringkas.galatTerakhir,
      sisaBytes,
    },
    now,
  );

  if (masalah.length === 0) return { masalah: 0, terkirim: false, alasan: "tidak-ada-masalah" };
  if (!(await waArsipAktif())) return { masalah: masalah.length, terkirim: false, alasan: "wa-mati" };

  const tujuan = await waArsipTujuan();
  if (!tujuan) return { masalah: masalah.length, terkirim: false, alasan: "tanpa-tujuan" };

  const s = sidik(masalah);
  if (!(await bolehKirim(s, now))) {
    return { masalah: masalah.length, terkirim: false, alasan: "diredam" };
  }

  const teks = [
    "*MARLIN – Arsip foto asli perlu diperiksa*",
    "",
    ...masalah.map((m, i) => `${i + 1}. ${m.teks}`),
    "",
    "Rinciannya di MARLIN – Sistem – Arsip dingin berkas asli.",
  ].join("\n");

  try {
    const { sendText } = await import("@/lib/waha/kirim");
    await sendText(tujuan, teks);
    await audit(null, AKSI, "system", null, { sidik: s, kode: masalah.map((m) => m.kode) });
    return { masalah: masalah.length, terkirim: true, alasan: "terkirim" };
  } catch {
    // Gagal mengirim peringatan TIDAK dicatat sebagai terkirim – kalau dicatat,
    // peredamnya akan menahan percobaan berikutnya selama sehari penuh untuk
    // pesan yang tidak pernah sampai.
    return { masalah: masalah.length, terkirim: false, alasan: "gagal" };
  }
}
