import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { OPEN_FINDING_STATUSES } from "@/lib/lifecycle";
import { sendText } from "@/lib/waha/kirim";
import type { HasilPengingatTenggat } from "@/lib/kendala/penjadwal-tenggat";
import { JEDA_HARI } from "@/lib/kendala/penjadwal-tenggat";
import { MAKS_BARIS, pesanTemuanTenggat, sidikTenggat, type BarisTemuanTenggat } from "./pesan-tenggat";

/**
 * PENGINGAT TEMUAN LEWAT TENGGAT KE GRUP PAKET (DECISIONS 426).
 *
 * Kerangka, peredam pengulangan (sidik di `audit_logs` + jeda {@link JEDA_HARI}
 * hari), dan alasan desainnya SAMA dengan `kendala/penjadwal-tenggat.ts` —
 * baca komentar di sana; tidak diulang di sini supaya dua salinan penjelasan
 * tidak perlahan berbeda. Aksi auditnya `temuan.pengingat_tenggat`.
 */

const AKSI = "temuan.pengingat_tenggat";

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
  return (now.getTime() - riwayat.createdAt.getTime()) / 86_400_000 >= JEDA_HARI;
}

export async function kirimPengingatTemuanTerjadwal(
  now = new Date(),
): Promise<HasilPengingatTenggat> {
  const hasil: HasilPengingatTenggat = {
    diperiksa: 0,
    terkirim: 0,
    gagal: 0,
    diredam: 0,
    rincian: [],
  };
  const hariIni = parseDateKey(jakartaDateKey(now))!;

  const kandidat = await db.package.findMany({
    where: { stage: "pelaksanaan", waGroupId: { not: null } },
    select: { id: true, name: true, waGroupId: true, locations: { select: { id: true } } },
  });

  for (const p of kandidat) {
    const lokasiIds = p.locations.map((l) => l.id);
    if (lokasiIds.length === 0) continue;

    const saring: Prisma.FindingWhereInput = {
      locationId: { in: lokasiIds },
      status: { in: [...OPEN_FINDING_STATUSES] },
      dueDate: { not: null, lt: hariIni },
    };
    const temuan = await db.finding.findMany({
      where: saring,
      select: {
        title: true,
        severity: true,
        dueDate: true,
        assignedToId: true,
        assignedName: true,
        location: { select: { name: true } },
      },
      orderBy: { dueDate: "asc" },
      take: MAKS_BARIS * 4,
    });

    if (temuan.length === 0) continue;
    hasil.diperiksa += 1;
    const total = await db.finding.count({ where: saring });

    const picIds = [...new Set(temuan.map((t) => t.assignedToId).filter((v): v is string => !!v))];
    const namaPic = new Map(
      picIds.length
        ? (
            await db.user.findMany({ where: { id: { in: picIds } }, select: { id: true, fullName: true } })
          ).map((u) => [u.id, u.fullName])
        : [],
    );

    const baris: BarisTemuanTenggat[] = temuan.map((t) => ({
      judul: t.title,
      lokasi: t.location.name,
      severity: t.severity,
      pic: (t.assignedToId ? namaPic.get(t.assignedToId) : null) ?? t.assignedName ?? null,
      lewatHari: Math.max(1, Math.round((hariIni.getTime() - t.dueDate!.getTime()) / 86_400_000)),
    }));

    const sidik = sidikTenggat(baris, total);
    const riwayat = await riwayatTerakhir(p.id);
    if (!bolehKirim(riwayat, sidik, now)) {
      hasil.diredam += 1;
      hasil.rincian.push({ paket: p.name, hasil: "diredam – daftarnya belum berubah" });
      continue;
    }

    const teks = pesanTemuanTenggat(p.name, baris, total);
    if (!teks) continue;

    try {
      const waMessageId = await sendText(p.waGroupId!, teks);
      hasil.terkirim += 1;
      hasil.rincian.push({ paket: p.name, hasil: `terkirim (${total} temuan)` });
      // SESUDAH berhasil kirim — alasan sama dengan kendala.
      await audit(null, AKSI, "package", p.id, { sidik, jumlah: total, waMessageId });
    } catch (err) {
      hasil.gagal += 1;
      hasil.rincian.push({ paket: p.name, hasil: err instanceof Error ? err.message : "gagal kirim" });
    }
  }

  return hasil;
}
