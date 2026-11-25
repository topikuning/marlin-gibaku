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
import { akarLineage, satuanSetara, volumeNol } from "./padanan-draft-aturan";

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

/** Toleransi Decimal(15,3) – sisa pembulatan bukan kelebihan. */
const TOLERANSI = 0.0005;
const bulat3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Cukupkah sisa volume item sasaran untuk realisasi pindahan? `terlapor` =
 * semua baris basis aktif item sasaran, status laporan apa pun (yang belum
 * dikirim juga akan terhitung). Realisasi tidak boleh melebihi volume kontrak –
 * sama dengan pagar laporan harian.
 */
export function ruangVolume(o: { volume: number; terlapor: number; pindahan: number }): {
  cukup: boolean;
  kelebihan: number;
  sisa: number;
} {
  const sisa = bulat3(Math.max(0, o.volume - o.terlapor));
  const lebih = bulat3(o.terlapor + o.pindahan - o.volume);
  return lebih > TOLERANSI ? { cukup: false, kelebihan: lebih, sisa } : { cukup: true, kelebihan: 0, sisa };
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
