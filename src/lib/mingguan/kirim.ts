import "server-only";
import { db } from "@/lib/db";
import { getLocationProgress } from "@/lib/progress";
import { isWahaConfigured, sendText } from "@/lib/waha/client";
import { susunPesanMingguan, type BarisLokasiMingguan } from "./pesan";

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
        select: { id: true, name: true },
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
): Promise<{ body: string; mingguKe: number; lokasi: number } | { alasan: string }> {
  const pkg = await muatPaket(packageId);
  if (!pkg) return { alasan: "Paket tidak ditemukan." };
  if (!pkg.contract?.startDate) {
    return { alasan: "Paket ini belum punya tanggal SPMK, jadi minggu kontraknya belum ada." };
  }
  if (pkg.locations.length === 0) return { alasan: "Paket ini belum punya lokasi aktif." };

  const mingguKe = mingguKontrak(pkg.contract.startDate, now);
  const baris: BarisLokasiMingguan[] = [];
  for (const l of pkg.locations) {
    // Angkanya DITERIMA dari calculation layer, tidak dihitung ulang di sini
    // (CLAUDE.md). `totalWeeks === 0` = lokasi belum punya baseline sama sekali.
    const p = await getLocationProgress(l.id);
    const belumAdaKurva = p.totalWeeks === 0;
    baris.push({
      nama: l.name,
      targetPct: belumAdaKurva ? null : p.planPct,
      realisasiPct: p.realizedPct,
      deviasiPct: p.deviationPct,
    });
  }

  const body = susunPesanMingguan({
    pelaksana: pkg.contract.vendor.name,
    mingguKe,
    lokasi: baris,
  });
  if (!body) return { alasan: "Tidak ada lokasi yang bisa dilaporkan." };
  return { body, mingguKe, lokasi: baris.length };
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
  opts: { manual?: boolean; paksa?: boolean; sentById?: string; now?: Date } = {},
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

  const siap = await pratinjauMingguan(packageId, now);
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
