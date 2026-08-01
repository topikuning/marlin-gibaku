import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey } from "@/lib/format";
import { isWahaConfigured, getSessionStatus } from "@/lib/waha/client";
import { kumpulkanPengingat } from "./penjadwal";

/**
 * Pratinjau pengingat harian untuk halaman Sistem (DECISIONS 205).
 *
 * SENGAJA di luar modul `"use server"`: setiap ekspor di sana menjadi endpoint
 * yang bisa dipanggil siapa pun yang tahu id-nya, dan daftar ini memuat nama
 * orang. Di sini ia hanya bisa dipanggil dari Server Component yang sudah
 * lewat page-guard.
 */

export type PratinjauPengingat = {
  dateKey: string;
  wahaSiap: boolean;
  /** Status sesi WhatsApp: "WORKING" = siap kirim. Selain itu, nol yang sampai. */
  sesiStatus: string;
  /** Yang akan ditagih bila tombol ditekan sekarang. */
  akanDitagih: { nama: string; lokasi: string[]; adaDraft: boolean[] }[];
  /** Sudah menerima pengingat hari ini (tidak akan dikirimi lagi). */
  sudahDikirim: { nama: string; lokasi: number; status: string }[];
  /** Penanggung jawab lokasi tertagih yang TIDAK punya nomor WA. */
  tanpaNomor: string[];
};

/**
 * Apa yang akan terjadi kalau tombolnya ditekan — dihitung dengan fungsi yang
 * SAMA dengan pengirimannya. Tombol yang mengirim pesan ke HP orang lain tidak
 * boleh ditekan tanpa tahu siapa yang menerimanya.
 */
export async function pratinjauPengingat(orgId: string): Promise<PratinjauPengingat> {
  const now = new Date();
  const dateKey = jakartaDateKey(now);
  const penerima = await kumpulkanPengingat(now, orgId);

  // Status sesi ditarik SEKARANG, bukan diasumsikan: admin harus tahu tombolnya
  // akan mengirim atau cuma menghanguskan jatah hari ini (DECISIONS 206).
  const siap = await isWahaConfigured();
  let sesi = "belum dikonfigurasi";
  if (siap) {
    try {
      sesi = (await getSessionStatus()).status;
    } catch (err) {
      sesi = `tidak bisa dicek: ${err instanceof Error ? err.message : "gagal"}`;
    }
  }

  // `DailyReminderLog` tidak punya relasi Prisma ke User, jadi penyaringan
  // organisasi dilakukan lewat daftar id — bukan dilewati begitu saja.
  const anggota = await db.user.findMany({ where: { orgId }, select: { id: true, fullName: true } });
  const namaOrg = new Map(anggota.map((u) => [u.id, u.fullName]));
  const log = await db.dailyReminderLog.findMany({
    where: { dateKey, userId: { in: [...namaOrg.keys()] } },
    select: { userId: true, locations: true, status: true },
  });
  const sudah = new Map(log.map((l) => [l.userId, l]));

  return {
    dateKey,
    wahaSiap: siap,
    sesiStatus: sesi,
    akanDitagih: penerima
      .filter((p) => !sudah.has(p.userId))
      .map((p) => ({
        nama: p.nama,
        lokasi: p.lokasi.map((l) => l.nama),
        adaDraft: p.lokasi.map((l) => l.adaDraft),
      })),
    sudahDikirim: log.map((l) => ({
      nama: namaOrg.get(l.userId) ?? "—",
      lokasi: l.locations,
      status: l.status,
    })),
    tanpaNomor: await penanggungJawabTanpaNomor(now, orgId),
  };
}

/**
 * Penanggung jawab lokasi yang perlu ditagih tetapi nomornya kosong — mereka
 * TIDAK akan dikirimi apa pun. Disebut namanya supaya admin tahu bahwa
 * "terkirim 3" tidak berarti semua orang tertagih.
 */
async function penanggungJawabTanpaNomor(now: Date, orgId: string): Promise<string[]> {
  const tanggal = new Date(`${jakartaDateKey(now)}T00:00:00.000Z`);
  const lokasi = await db.location.findMany({
    where: {
      status: "berjalan",
      isActive: true,
      package: { orgId, stage: "pelaksanaan", contract: { startDate: { not: null, lte: tanggal } } },
    },
    select: {
      dailyReports: { where: { reportDate: tanggal }, select: { status: true } },
      assignments: {
        where: { unassignedAt: null },
        select: { user: { select: { fullName: true, waNumber: true, isActive: true } } },
      },
    },
  });
  const out = new Set<string>();
  for (const l of lokasi) {
    const laporan = l.dailyReports[0];
    if (laporan && laporan.status !== "draft") continue;
    for (const a of l.assignments) {
      if (a.user.isActive && !a.user.waNumber) out.add(a.user.fullName);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b, "id"));
}
