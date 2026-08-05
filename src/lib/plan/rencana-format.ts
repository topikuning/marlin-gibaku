import { bobotPct } from "@/lib/progress-calc";

/**
 * FORMAT & ANGKA RENCANA MINGGUAN — modul murni (DECISIONS 258).
 *
 * Keberatan user 2026-08-05: *"aku sudah buat rencana, lalu apa? mana
 * outputnya? … dari apa yang kamu rencanakan, itu berapa persen pencapaiannya
 * jika rencanamu diikuti … apa maksud tulisan merah itu?"*
 *
 * Tiga cacat berbeda, satu akarnya sama: rencana ditampilkan tanpa pernah
 * dinilai. Berkas ini memuat aturan penilaiannya — tanpa database, tanpa React —
 * supaya bisa diuji langsung dan dipakai layar maupun berkas cetak dari SATU
 * tempat.
 *
 * ### Acuannya
 *
 * - **Last Planner System** (lean construction): rencana mingguan adalah
 *   KOMITMEN, dan kredibilitasnya diukur dengan **PPC — Percent Plan Complete**:
 *   berapa dari yang dijanjikan minggu lalu benar-benar tuntas. Tanpa PPC,
 *   rencana minggu ini cuma daftar harapan yang tidak pernah ditagih.
 * - **Earned Value Management**: rencana tidak pernah disajikan sendirian —
 *   selalu bersama realisasi dan deviasinya, dan dinyatakan dalam BOBOT (%
 *   nilai), bukan volume, supaya item besar dan kecil bisa dibandingkan.
 */

/* ── 1. Label "kejar" ────────────────────────────────────────────────────── */

/**
 * Penjelasan bagian target yang bersifat menutup ketertinggalan jadwal.
 *
 * Notasi lama `(+1.698,24 kejar)` MENYESATKAN. Tanda `+` membacanya sebagai
 * tambahan DI ATAS target, padahal bagian itu ada DI DALAM target:
 *
 * ```
 * targetVolume  = min(sisa, tambahan minggu ini + tertinggal)
 * catchUpVolume = min(tertinggal, sisa)      ← himpunan bagian
 * ```
 *
 * Akibatnya baris dengan target 1.698,24 dan ketertinggalan 1.698,24 terbaca
 * 3.396,48, padahal artinya "seluruh target ini menutup ketertinggalan — item
 * belum tersentuh sama sekali". Angka di layar benar; yang salah cara
 * membacanya, dan itu ditentukan oleh labelnya.
 *
 * Bentuknya LABEL (`Ketertinggalan: …`), bukan kalimat. "kejaran" adalah bahasa
 * lisan dan tidak pantas di dokumen yang ditandatangani PPK; "ketertinggalan"
 * adalah istilah baku yang sudah dipakai di seluruh sistem ini.
 */
export function labelKejar(
  targetVolume: number,
  catchUpVolume: number,
  fmt: (n: number) => string,
  unit?: string | null,
): string | null {
  const EPS = 1e-6;
  if (catchUpVolume <= EPS) return null;
  // Seluruh target = ketertinggalan: mengulang angkanya tidak menambah apa pun,
  // dan justru berisiko dibaca sebagai angka kedua.
  if (catchUpVolume >= targetVolume - EPS) return "Ketertinggalan: seluruh target ini";
  return `Ketertinggalan: ${fmt(catchUpVolume)}${unit ? ` ${unit}` : ""}`;
}

/* ── 2. Proyeksi: "kalau rencana ini diikuti, sampai di mana?" ───────────── */

export type Proyeksi = {
  /** Bobot yang DITAMBAHKAN rencana minggu ini (poin persen). */
  tambahanPct: number;
  /** Realisasi sekarang + tambahan rencana. */
  proyeksiPct: number;
  /** Tuntutan kurva-S di akhir minggu ini. */
  targetPct: number;
  /** proyeksi − target; negatif = masih tertinggal walau rencana dituruti. */
  selisihPct: number;
  /** true = rencana ini SAJA belum cukup mengejar kurva-S. */
  masihTertinggal: boolean;
};

/**
 * Akibat rencana, bukan riwayatnya.
 *
 * Layar lama hanya menampilkan rencana s/d minggu ini, realisasi, dan deviasi —
 * semuanya tentang yang SUDAH lewat. Tidak ada satu angka pun yang menjawab
 * "kalau rencana ini dikerjakan penuh, saya sampai di mana?", padahal itulah
 * satu-satunya pertanyaan yang membuat sebuah rencana bisa dinilai SEBELUM
 * dijalankan.
 *
 * Bobotnya dihitung lewat `bobotPct` (progress-calc) — bukan rumus baru di
 * sini. Aturan repo: formula angka hanya boleh hidup di calculation layer.
 */
export function hitungProyeksi(input: {
  actualPct: number;
  targetPct: number;
  nilaiRencana: number;
  grandTotal: number;
}): Proyeksi {
  const tambahanPct = bobotPct(input.nilaiRencana, input.grandTotal);
  const proyeksiPct = input.actualPct + tambahanPct;
  const selisihPct = proyeksiPct - input.targetPct;
  return {
    tambahanPct,
    proyeksiPct,
    targetPct: input.targetPct,
    selisihPct,
    // Ambang 0,01 poin: selisih di bawah itu hasil pembulatan, bukan
    // ketertinggalan — menandainya merah hanya melatih orang mengabaikan warna.
    masihTertinggal: selisihPct < -0.01,
  };
}

/* ── 3. PPC — Percent Plan Complete (Last Planner System) ────────────────── */

export type PpcItem = { targetVolume: number; realisasiVolume: number };

export type Ppc = {
  /** Jumlah komitmen minggu lalu. */
  jumlah: number;
  /** Yang TUNTAS (realisasi ≥ target). */
  tuntas: number;
  /** tuntas / jumlah × 100. null bila tidak ada rencana minggu lalu. */
  pct: number | null;
  /** Pencapaian volume tertimbang — pelengkap, BUKAN pengganti PPC. */
  volumePct: number | null;
};

/**
 * PPC dihitung PER KOMITMEN dan BINER — tuntas atau tidak.
 *
 * Ini bukan kelalaian, melainkan inti Last Planner System: pekerjaan yang baru
 * 80% selesai TIDAK melepaskan pekerjaan penerusnya. Menghitung PPC secara
 * tertimbang-volume akan memberi angka bagus untuk minggu yang sebenarnya
 * memacetkan seluruh rantai — persis kebohongan yang PPC diciptakan untuk
 * membongkar.
 *
 * Pencapaian volume tetap dilaporkan sebagai angka KEDUA, karena berguna untuk
 * melihat "hampir" — tapi ia tidak boleh menggantikan PPC.
 */
export function hitungPpc(items: PpcItem[]): Ppc {
  if (items.length === 0) return { jumlah: 0, tuntas: 0, pct: null, volumePct: null };
  const EPS = 1e-6;
  const tuntas = items.filter((i) => i.realisasiVolume + EPS >= i.targetVolume).length;
  const totalTarget = items.reduce((t, i) => t + i.targetVolume, 0);
  const totalReal = items.reduce((t, i) => t + Math.min(i.realisasiVolume, i.targetVolume), 0);
  return {
    jumlah: items.length,
    tuntas,
    pct: Math.round((tuntas / items.length) * 1000) / 10,
    // Dibatasi ke target per item: kelebihan di satu item tidak boleh menutupi
    // kekurangan di item lain — itu akan menyembunyikan yang macet.
    volumePct: totalTarget <= EPS ? null : Math.round((totalReal / totalTarget) * 1000) / 10,
  };
}

/* ── 4. Status ringkas ───────────────────────────────────────────────────── */

export type StatusRencana = "aman" | "perhatian" | "kritis";

/**
 * Status deviasi. SELALU dipasangkan dengan labelnya, tidak pernah warna saja —
 * berkas ini dicetak hitam-putih dan dibaca orang yang mungkin buta warna.
 *
 * Ambangnya mengikuti praktik umum monev proyek konstruksi: deviasi di bawah
 * 5 poin masih terkejar dalam satu-dua minggu; di atas 10 poin biasanya perlu
 * keputusan di luar kewenangan pelaksana (tambah alat, tambah regu, revisi
 * jadwal), jadi ia harus terlihat berbeda.
 */
export function statusDeviasi(deviasiPct: number): StatusRencana {
  if (deviasiPct >= -5) return "aman";
  if (deviasiPct >= -10) return "perhatian";
  return "kritis";
}

export const LABEL_STATUS: Record<StatusRencana, string> = {
  aman: "Sesuai jadwal",
  perhatian: "Perlu perhatian",
  kritis: "Kritis",
};
