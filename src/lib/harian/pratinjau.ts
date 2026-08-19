import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey } from "@/lib/format";
import type { WaOutboundStatus } from "@/generated/prisma/enums";
import { isWahaConfigured, getSessionStatus } from "@/lib/waha/client";
import { normalizeWaTarget } from "@/lib/contacts/model";
import { kumpulkanPengingat } from "./penjadwal";
import { getPengingatAktif } from "./setelan";

/**
 * Pratinjau pengingat harian untuk halaman Sistem (DECISIONS 205).
 *
 * SENGAJA di luar modul `"use server"`: setiap ekspor di sana menjadi endpoint
 * yang bisa dipanggil siapa pun yang tahu id-nya, dan daftar ini memuat nama
 * orang. Di sini ia hanya bisa dipanggil dari Server Component yang sudah
 * lewat page-guard.
 */

/** Jejak pengiriman hari ini untuk satu orang. */
export type RiwayatHariIni = {
  /** Berapa kali pengingat hari ini sudah dikirim ke orang ini. */
  attempts: number;
  status: string;
  /** Ada ID pesan dari WhatsApp = bukti pesannya benar-benar masuk antrean. */
  adaBukti: boolean;
  error: string | null;
  /**
   * Nasib SEBENARNYA kiriman itu menurut outbox (DECISIONS 380).
   *
   * `DailyReminderLog.status` ditulis **"sukses" SEBELUM pesannya berangkat**
   * dan hanya berubah kalau pemanggilan melempar. Padahal justru kegagalan yang
   * paling berbahaya terjadi SESUDAH itu: WAHA menerbitkan id, lalu WhatsApp
   * menolak sendiri (mis. error 463, nomor pengirim dibatasi menghubungi nomor
   * baru) — penolakan yang tidak pernah terlihat dari respons API (`WA-01`).
   *
   * Sejak DECISIONS 374 nasib itu TERCATAT di `wa_outbound` dan diperbarui
   * `message.ack`. Yang kurang cuma menyambungkannya ke layar ini: tanpa itu
   * pengingat yang ditolak WhatsApp tetap tampil "ada ID pesan", yang terbaca
   * seperti baik-baik saja.
   *
   * `null` = tidak ada barisnya (kiriman lama sebelum outbox ada).
   */
  statusKirim: WaOutboundStatus | null;
};

export type PratinjauPengingat = {
  dateKey: string;
  /**
   * Sakelar penjadwal (DECISIONS 260). MATI berarti cron tidak menagih —
   * tombol di halaman ini tetap hidup, jadi keadaannya harus terbaca, bukan
   * disimpulkan dari "kok tidak ada yang dapat pesan".
   */
  otomatisAktif: boolean;
  wahaSiap: boolean;
  /** Status sesi WhatsApp. INFORMASI — tidak memblokir tombol (DECISIONS 207). */
  sesiStatus: string;
  /**
   * Yang akan menerima pesan bila tombol ditekan sekarang — SEMUANYA, termasuk
   * yang sudah dikirimi hari ini. Daftar ini harus persis sama dengan yang
   * benar-benar dikirimi; pratinjau yang meleset lebih buruk daripada tidak ada.
   */
  akanDitagih: {
    /** Dipakai tombol kirim per orang — nama bisa kembar, id tidak. */
    userId: string;
    nama: string;
    /** Nomor tujuan sebenarnya (628…@c.us) — bukan tebakan dari nama. */
    tujuan: string;
    lokasi: string[];
    adaDraft: boolean[];
    riwayat: RiwayatHariIni | null;
  }[];
  /** Sudah menerima pengingat hari ini (termasuk yang kini tidak perlu ditagih lagi). */
  sudahDikirim: ({ nama: string; lokasi: number; tujuan: string | null } & RiwayatHariIni)[];
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
  const [{ penerima }, otomatisAktif] = await Promise.all([
    kumpulkanPengingat(now, orgId),
    getPengingatAktif(),
  ]);

  // Status sesi ditarik SEKARANG, bukan diasumsikan. Ini keterangan untuk
  // membaca hasil, BUKAN syarat menekan tombol (DECISIONS 207).
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
    select: {
      userId: true,
      locations: true,
      status: true,
      attempts: true,
      error: true,
      waMessageId: true,
      chatId: true,
    },
  });
  const sudah = new Map(log.map((l) => [l.userId, l]));

  /*
   * Nasib sebenarnya tiap kiriman — dibaca dari outbox lewat `waMessageId`
   * (DECISIONS 380). SATU query untuk semua, bukan per orang.
   */
  const idPesan = log.map((l) => l.waMessageId).filter((x): x is string => !!x);
  const outbox = idPesan.length
    ? await db.waOutbound.findMany({
        where: { waMessageId: { in: idPesan } },
        select: { waMessageId: true, status: true },
      })
    : [];
  const statusOutbox = new Map(
    outbox.map((o) => [o.waMessageId as string, o.status] as const),
  );

  const riwayat = (userId: string): RiwayatHariIni | null => {
    const l = sudah.get(userId);
    if (!l) return null;
    return {
      attempts: l.attempts,
      status: l.status,
      adaBukti: !!l.waMessageId,
      error: l.error,
      statusKirim: l.waMessageId ? (statusOutbox.get(l.waMessageId) ?? null) : null,
    };
  };

  return {
    dateKey,
    otomatisAktif,
    wahaSiap: siap,
    sesiStatus: sesi,
    // TIDAK disaring oleh log: tombol admin mengirim ke semua orang di daftar
    // ini, termasuk yang sudah dikirimi tadi. Menyembunyikan mereka membuat
    // pratinjau berbohong tentang siapa yang akan menerima (DECISIONS 207).
    akanDitagih: penerima.map((p) => ({
      userId: p.userId,
      nama: p.nama,
      // Tujuan yang BENAR-BENAR akan dipakai — dinormalkan dengan fungsi yang
      // sama dengan pengirimnya. Menampilkan "0812…" padahal yang dikirim
      // "628…@c.us" membuat pratinjau tidak bisa dipakai menelusuri kegagalan.
      tujuan: tujuanTampil(p.wa),
      lokasi: p.lokasi.map((l) => l.nama),
      adaDraft: p.lokasi.map((l) => l.adaDraft),
      riwayat: riwayat(p.userId),
    })),
    sudahDikirim: log.map((l) => ({
      nama: namaOrg.get(l.userId) ?? "—",
      lokasi: l.locations,
      tujuan: l.chatId,
      attempts: l.attempts,
      status: l.status,
      adaBukti: !!l.waMessageId,
      error: l.error,
      statusKirim: l.waMessageId ? (statusOutbox.get(l.waMessageId) ?? null) : null,
    })),
    tanpaNomor: await penanggungJawabTanpaNomor(now, orgId),
  };
}

/** Nomor tersimpan → tujuan WAHA. Yang tak bisa dinormalkan ditandai, bukan disembunyikan. */
function tujuanTampil(wa: string): string {
  try {
    return normalizeWaTarget(wa);
  } catch {
    return `${wa} (format tidak dikenal)`;
  }
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
