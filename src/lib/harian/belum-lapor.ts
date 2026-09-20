import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { kanonikGrupId } from "@/lib/waha/grup-id";

/**
 * SATU aturan "lokasi ini sudah melapor hari ini atau belum", dipakai bersama
 * pengingat perorangan dan pengingat grup.
 *
 * Dipisah bukan karena kodenya panjang, melainkan karena dua penagih yang
 * masing-masing menghitung sendiri PASTI menyimpang cepat atau lambat — dan
 * saat itu terjadi, satu orang ditagih untuk lokasi yang menurut grup sudah
 * beres. Yang bertengkar bukan kodenya, tapi orangnya.
 */

/**
 * Sudah dianggap melapor begitu laporannya KELUAR dari draf (dikirim, perlu
 * koreksi, disetujui, final). Menunggu sampai `final` berarti menagih orang
 * yang sudah mengerjakan bagiannya dan kini menunggu atasannya.
 */
export function sudahLapor(status: string | null | undefined): boolean {
  return status != null && status !== "draft";
}

export type LokasiTertagihPaket = {
  locationId: string;
  nama: string;
  /** true = barisnya ada tapi masih draf. */
  adaDraft: boolean;
};

export type TagihanGrup = {
  packageId: string;
  namaPaket: string;
  /** chatId kanonik grup tujuan. */
  chatId: string;
  /** Kabupaten grup ini, atau `null` bila ini grup PAKET (DECISIONS 596). */
  kabupaten: string | null;
  belum: LokasiTertagihPaket[];
  /** Lokasi grup ini yang laporannya SUDAH masuk hari itu. */
  sudah: number;
};

/**
 * Tagihan laporan harian per GRUP WhatsApp — bukan per paket (DECISIONS 596).
 *
 * Dulu ia mengumpulkan per paket, dan itu benar selama satu paket hanya punya
 * satu tujuan. Dengan grup kabupaten, satu paket bisa punya beberapa; mengirim
 * satu pesan per paket berarti grup kabupaten kedua tidak pernah menerima
 * apa pun — dan pesan yang tidak datang tidak meninggalkan jejak.
 *
 * Karena itu pertanyaannya dibalik: mulai dari LOKASI, lalu dikelompokkan
 * menurut grup efektifnya (kabupaten kalau ada, selain itu paket). Lokasi tanpa
 * tujuan apa pun dilewati — bukan kegagalan, ia memang belum disiapkan.
 *
 * Lingkupnya tetap sama persis dengan pengingat perorangan: lokasi berjalan, di
 * paket `pelaksanaan`, yang SPMK-nya sudah lewat. Dua penagih yang menghitung
 * sendiri-sendiri pasti menyimpang, dan saat itu terjadi satu orang ditagih
 * untuk lokasi yang menurut grup sudah beres.
 */
export async function tagihanPerGrup(
  now = new Date(),
  opts: { packageId?: string; orgId?: string } = {},
): Promise<TagihanGrup[]> {
  const tanggal = parseDateKey(jakartaDateKey(now))!;

  const lokasi = await db.location.findMany({
    where: {
      status: "berjalan",
      isActive: true,
      package: {
        stage: "pelaksanaan",
        contract: { startDate: { not: null, lte: tanggal } },
        ...(opts.packageId ? { id: opts.packageId } : {}),
        ...(opts.orgId ? { orgId: opts.orgId } : {}),
      },
    },
    orderBy: [{ package: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      packageId: true,
      package: { select: { name: true, waGroupId: true } },
      waGroup: { select: { waGroupId: true, regency: true } },
      dailyReports: { where: { reportDate: tanggal }, select: { status: true } },
    },
  });

  const per = new Map<string, TagihanGrup>();
  for (const l of lokasi) {
    const kab = kanonikGrupId(l.waGroup?.waGroupId);
    const chatId = kab ?? kanonikGrupId(l.package.waGroupId);
    if (!chatId) continue;

    let t = per.get(chatId);
    if (!t) {
      t = {
        packageId: l.packageId,
        namaPaket: l.package.name,
        chatId,
        kabupaten: kab ? (l.waGroup?.regency ?? null) : null,
        belum: [],
        sudah: 0,
      };
      per.set(chatId, t);
    }

    const laporan = l.dailyReports[0];
    if (sudahLapor(laporan?.status)) t.sudah += 1;
    else t.belum.push({ locationId: l.id, nama: l.name, adaDraft: !!laporan });
  }
  return [...per.values()];
}
