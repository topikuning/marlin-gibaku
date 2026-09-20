import "server-only";
import { db } from "@/lib/db";
import { kanonikGrupId } from "./grup-id";

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

export type AsalGrup = "kabupaten" | "paket";

export type GrupTujuan = {
  /** chatId kanonik, siap dipakai `sendText`/`sendFile`. */
  chatId: string;
  /** Nama grup bila diketahui – untuk kalimat balasan, bukan untuk pencocokan. */
  nama: string | null;
  asal: AsalGrup;
  /** Sebutan siap-pakai di UI/balasan, mis. "grup WhatsApp kabupaten Jepara". */
  label: string;
};

function labelGrup(asal: AsalGrup, nama: string | null, regency: string | null): string {
  if (asal === "paket") return "grup WhatsApp paket";
  if (regency) return `grup WhatsApp kabupaten ${regency}`;
  return nama ? `grup WhatsApp ${nama}` : "grup WhatsApp kabupaten";
}

/** Grup tujuan sebuah lokasi, atau `null` bila lokasinya tidak punya tujuan. */
export async function grupUntukLokasi(locationId: string): Promise<GrupTujuan | null> {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: {
      waGroup: { select: { waGroupId: true, waGroupName: true, regency: true } },
      package: { select: { waGroupId: true, waGroupName: true } },
    },
  });
  if (!loc) return null;

  if (loc.waGroup) {
    const chatId = kanonikGrupId(loc.waGroup.waGroupId);
    if (chatId) {
      return {
        chatId,
        nama: loc.waGroup.waGroupName,
        asal: "kabupaten",
        label: labelGrup("kabupaten", loc.waGroup.waGroupName, loc.waGroup.regency),
      };
    }
  }

  const chatPaket = kanonikGrupId(loc.package?.waGroupId);
  if (!chatPaket) return null;
  return {
    chatId: chatPaket,
    nama: loc.package?.waGroupName ?? null,
    asal: "paket",
    label: labelGrup("paket", loc.package?.waGroupName ?? null, null),
  };
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
    select: {
      id: true,
      waGroup: { select: { waGroupId: true, waGroupName: true, regency: true } },
      package: { select: { waGroupId: true, waGroupName: true } },
    },
  });

  const per = new Map<string, { chatId: string; label: string; asal: AsalGrup; lokasiIds: string[] }>();
  for (const r of rows) {
    const kab = r.waGroup ? kanonikGrupId(r.waGroup.waGroupId) : null;
    const chatId = kab ?? kanonikGrupId(r.package?.waGroupId);
    if (!chatId) continue; // lokasi tanpa tujuan – bukan kegagalan, tidak dikirimi
    const asal: AsalGrup = kab ? "kabupaten" : "paket";
    const label = kab
      ? labelGrup("kabupaten", r.waGroup!.waGroupName, r.waGroup!.regency)
      : labelGrup("paket", r.package?.waGroupName ?? null, null);
    const ada = per.get(chatId);
    if (ada) ada.lokasiIds.push(r.id);
    else per.set(chatId, { chatId, label, asal, lokasiIds: [r.id] });
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
