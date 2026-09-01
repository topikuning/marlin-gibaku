/**
 * BATAS 10% PERPRES 16/2018 PASAL 54 — modul murni, tanpa DB.
 *
 * ### Plafonnya milik KONTRAK, dibagi rebutan antar lokasi
 *
 * Penegasan user 2026-09-01, dengan contohnya sendiri:
 *
 * > "satu kontrak bisa naik turun 10% dari batas nilai kontrak. misal 2 lokasi,
 * > lokasi a kontrak 100jt, lokasi b 100jt. batas kenaikan adalah 20jt. maka
 * > ketika lokasi a sudah 15jt penambahan, lokasi b maksimal tinggal 5jt."
 *
 * Jadi 10% BUKAN jatah per lokasi. Ia satu plafon untuk seluruh kontrak, dan
 * setiap lokasi yang sudah menaikkan nilainya mengurangi sisa untuk lokasi lain.
 * `Contract` melekat pada `Package` (`packageId @unique`) yang bisa memayungi
 * banyak `Location`, sementara RAB dan adendum hidup per lokasi — di situlah
 * batas per-lokasi menjadi salah.
 *
 * ### Kenaikan dibaca dari RAB AKTIF, bukan dari catatan CCO
 *
 * Percobaan pertama menjumlahkan `ContractAmendment.valueDelta` sebagai buku
 * besar kenaikan. Itu tidak bisa diandalkan: `RabRevision.amendmentId` **boleh
 * kosong** dan tidak satu pun jalur aktivasi menuntutnya. Adendum yang
 * diaktifkan tanpa CCO terdaftar karena itu tidak terhitung sama sekali, dan
 * lokasi berikutnya akan terlihat masih punya plafon penuh.
 *
 * Yang dipakai sekarang adalah keadaan yang sebenarnya berlaku: Σ nilai RAB
 * AKTIF seluruh lokasi paket, dengan lokasi yang sedang diadendum diganti nilai
 * DRAFT-nya. Itu persis "nilai kontrak akhir" yang dimaksud Pasal 54.
 *
 * ### Dasarnya NILAI KONTRAK, bukan RAB revisi pertama
 *
 * Kode lama memakai `rabRevision` pertama satu lokasi — dan revisi itu boleh
 * ber-`source: hps_awal`, yaitu HPS, bukan nilai kontrak hasil tender. Bila
 * kontrak dimenangkan di 90% HPS, plafonnya kira-kira 11% terlalu longgar,
 * sementara layarnya menulis "10% nilai RAB kontrak awal".
 *
 * ### Tetap PERINGATAN, bukan penghalang
 *
 * Keputusan user 29 Juli 2026: *"jadi warning (bukan blocker) — MARLIN mencatat
 * kenyataan, bukan menolaknya."* Modul ini mengembalikan sinyal, tidak melempar.
 */
import { withPpn } from "@/lib/money";

export type SinyalBatas =
  /** Kenaikan nilai kontrak (seluruh lokasi) melewati 10% nilai kontrak awal. */
  | "lewat-batas"
  /** Nilai aman, tapi lingkupnya banyak bergeser (tukar-menukar besar). */
  | "geser-lingkup"
  | "aman";

/**
 * Dari mana angka pembanding diambil. Dibawa keluar supaya layar bisa MENYEBUT
 * dasarnya: peringatan yang menyebut "10% nilai kontrak" sambil diam-diam
 * memakai angka HPS adalah peringatan yang salah walau angkanya kebetulan dekat.
 */
export type DasarBatas =
  /** `Contract.contractValue` — yang benar menurut Pasal 54. */
  | "kontrak"
  /** Kontrak belum ada; terpaksa memakai RAB revisi pertama LOKASI INI saja. */
  | "rab-revisi-pertama";

/** Nilai RAB aktif satu lokasi dalam paket. `null` = lokasi itu belum punya RAB aktif. */
export type RabLokasi = { locationId: string; totalPraPpn: bigint | null };

export type HasilBatas = {
  sinyal: SinyalBatas;
  dasar: DasarBatas;
  /** Nilai kontrak awal, inklusif PPN. */
  nilaiAwal: bigint;
  /** 10% dari `nilaiAwal` — plafon untuk SELURUH kontrak. */
  batas: bigint;
  /** Nilai kontrak akhir bila draft ini diaktifkan, inklusif PPN. */
  nilaiAkhir: bigint;
  /** `nilaiAkhir − nilaiAwal`: kenaikan seluruh lokasi, inklusif PPN. */
  kenaikanKumulatif: bigint;
  /** Kenaikan yang disumbang draft ini saja, inklusif PPN. */
  kenaikanDraft: bigint;
  /** Kenaikan lokasi LAIN yang sudah berlaku — ini yang memakan plafon. */
  kenaikanLokasiLain: bigint;
  /** `batas − kenaikanKumulatif`. Negatif = sudah lewat. */
  sisaPlafon: bigint;
  /** Σ kenaikan per item draft ini (KOTOR), inklusif PPN. */
  totalTambah: bigint;
  /**
   * Lokasi paket yang BELUM punya RAB aktif. Selama masih ada, `nilaiAkhir`
   * lebih rendah dari kenyataan dan angkanya belum bisa dipercaya — harus
   * dikatakan di layar, bukan disembunyikan di balik "aman".
   */
  lokasiTanpaRabAktif: number;
};

export type MasukanBatas = {
  /** `Contract.contractValue` (inklusif PPN), atau null bila kontrak belum ada. */
  nilaiKontrak: bigint | null;
  /** Nilai RAB AKTIF tiap lokasi dalam paket (PRA-PPN). */
  rabAktifPaket: RabLokasi[];
  /** Lokasi yang sedang diadendum. */
  locationIdDraft: string;
  /** `totalValue` draft adendum lokasi itu (PRA-PPN). */
  totalDraftPraPpn: bigint;
  /** Σ kenaikan per item draft ini, kotor (PRA-PPN). */
  totalTambahPraPpn: bigint;
  /** Cadangan bila kontrak belum ada: RAB revisi pertama LOKASI INI (PRA-PPN). */
  nilaiRabAwalPraPpn: bigint | null;
  ppnPercent: number;
};

/**
 * `null` bila tidak ada dasar sama sekali (kontrak belum ada DAN RAB awal
 * kosong). Mengembalikan null lebih jujur daripada memakai 0 sebagai nilai
 * awal, yang akan membuat setiap adendum sekecil apa pun "melanggar 10%".
 */
export function nilaiAdendum(m: MasukanBatas): HasilBatas | null {
  const adaKontrak = m.nilaiKontrak != null && m.nilaiKontrak > 0n;
  const dasar: DasarBatas = adaKontrak ? "kontrak" : "rab-revisi-pertama";

  const aktifLokasiIni = m.rabAktifPaket.find((r) => r.locationId === m.locationIdDraft)?.totalPraPpn ?? 0n;
  const kenaikanDraft = withPpn(m.totalDraftPraPpn - aktifLokasiIni, m.ppnPercent);
  const totalTambah = withPpn(m.totalTambahPraPpn, m.ppnPercent);

  if (!adaKontrak) {
    // Tanpa kontrak tidak ada plafon paket yang bisa dihitung; yang tersisa
    // hanya perbandingan per lokasi, dan dasarnya WAJIB ditandai supaya
    // kalimat di layar tidak menyebutnya "nilai kontrak".
    if (m.nilaiRabAwalPraPpn == null) return null;
    const nilaiAwal = withPpn(m.nilaiRabAwalPraPpn, m.ppnPercent);
    if (nilaiAwal <= 0n) return null;
    const batas = nilaiAwal / 10n;
    return {
      sinyal: kenaikanDraft > batas ? "lewat-batas" : totalTambah > batas ? "geser-lingkup" : "aman",
      dasar,
      nilaiAwal,
      batas,
      nilaiAkhir: nilaiAwal + kenaikanDraft,
      kenaikanKumulatif: kenaikanDraft,
      kenaikanDraft,
      kenaikanLokasiLain: 0n,
      sisaPlafon: batas - kenaikanDraft,
      totalTambah,
      lokasiTanpaRabAktif: 0,
    };
  }

  const nilaiAwal = m.nilaiKontrak!;
  const batas = nilaiAwal / 10n;

  // Nilai kontrak AKHIR = Σ RAB aktif seluruh lokasi, dengan lokasi yang sedang
  // diadendum diganti nilai draftnya.
  let akhirPraPpn = 0n;
  let lokasiTanpaRabAktif = 0;
  for (const r of m.rabAktifPaket) {
    if (r.locationId === m.locationIdDraft) {
      akhirPraPpn += m.totalDraftPraPpn;
      continue;
    }
    if (r.totalPraPpn == null) {
      lokasiTanpaRabAktif++;
      continue;
    }
    akhirPraPpn += r.totalPraPpn;
  }
  const nilaiAkhir = withPpn(akhirPraPpn, m.ppnPercent);
  const kenaikanKumulatif = nilaiAkhir - nilaiAwal;

  return {
    sinyal:
      kenaikanKumulatif > batas ? "lewat-batas" : totalTambah > batas ? "geser-lingkup" : "aman",
    dasar,
    nilaiAwal,
    batas,
    nilaiAkhir,
    kenaikanKumulatif,
    kenaikanDraft,
    kenaikanLokasiLain: kenaikanKumulatif - kenaikanDraft,
    sisaPlafon: batas - kenaikanKumulatif,
    totalTambah,
    lokasiTanpaRabAktif,
  };
}
