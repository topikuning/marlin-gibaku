import type { PackageStage } from "@/generated/prisma/enums";

/**
 * KESIAPAN DATA satu paket (DECISIONS 368) — murni, tanpa DB.
 *
 * Rancangan user 2026-08-19 menaruh kolom "Status Data" di daftar paket. Yang
 * dijawabnya: *paket mana yang belum bisa dipakai bekerja?* Sebelumnya jawaban
 * itu hanya bisa didapat dengan membuka paketnya satu per satu.
 *
 * ### Diukur terhadap TAHAPNYA, bukan terhadap daftar isian yang sama
 *
 * Paket prospek yang belum punya lokasi itu WAJAR — prospek memang belum tentu
 * jadi. Kalau ia ikut ditandai merah, seluruh kolom ini jadi merah pada paket
 * yang tidak salah apa-apa, dan kolom yang selalu merah berhenti dibaca. Yang
 * benar-benar menghambat adalah paket yang SUDAH berkontrak tapi belum punya
 * lokasi: tidak ada yang bisa dilaporkan, dan tidak ada yang menyadarinya.
 *
 * ### Selalu menyebut APA yang kurang
 *
 * `kurang` bukan hiasan. Lencana "Perlu cek" tanpa penyebutnya memaksa orang
 * membuka paketnya untuk menebak-nebak — persis pekerjaan yang hendak
 * dihilangkan kolom ini.
 *
 * ### Grup WA & folder Drive TIDAK dihitung di sini
 *
 * Keduanya jalur pengiriman, bukan syarat pekerjaan — laporan tetap bisa dibuat
 * tanpanya — dan keduanya SUDAH punya kolomnya sendiri di daftar paket sejak
 * 2026-07-30. Versi pertama fungsi ini memasukkannya sebagai catatan, dan
 * hasilnya terlihat begitu dijalankan pada data nyata: SELURUH paket
 * pelaksanaan berlencana "Perlu cek" yang sama, karena tak satu pun punya grup
 * WA. Kolom yang warnanya seragam tidak membedakan apa pun, dan yang tidak
 * membedakan apa pun berhenti dibaca.
 */

export type KesiapanPaket = "lengkap" | "perlu_cek" | "belum_lengkap" | "arsip";

export const KESIAPAN_LABEL: Record<KesiapanPaket, string> = {
  lengkap: "Lengkap",
  perlu_cek: "Perlu cek",
  belum_lengkap: "Belum lengkap",
  arsip: "Arsip",
};

export const KESIAPAN_TONE: Record<KesiapanPaket, "success" | "warning" | "danger" | "neutral"> = {
  lengkap: "success",
  perlu_cek: "warning",
  belum_lengkap: "danger",
  arsip: "neutral",
};

/** Tahap yang sudah mengikat: lokasi & penyedia bukan lagi opsional. */
const TAHAP_MENGIKAT: ReadonlySet<PackageStage> = new Set<PackageStage>([
  "penetapan",
  "kontrak",
  "pelaksanaan",
  "serah_terima",
  "selesai",
]);

export type BahanKesiapan = {
  stage: PackageStage;
  locationCount: number;
  /** Vendor kontrak ATAU kandidat — dua-duanya menjawab "siapa yang mengerjakan". */
  adaVendor: boolean;
};

export function kesiapanPaket(p: BahanKesiapan): { status: KesiapanPaket; kurang: string[] } {
  // Paket batal tidak menunggu apa pun. Menandainya "belum lengkap" berarti
  // menagih pekerjaan atas sesuatu yang sudah ditutup.
  if (p.stage === "batal") return { status: "arsip", kurang: [] };

  const mengikat = TAHAP_MENGIKAT.has(p.stage);
  const penghalang: string[] = [];
  const catatan: string[] = [];

  if (mengikat) {
    if (p.locationCount === 0) penghalang.push("lokasi belum dipilih");
    if (!p.adaVendor) penghalang.push("penyedia belum ditetapkan");
  } else {
    // Prospek & tender: belum wajib, tapi tetap disebut supaya orang tahu apa
    // yang menunggu — sekadar bukan sebagai penghalang.
    if (p.locationCount === 0) catatan.push("lokasi belum dipilih");
    if (!p.adaVendor) catatan.push("kandidat penyedia belum diisi");
  }

  if (penghalang.length > 0) {
    return { status: "belum_lengkap", kurang: [...penghalang, ...catatan] };
  }
  if (catatan.length > 0) return { status: "perlu_cek", kurang: catatan };
  return { status: "lengkap", kurang: [] };
}
