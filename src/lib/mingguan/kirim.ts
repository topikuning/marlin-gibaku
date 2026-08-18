import "server-only";
import { db } from "@/lib/db";
import { getLocationProgress, type LocationProgress } from "@/lib/progress";
import { weightedPct, weightedRealizedPct } from "@/lib/progress-calc";
import { isWahaConfigured, sendText } from "@/lib/waha/client";
import { formatTanggal } from "@/lib/format";
import { susunPesanMingguan, type BarisLokasiMingguan, type RekapPaket } from "./pesan";

/**
 * Pengirim LAPORAN PROGRES MINGGUAN ke grup WhatsApp paket (DECISIONS 311).
 *
 * Satu paket = satu kontrak = satu SPMK = satu nomor minggu, jadi seluruh
 * lokasinya masuk ke SATU pesan. Dipakai dua jalur — penjadwal dan tombol
 * manual — dan keduanya memanggil fungsi yang SAMA supaya isi pesannya tidak
 * pernah bisa berbeda antara yang otomatis dan yang ditekan orang.
 */

/** Berapa hari kalender sejak SPMK, dihitung utuh (bukan pecahan jam). */
const HARI_MS = 86_400_000;

/**
 * Minggu kontrak ke berapa hari ini — DITURUNKAN dari tanggal SPMK, tanpa
 * dibatasi panjang kurva-S.
 *
 * Sengaja tidak memakai `weekNumber` milik `getLocationProgress`: angka itu
 * di-clamp ke jumlah minggu baseline masing-masing lokasi, jadi pada kontrak
 * yang molor dua lokasi dalam satu paket bisa melaporkan nomor minggu yang
 * berbeda di satu pesan yang sama. Nomor minggu adalah sifat KONTRAK; kalau
 * pelaksanaannya lewat dari jadwal, yang benar adalah mengatakan minggu ke-25,
 * bukan menahannya di 20.
 */
export function mingguKontrak(startDate: Date, now: Date): number {
  const hari = Math.floor((tengahMalam(now) - tengahMalam(startDate)) / HARI_MS);
  return Math.floor(hari / 7) + 1;
}

/**
 * Apakah `now` jatuh pada HARI TERAKHIR sebuah minggu kontrak.
 *
 * Minggu ke-N mencakup hari ke-(N−1)×7 sampai N×7−1 sejak SPMK, jadi hari
 * terakhirnya adalah yang sisa-baginya 6. Penjadwal dipanggil harian dan
 * memakai ini sebagai satu-satunya penentu "sudah waktunya" — dengan begitu
 * harinya mengikuti tanggal SPMK tiap paket (pilihan user), bukan hari tetap
 * dalam seminggu yang bisa jatuh di tengah minggu kontrak.
 */
export function akhirMingguKontrak(startDate: Date, now: Date): boolean {
  const hari = Math.floor((tengahMalam(now) - tengahMalam(startDate)) / HARI_MS);
  return hari >= 0 && hari % 7 === 6;
}

/** Tengah malam UTC dari sebuah tanggal — supaya selisihnya utuh per hari. */
function tengahMalam(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Hari pertama & terakhir sebuah minggu kontrak (DECISIONS 357).
 *
 * Kebalikan `mingguKontrak`. Dipakai mengirim laporan minggu yang SUDAH SELESAI:
 * angkanya harus dihitung `asOf` hari terakhir minggu itu, bukan hari ini.
 * Tanpa itu, judulnya berbunyi "Minggu ke-6" sementara isinya realisasi hari ini
 * — jawaban benar untuk minggu yang salah, dan penerimanya (PPK, konsultan)
 * tidak punya cara mengetahuinya.
 */
export function rentangMingguKontrak(startDate: Date, mingguKe: number): { mulai: Date; akhir: Date } {
  const n = Math.max(1, Math.floor(mingguKe));
  const awal = tengahMalam(startDate) + (n - 1) * 7 * HARI_MS;
  return { mulai: new Date(awal), akhir: new Date(awal + 6 * HARI_MS) };
}

/**
 * Minggu kontrak TERAKHIR yang sudah tuntas pada `now`.
 *
 * Nol berarti kontraknya belum melewati satu minggu penuh pun — bukan "minggu
 * ke-0". Pemanggil WAJIB memeriksanya; menawarkan "kirim minggu terakhir" pada
 * kontrak yang baru berjalan tiga hari menjanjikan laporan yang isinya belum ada.
 */
export function mingguSelesaiTerakhir(startDate: Date, now: Date): number {
  return mingguKontrak(startDate, now) - 1;
}

/**
 * Tanggal yang dipakai sebagai `asOf` untuk sebuah minggu target.
 *
 * Minggu BERJALAN memakai `now` — memakai akhir minggunya berarti memakai
 * tanggal DEPAN, dan `report_date <= asOf` akan diam-diam memasukkan laporan
 * yang belum ada sambil membuat nomor minggunya melompat.
 */
export function asOfMinggu(startDate: Date, mingguKe: number, now: Date): Date {
  const berjalan = mingguKontrak(startDate, now);
  if (mingguKe >= berjalan) return now;
  return rentangMingguKontrak(startDate, mingguKe).akhir;
}

/**
 * Angka SELURUH paket — rata-rata TERTIMBANG nilai kontrak tiap lokasi, memakai
 * `weightedPct`/`weightedRealizedPct` dari `progress-calc` (formula kanonik,
 * B13). Tidak ada rata-rata baru yang ditulis di sini: lokasi Rp 12 M dan
 * lokasi Rp 3 M tidak boleh dihitung sama berat, dan rata-rata biasa akan
 * membuat paket tampak lebih maju daripada kenyataannya.
 *
 * Deviasinya = realisasi tertimbang − target tertimbang, BUKAN rata-rata dari
 * deviasi per lokasi. Keduanya angka yang berbeda, dan yang benar untuk sebuah
 * paket adalah yang pertama.
 *
 * Lokasi tanpa kurva-S DIKELUARKAN, bukan dihitung sebagai target 0%.
 * Memasukkannya akan menyeret target paket ke bawah dan membuat paket terbaca
 * mendahului jadwal — kebohongan yang sama persis dengan yang sudah dihindari
 * di tingkat lokasi. Jumlah yang dikeluarkan ikut disebut di pesan.
 */
export function rekapPaket(berkurva: LocationProgress[], tanpaKurva: number): RekapPaket | null {
  if (berkurva.length === 0) return null;
  const targetPct = weightedPct(berkurva.map((p) => ({ grandTotal: p.grandTotal, pct: p.planPct })));
  const realisasiPct = weightedRealizedPct(berkurva);
  return {
    targetPct,
    realisasiPct,
    deviasiPct: realisasiPct - targetPct,
    lokasiDihitung: berkurva.length,
    lokasiTanpaKurva: tanpaKurva,
  };
}

export type HasilKirimMingguan =
  | { ok: true; mingguKe: number; lokasi: number; body: string; waMessageId: string | null }
  | { ok: false; alasan: string; body?: string };

/** Paket + kontrak + lokasi aktif, secukupnya untuk menyusun pesan. */
async function muatPaket(packageId: string) {
  return db.package.findUnique({
    where: { id: packageId },
    select: {
      id: true,
      name: true,
      waGroupId: true,
      contract: { select: { startDate: true, vendor: { select: { name: true } } } },
      locations: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, regency: true, province: true },
      },
    },
  });
}

/**
 * Susun teks laporan mingguan satu paket TANPA mengirim apa pun.
 *
 * Dipakai pratinjau di layar sebelum menekan kirim: laporan resmi ke pemberi
 * kerja tidak boleh berangkat tanpa ada yang sempat membacanya lebih dulu.
 */
export async function pratinjauMingguan(
  packageId: string,
  now = new Date(),
  /**
   * Minggu kontrak yang diminta. Kosong = minggu BERJALAN (perilaku lama).
   *
   * Permintaan user 2026-08-17: *"kadang kita butuh kirim minggu terakhir"* —
   * minggu berjalan baru berisi sebagian hari, dan yang dilaporkan ke PPK
   * biasanya minggu yang sudah tuntas (DECISIONS 357).
   */
  mingguDiminta?: number,
): Promise<{ body: string; mingguKe: number; lokasi: number; berjalan: boolean } | { alasan: string }> {
  const pkg = await muatPaket(packageId);
  if (!pkg) return { alasan: "Paket tidak ditemukan." };
  if (!pkg.contract?.startDate) {
    return { alasan: "Paket ini belum punya tanggal SPMK, jadi minggu kontraknya belum ada." };
  }
  if (pkg.locations.length === 0) return { alasan: "Paket ini belum punya lokasi aktif." };

  const mingguBerjalan = mingguKontrak(pkg.contract.startDate, now);
  const mingguKe = mingguDiminta ?? mingguBerjalan;
  if (mingguKe < 1) {
    return { alasan: "Kontrak ini belum melewati satu minggu penuh, jadi belum ada minggu selesai yang bisa dilaporkan." };
  }
  if (mingguKe > mingguBerjalan) {
    return { alasan: `Minggu ke-${mingguKe} belum terjadi — minggu kontrak yang sedang berjalan baru ke-${mingguBerjalan}.` };
  }
  const berjalan = mingguKe >= mingguBerjalan;
  /*
   * Angka dihitung PADA akhir minggu target, bukan hari ini (DECISIONS 357).
   * `asOf` sudah didukung calculation layer dan artinya persis ini: laporan
   * mana yang ikut dihitung (`report_date <= asOf`). Tanpa ini, judul "Minggu
   * ke-6" akan memuat realisasi hari ini.
   */
  const asOf = asOfMinggu(pkg.contract.startDate, mingguKe, now);
  const baris: BarisLokasiMingguan[] = [];
  /** Hanya yang punya kurva-S yang boleh ikut rekap — lihat `rekapPaket`. */
  const berkurva: LocationProgress[] = [];
  let tanpaKurva = 0;

  for (const l of pkg.locations) {
    // Angkanya DITERIMA dari calculation layer, tidak dihitung ulang di sini
    // (CLAUDE.md). `totalWeeks === 0` = lokasi belum punya baseline sama sekali.
    const p = await getLocationProgress(l.id, { asOf });
    const belumAdaKurva = p.totalWeeks === 0;
    if (belumAdaKurva) tanpaKurva += 1;
    else berkurva.push(p);
    baris.push({
      nama: l.name,
      wilayah: [l.regency, l.province].filter(Boolean).join(", "),
      targetPct: belumAdaKurva ? null : p.planPct,
      realisasiPct: p.realizedPct,
      deviasiPct: p.deviationPct,
    });
  }

  const rentang = rentangMingguKontrak(pkg.contract.startDate, mingguKe);
  const body = susunPesanMingguan({
    pelaksana: pkg.contract.vendor.name,
    mingguKe,
    periode: `${formatTanggal(rentang.mulai, "d MMM")} – ${formatTanggal(rentang.akhir, "d MMM yyyy")}`,
    berjalan,
    lokasi: baris,
    rekap: rekapPaket(berkurva, tanpaKurva),
  });
  if (!body) return { alasan: "Tidak ada lokasi yang bisa dilaporkan." };
  return { body, mingguKe, lokasi: baris.length, berjalan };
}

/**
 * Kirim laporan mingguan satu paket ke grup WA-nya, lalu catat jejaknya.
 *
 * `paksa` dipakai tombol manual: ia MENIMPA baris minggu yang sama alih-alih
 * menolak. Yang dijaga UNIQUE `(paket, minggu)` adalah penjadwal yang tidak
 * boleh mengumumkan minggu yang sama dua kali; orang yang menekan tombol tahu
 * persis apa yang ia lakukan dan sering justru sedang mengulang kiriman yang
 * gagal (pola yang sama dengan pengingat harian, DECISIONS 207).
 */
export async function kirimLaporanMingguan(
  packageId: string,
  opts: {
    manual?: boolean;
    paksa?: boolean;
    sentById?: string;
    now?: Date;
    /** Minggu kontrak yang diminta; kosong = minggu berjalan (DECISIONS 357). */
    mingguKe?: number;
  } = {},
): Promise<HasilKirimMingguan> {
  const now = opts.now ?? new Date();
  const pkg = await muatPaket(packageId);
  if (!pkg) return { ok: false, alasan: "Paket tidak ditemukan." };
  if (!pkg.waGroupId) {
    return { ok: false, alasan: "Paket ini belum ditautkan ke grup WhatsApp." };
  }
  if (!(await isWahaConfigured())) {
    return { ok: false, alasan: "WhatsApp (WAHA) belum dikonfigurasi." };
  }

  const siap = await pratinjauMingguan(packageId, now, opts.mingguKe);
  if ("alasan" in siap) return { ok: false, alasan: siap.alasan };

  const sudah = await db.weeklyWaLog.findUnique({
    where: { packageId_weekNumber: { packageId, weekNumber: siap.mingguKe } },
    select: { id: true, status: true, attempts: true },
  });
  // Sudah PERNAH BERHASIL untuk minggu ini → penjadwal berhenti di sini.
  // Baris `gagal` tidak menghalangi: yang tidak boleh berulang adalah pesan
  // yang benar-benar sampai, bukan percobaan yang kandas karena WAHA mati.
  if (sudah?.status === "sukses" && !opts.paksa) {
    return { ok: false, alasan: `Minggu ke-${siap.mingguKe} sudah pernah dikirim.` };
  }

  let waMessageId: string | null = null;
  let status = "sukses";
  let error: string | null = null;
  try {
    waMessageId = await sendText(pkg.waGroupId, siap.body);
  } catch (err) {
    status = "gagal";
    error = err instanceof Error ? err.message : "Gagal mengirim";
  }

  const isi = {
    locations: siap.lokasi,
    status,
    error,
    waMessageId,
    chatId: pkg.waGroupId,
    manual: opts.manual ?? false,
    body: siap.body,
    sentById: opts.sentById ?? null,
    lastSentAt: now,
  };
  await db.weeklyWaLog.upsert({
    where: { packageId_weekNumber: { packageId, weekNumber: siap.mingguKe } },
    create: { packageId, weekNumber: siap.mingguKe, attempts: 1, ...isi },
    update: { attempts: (sudah?.attempts ?? 0) + 1, ...isi },
  });

  if (status === "gagal") return { ok: false, alasan: error ?? "Gagal mengirim", body: siap.body };
  return { ok: true, mingguKe: siap.mingguKe, lokasi: siap.lokasi, body: siap.body, waMessageId };
}
