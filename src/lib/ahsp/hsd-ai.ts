import "server-only";
import { aiStructured } from "@/lib/ai/structured";
import { checkAiGuard, AiGuardError } from "@/lib/ai-hub/guard";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";
import { keadaanHarga } from "./hsd";
import {
  BATAS_USULAN_HARGA_AI,
  cocokkanUsulanHarga,
  hasilHargaAiSchema,
  type TargetHargaAi,
  type UsulanHargaAi,
} from "./hsd-ai-parse";
export type { UsulanHargaAi } from "./hsd-ai-parse";

export type HasilUsulanHargaAi =
  | { ok: true; model: string; usulan: UsulanHargaAi[] }
  | { ok: false; error: string };

/**
 * Minta draf HSD kepada provider AI aktif.
 *
 * Angka ini TIDAK disimpan dan TIDAK ikut kalkulasi. Server action terpisah
 * mewajibkan pengguna menerima usulan sebelum HSD berubah.
 */
export async function usulkanHargaDenganAi(
  user: SessionUser,
  locationId: string,
): Promise<HasilUsulanHargaAi> {
  const [location, harga] = await Promise.all([
    db.location.findUnique({
      where: { id: locationId },
      select: { name: true, regency: true, province: true },
    }),
    keadaanHarga(locationId),
  ]);
  if (!location) return { ok: false, error: "Lokasi tidak ditemukan." };

  const target = harga.baris.filter((b) => b.harga === null).slice(0, BATAS_USULAN_HARGA_AI);
  if (target.length === 0) {
    return { ok: false, error: "Seluruh sumber daya sudah memiliki harga." };
  }

  const daftar = target.map((b, i) => ({
    id: `r${i + 1}`,
    kategori: b.kategori,
    nama: b.nama,
    satuan: b.satuan || "satuan",
    jumlah: b.jumlah,
    referensi: b.rekomendasi.map((r) => ({
      harga: r.harga.toString(),
      lokasi: r.lokasi,
      kabupaten: r.kabupaten,
    })),
  }));

  const prompt = [
    `Tanggal estimasi: ${jakartaToday()}.`,
    `Lokasi proyek: ${location.name}, ${location.regency}, ${location.province}, Indonesia.`,
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

  const targetServer: TargetHargaAi[] = target.map((d, i) => ({
    id: `r${i + 1}`,
    kategori: d.kategori,
    nama: d.nama,
    satuan: d.satuan,
  }));
  const usulan: UsulanHargaAi[] = cocokkanUsulanHarga(targetServer, result.data.suggestions);
  if (usulan.length === 0) {
    return { ok: false, error: "AI tidak mengembalikan usulan yang dapat dijodohkan." };
  }
  return { ok: true, model: result.meta.model, usulan };
}
