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
import { kunciSatuan } from "./padanan-draft-aturan";

/**
 * DECISIONS 781 – ketetapan user 2026-11-25: *"intinya kasih saja semua list
 * pekerjaan di RAB aktif, untuk dipadankan, satuan dsb mengikuti rab aktif,
 * hanya volume saja disesuaikan atau bisa diinput sesuai sisa. mitigasi total
 * masalah pemetaan manual ini."*
 *
 * Jadi tujuan pemasangan adalah SEMUA item pekerjaan RAB aktif – beda kategori
 * dan beda satuan tidak lagi ditolak, hanya disebut. Satuan ikut item tujuan;
 * volume yang masuk diisi orang (bawaan: volume asalnya bila satuannya sama),
 * paling banyak sebesar sisa item tujuan.
 */

/** Item RAB aktif calon penerima realisasi. */
export type ItemSasaran = {
  lineageKey: string;
  kind: string;
  name: string;
  punyaAnak: boolean;
};

/**
 * Sebab item ini TIDAK bisa menjadi tujuan, atau `null` bila bisa. Yang tersisa
 * hanya syarat bentuk: harus item pekerjaan RAB aktif tanpa rincian, dan bukan
 * item yang sama. Kategori, satuan, dan sisa volume tidak menolak.
 */
export function periksaSasaran(
  sasaran: ItemSasaran,
  lineageAktif: ReadonlySet<string>,
  lineageLama: string | null = null,
): string | null {
  if (lineageLama != null && lineageLama === sasaran.lineageKey) return `"${sasaran.name}" adalah item yang sama.`;
  if (!lineageAktif.has(sasaran.lineageKey)) return `"${sasaran.name}" tidak ada di RAB aktif.`;
  if (sasaran.kind !== "item" && sasaran.kind !== "grup") return `"${sasaran.name}" bukan item pekerjaan.`;
  if (sasaran.punyaAnak) return `"${sasaran.name}" punya rincian di bawahnya. Pilih salah satu rinciannya.`;
  return null;
}

/** Satuan dianggap sama bila bentuk bakunya sama, atau salah satunya tidak diketahui. */
export function satuanSama(a: string | null, b: string | null): boolean {
  const ka = kunciSatuan(a);
  const kb = kunciSatuan(b);
  return ka == null || kb == null || ka === kb;
}

/** Toleransi Decimal(15,3) – sisa pembulatan bukan kelebihan. */
const TOLERANSI = 0.0005;
const bulat3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Volume yang MASUK ke item tujuan.
 *
 * - `diminta` = isian orang, dalam satuan item tujuan. Kosong → volume asalnya,
 *   hanya bila satuannya sama; beda satuan WAJIB diisi (angka tidak bisa
 *   dipindah apa adanya dari m ke m3).
 * - Tidak boleh melebihi sisa item tujuan. `ketat` (saat mengajukan): isian
 *   yang melebihi sisa ditolak. Saat berlaku (sisa bisa sudah berkurang
 *   sejak diajukan) dan untuk isian kosong: dipotong ke sisa.
 * - Sisa 0 tetap boleh: catatannya hanya dipetakan, volumenya 0.
 * - `dipotong` = volume asal yang tidak ikut masuk; hanya bermakna bila
 *   satuannya sama.
 */
export function tentukanMasuk(o: {
  asal: number;
  diminta: number | null;
  sisa: number;
  satuanSama: boolean;
  ketat: boolean;
}): { masuk: number; dipotong: number } | { galat: "isi_volume" | "negatif" | "melebihi" } {
  if (o.diminta == null && !o.satuanSama) return { galat: "isi_volume" };
  const minta = bulat3(o.diminta ?? o.asal);
  if (minta < 0) return { galat: "negatif" };
  const sisa = bulat3(Math.max(0, o.sisa));
  if (o.ketat && o.diminta != null && minta > sisa + TOLERANSI) return { galat: "melebihi" };
  const masuk = Math.min(minta, sisa);
  return { masuk, dipotong: o.satuanSama ? bulat3(Math.max(0, o.asal - masuk)) : 0 };
}

/**
 * Bagi `target` ke tiap baris sesuai bobotnya – naik ATAU turun. Σ hasil ==
 * `target` PERSIS pada presisi 3 desimal (sisa terbesar / Hamilton, seperti
 * `sesuaikanProporsional`). Bobot yang semuanya 0 → dibagi sama rata.
 * Bobot yang sama dengan target mengembalikan bobotnya apa adanya.
 */
export function bagiProporsional(bobot: readonly number[], target: number): number[] {
  if (bobot.length === 0) return [];
  const t = Math.max(0, Math.round(target * 1000));
  const w = bobot.map((v) => Math.max(0, Math.round(v * 1000)));
  const total = w.reduce((a, v) => a + v, 0);
  const eksak = total > 0 ? w.map((v) => (v * t) / total) : w.map(() => t / w.length);
  const bawah = eksak.map((e) => Math.floor(e));
  const kurang = t - bawah.reduce((a, v) => a + v, 0);
  const urut = eksak
    .map((e, i) => ({ i, pecahan: e - bawah[i]! }))
    .sort((a, b) => b.pecahan - a.pecahan || a.i - b.i);
  const naik = new Set(urut.slice(0, Math.max(0, Math.min(kurang, w.length))).map((o) => o.i));
  return bawah.map((v, i) => (v + (naik.has(i) ? 1 : 0)) / 1000);
}

/**
 * Bobot baris item yang DINOLKAN saat aktivasi (DECISIONS 745/756): angka
 * sebelum diturunkan, dari jejak audit aktivasi, untuk baris yang angkanya
 * masih seperti sesudah aktivasi; baris yang sudah diubah orang sesudahnya
 * memakai angkanya sekarang. Tidak ada lagi yang ditolak di sini – volumenya
 * toh diisi dan disetujui orang (781).
 */
export function bobotDinolkan(
  jejak: readonly { tanggal: string; dari: number; ke: number }[],
  baris: readonly { id: string; tanggal: string; volume: number }[],
): Map<string, number> {
  const perTanggal = new Map(jejak.map((j) => [j.tanggal, j]));
  return new Map(
    baris.map((b) => {
      const j = perTanggal.get(b.tanggal);
      return [b.id, j && Math.abs(b.volume - j.ke) <= TOLERANSI ? j.dari : b.volume];
    }),
  );
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

/* ── Catatan pekerjaan di luar RAB → item RAB aktif (DECISIONS 780/781) ── */

export type CatatanMasuk = { id: string; reportId: string; tanggal: string; volume: number };

/** Satu baris laporan hasil pemasangan: baru, atau menumpang di baris yang sudah ada. */
export type BarisLuarRab = {
  reportId: string;
  tanggal: string;
  catatanIds: string[];
  /** Volume yang masuk ke baris ini, dalam satuan item tujuan. */
  tambah: number;
  /** Volume baris item tujuan yang SUDAH ada di laporan itu; null = baris baru. */
  adaVolume: number | null;
};

/**
 * Rencana baris laporan untuk catatan di luar RAB yang dipasangkan ke item RAB
 * aktif. Laporan harian hanya punya satu baris per item, jadi catatan di
 * laporan yang sama digabung; laporan yang sudah punya baris item tujuan
 * mendapat tambahan di baris itu. `masuk` dibagi ke laporan-laporan itu sesuai
 * volume catatannya (`bagiProporsional`).
 *
 * `ada` = volume baris item tujuan yang sudah ada, per laporan.
 */
export function rencanaLuarRab(
  catatan: readonly CatatanMasuk[],
  ada: ReadonlyMap<string, number>,
  masuk: number,
): BarisLuarRab[] {
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
  bagiProporsional(
    baris.map((b) => b.tambah),
    masuk,
  ).forEach((v, i) => (baris[i]!.tambah = v));
  return baris;
}
