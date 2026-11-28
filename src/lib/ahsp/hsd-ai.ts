import "server-only";
import { aiStructured } from "@/lib/ai/structured";
import { checkAiGuard, AiGuardError } from "@/lib/ai-hub/guard";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";
import { keadaanHarga } from "./hsd";
import { hasilHargaAiSchema, cocokkanUsulanHarga, type TargetHargaAi, type UsulanHargaAi } from "./hsd-ai-parse";
import { BATAS_USULAN_HARGA_AI, kunciTarget, pilihTargetUsulan } from "./usulan-target";
export type { UsulanHargaAi } from "./hsd-ai-parse";

/**
 * Draf Harga Satuan Dasar dari AI (DECISIONS 441, dirombak DECISIONS 475).
 *
 * Angka di sini TIDAK disimpan sebagai HSD dan TIDAK ikut kalkulasi. Ia menjadi
 * baris `HsdUsulanAi` berstatus `draf`; hanya penerimaan oleh orang yang
 * memindahkannya ke `HargaSatuanDasar`.
 *
 * Panggilan providernya dijalankan DI LATAR (`hsd-ai-latar.ts`). Berkas ini
 * hanya menyiapkan targetnya dan memanggil provider — tidak tahu-menahu soal
 * request maupun layar.
 */

export type TargetSiap = {
  lokasi: { name: string; village: string; regency: string; province: string };
  target: {
    kategori: string;
    nama: string;
    satuan: string;
    jumlah: number;
    rekomendasi: { harga: string; lokasi: string; kabupaten: string }[];
  }[];
  totalKosong: number;
  tidakDiminta: number;
};

/**
 * Siapkan daftar sumber daya yang akan dimintakan draf harga.
 *
 * DIPANGGIL DI DALAM REQUEST — sengaja, karena penolakan yang bisa dijawab
 * tanpa provider ("semuanya sudah berharga") harus sampai seketika.
 */
export async function siapkanTargetHarga(
  locationId: string,
  dipilih?: ReadonlySet<string>,
  /**
   * Kunci yang SUDAH dimintakan pada putaran sebelumnya dalam run yang sama
   * (estimasi semua harga, DECISIONS 805) – dilewati supaya tiap putaran
   * mengerjakan sumber daya yang belum, dan perputarannya pasti berhenti.
   */
  kecuali?: ReadonlySet<string>,
): Promise<TargetSiap | { error: string }> {
  const [lokasi, harga] = await Promise.all([
    db.location.findUnique({
      where: { id: locationId },
      select: { name: true, village: true, regency: true, province: true },
    }),
    keadaanHarga(locationId),
  ]);
  if (!lokasi) return { error: "Lokasi tidak ditemukan." };

  const baris = kecuali && kecuali.size > 0 ? harga.baris.filter((b) => !kecuali.has(kunciTarget(b))) : harga.baris;
  const pilihan = pilihTargetUsulan(baris, BATAS_USULAN_HARGA_AI, dipilih);
  if (pilihan.target.length === 0) {
    return {
      error:
        pilihan.totalKosong === 0
          ? kecuali && kecuali.size > 0
            ? "Semua sumber daya yang belum berharga sudah dimintakan."
            : "Seluruh sumber daya sudah memiliki harga."
          : "Sumber daya yang dicentang sudah berharga – tidak ada yang perlu dimintakan draf.",
    };
  }

  return {
    lokasi,
    target: pilihan.target.map((b) => ({
      kategori: b.kategori,
      nama: b.nama,
      satuan: b.satuan,
      jumlah: b.jumlah,
      rekomendasi: b.rekomendasi.map((r) => ({
        harga: r.harga.toString(),
        lokasi: r.lokasi,
        kabupaten: r.kabupaten,
      })),
    })),
    totalKosong: pilihan.totalKosong,
    tidakDiminta: pilihan.tidakDiminta,
  };
}

export type HasilUsulanHargaAi =
  | { ok: true; model: string; usulan: UsulanHargaAi[] }
  | { ok: false; error: string };

/** Panggil provider untuk target yang sudah disiapkan. Dipakai dari latar. */
export async function usulkanHargaDenganAi(
  user: SessionUser,
  siap: TargetSiap,
): Promise<HasilUsulanHargaAi> {
  const daftar = siap.target.map((b, i) => ({
    id: `r${i + 1}`,
    kategori: b.kategori,
    nama: b.nama,
    satuan: b.satuan || "satuan",
    jumlah: b.jumlah,
    referensi: b.rekomendasi,
  }));

  const prompt = [
    `Tanggal estimasi: ${jakartaToday()}.`,
    `Lokasi proyek: ${siap.lokasi.name}, Desa ${siap.lokasi.village}, ${siap.lokasi.regency}, ${siap.lokasi.province}, Indonesia.`,
    "Proyek Kampung Nelayan Merah Putih: kawasan pesisir. Harga adalah harga SAMPAI DI LOKASI (termasuk ongkos angkut ke desa itu), bukan harga toko di kota.",
    "Buat estimasi HARGA SATUAN rupiah untuk setiap sumber daya berikut.",
    "Gunakan konteks pasar konstruksi daerah tersebut. Referensi lokasi lain hanya bahan pertimbangan.",
    "Jangan mengubah jumlah kebutuhan, kategori, satuan, atau id.",
    "Bila datanya tidak cukup, tetap beri estimasi konservatif dan tandai keyakinan rendah.",
    "Harga ini adalah draf untuk direview manusia, bukan hasil survei atau penawaran pemasok.",
    JSON.stringify(daftar),
  ].join("\n");

  try {
    await checkAiGuard(user, {
      kind: "rapl.usulan_harga",
      locationCount: 1,
      inputChars: prompt.length,
    });
  } catch (err) {
    if (err instanceof AiGuardError) return { ok: false, error: err.message };
    throw err;
  }

  const result = await aiStructured(hasilHargaAiSchema, {
    system:
      "Anda estimator biaya konstruksi Indonesia. Berikan draf harga yang konservatif dan jujur soal ketidakpastian. Jangan mengaku melakukan survei, membuka marketplace, atau memperoleh penawaran bila konteks tidak menyediakannya.",
    prompt,
    schemaHint:
      '{"suggestions":[{"id":"r1","harga":1500000,"keyakinan":"rendah|sedang|tinggi","alasan":"maksimal 240 karakter"}]}',
    maxTokens: 2400,
    timeoutMs: 60_000,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const targetServer: TargetHargaAi[] = siap.target.map((d, i) => ({
    id: `r${i + 1}`,
    kategori: d.kategori,
    nama: d.nama,
    satuan: d.satuan,
  }));
  const usulan = cocokkanUsulanHarga(targetServer, result.data.suggestions);
  if (usulan.length === 0) {
    return { ok: false, error: "Tidak ada usulan AI yang cocok dengan sumber daya di lokasi ini." };
  }
  return { ok: true, model: result.meta.model, usulan };
}
