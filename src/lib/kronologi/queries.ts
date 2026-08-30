import "server-only";
import { db } from "@/lib/db";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import { jakartaDateKey } from "@/lib/format";
import {
  geserHari,
  susunKronologi,
  type KegiatanMentah,
  type KendalaMentah,
  type Kronologi,
} from "./susun";

/**
 * Pengambil bahan kronologi. Aturannya di `susun.ts`; yang di sini hanya
 * membaca dan menerjemahkan.
 *
 * TANPA otorisasi — pemanggil yang menggerbangi (`requireLocationAccess` di
 * layar, penyaring lingkup di jalur WhatsApp), sama seperti `renderHarianKkpPdf`.
 */

export type KronologiLokasi = Kronologi & {
  lokasi: { id: string; nama: string; slug: string; wilayah: string };
};

export async function ambilKronologi(
  locationId: string,
  opts: { sampai: string; hari?: number; batas?: number },
): Promise<KronologiLokasi | null> {
  const hari = opts.hari ?? 90;
  const sejak = geserHari(opts.sampai, -hari);

  const lokasi = await db.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, slug: true, regency: true, province: true },
  });
  if (!lokasi) return null;

  const [kendalaRaw, kegiatanRaw, labelJenis] = await Promise.all([
    /*
     * `mergedIntoId: null` WAJIB — kendala kembar yang sudah digabung tidak
     * boleh muncul lagi di sini (peringatan pada model `Issue`; dijaga
     * `tests/unit/kendala-pembaca-gabung.test.ts`).
     *
     * Tidak disaring tanggal di SQL: kendala yang MASIH TERBUKA ikut berapa pun
     * umurnya — justru itu inti kondisi terkini. Yang lampau disaring
     * `susunKronologi`, di satu tempat, dengan aturan yang diuji.
     */
    db.issue.findMany({
      where: { locationId, mergedIntoId: null },
      select: {
        id: true,
        title: true,
        description: true,
        severity: true,
        status: true,
        source: true,
        createdAt: true,
        closedAt: true,
        closingNote: true,
        dueDate: true,
        picName: true,
        picUserId: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.fieldActivity.findMany({
      where: { locationId, activityDate: { gte: new Date(`${sejak}T00:00:00.000Z`) } },
      select: {
        id: true,
        activityDate: true,
        type: true,
        title: true,
        notes: true,
        kendala: true,
        solusi: true,
        participants: true,
        status: true,
        _count: { select: { photos: true } },
      },
      orderBy: { activityDate: "desc" },
    }),
    getActivityKindLabelMap(),
  ]);

  const picIds = [...new Set(kendalaRaw.map((k) => k.picUserId).filter((v): v is string => !!v))];
  const picNama = new Map(
    picIds.length === 0
      ? []
      : (
          await db.user.findMany({
            where: { id: { in: picIds } },
            select: { id: true, fullName: true },
          })
        ).map((u) => [u.id, u.fullName] as const),
  );

  const kendala: KendalaMentah[] = kendalaRaw.map((k) => ({
    id: k.id,
    judul: k.title,
    rincian: k.description,
    tingkat: k.severity,
    status: k.status,
    dibuka: jakartaDateKey(k.createdAt),
    ditutup: k.closedAt ? jakartaDateKey(k.closedAt) : null,
    catatanPenutup: k.closingNote,
    sumber: k.source,
    // PIC di luar MARLIN memang hanya bernama, tidak berakun (DECISIONS 426).
    pic: (k.picUserId ? picNama.get(k.picUserId) : null) ?? k.picName ?? null,
    tenggat: k.dueDate ? k.dueDate.toISOString().slice(0, 10) : null,
  }));

  const kegiatan: KegiatanMentah[] = kegiatanRaw.map((g) => ({
    id: g.id,
    tanggal: g.activityDate.toISOString().slice(0, 10),
    jenis: labelJenis.get(g.type) ?? g.type,
    judul: g.title,
    catatan: g.notes,
    kendala: g.kendala,
    solusi: g.solusi,
    peserta: g.participants,
    status: g.status,
    jumlahFoto: g._count.photos,
  }));

  return {
    lokasi: {
      id: lokasi.id,
      nama: lokasi.name,
      slug: lokasi.slug,
      wilayah: `${lokasi.regency}, ${lokasi.province}`,
    },
    ...susunKronologi({ sampai: opts.sampai, hari, batas: opts.batas, kendala, kegiatan }),
  };
}
