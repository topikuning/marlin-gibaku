import "server-only";
import { db } from "@/lib/db";
import { kanonikGrupId } from "./grup-id";
import {
  CAKUPAN_KOSONG,
  PILIH_GRUP_KABUPATEN,
  PILIH_GRUP_PAKET,
  tujuanGrupLokasi,
  type AsalGrup,
  type CakupanGrupPaket,
  type GrupTujuan,
} from "./grup-tujuan";

/**
 * SATU tempat yang menjawab "lokasi ini bicara lewat grup WA yang mana", dan
 * kebalikannya (DECISIONS 596).
 *
 * Sebelum ini jawabannya disalin di belasan tempat sebagai
 * `lokasi.package.waGroupId` — dan selama hanya ada satu jawaban, menyalinnya
 * tidak terasa salah. Begitu grup kabupaten ada, tiap salinan jadi satu tempat
 * yang bisa ketinggalan: laporan lengkap terkirim ke grup kabupaten sementara
 * pengingat harian masih ke grup paket, tanpa ada yang salah secara sintaks.
 *
 * ### Urutan yang berlaku
 *
 * 1. `Location.waGroupRefId` — grup kabupaten, kalau lokasi ini dipasang;
 * 2. `Package.waGroupId` — grup paket, bawaan untuk lokasi yang tidak dipasang;
 * 3. tidak ada.
 *
 * ### Kenapa jangkauan grup PAKET tetap seluruh lokasi paket
 *
 * Grup kabupaten MEMPERSEMPIT, tidak pernah melebarkan: anggotanya hanya lokasi
 * yang dipasang ke situ, dan semuanya satu paket (ditegakkan FK komposit, lihat
 * `WaGroup`). Grup paket dibiarkan persis seperti sebelumnya — menjawab tentang
 * seluruh lokasi paketnya, termasuk yang punya grup kabupaten sendiri. Itu
 * bukan kebocoran: paketnya sama, jadi tidak ada seorang pun yang mendadak
 * melihat data yang tadinya tertutup baginya. Mempersempitnya justru akan
 * MENGUBAH perilaku yang sudah dipakai orang hari ini, tanpa diminta.
 */

export type { AsalGrup, GrupTujuan } from "./grup-tujuan";

/** Grup tujuan sebuah lokasi, atau `null` bila lokasinya tidak punya tujuan. */
export async function grupUntukLokasi(locationId: string): Promise<GrupTujuan | null> {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: { waGroup: PILIH_GRUP_KABUPATEN, package: { select: PILIH_GRUP_PAKET } },
  });
  return loc ? tujuanGrupLokasi(loc) : null;
}

export type LingkupGrup = {
  packageId: string;
  /** Lokasi AKTIF yang bicara lewat grup ini. */
  lokasiIds: string[];
  asal: AsalGrup;
  nama: string | null;
  regency: string | null;
};

/**
 * Kebalikannya: pesan datang dari `chatId` ini — lokasi mana saja yang boleh
 * dibicarakan di sana.
 *
 * Dipakai jalur MASUK. Pencocokannya kesamaan persis atas bentuk kanonik, bukan
 * `findFirst` atas varian: satu grup nyata paling banyak satu baris, di
 * `wa_groups` maupun di `packages`, jadi hasilnya tidak pernah bergantung pada
 * urutan baris (DECISIONS 370).
 */
export async function lingkupGrup(rawChatId: string): Promise<LingkupGrup | null> {
  const chatId = kanonikGrupId(rawChatId);
  if (!chatId) return null;

  const grup = await db.waGroup.findUnique({
    where: { waGroupId: chatId },
    select: {
      packageId: true,
      waGroupName: true,
      regency: true,
      locations: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (grup) {
    return {
      packageId: grup.packageId,
      lokasiIds: grup.locations.map((l) => l.id),
      asal: "kabupaten",
      nama: grup.waGroupName,
      regency: grup.regency,
    };
  }

  const paket = await db.package.findUnique({
    where: { waGroupId: chatId },
    select: {
      id: true,
      waGroupName: true,
      locations: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!paket) return null;
  return {
    packageId: paket.id,
    lokasiIds: paket.locations.map((l) => l.id),
    asal: "paket",
    nama: paket.waGroupName,
    regency: null,
  };
}

/**
 * Semua grup yang harus dikirimi untuk sekumpulan lokasi, sudah dikelompokkan.
 *
 * Dipakai penjadwal yang dulu mengirim SATU pesan per paket. Dengan grup
 * kabupaten, satu paket bisa punya beberapa tujuan — dan kalau pengelompokannya
 * dilewatkan, kunci anti-duplikat berbasis paket akan meloloskan grup pertama
 * lalu MEMBLOKIR sisanya: grup kabupaten kedua dan ketiga tidak pernah menerima
 * apa pun, dan pesan yang tidak datang tidak meninggalkan jejak.
 */
export async function kelompokkanPerGrup(
  locationIds: string[],
): Promise<{ chatId: string; label: string; asal: AsalGrup; lokasiIds: string[] }[]> {
  if (locationIds.length === 0) return [];
  const rows = await db.location.findMany({
    where: { id: { in: locationIds } },
    select: { id: true, waGroup: PILIH_GRUP_KABUPATEN, package: { select: PILIH_GRUP_PAKET } },
  });

  const per = new Map<string, { chatId: string; label: string; asal: AsalGrup; lokasiIds: string[] }>();
  for (const r of rows) {
    const g = tujuanGrupLokasi(r);
    if (!g) continue; // lokasi tanpa tujuan – bukan kegagalan, tidak dikirimi
    const ada = per.get(g.chatId);
    if (ada) ada.lokasiIds.push(r.id);
    else per.set(g.chatId, { chatId: g.chatId, label: g.label, asal: g.asal, lokasiIds: [r.id] });
  }
  return [...per.values()];
}

/**
 * Semua GRUP yang perlu dikirimi penjadwal berkala, untuk paket `pelaksanaan`.
 *
 * Dipakai penagih tenggat (kendala & temuan) yang dulu berputar per PAKET.
 * Dengan grup kabupaten, satu paket bisa punya beberapa tujuan dan masing-
 * masing hanya berhak atas lokasinya sendiri — grup Jepara tidak boleh
 * menerima daftar kendala Demak.
 *
 * Paket tanpa grup apa pun tidak muncul di sini; itu bukan kegagalan yang
 * perlu dicatat tiap hari, ia memang belum disiapkan.
 */
export async function grupPaketPelaksanaan(): Promise<
  {
    packageId: string;
    namaPaket: string;
    chatId: string;
    kabupaten: string | null;
    lokasiIds: string[];
  }[]
> {
  const paket = await db.package.findMany({
    where: { stage: "pelaksanaan" },
    select: {
      id: true,
      name: true,
      waGroupId: true,
      locations: {
        select: { id: true, waGroup: { select: { waGroupId: true, regency: true } } },
      },
    },
  });

  const hasil: {
    packageId: string;
    namaPaket: string;
    chatId: string;
    kabupaten: string | null;
    lokasiIds: string[];
  }[] = [];

  for (const p of paket) {
    const per = new Map<string, { kabupaten: string | null; lokasiIds: string[] }>();
    for (const l of p.locations) {
      const kab = kanonikGrupId(l.waGroup?.waGroupId);
      const chatId = kab ?? kanonikGrupId(p.waGroupId);
      if (!chatId) continue;
      const ada = per.get(chatId);
      if (ada) ada.lokasiIds.push(l.id);
      else per.set(chatId, { kabupaten: kab ? (l.waGroup?.regency ?? null) : null, lokasiIds: [l.id] });
    }
    for (const [chatId, v] of per) {
      hasil.push({ packageId: p.id, namaPaket: p.name, chatId, ...v });
    }
  }
  return hasil;
}

/**
 * Jangkauan grup tiap paket atas lokasi AKTIF-nya – bahan kolom "Grup WA" di
 * daftar paket (DECISIONS 747). Dua kueri berkelompok untuk seluruh daftar,
 * bukan satu kueri per paket.
 */
export async function cakupanGrupPaket(packageIds: string[]): Promise<Map<string, CakupanGrupPaket>> {
  const hasil = new Map<string, CakupanGrupPaket>();
  if (packageIds.length === 0) return hasil;
  const [aktif, perGrup] = await Promise.all([
    db.location.groupBy({
      by: ["packageId"],
      where: { packageId: { in: packageIds }, isActive: true },
      _count: { _all: true },
    }),
    db.location.groupBy({
      by: ["packageId", "waGroupRefId"],
      where: { packageId: { in: packageIds }, isActive: true, waGroupRefId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  for (const a of aktif) hasil.set(a.packageId, { ...CAKUPAN_KOSONG, lokasiAktif: a._count._all });
  for (const g of perGrup) {
    const c = hasil.get(g.packageId) ?? { ...CAKUPAN_KOSONG };
    c.grupKabupaten += 1;
    c.lokasiBerGrupKabupaten += g._count._all;
    hasil.set(g.packageId, c);
  }
  return hasil;
}
