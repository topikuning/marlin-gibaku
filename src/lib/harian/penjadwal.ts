import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { jakartaDateKey, formatTanggal, parseDateKey } from "@/lib/format";
import { canTransitionLocation } from "@/lib/lifecycle";
import { sendText, isWahaConfigured } from "@/lib/waha/client";
import { pesanPengingat, type LokasiTertagih } from "./pesan";

/**
 * Pekerjaan harian MARLIN (DECISIONS 202) — dijalankan penjadwal luar lewat
 * `POST /api/cron/harian`.
 *
 * Dua pekerjaan, sengaja satu pintu: keduanya butuh "hari ini menurut
 * Asia/Jakarta", dan keduanya harus aman dipicu berkali-kali.
 */

export type HasilHarian = {
  dateKey: string;
  spmk: { diaktifkan: number; paket: string[] };
  pengingat: { terkirim: number; gagal: number; dilewati: number };
};

/* ── 1. Aktivasi SPMK yang jatuh tempo ───────────────────────────────────── */

/**
 * Paket berstatus `kontrak` yang SPMK-nya sudah tiba → naik ke `pelaksanaan`.
 *
 * Sebelumnya `startPelaksanaan` langsung menaikkan status begitu tombol
 * ditekan, TANPA melihat tanggalnya. Mengisi SPMK 3 Agustus pada 1 Agustus
 * membuat seluruh lokasi berstatus Berjalan dua hari lebih awal, kurva-S
 * menghitung Minggu 1, dan deviasi negatif muncul untuk hari yang pekerjaannya
 * belum boleh dimulai. Sekarang tanggal masa depan DICATAT tapi aktivasinya
 * menunggu — dan fungsi inilah yang menjalankannya.
 */
export async function aktifkanSpmkJatuhTempo(now = new Date()): Promise<HasilHarian["spmk"]> {
  const hariIni = parseDateKey(jakartaDateKey(now))!;
  const kandidat = await db.package.findMany({
    where: {
      stage: "kontrak",
      contract: { startDate: { not: null, lte: hariIni } },
    },
    select: {
      id: true,
      name: true,
      stage: true,
      contract: { select: { startDate: true } },
      locations: { select: { id: true, status: true } },
    },
  });

  const paket: string[] = [];
  for (const p of kandidat) {
    await db.$transaction(async (tx) => {
      // Baca ulang di dalam transaksi: penjadwal bisa berjalan bersamaan dengan
      // seseorang yang menekan "Mulai Pelaksanaan" manual.
      const kini = await tx.package.findUnique({ where: { id: p.id }, select: { stage: true } });
      if (kini?.stage !== "kontrak") return;

      await tx.package.update({ where: { id: p.id }, data: { stage: "pelaksanaan" } });
      await tx.packageStageHistory.create({
        data: {
          packageId: p.id,
          fromStage: "kontrak",
          toStage: "pelaksanaan",
          // changedById null = dilakukan sistem, bukan orang. Jangan pernah
          // mengatribusikan tindakan otomatis ke manusia mana pun.
          changedById: null,
          note: `Pelaksanaan dimulai otomatis pada tanggal SPMK (${jakartaDateKey(p.contract!.startDate!)})`,
        },
      });

      const mulai = p.locations.filter((l) => canTransitionLocation(l.status, "berjalan"));
      if (mulai.length > 0) {
        await tx.location.updateMany({
          where: { id: { in: mulai.map((l) => l.id) } },
          data: { status: "berjalan", isActive: true },
        });
        await tx.locationStatusHistory.createMany({
          data: mulai.map((l) => ({
            locationId: l.id,
            fromStatus: l.status,
            toStatus: "berjalan" as const,
            changedById: null,
            note: "Mulai pelaksanaan (SPMK jatuh tempo)",
          })),
        });
      }
      paket.push(p.name);
    });
  }
  if (paket.length > 0) {
    await audit(null, "package.spmk_auto_start", "package", null, { paket });
  }
  return { diaktifkan: paket.length, paket };
}

/* ── 2. Pengingat laporan harian ─────────────────────────────────────────── */

/**
 * Penerima: pemegang penugasan aktif di lokasi tsb yang punya nomor WA. Peran
 * lain (PM/AM) sengaja tidak ikut — keputusan user 2026-08-01.
 */
export type PenerimaPengingat = {
  userId: string;
  nama: string;
  wa: string;
  lokasi: LokasiTertagih[];
};

/**
 * Siapa yang perlu ditagih hari ini, dan lokasi apa saja per orang.
 *
 * DIPAKAI BERSAMA oleh pengiriman terjadwal dan pratinjau di halaman sistem
 * (DECISIONS 205) — kalau dua jalur ini punya perhitungan sendiri-sendiri,
 * admin bisa melihat daftar yang berbeda dari yang benar-benar dikirim.
 */
export async function kumpulkanPengingat(
  now = new Date(),
  /**
   * Batasi ke satu organisasi. Cron sistem memanggilnya TANPA ini (semua
   * tenant, memang tugasnya); tombol manual admin WAJIB mengisinya — admin
   * organisasi A tidak boleh mengirim WA ke orang organisasi B (DECISIONS 150).
   */
  orgId?: string,
): Promise<PenerimaPengingat[]> {
  const tanggal = parseDateKey(jakartaDateKey(now))!;

  // Lokasi yang WAJIB punya laporan hari ini: berjalan, di paket pelaksanaan,
  // dan SPMK-nya sudah lewat (tidak menagih hari sebelum pekerjaan dimulai).
  const lokasi = await db.location.findMany({
    where: {
      status: "berjalan",
      isActive: true,
      package: {
        stage: "pelaksanaan",
        contract: { startDate: { not: null, lte: tanggal } },
        ...(orgId ? { orgId } : {}),
      },
    },
    select: {
      id: true,
      name: true,
      dailyReports: { where: { reportDate: tanggal }, select: { status: true } },
      assignments: {
        where: { unassignedAt: null },
        select: { user: { select: { id: true, fullName: true, waNumber: true, isActive: true } } },
      },
    },
  });

  // Kumpulkan per PENERIMA, bukan per lokasi: satu orang yang memegang tiga
  // lokasi harus menerima SATU pesan berisi tiga baris, bukan tiga pesan.
  const perUser = new Map<
    string,
    { nama: string; wa: string; lokasi: LokasiTertagih[] }
  >();
  for (const l of lokasi) {
    const laporan = l.dailyReports[0];
    // Sudah dikirim/disetujui/final → tidak ditagih.
    if (laporan && laporan.status !== "draft") continue;
    const item: LokasiTertagih = { nama: l.name, adaDraft: !!laporan };
    for (const a of l.assignments) {
      const u = a.user;
      if (!u.isActive || !u.waNumber) continue;
      const entri = perUser.get(u.id) ?? { nama: u.fullName, wa: u.waNumber, lokasi: [] };
      entri.lokasi.push(item);
      perUser.set(u.id, entri);
    }
  }

  // Urut abjad supaya daftar pratinjau di halaman sistem stabil dari waktu ke
  // waktu — daftar yang berubah urutan tiap muat ulang susah dibaca.
  return [...perUser.entries()]
    .map(([userId, e]) => ({ userId, ...e }))
    .sort((a, b) => a.nama.localeCompare(b.nama, "id"));
}

/**
 * Kirim pengingat WA ke penanggung jawab lokasi yang laporannya BELUM lengkap
 * hari ini. Yang sudah melapor tidak dikirimi apa pun — pengingat yang datang
 * setiap hari tanpa peduli isinya akan berhenti dibaca dalam seminggu.
 */
export async function kirimPengingatHarian(
  now = new Date(),
  orgId?: string,
): Promise<HasilHarian["pengingat"]> {
  const dateKey = jakartaDateKey(now);
  const tanggal = parseDateKey(dateKey)!;
  const hasil = { terkirim: 0, gagal: 0, dilewati: 0 };
  // `isWahaConfigured` ASINKRON (baca konfigurasi dari DB). Versi pertama
  // menulisnya `!isWahaConfigured()` — menegasikan Promise selalu false,
  // sehingga pengamannya TIDAK PERNAH aktif: saat WAHA mati, baris pengingat
  // tetap ditulis lalu semua pengiriman gagal, dan karena UNIQUE (user, hari)
  // percobaan yang benar berikutnya di hari itu ikut terlewat.
  if (!(await isWahaConfigured())) return hasil;

  const penerima = await kumpulkanPengingat(now, orgId);
  const tanggalTampil = formatTanggal(tanggal);
  for (const e of penerima) {
    const userId = e.userId;
    const teks = pesanPengingat(e.nama, tanggalTampil, e.lokasi);
    if (!teks) continue;

    // Catat DULU: unique (userId, dateKey) menolak percobaan kedua di hari yang
    // sama, jadi pesan dobel tercegah walau cron dipicu berkali-kali. Kalau
    // dibalik (kirim dulu, catat kemudian), kegagalan mencatat = kirim ulang.
    try {
      await db.dailyReminderLog.create({
        data: { userId, dateKey, locations: e.lokasi.length, status: "sukses" },
      });
    } catch {
      hasil.dilewati++; // sudah pernah dikirim hari ini
      continue;
    }

    try {
      await sendText(e.wa, teks);
      hasil.terkirim++;
    } catch (err) {
      hasil.gagal++;
      await db.dailyReminderLog.update({
        where: { userId_dateKey: { userId, dateKey } },
        data: { status: "gagal", error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  return hasil;
}

/** Satu putaran pekerjaan harian. Urutannya penting: SPMK dulu, baru menagih. */
export async function jalankanTugasHarian(now = new Date()): Promise<HasilHarian> {
  const spmk = await aktifkanSpmkJatuhTempo(now);
  const pengingat = await kirimPengingatHarian(now);
  return { dateKey: jakartaDateKey(now), spmk, pengingat };
}
