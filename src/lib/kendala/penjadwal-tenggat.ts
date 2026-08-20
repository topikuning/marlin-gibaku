import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { sendText } from "@/lib/waha/kirim";
import { MAKS_BARIS, pesanKendalaTenggat, sidikTenggat, type BarisTenggat } from "./pesan-tenggat";

/**
 * PENGINGAT KENDALA LEWAT TENGGAT KE GRUP PAKET (DECISIONS 392).
 *
 * Menumpang putaran cron harian yang sudah ada (`/api/cron/harian`), bukan cron
 * kedua – sama seperti laporan mingguan.
 *
 * ### Peredam pengulangan
 *
 * Daftar kendala lewat tenggat hampir tidak berubah dari hari ke hari. Mengirim
 * daftar yang sama tiap 24 jam adalah cara tercepat membuat grup berhenti
 * membacanya, dan `src/lib/harian/pesan.ts` sudah menuliskan alasan yang sama
 * untuk pengingat laporan harian.
 *
 * Jadi: sebuah grup dikirimi lagi hanya kalau **isinya berubah** atau sudah
 * lewat {@link JEDA_HARI} hari sejak kiriman terakhir. Catatannya menumpang
 * `audit_logs` (`kendala.pengingat_tenggat` pada resource `package`) supaya
 * tidak perlu tabel baru – audit memang sudah append-only dan sudah ber-indeks
 * `(resource_type, resource_id)`.
 */

/** Jeda minimum sebelum daftar yang SAMA dikirim ulang. */
export const JEDA_HARI = 3;

const AKSI = "kendala.pengingat_tenggat";

export type HasilPengingatTenggat = {
  diperiksa: number;
  terkirim: number;
  gagal: number;
  /** Grup yang tidak dikirimi karena daftarnya sama dan belum lewat jeda. */
  diredam: number;
  rincian: { paket: string; hasil: string }[];
};

type Riwayat = { sidik: string; createdAt: Date } | null;

async function riwayatTerakhir(packageId: string): Promise<Riwayat> {
  const row = await db.auditLog.findFirst({
    where: { action: AKSI, resourceType: "package", resourceId: packageId },
    orderBy: { createdAt: "desc" },
    select: { payload: true, createdAt: true },
  });
  if (!row) return null;
  const p = row.payload as { sidik?: unknown } | null;
  if (!p || typeof p.sidik !== "string") return null;
  return { sidik: p.sidik, createdAt: row.createdAt };
}

function bolehKirim(riwayat: Riwayat, sidik: string, now: Date): boolean {
  if (!riwayat) return true;
  if (riwayat.sidik !== sidik) return true;
  const umurHari = (now.getTime() - riwayat.createdAt.getTime()) / 86_400_000;
  return umurHari >= JEDA_HARI;
}

export async function kirimPengingatKendalaTerjadwal(
  now = new Date(),
): Promise<HasilPengingatTenggat> {
  const hasil: HasilPengingatTenggat = {
    diperiksa: 0,
    terkirim: 0,
    gagal: 0,
    diredam: 0,
    rincian: [],
  };

  // Bukan `jakartaToday()`: `now` yang disuntik harus dihormati, kalau tidak
  // uji apa pun tentang "lewat berapa hari" mengukur hari nyata, bukan hari uji.
  const hariIni = parseDateKey(jakartaDateKey(now))!;

  /*
   * Paket tanpa `waGroupId` bukan kegagalan yang perlu dicatat tiap hari — ia
   * memang belum disiapkan. Mencatatnya sebagai "gagal" setiap 24 jam hanya
   * membuat log ini tidak terbaca lagi saat yang gagal betulan muncul.
   */
  const kandidat = await db.package.findMany({
    where: { stage: "pelaksanaan", waGroupId: { not: null } },
    select: { id: true, name: true, waGroupId: true, locations: { select: { id: true } } },
  });

  for (const p of kandidat) {
    const lokasiIds = p.locations.map((l) => l.id);
    if (lokasiIds.length === 0) continue;

    const saring: Prisma.IssueWhereInput = {
      locationId: { in: lokasiIds },
      status: { in: ["terbuka", "ditangani"] },
      dueDate: { not: null, lt: hariIni },
    };
    const kendala = await db.issue.findMany({
      where: saring,
      select: {
        title: true,
        dueDate: true,
        picName: true,
        picUserId: true,
        location: { select: { name: true } },
      },
      orderBy: { dueDate: "asc" },
      // Dipotong supaya paket dengan ratusan kendala tidak menarik semuanya ke
      // memori. Jumlah SEBENARNYA dihitung terpisah di bawah, jadi "dan N
      // lainnya" tetap menyebut angka yang benar.
      take: MAKS_BARIS * 4,
    });

    if (kendala.length === 0) continue;
    hasil.diperiksa += 1;
    const total = await db.issue.count({ where: saring });

    // Nama PIC diambil terpisah — `Issue.picUserId` sengaja tanpa relasi
    // Prisma, sama seperti di `queries.ts`.
    const picIds = [...new Set(kendala.map((k) => k.picUserId).filter((v): v is string => !!v))];
    const namaPic = new Map(
      picIds.length
        ? (
            await db.user.findMany({
              where: { id: { in: picIds } },
              select: { id: true, fullName: true },
            })
          ).map((u) => [u.id, u.fullName])
        : [],
    );

    const baris: BarisTenggat[] = kendala.map((k) => ({
      judul: k.title,
      lokasi: k.location.name,
      pic: (k.picUserId ? namaPic.get(k.picUserId) : null) ?? k.picName ?? null,
      lewatHari: Math.max(
        1,
        Math.round((hariIni.getTime() - k.dueDate!.getTime()) / 86_400_000),
      ),
    }));

    const sidik = sidikTenggat(baris, total);
    const riwayat = await riwayatTerakhir(p.id);
    if (!bolehKirim(riwayat, sidik, now)) {
      hasil.diredam += 1;
      hasil.rincian.push({ paket: p.name, hasil: "diredam – daftarnya belum berubah" });
      continue;
    }

    const teks = pesanKendalaTenggat(p.name, baris, total);
    if (!teks) continue;

    try {
      const waMessageId = await sendText(p.waGroupId!, teks);
      hasil.terkirim += 1;
      hasil.rincian.push({ paket: p.name, hasil: `terkirim (${total} kendala)` });
      // Dicatat SESUDAH berhasil kirim: mencatat lebih dulu akan meredam
      // kiriman berikutnya untuk pesan yang tidak pernah sampai.
      await audit(null, AKSI, "package", p.id, {
        sidik,
        jumlah: total,
        waMessageId,
      });
    } catch (err) {
      hasil.gagal += 1;
      hasil.rincian.push({
        paket: p.name,
        hasil: err instanceof Error ? err.message : "gagal kirim",
      });
    }
  }

  return hasil;
}
