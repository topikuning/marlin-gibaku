import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { jakartaDateKey, formatTanggal, parseDateKey } from "@/lib/format";
import { canTransitionLocation } from "@/lib/lifecycle";
import { sendText, isWahaConfigured, getSessionStatus } from "@/lib/waha/client";
import { normalizeWaTarget } from "@/lib/contacts/model";
import { pesanPengingat, type LokasiTertagih } from "./pesan";
import type { DiagnosaPengingat } from "./diagnosa";

/**
 * Pekerjaan harian MARLIN (DECISIONS 202) — dijalankan penjadwal luar lewat
 * `POST /api/cron/harian`.
 *
 * Dua pekerjaan, sengaja satu pintu: keduanya butuh "hari ini menurut
 * Asia/Jakarta", dan keduanya harus aman dipicu berkali-kali.
 */

/** Hasil satu penerima — supaya "berhasil atau tidak" tidak perlu ditebak. */
export type RincianKirim = {
  nama: string;
  /** Tujuan yang benar-benar dipakai (628…@c.us). */
  tujuan: string;
  ok: boolean;
  /** ID pesan dari WAHA. Null = WAHA menerima permintaan tapi tak memberi bukti. */
  waMessageId: string | null;
  error?: string;
};

export type { DiagnosaPengingat } from "./diagnosa";
export { sebabTidakAdaPenerima } from "./diagnosa";

export type HasilPengingat = {
  terkirim: number;
  gagal: number;
  dilewati: number;
  /** Status sesi WhatsApp saat itu. INFORMASI, bukan pagar (DECISIONS 207). */
  sesi: string;
  rincian: RincianKirim[];
  /** Angka pendukung supaya "0 terkirim" bisa menjelaskan dirinya (DECISIONS 221). */
  diagnosa?: DiagnosaPengingat;
  /**
   * Penjadwal tidak mengirim apa pun karena SAKELARNYA MATI — bukan karena
   * tidak ada yang perlu ditagih. Dua keadaan itu sama-sama "0 terkirim" dan
   * membedakannya adalah satu-satunya cara log cron bisa dibaca.
   */
  dimatikan?: boolean;
};

export type HasilHarian = {
  dateKey: string;
  spmk: { diaktifkan: number; paket: string[] };
  pengingat: HasilPengingat;
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
): Promise<{ penerima: PenerimaPengingat[]; diagnosa: DiagnosaPengingat }> {
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
  // Angka-angka ini dikumpulkan supaya "0 terkirim" bisa MENJELASKAN DIRINYA.
  // Tidak menebak sebab bukan berarti diam: jumlah lokasi yang ditagih, yang
  // sudah lapor, dan orang yang belum punya nomor WA semuanya FAKTA, bukan
  // tebakan — dan tanpa itu admin cuma melihat kalimat hijau tanpa jalan
  // keluar. DECISIONS 221.
  const diagnosa: DiagnosaPengingat = {
    lokasiDalamLingkup: lokasi.length,
    lokasiSudahLapor: 0,
    lokasiPerluDitagih: 0,
    lokasiTanpaPenugasan: 0,
    orangDitugaskan: 0,
    orangTanpaNomorWa: 0,
    orangNonaktif: 0,
  };
  const orangTerlihat = new Set<string>();
  const tanpaWa = new Set<string>();
  for (const l of lokasi) {
    const laporan = l.dailyReports[0];
    // Sudah dikirim/disetujui/final → tidak ditagih.
    if (laporan && laporan.status !== "draft") {
      diagnosa.lokasiSudahLapor++;
      continue;
    }
    diagnosa.lokasiPerluDitagih++;
    if (l.assignments.length === 0) diagnosa.lokasiTanpaPenugasan++;
    const item: LokasiTertagih = { nama: l.name, adaDraft: !!laporan };
    for (const a of l.assignments) {
      const u = a.user;
      if (!orangTerlihat.has(u.id)) {
        orangTerlihat.add(u.id);
        if (!u.isActive) diagnosa.orangNonaktif++;
        else if (!u.waNumber) tanpaWa.add(u.id);
      }
      if (!u.isActive || !u.waNumber) continue;
      const entri = perUser.get(u.id) ?? { nama: u.fullName, wa: u.waNumber, lokasi: [] };
      entri.lokasi.push(item);
      perUser.set(u.id, entri);
    }
  }
  diagnosa.orangDitugaskan = orangTerlihat.size;
  diagnosa.orangTanpaNomorWa = tanpaWa.size;

  // Urut abjad supaya daftar pratinjau di halaman sistem stabil dari waktu ke
  // waktu — daftar yang berubah urutan tiap muat ulang susah dibaca.
  const penerima = [...perUser.entries()]
    .map(([userId, e]) => ({ userId, ...e }))
    .sort((a, b) => a.nama.localeCompare(b.nama, "id"));
  return { penerima, diagnosa };
}

/**
 * Kirim pengingat WA ke penanggung jawab lokasi yang laporannya BELUM lengkap
 * hari ini. Yang sudah melapor tidak dikirimi apa pun — pengingat yang datang
 * setiap hari tanpa peduli isinya akan berhenti dibaca dalam seminggu.
 *
 * `paksa` membedakan dua pemanggil yang kebutuhannya memang berbeda
 * (DECISIONS 207):
 * - **cron** (`paksa: false`) sekali sehari per orang. Penjadwal yang dipicu
 *   dua kali tidak boleh mengirim pesan kedua ke HP orang lapangan.
 * - **admin** (`paksa: true`) sebanyak yang ia mau. Orangnya menekan tombol
 *   sadar, melihat daftar penerimanya lebih dulu, dan tahu kapan pesan pertama
 *   tidak sampai — mengunci dia sehari penuh berarti sistem memutuskan sesuatu
 *   yang bukan haknya.
 */
export async function kirimPengingatHarian(
  now = new Date(),
  orgId?: string,
  opts: {
    paksa?: boolean;
    /**
     * Batasi ke orang-orang ini saja (tombol per orang, permintaan user
     * 2026-08-05). Kosong/tak diisi = semua yang perlu ditagih.
     *
     * Penyaringan dilakukan SESUDAH `kumpulkanPengingat`, bukan lewat query
     * terpisah: dengan begitu isi pesan, daftar lokasi, dan aturan "yang sudah
     * lapor tidak ditagih" untuk satu orang PERSIS sama dengan versi massalnya.
     * Jalur kedua yang menghitung sendiri akan menyimpang cepat atau lambat.
     */
    userIds?: string[];
  } = {},
): Promise<HasilPengingat> {
  const dateKey = jakartaDateKey(now);
  const tanggal = parseDateKey(dateKey)!;
  const hasil: HasilPengingat = {
    terkirim: 0,
    gagal: 0,
    dilewati: 0,
    sesi: "tidak diketahui",
    rincian: [],
  };
  // `isWahaConfigured` ASINKRON (baca konfigurasi dari DB). Versi pertama
  // menulisnya `!isWahaConfigured()` — menegasikan Promise selalu false,
  // sehingga pengamannya TIDAK PERNAH aktif: saat WAHA mati, baris pengingat
  // tetap ditulis lalu semua pengiriman gagal, dan karena UNIQUE (user, hari)
  // percobaan yang benar berikutnya di hari itu ikut terlewat.
  if (!(await isWahaConfigured())) {
    hasil.sesi = "belum dikonfigurasi";
    return hasil;
  }

  // Status sesi DICATAT, tidak dipakai sebagai pagar. Ia berguna untuk membaca
  // hasil ("0 terkirim, sesi SCAN_QR_CODE" langsung menjelaskan dirinya), tapi
  // menjadikannya syarat berarti satu tebakan kami bisa menghentikan pengiriman
  // yang sebenarnya sehat — dan itu persis kegagalan yang lebih mahal
  // (DECISIONS 207).
  try {
    hasil.sesi = (await getSessionStatus()).status;
  } catch (err) {
    hasil.sesi = `tidak bisa dicek: ${err instanceof Error ? err.message : "gagal"}`;
  }

  const { penerima: semua, diagnosa } = await kumpulkanPengingat(now, orgId);
  hasil.diagnosa = diagnosa;
  const hanya = opts.userIds?.length ? new Set(opts.userIds) : null;
  const penerima = hanya ? semua.filter((p) => hanya.has(p.userId)) : semua;
  const tanggalTampil = formatTanggal(tanggal);
  for (const e of penerima) {
    const userId = e.userId;
    const teks = pesanPengingat(e.nama, tanggalTampil, e.lokasi);
    if (!teks) continue;

    // Nomor dinormalkan SAAT KIRIM, bukan cuma saat disimpan: baris lama (dan
    // baris hasil impor) bisa berisi "0812…", dan WAHA menerima bentuk itu
    // dengan 2xx lalu tidak mengirim apa pun. Gagal karena format harus
    // tercatat sebagai gagal, bukan menyamar jadi sukses.
    let tujuan: string;
    try {
      tujuan = normalizeWaTarget(e.wa);
    } catch (err) {
      hasil.gagal++;
      hasil.rincian.push({
        nama: e.nama,
        tujuan: e.wa,
        ok: false,
        waMessageId: null,
        error: err instanceof Error ? err.message : "Nomor WA tidak dikenal.",
      });
      continue;
    }

    // Catat DULU, lalu kirim: kalau dibalik, kegagalan mencatat = kirim ulang.
    // Untuk cron, `create` yang ditolak UNIQUE (user, hari) berarti "sudah
    // pernah hari ini" → dilewati. Untuk admin, barisnya di-upsert dan
    // `attempts` bertambah — riwayatnya tumbuh, bukan menghalangi.
    if (opts.paksa) {
      await db.dailyReminderLog.upsert({
        where: { userId_dateKey: { userId, dateKey } },
        create: {
          userId,
          dateKey,
          locations: e.lokasi.length,
          status: "sukses",
          chatId: tujuan,
          lastSentAt: now,
        },
        update: {
          locations: e.lokasi.length,
          status: "sukses",
          chatId: tujuan,
          attempts: { increment: 1 },
          lastSentAt: now,
          // Hasil percobaan LAMA dibersihkan supaya barisnya menggambarkan
          // percobaan terakhir, bukan campuran dua kejadian.
          error: null,
          waMessageId: null,
        },
      });
    } else {
      try {
        await db.dailyReminderLog.create({
          data: {
            userId,
            dateKey,
            locations: e.lokasi.length,
            status: "sukses",
            chatId: tujuan,
            lastSentAt: now,
          },
        });
      } catch {
        hasil.dilewati++; // sudah pernah dikirim hari ini
        continue;
      }
    }

    try {
      const waMessageId = await sendText(tujuan, teks);
      hasil.terkirim++;
      hasil.rincian.push({ nama: e.nama, tujuan, ok: true, waMessageId });
      // Simpan buktinya supaya "sukses" bisa ditelusuri ke pesan yang nyata.
      if (waMessageId) {
        await db.dailyReminderLog.update({
          where: { userId_dateKey: { userId, dateKey } },
          data: { waMessageId },
        });
      }
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      hasil.gagal++;
      hasil.rincian.push({ nama: e.nama, tujuan, ok: false, waMessageId: null, error: pesan });
      await db.dailyReminderLog.update({
        where: { userId_dateKey: { userId, dateKey } },
        data: { status: "gagal", error: pesan },
      });
    }
  }
  return hasil;
}

/**
 * Satu putaran pekerjaan harian. Urutannya penting: SPMK dulu, baru menagih.
 *
 * Sakelar pengingat (DECISIONS 260) diperiksa DI SINI, bukan di dalam
 * `kirimPengingatHarian`: yang boleh dimatikan admin adalah PENJADWALNYA, bukan
 * kemampuan menagih. Tombol manual memanggil fungsi yang sama dan sengaja tidak
 * lewat pemeriksaan ini.
 *
 * Aktivasi SPMK TETAP berjalan walau pengingat mati — ia menumpang putaran yang
 * sama tetapi bukan pengingat, dan menahannya akan menggeser tanggal mulai
 * pelaksanaan, yang berarti kurva-S dan seluruh deviasi ikut salah.
 */
export async function jalankanTugasHarian(now = new Date()): Promise<HasilHarian> {
  const spmk = await aktifkanSpmkJatuhTempo(now);
  const { getPengingatAktif } = await import("./setelan");
  if (!(await getPengingatAktif())) {
    return {
      dateKey: jakartaDateKey(now),
      spmk,
      pengingat: {
        terkirim: 0,
        gagal: 0,
        dilewati: 0,
        sesi: "tidak dicek",
        rincian: [],
        dimatikan: true,
      },
    };
  }
  const pengingat = await kirimPengingatHarian(now);
  return { dateKey: jakartaDateKey(now), spmk, pengingat };
}
