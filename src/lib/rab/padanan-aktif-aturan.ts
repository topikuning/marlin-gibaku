/**
 * PEMASANGAN REALISASI SESUDAH AKTIVASI ADENDUM – aturan murni (DECISIONS 777).
 *
 * Permintaan user 2026-11-25: *"buat bisa dipasangkan sesudah aktivasi, menu
 * khusus. mitigasi semua resiko dan penanganannya"*.
 *
 * Sebelum aktivasi, item terlapor dipasangkan ke item DRAFT dengan pewarisan
 * kunci (DECISIONS 754). Sesudah aktivasi RAB aktif sudah sah dan dokumen CCO
 * sudah terbit, jadi RAB-nya TIDAK diubah: yang dipindah adalah KUNCI baris
 * laporan item lama, ke kunci item RAB aktif. Laporan, tanggal, pelapor, dan
 * fotonya tetap; baris itu membawa penanda usulannya supaya bisa dilepas lagi.
 *
 * MURNI: tanpa DB.
 */
import { akarLineage, kunciSatuan, satuanSetara, volumeNol } from "./padanan-draft-aturan";
import { sesuaikanProporsional } from "./sesuaikan-realisasi";

/** Item yang realisasinya akan dipasangkan (hilang dari RAB aktif, atau dinolkan). */
export type ItemLama = { lineageKey: string; name: string; unit: string | null };

/** Item RAB aktif calon penerima realisasi. */
export type ItemSasaran = {
  lineageKey: string;
  kind: string;
  name: string;
  unit: string | null;
  punyaAnak: boolean;
  volume: number | null;
};

/**
 * Sebab pasangan ini TIDAK sah, atau `null` bila sah.
 *
 * `lineageDraft` = kunci item di draft adendum yang sedang berjalan (null bila
 * tidak ada draft). Item lama yang muncul lagi di draft akan tersambung sendiri
 * saat draft itu aktif; memasangkannya sekarang membuat realisasinya terhitung
 * dua kali kelak.
 */
export function periksaPasanganAktif(
  lama: ItemLama,
  sasaran: ItemSasaran,
  konteks: { lineageAktif: ReadonlySet<string>; lineageDraft: ReadonlySet<string> | null },
): string | null {
  if (lama.lineageKey === sasaran.lineageKey) return `"${sasaran.name}" adalah item yang sama.`;
  if (!konteks.lineageAktif.has(sasaran.lineageKey)) return `"${sasaran.name}" tidak ada di RAB aktif.`;
  if (sasaran.kind !== "item" && sasaran.kind !== "grup") return `"${sasaran.name}" bukan item pekerjaan.`;
  if (sasaran.punyaAnak) return `"${sasaran.name}" punya rincian di bawahnya. Pilih salah satu rinciannya.`;
  if (volumeNol(sasaran.volume)) {
    return `"${sasaran.name}" bervolume 0 di RAB aktif, jadi tidak bisa menampung realisasi.`;
  }
  if (akarLineage(lama.lineageKey) !== akarLineage(sasaran.lineageKey)) {
    return (
      `Beda kategori: "${lama.name}" dan "${sasaran.name}" ada di kategori yang berbeda. ` +
      `Memasangkan lintas kategori memindahkan realisasinya ke kategori lain di blanko KKP.`
    );
  }
  if (!satuanSetara(lama.unit, sasaran.unit)) {
    return (
      `Beda satuan: "${lama.name}" dalam ${lama.unit}, "${sasaran.name}" dalam ${sasaran.unit}. ` +
      `Volume yang sudah dilaporkan dipindah apa adanya, jadi satuannya harus sama.`
    );
  }
  if (konteks.lineageDraft?.has(lama.lineageKey)) {
    return (
      `"${lama.name}" muncul lagi di draft adendum yang sedang berjalan. ` +
      `Realisasinya tersambung sendiri saat draft itu aktif, jadi tidak perlu dipasangkan.`
    );
  }
  return null;
}

/**
 * Sebab item RAB aktif ini TIDAK bisa menampung catatan pekerjaan di luar RAB,
 * atau `null` bila bisa (DECISIONS 780). Catatan tidak punya kategori, jadi
 * yang diperiksa hanya itemnya dan satuannya; satuan "-" (tidak diketahui)
 * cocok dengan apa pun.
 */
export function periksaSasaranLuarRab(
  catatan: readonly { uraian: string; satuan: string }[],
  sasaran: ItemSasaran,
  lineageAktif: ReadonlySet<string>,
): string | null {
  if (!lineageAktif.has(sasaran.lineageKey)) return `"${sasaran.name}" tidak ada di RAB aktif.`;
  if (sasaran.kind !== "item" && sasaran.kind !== "grup") return `"${sasaran.name}" bukan item pekerjaan.`;
  if (sasaran.punyaAnak) return `"${sasaran.name}" punya rincian di bawahnya. Pilih salah satu rinciannya.`;
  if (volumeNol(sasaran.volume)) {
    return `"${sasaran.name}" bervolume 0 di RAB aktif, jadi tidak bisa menampung realisasi.`;
  }
  const ks = kunciSatuan(sasaran.unit);
  const beda = catatan.find((c) => {
    const kc = kunciSatuan(c.satuan);
    return ks != null && kc != null && kc !== ks;
  });
  if (beda) {
    return (
      `Beda satuan: catatan "${beda.uraian}" dalam ${beda.satuan}, "${sasaran.name}" dalam ${sasaran.unit}. ` +
      `Volume catatan dipindah apa adanya, jadi satuannya harus sama.`
    );
  }
  return null;
}

/** Toleransi Decimal(15,3) – sisa pembulatan bukan kelebihan. */
const TOLERANSI = 0.0005;
const bulat3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Volume yang MASUK ke item tujuan (DECISIONS 780). Realisasi tidak boleh
 * melebihi volume kontrak item tujuan, tetapi kelebihannya DIPOTONG – dibagi
 * rata di antara baris pindahan, aturan yang sama dengan aktivasi adendum
 * (DECISIONS 745) – bukan ditolak: penolakan membuat pemasangan buntu persis
 * pada kasus adendum yang menurunkan volume (keluhan user 2026-11-25).
 * Baris milik item tujuan sendiri tidak disentuh. `null` = sisa volumenya 0.
 */
export function bagiMasuk(
  pindahan: readonly number[],
  tujuan: { volume: number; terlapor: number },
): { hasil: number[]; masuk: number; dipotong: number } | null {
  const sisa = bulat3(tujuan.volume - tujuan.terlapor);
  if (sisa <= TOLERANSI) return null;
  const total = bulat3(pindahan.reduce((t, v) => t + v, 0));
  if (total <= sisa + TOLERANSI) return { hasil: [...pindahan], masuk: total, dipotong: 0 };
  const hasil = sesuaikanProporsional([...pindahan], sisa) ?? [...pindahan];
  return { hasil, masuk: sisa, dipotong: bulat3(total - sisa) };
}

/**
 * Rencana PEMULIHAN volume yang dinolkan saat aktivasi, dari jejak audit
 * `rab.adendum_sesuaikan_realisasi` aktivasi itu (per tanggal: dari → ke).
 *
 * Hanya baris yang angkanya MASIH sama dengan sesudah aktivasi yang dipulihkan.
 * Bila ada yang sudah berubah, tidak satu pun dipulihkan – angka orang tidak
 * ditimpa diam-diam; tanggalnya disebut.
 */
export function rencanaPulihNol(
  jejak: readonly { tanggal: string; dari: number; ke: number }[],
  baris: readonly { id: string; tanggal: string; volume: number }[],
): { ok: true; pulih: Map<string, number> } | { ok: false; tanggal: string[] } {
  const perTanggal = new Map(jejak.map((j) => [j.tanggal, j]));
  const pulih = new Map<string, number>();
  const berubah: string[] = [];
  for (const b of baris) {
    const j = perTanggal.get(b.tanggal);
    if (!j) continue;
    if (Math.abs(b.volume - j.ke) > TOLERANSI) berubah.push(b.tanggal);
    else if (Math.abs(j.dari - j.ke) > TOLERANSI) pulih.set(b.id, j.dari);
  }
  return berubah.length > 0 ? { ok: false, tanggal: berubah.sort() } : { ok: true, pulih };
}

export type KeadaanUsulan = "diajukan" | "berlaku" | "ditutup" | "dilepas";

/** Keadaan usulan diturunkan dari tanggalnya. */
export function keadaanUsulan(p: {
  berlakuPada: Date | null;
  ditutupPada: Date | null;
  dilepasPada: Date | null;
}): KeadaanUsulan {
  if (p.dilepasPada) return "dilepas";
  if (p.ditutupPada) return "ditutup";
  if (p.berlakuPada) return "berlaku";
  return "diajukan";
}

/** Selisih jam aplikasi saat menulis baris dan saat menandai usulan berlaku. */
const JEDA_TULIS_MS = 60_000;

/**
 * Baris ini diubah orang SESUDAH pemasangan berlaku? Lepas tidak boleh
 * menimpa perubahan itu – ia hanya mengembalikan angka yang ditulis pemasangan.
 */
export function barisDiubahSesudah(updatedAt: Date, berlakuPada: Date): boolean {
  return updatedAt.getTime() > berlakuPada.getTime() + JEDA_TULIS_MS;
}

/* ── Catatan pekerjaan di luar RAB → item RAB aktif (DECISIONS 780) ────── */

export type CatatanMasuk = { id: string; reportId: string; tanggal: string; volume: number };

/** Satu baris laporan hasil pemasangan: baru, atau menumpang di baris yang sudah ada. */
export type BarisLuarRab = {
  reportId: string;
  tanggal: string;
  catatanIds: string[];
  /** Volume catatan yang masuk ke baris ini (sesudah dipotong). */
  tambah: number;
  /** Volume baris item tujuan yang SUDAH ada di laporan itu; null = baris baru. */
  adaVolume: number | null;
};

/**
 * Rencana baris laporan untuk catatan di luar RAB yang dipasangkan ke item RAB
 * aktif. Laporan harian hanya punya satu baris per item, jadi catatan di
 * laporan yang sama digabung; laporan yang sudah punya baris item tujuan
 * mendapat tambahan di baris itu. Kelebihan atas sisa volume dipotong dibagi
 * rata (`bagiMasuk`). `null` = sisa volume item tujuan 0.
 *
 * `ada` = volume baris item tujuan yang sudah ada, per laporan.
 */
export function rencanaLuarRab(
  catatan: readonly CatatanMasuk[],
  ada: ReadonlyMap<string, number>,
  tujuan: { volume: number; terlapor: number },
): { baris: BarisLuarRab[]; masuk: number; dipotong: number } | null {
  const grup = new Map<string, BarisLuarRab>();
  for (const c of [...catatan].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.id.localeCompare(b.id))) {
    const g = grup.get(c.reportId);
    if (g) {
      g.catatanIds.push(c.id);
      g.tambah = bulat3(g.tambah + c.volume);
    } else {
      grup.set(c.reportId, {
        reportId: c.reportId,
        tanggal: c.tanggal,
        catatanIds: [c.id],
        tambah: bulat3(c.volume),
        adaVolume: ada.has(c.reportId) ? ada.get(c.reportId)! : null,
      });
    }
  }
  const baris = [...grup.values()];
  const bagi = bagiMasuk(
    baris.map((b) => b.tambah),
    tujuan,
  );
  if (!bagi) return null;
  bagi.hasil.forEach((v, i) => (baris[i]!.tambah = v));
  return { baris, masuk: bagi.masuk, dipotong: bagi.dipotong };
}
