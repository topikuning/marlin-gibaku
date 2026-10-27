import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, ROLE_LABEL } from "@/lib/authz";
import { hasLocationAccess, type SessionUser } from "@/lib/auth/session";
import { canTransitionWaPersetujuan } from "@/lib/lifecycle";
import { diffRevisions } from "@/lib/rab/adendum";
import { jalankanAktivasi } from "@/lib/rab/aktivasi";
import { pastikanBolehAktivasi, PersetujuanError, ringkasPersetujuan, setujuiRevisi } from "@/lib/rab/persetujuan";
import {
  bacaBalasanSetuju,
  buatKodePersetujuan,
  kabarKirimNotifikasi,
  kunciMenungguPersetujuan,
  teksPersetujuanWa as teks,
} from "@/lib/rab/persetujuan-wa-aturan";
import { sendWaMessage } from "@/lib/waha/gateway";
import { balasWa } from "@/lib/waha/kirim";
import type { ParsedWaMessage } from "@/lib/waha/ingest-parse";
import { normalizePhone } from "@/lib/waha/sender-identity";

/**
 * PERSETUJUAN AKTIVASI ADENDUM LEWAT WHATSAPP – sisi database dan WA
 * (DECISIONS 714). Aturannya di `persetujuan-wa-aturan.ts` (murni, diuji
 * langsung).
 *
 * Dua pintu:
 *   1. `kirimPermintaanPd` – dipanggil sesudah AM/PM/SM menyetujui di web;
 *      setiap Program Director yang memegang lokasinya dan bernomor
 *      TERVERIFIKASI menerima pesan berkode.
 *   2. `tanganiBalasanPersetujuan` – balasan "SETUJU <kode>" di chat pribadi.
 *      Suaranya dicatat lewat `setujuiRevisi`/gerbang yang sama dengan web, dan
 *      bila persetujuannya jadi lengkap draft langsung diaktifkan atas nama PD
 *      (pilihan user 2026-10-27).
 */

const rupiah = new Intl.NumberFormat("id-ID");
const fmtRp = (v: bigint) => `Rp ${rupiah.format(v)}`;
const fmtDelta = (d: bigint) => `${d >= 0n ? "+" : "−"}Rp ${rupiah.format(d < 0n ? -d : d)}`;

const labelOrang = (nama: string, role: UserRole) => `${nama} (${ROLE_LABEL[role]})`;

/** Nomor pengirim = nomor terverifikasi akun ini? (bukan sekadar `phone`/LID yang cocok). */
function nomorTerverifikasi(
  akun: { waNumber: string | null; waVerifiedAt: Date | null },
  nomorPengirim: string | null,
): boolean {
  const kirim = normalizePhone(nomorPengirim);
  return akun.waVerifiedAt !== null && kirim !== null && normalizePhone(akun.waNumber) === kirim;
}

async function batalkan(where: Prisma.WaPersetujuanWhereInput, alasan: string): Promise<void> {
  if (!canTransitionWaPersetujuan("menunggu", "batal")) return;
  await db.waPersetujuan.updateMany({
    where: { ...where, status: "menunggu" },
    data: { status: "batal", kunciMenunggu: null, alasanBatal: alasan, selesaiAt: new Date() },
  });
}

/* ── 1. Permintaan ke Program Director ─────────────────────────────────── */

/**
 * Kirim permintaan persetujuan ke Program Director. Mengembalikan kalimat
 * untuk layar orang yang baru menyetujui: siapa yang dikirimi WA, siapa
 * tidak dan kenapa. Pemanggil sudah memastikan `perluNotifikasiPd`.
 */
export async function kirimPermintaanPd(
  revisionId: string,
  pemohon: { id: string; fullName: string; role: UserRole },
): Promise<string> {
  const rev = await db.rabRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: {
      id: true,
      revisionNo: true,
      status: true,
      updatedAt: true,
      totalValue: true,
      locationId: true,
      location: { select: { name: true, package: { select: { name: true, orgId: true } } } },
    },
  });
  if (rev.status !== "draft") return "";
  const aktif = await db.rabRevision.findFirst({
    where: { locationId: rev.locationId, status: "aktif" },
    select: { id: true },
  });
  if (!aktif) return "";

  const calon = await db.user.findMany({
    where: { orgId: rev.location.package.orgId, role: "program_director", isActive: true },
    select: {
      id: true,
      orgId: true,
      fullName: true,
      username: true,
      email: true,
      role: true,
      mustChangePassword: true,
      waNumber: true,
      waVerifiedAt: true,
    },
    orderBy: { fullName: "asc" },
  });

  const diff = await diffRevisions(aktif.id, rev.id);
  const perubahan =
    `${diff.ditambah.length} item baru · ${diff.dihapus.length} dihapus · ${diff.diubah.length} diubah · ` +
    `Δ ${fmtDelta(diff.delta)}`;
  const sudahSetuju = (await ringkasPersetujuan(rev.id)).berlaku.map((p) => labelOrang(p.nama, p.role));

  const terkirim: string[] = [];
  const sudah: string[] = [];
  const tidak: { nama: string; sebab: string }[] = [];

  for (const pd of calon) {
    if (!(await hasLocationAccess(pd, rev.locationId))) continue;
    if (!pd.waNumber) {
      tidak.push({ nama: pd.fullName, sebab: "belum ada nomor WA di akunnya" });
      continue;
    }
    // Nomor yang belum diverifikasi bisa saja salah ketik: isi draft adendum
    // tidak dikirim ke nomor yang belum terbukti milik orangnya.
    if (!pd.waVerifiedAt) {
      tidak.push({ nama: pd.fullName, sebab: "nomor WA-nya belum diverifikasi" });
      continue;
    }

    // Isi draft yang sama sudah pernah dimintakan → jangan dikirim ulang.
    const lama = await db.waPersetujuan.findFirst({
      where: { revisionId: rev.id, untukUserId: pd.id, status: "menunggu", draftDiubahPada: rev.updatedAt },
      select: { id: true },
    });
    if (lama) {
      sudah.push(pd.fullName);
      continue;
    }
    await batalkan({ revisionId: rev.id, untukUserId: pd.id }, "draft berubah sebelum dibalas");

    const baris = await buatBaris(rev.id, pd.id, pemohon.id, rev.updatedAt, rev.totalValue);
    const r = await sendWaMessage({
      kind: "teks",
      destination: pd.waNumber,
      payload: {
        teks: teks.notifikasi({
          lokasi: rev.location.name,
          paket: rev.location.package.name,
          revisionNo: rev.revisionNo,
          nilaiDraft: fmtRp(rev.totalValue),
          perubahan,
          sudahSetuju,
          kode: baris.kode,
        }),
      },
      idempotencyKey: `wa_persetujuan:${baris.id}`,
      sourceType: "wa_persetujuan",
      sourceId: baris.id,
      persetujuanAktivasiId: baris.id,
      dimintaOlehId: pemohon.id,
      peminta: pemohon.fullName,
    });
    if (r.diterimaWaha) {
      terkirim.push(pd.fullName);
    } else {
      const sebab = r.error ?? "WhatsApp menolak kirimannya";
      await db.waPersetujuan.update({
        where: { id: baris.id },
        data: { status: "batal", kunciMenunggu: null, gagalKirim: sebab, alasanBatal: "gagal dikirim", selesaiAt: new Date() },
      });
      tidak.push({ nama: pd.fullName, sebab: `WA gagal dikirim (${sebab.replace(/\.$/, "")})` });
    }
  }

  await audit(pemohon.id, "rab.persetujuan_wa_kirim", "rab_revision", rev.id, {
    locationId: rev.locationId,
    revisionNo: rev.revisionNo,
    terkirim,
    sudahPernah: sudah,
    tidak,
  });
  return kabarKirimNotifikasi({ terkirim, sudah, tidak });
}

/** Baris permintaan dengan kode yang belum dipakai PD itu (tabrakan → kode baru). */
async function buatBaris(revisionId: string, untukUserId: string, pemohonId: string, draftDiubahPada: Date, totalValue: bigint) {
  for (let coba = 0; ; coba++) {
    const kode = buatKodePersetujuan();
    try {
      return await db.waPersetujuan.create({
        data: {
          revisionId,
          untukUserId,
          pemohonId,
          kode,
          draftDiubahPada,
          totalValue,
          kunciMenunggu: kunciMenungguPersetujuan(untukUserId, kode),
        },
        select: { id: true, kode: true },
      });
    } catch (e) {
      if (coba < 9 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
}

/**
 * Program Director yang sudah dikirimi WA untuk ISI DRAFT SEKARANG dan belum
 * membalas – ditampilkan di panel persetujuan, supaya siapa pun yang membuka
 * draft tahu permintaannya sudah berangkat dan ke siapa.
 */
export async function permintaanWaMenunggu(revisionId: string): Promise<{ nama: string; dikirimAt: Date }[]> {
  const rev = await db.rabRevision.findUnique({ where: { id: revisionId }, select: { updatedAt: true } });
  if (!rev) return [];
  const rows = await db.waPersetujuan.findMany({
    where: { revisionId, status: "menunggu", draftDiubahPada: rev.updatedAt },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, untuk: { select: { fullName: true } } },
  });
  return rows.map((r) => ({ nama: r.untuk.fullName, dikirimAt: r.createdAt }));
}

/* ── 2. Balasan SETUJU ──────────────────────────────────────────────────── */

export type HasilBalasanPersetujuan = { ditangani: boolean; alasan: string };

const TIDAK: HasilBalasanPersetujuan = { ditangani: false, alasan: "" };

/**
 * Tangani "SETUJU <kode>" di chat PRIBADI. `nomorPengirim` = nomor yang
 * terbaca dari pesan (sesudah padanan @lid), bukan nomor di akun.
 *
 * "setuju" tanpa kode, dari orang yang tidak punya permintaan menunggu, tidak
 * ditangani di sini – diteruskan ke lapor seperti teks lain.
 */
export async function tanganiBalasanPersetujuan(
  m: ParsedWaMessage,
  user: SessionUser,
  nomorPengirim: string | null,
): Promise<HasilBalasanPersetujuan> {
  const balasan = bacaBalasanSetuju(m.body);
  if (!balasan) return TIDAK;

  const menunggu = await db.waPersetujuan.findMany({
    where: { untukUserId: user.id, status: "menunggu" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      kode: true,
      revisionId: true,
      draftDiubahPada: true,
      revision: {
        select: {
          id: true,
          status: true,
          updatedAt: true,
          revisionNo: true,
          source: true,
          locationId: true,
          location: { select: { name: true } },
        },
      },
    },
  });

  if (balasan.kode === null) {
    if (menunggu.length === 0) return TIDAK;
    await balasWa(m.chatId, teks.mintaKode(menunggu.map((r) => r.kode)));
    return { ditangani: true, alasan: "persetujuan: kode diminta" };
  }

  const tolak = async (pesan: string, sebab: string, revisionId: string | null) => {
    await balasWa(m.chatId, pesan);
    await audit(user.id, "rab.persetujuan_wa_tolak", "rab_revision", revisionId, {
      sebab,
      kode: balasan.kode,
      waMessageId: m.waMessageId,
    });
    return { ditangani: true, alasan: `persetujuan: ditolak (${sebab})` };
  };

  if (user.role !== "program_director") return tolak(teks.bukanDirektur, "bukan program director", null);

  const baris = menunggu.find((r) => r.kode === balasan.kode);
  if (!baris) return tolak(teks.kodeTidakDikenal(balasan.kode), "kode tidak dikenal", null);
  const rev = baris.revision;
  const lokasi = rev.location.name;

  // Nomor TERVERIFIKASI, dan pesannya memang datang dari nomor itu (pilihan
  // user): nomor yang diketik admin bisa salah, dan salah satu angka berarti
  // orang lain ikut menyetujui perubahan kontrak.
  const akun = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { waNumber: true, waVerifiedAt: true },
  });
  if (!nomorTerverifikasi(akun, nomorPengirim)) return tolak(teks.belumVerifikasi, "nomor belum diverifikasi", rev.id);
  if (!(await hasLocationAccess(user, rev.locationId))) return tolak(teks.tanpaAkses(lokasi), "tanpa akses lokasi", rev.id);

  if (rev.status !== "draft") {
    await batalkan({ id: baris.id }, "revisi sudah bukan draft");
    return tolak(teks.bukanDraft(rev.revisionNo, lokasi), "bukan draft", rev.id);
  }
  // Isi draft yang disetujui harus PERSIS yang disebut di pesan.
  if (rev.updatedAt.getTime() !== baris.draftDiubahPada.getTime()) {
    await batalkan({ id: baris.id }, "draft berubah sebelum dibalas");
    return tolak(teks.draftBerubah(rev.revisionNo, lokasi), "draft berubah", rev.id);
  }

  /*
   * Satu balasan, satu kali. Klaimnya mengosongkan kunci (status tetap
   * menunggu), BARU suaranya dicatat, BARU statusnya disetujui – supaya baris
   * tidak pernah berbunyi "disetujui" untuk suara yang gagal dicatat. Yang
   * kalah balapan (pesan ganda) berhenti di sini.
   */
  const diambil = await db.waPersetujuan.updateMany({
    where: { id: baris.id, status: "menunggu", kunciMenunggu: { not: null } },
    data: { kunciMenunggu: null },
  });
  if (diambil.count === 0) return { ditangani: true, alasan: "persetujuan: sudah diproses" };
  try {
    await setujuiRevisi(rev.id, { id: user.id, role: user.role });
  } catch (e) {
    if (!(e instanceof PersetujuanError)) throw e;
    await batalkan({ id: baris.id }, e.message);
    return tolak(e.message, "ditolak aturan persetujuan", rev.id);
  }
  if (canTransitionWaPersetujuan("menunggu", "disetujui")) {
    await db.waPersetujuan.update({ where: { id: baris.id }, data: { status: "disetujui", selesaiAt: new Date() } });
  }
  await audit(user.id, "rab.persetujuan_wa_setuju", "rab_revision", rev.id, {
    locationId: rev.locationId,
    revisionNo: rev.revisionNo,
    waPersetujuanId: baris.id,
    waMessageId: m.waMessageId,
  });
  // PD lain yang dikirimi permintaan yang sama tidak perlu membalas lagi.
  await batalkan({ revisionId: rev.id, id: { not: baris.id } }, "sudah disetujui Program Director lain");

  const status = await ringkasPersetujuan(rev.id);
  if (!status.lengkap) {
    await balasWa(m.chatId, teks.tercatatMenunggu(rev.revisionNo, lokasi, status.kurang));
    return { ditangani: true, alasan: "persetujuan: tercatat, menunggu kursi lain" };
  }

  /*
   * LENGKAP → AKTIFKAN atas nama PD (pilihan user 2026-10-27). Lewat gerbang
   * dan jalan aktivasi yang sama dengan tombol Aktifkan di web.
   */
  const penerimaKabar = status.berlaku.filter((p) => p.userId !== user.id);
  let kabar: string;
  let gagal: string | null = null;
  try {
    if (!can(user.role, "rab.manage")) throw new PersetujuanError("Akun Anda tidak berhak mengaktifkan revisi.");
    await pastikanBolehAktivasi(rev.id);
    const adendum = (await db.rabRevision.count({ where: { locationId: rev.locationId, status: "aktif" } })) > 0;
    const hasil = await jalankanAktivasi({
      rev: { id: rev.id, locationId: rev.locationId, revisionNo: rev.revisionNo, source: rev.source },
      userId: user.id,
      adendum,
      persetujuanSaatItu: null,
      jalur: "balasan_wa",
    });
    kabar = hasil.ok ? hasil.kabar : hasil.error;
  } catch (e) {
    gagal = e instanceof Error ? e.message : "kesalahan tak dikenal";
    kabar = "";
  }
  await audit(user.id, gagal ? "rab.aktivasi_wa_gagal" : "rab.aktivasi_lewat_wa", "rab_revision", rev.id, {
    locationId: rev.locationId,
    revisionNo: rev.revisionNo,
    waPersetujuanId: baris.id,
    ...(gagal ? { sebab: gagal } : {}),
  });

  await balasWa(m.chatId, gagal ? teks.aktifGagal(rev.revisionNo, lokasi, gagal) : teks.aktif(kabar));
  const isiKabar = gagal
    ? teks.kabarPemohonGagal({ pd: user.fullName, revisionNo: rev.revisionNo, lokasi, sebab: gagal })
    : teks.kabarPemohon({ pd: user.fullName, revisionNo: rev.revisionNo, lokasi, kabar });
  await kabariPenyetuju(baris.id, penerimaKabar, isiKabar, user);
  return { ditangani: true, alasan: gagal ? "persetujuan: tercatat, aktivasi gagal" : "persetujuan: draft diaktifkan" };
}

/**
 * Kabar hasil ke yang sudah menyetujui lebih dulu – hanya ke nomor
 * TERVERIFIKASI; yang lain melihatnya di aplikasi. Gagal kirim tidak
 * membatalkan apa pun: aktivasinya sudah terjadi dan tercatat.
 */
async function kabariPenyetuju(
  waPersetujuanId: string,
  penerima: { userId: string }[],
  isi: string,
  pd: SessionUser,
): Promise<void> {
  if (penerima.length === 0) return;
  const orang = await db.user.findMany({
    where: { id: { in: penerima.map((p) => p.userId) }, isActive: true, waVerifiedAt: { not: null } },
    select: { id: true, waNumber: true },
  });
  for (const o of orang) {
    if (!o.waNumber) continue;
    try {
      await sendWaMessage({
        kind: "teks",
        destination: o.waNumber,
        payload: { teks: isi },
        idempotencyKey: `wa_persetujuan:${waPersetujuanId}:kabar:${o.id}`,
        sourceType: "wa_persetujuan",
        sourceId: waPersetujuanId,
        persetujuanAktivasiId: waPersetujuanId,
        dimintaOlehId: pd.id,
        peminta: pd.fullName,
      });
    } catch (e) {
      console.error("[persetujuan-wa] kabar ke penyetuju gagal:", e);
    }
  }
}
