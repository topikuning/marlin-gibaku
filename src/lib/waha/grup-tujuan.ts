import type { Prisma } from "@/generated/prisma/client";
import { kanonikGrupId } from "./grup-id";

/**
 * TUJUAN GRUP WA SEBUAH LOKASI – bagian MURNI dari satu pintu (DECISIONS 596,
 * 747). Tanpa DB, tanpa server-only: dipakai `grup.ts` dan oleh kueri mana pun
 * yang sudah memuat lokasinya sendiri (papan status, daftar paket), supaya
 * mereka tidak menyalin aturan urutannya.
 *
 * Urutan: grup KABUPATEN lokasi (kalau dipasang) → grup PAKET → tidak ada.
 *
 * Kenapa ini harus diekspor sebagai potongan `select` + fungsi, bukan disalin:
 * papan Status Laporan Harian menyalin `package.waGroupId` sendiri, dan
 * delapan lokasi ber-grup kabupaten terbaca "Tanpa grup" (laporan user
 * 2026-11-06). Itu kebocoran keempat dari kelas yang sama sesudah 596, 609,
 * 626. Pagar `tests/unit/grup-wa-satu-pintu.test.ts` menolak berkas baru yang
 * membaca kolomnya sendiri.
 */

export type AsalGrup = "kabupaten" | "paket";

export type GrupTujuan = {
  /** chatId kanonik, siap dipakai `sendText`/`sendFile`. */
  chatId: string;
  /** Nama grup bila diketahui – untuk kalimat, bukan untuk pencocokan. */
  nama: string | null;
  asal: AsalGrup;
  /** Kabupaten grupnya, hanya untuk grup kabupaten. */
  kabupaten: string | null;
  /** Sebutan siap-pakai, mis. "grup WhatsApp kabupaten Jepara". */
  label: string;
};

/** Potongan `select` relasi `Location.waGroup`. */
export const PILIH_GRUP_KABUPATEN = {
  select: { waGroupId: true, waGroupName: true, regency: true },
} as const satisfies Prisma.WaGroupDefaultArgs;

/** Potongan `select` kolom grup di `Package` – digabung ke select paket pemanggil. */
export const PILIH_GRUP_PAKET = {
  waGroupId: true,
  waGroupName: true,
} as const satisfies Prisma.PackageSelect;

/** Lokasi yang PUNYA tujuan: grup kabupatennya sendiri ATAU grup paketnya. */
export const LOKASI_PUNYA_GRUP_WA = {
  OR: [{ waGroupRefId: { not: null } }, { package: { waGroupId: { not: null } } }],
} satisfies Prisma.LocationWhereInput;

/**
 * Paket yang punya grup WA APA PUN: grup paket, atau sedikitnya satu grup
 * kabupaten. Pesan dari grup kabupaten diarsipkan dengan `packageId` paketnya
 * (ingest.ts), jadi layar arsip percakapan wajib memakai syarat ini – bukan
 * `waGroupId != null`.
 */
export const PAKET_PUNYA_GRUP_WA = {
  OR: [{ waGroupId: { not: null } }, { waGroups: { some: {} } }],
} satisfies Prisma.PackageWhereInput;

/** Paket punya grup WA apa pun – versi data yang sudah dimuat dari `PAKET_PUNYA_GRUP_WA`. */
export function paketPunyaGrupWa(pkg: { waGroupId: string | null; _count: { waGroups: number } }): boolean {
  return pkg.waGroupId != null || pkg._count.waGroups > 0;
}

export function labelGrup(asal: AsalGrup, nama: string | null, regency: string | null): string {
  if (asal === "paket") return "grup WhatsApp paket";
  if (regency) return `grup WhatsApp kabupaten ${regency}`;
  return nama ? `grup WhatsApp ${nama}` : "grup WhatsApp kabupaten";
}

export type SumberGrupLokasi = {
  waGroup: { waGroupId: string; waGroupName: string | null; regency: string | null } | null;
  package: { waGroupId: string | null; waGroupName: string | null } | null;
};

/** Grup tujuan lokasi yang sudah dimuat, atau `null` bila tidak punya tujuan. */
export function tujuanGrupLokasi(l: SumberGrupLokasi): GrupTujuan | null {
  const kab = l.waGroup ? kanonikGrupId(l.waGroup.waGroupId) : null;
  if (kab && l.waGroup) {
    return {
      chatId: kab,
      nama: l.waGroup.waGroupName,
      asal: "kabupaten",
      kabupaten: l.waGroup.regency,
      label: labelGrup("kabupaten", l.waGroup.waGroupName, l.waGroup.regency),
    };
  }
  const paket = kanonikGrupId(l.package?.waGroupId);
  if (!paket) return null;
  return {
    chatId: paket,
    nama: l.package?.waGroupName ?? null,
    asal: "paket",
    kabupaten: null,
    label: labelGrup("paket", l.package?.waGroupName ?? null, null),
  };
}

/** Jangkauan grup sebuah paket atas lokasi AKTIF-nya. */
export type CakupanGrupPaket = {
  lokasiAktif: number;
  /** Lokasi aktif yang dipasang ke grup kabupaten. */
  lokasiBerGrupKabupaten: number;
  /** Banyaknya grup kabupaten berbeda yang dipakai lokasi aktif itu. */
  grupKabupaten: number;
};

export const CAKUPAN_KOSONG: CakupanGrupPaket = { lokasiAktif: 0, lokasiBerGrupKabupaten: 0, grupKabupaten: 0 };

export type RingkasGrupPaket = {
  /** "lengkap" = tiap lokasi aktif punya tujuan; "sebagian"; "belum" = tidak ada grup sama sekali. */
  keadaan: "lengkap" | "sebagian" | "belum";
  /** Isi sel singkat. */
  teks: string;
  /** Kalimat lengkap untuk tooltip / keterangan. */
  keterangan: string;
};

/**
 * Ringkasan grup WA satu paket untuk DAFTAR paket.
 *
 * Sebelumnya kolomnya membaca grup paket saja, jadi paket yang seluruh
 * lokasinya sudah lewat grup kabupaten tetap berlabel "Belum".
 */
export function ringkasGrupWaPaket(
  pkg: { waGroupId: string | null; waGroupName: string | null },
  c: CakupanGrupPaket,
): RingkasGrupPaket {
  const tanpaKab = Math.max(0, c.lokasiAktif - c.lokasiBerGrupKabupaten);
  const namaPaket = pkg.waGroupId ? pkg.waGroupName || pkg.waGroupId : null;
  const ekorKab =
    c.grupKabupaten > 0
      ? ` · ${c.grupKabupaten} grup kabupaten untuk ${c.lokasiBerGrupKabupaten} lokasi`
      : "";

  if (namaPaket) {
    return { keadaan: "lengkap", teks: namaPaket, keterangan: `Grup paket: ${namaPaket}${ekorKab}` };
  }
  if (c.grupKabupaten === 0) {
    return { keadaan: "belum", teks: "Belum", keterangan: "Grup WhatsApp belum diatur" };
  }
  if (tanpaKab === 0) {
    return {
      keadaan: "lengkap",
      teks: `${c.grupKabupaten} grup kabupaten`,
      keterangan: `Tanpa grup paket – semua ${c.lokasiAktif} lokasi lewat grup kabupaten`,
    };
  }
  return {
    keadaan: "sebagian",
    teks: `${c.grupKabupaten} grup kabupaten`,
    keterangan: `${tanpaKab} dari ${c.lokasiAktif} lokasi belum punya grup: tidak ada grup kabupaten dan paket belum punya grup paket`,
  };
}
