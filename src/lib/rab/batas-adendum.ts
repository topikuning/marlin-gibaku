/**
 * BATAS 10% PERPRES 16/2018 PASAL 54 — modul murni, tanpa DB.
 *
 * ### Kenapa ini berdiri sendiri
 *
 * Aturannya dulu hidup di dalam `app/(app)/lokasi/[slug]/rab/adendum/page.tsx`
 * (melanggar aturan #7 CLAUDE.md: rumus angka hanya di calculation layer), dan
 * `tests/unit/adendum-batas-10persen.test.ts` MENYALIN ULANG rumus itu sebagai
 * fungsi lokal. Akibatnya ujinya menguji salinannya sendiri: menghapus seluruh
 * blok peringatan di halaman tidak membuat satu uji pun merah. Aturan tata
 * kelola yang ujinya menguji salinannya sendiri sama saja dengan tidak diuji.
 *
 * ### Dasarnya NILAI KONTRAK, bukan RAB revisi pertama
 *
 * Pasal 54 membatasi penambahan **nilai kontrak akhir** terhadap **nilai
 * kontrak awal**. Yang dipakai kode lama adalah `rabRevision` pertama SATU
 * lokasi — dan revisi itu boleh ber-`source: hps_awal`, yaitu HPS, bukan nilai
 * kontrak hasil tender. Bila kontrak dimenangkan di 90% HPS, plafon yang
 * dipakai kira-kira 11% terlalu longgar terhadap nilai kontrak sebenarnya,
 * sementara layarnya menulis "10% nilai RAB kontrak awal". `Contract` juga
 * melekat pada `Package`, yang bisa memayungi banyak lokasi, sehingga batas
 * per-lokasi bukan batas yang dibatasi Perpres.
 *
 * Penegasan user 2026-09-01: *"10% ini terhadap apa? kontrak kan? bukan per
 * item."*
 *
 * ### Kumulatif, bukan per adendum
 *
 * Yang dibatasi adalah nilai kontrak AKHIR. Tiga adendum masing-masing 4%
 * melewati batas walau tak satu pun melewatinya sendirian, jadi adendum yang
 * SUDAH berlaku (`ContractAmendment.valueDelta`) ikut dijumlahkan.
 *
 * ### Tetap PERINGATAN, bukan penghalang
 *
 * Keputusan user 29 Juli 2026 (DECISIONS di sekitar editor adendum): *"jadi
 * warning (bukan blocker) — MARLIN mencatat kenyataan, bukan menolaknya."*
 * Modul ini karena itu mengembalikan sinyal, bukan melempar galat.
 */
import { withPpn } from "@/lib/money";

export type SinyalBatas =
  /** Kenaikan nilai kontrak kumulatif melewati 10% nilai kontrak awal. */
  | "lewat-batas"
  /** Nilai aman, tapi lingkupnya banyak bergeser (tukar-menukar besar). */
  | "geser-lingkup"
  | "aman";

/**
 * Dari mana angka pembanding diambil. Dibawa keluar supaya layar bisa MENYEBUT
 * dasarnya: peringatan yang menyebut "10% nilai kontrak" sambil diam-diam
 * memakai angka HPS adalah peringatan yang salah walau angkanya kebetulan
 * dekat.
 */
export type DasarBatas =
  /** `Contract.contractValue` — yang benar menurut Pasal 54. */
  | "kontrak"
  /** Kontrak belum ada; terpaksa memakai RAB revisi pertama lokasi ini. */
  | "rab-revisi-pertama";

export type HasilBatas = {
  sinyal: SinyalBatas;
  dasar: DasarBatas;
  /** Nilai kontrak awal, inklusif PPN. */
  nilaiAwal: bigint;
  /** 10% dari `nilaiAwal`. */
  batas: bigint;
  /** Kenaikan kumulatif (adendum berlaku + draft ini), inklusif PPN. */
  kenaikanKumulatif: bigint;
  /** Kenaikan draft ini saja, inklusif PPN. */
  kenaikanDraft: bigint;
  /** Σ kenaikan per item draft ini (KOTOR), inklusif PPN. */
  totalTambah: bigint;
};

export type MasukanBatas = {
  /** `Contract.contractValue` (inklusif PPN), atau null bila kontrak belum ada. */
  nilaiKontrak: bigint | null;
  /** `totalValue` RAB revisi pertama lokasi (PRA-PPN) — cadangan terakhir. */
  nilaiRabAwalPraPpn: bigint | null;
  /** Σ `valueDelta` adendum kontrak yang SUDAH berlaku (inklusif PPN). */
  deltaBerlaku: bigint;
  /** Δ nilai draft ini terhadap revisi aktif (PRA-PPN). */
  deltaDraftPraPpn: bigint;
  /** Σ kenaikan per item draft ini, kotor (PRA-PPN). */
  totalTambahPraPpn: bigint;
  ppnPercent: number;
};

/**
 * `null` bila tidak ada dasar sama sekali (kontrak belum ada DAN RAB awal
 * kosong). Mengembalikan null lebih jujur daripada memakai 0 sebagai nilai
 * awal, yang akan membuat setiap adendum sekecil apa pun "melanggar 10%".
 */
export function nilaiAdendum(m: MasukanBatas): HasilBatas | null {
  const dasar: DasarBatas = m.nilaiKontrak != null && m.nilaiKontrak > 0n ? "kontrak" : "rab-revisi-pertama";
  const nilaiAwal =
    dasar === "kontrak"
      ? m.nilaiKontrak!
      : m.nilaiRabAwalPraPpn != null
        ? withPpn(m.nilaiRabAwalPraPpn, m.ppnPercent)
        : 0n;
  if (nilaiAwal <= 0n) return null;

  const batas = nilaiAwal / 10n;
  const kenaikanDraft = withPpn(m.deltaDraftPraPpn, m.ppnPercent);
  const kenaikanKumulatif = m.deltaBerlaku + kenaikanDraft;
  const totalTambah = withPpn(m.totalTambahPraPpn, m.ppnPercent);

  const sinyal: SinyalBatas =
    kenaikanKumulatif > batas ? "lewat-batas" : totalTambah > batas ? "geser-lingkup" : "aman";

  return { sinyal, dasar, nilaiAwal, batas, kenaikanKumulatif, kenaikanDraft, totalTambah };
}
