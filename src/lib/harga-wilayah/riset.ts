import "server-only";
import { z } from "zod";
import { getActiveAiConfig } from "@/lib/ai/config";
import { extractJsonBlock } from "@/lib/ai/parse";
import { checkAiGuard, AiGuardError } from "@/lib/ai-hub/guard";
import type { SessionUser } from "@/lib/auth/session";
import { jakartaToday } from "@/lib/format";
import { BATAS_HARGA_RUPIAH } from "@/lib/ahsp/hsd-price";
import { usulkanHargaDenganAi } from "@/lib/ahsp/hsd-ai";
import { batasiKeyakinan, verifikasiSumber, type Keyakinan, type MetodeHarga, type SumberHarga } from "./aturan";
import { risetWeb } from "./web";

/**
 * RISET HARGA SATU WILAYAH (DECISIONS 806): web dulu, estimasi bila tidak bisa.
 *
 * 1. Provider aktif Claude → model MENCARI di web (harga Pemda/SSH/HSPK,
 *    e-katalog, toko bangunan, marketplace) untuk kabupaten itu, lalu
 *    menjawab JSON. Setiap sumber yang disebutnya disaring terhadap alamat
 *    yang benar-benar dikembalikan pencarian; harga tanpa satu pun sumber sah
 *    turun menjadi `ai` (estimasi), bukan `web`.
 * 2. Provider lain, pencarian web dimatikan di akun, atau riset web gagal →
 *    estimasi AI biasa (`usulkanHargaDenganAi`) dengan konteks lokasi,
 *    bertanda `ai` dan tanpa sumber.
 *
 * Tidak menulis apa pun; penyimpanan ke katalog di `katalog.ts`.
 */

export type TargetRiset = { kategori: string; nama: string; satuan: string; jumlah: number };

export type HasilRiset = {
  kategori: string;
  nama: string;
  satuan: string;
  harga: bigint;
  hargaMin: bigint | null;
  hargaMaks: bigint | null;
  metode: Exclude<MetodeHarga, "lapangan">;
  keyakinan: Keyakinan;
  alasan: string;
  sumber: SumberHarga[];
};

export type KeluaranRiset =
  | { ok: true; model: string; hasil: HasilRiset[]; pencarian: number; catatan: string | null }
  | { ok: false; error: string };

const angka = z.number().int().positive().max(Number(BATAS_HARGA_RUPIAH));
const jawabanWebSchema = z.object({
  harga: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        harga: angka,
        min: angka.nullish(),
        maks: angka.nullish(),
        keyakinan: z.enum(["rendah", "sedang", "tinggi"]),
        alasan: z.string().min(3).max(400),
        sumber: z.array(z.object({ url: z.string().max(2_000), judul: z.string().max(300).nullish() })).max(6).default([]),
      }),
    )
    .max(40),
});

const SYSTEM_WEB =
  "Anda peneliti harga material, upah, dan alat konstruksi di Indonesia. Cari harga TERKINI di web untuk wilayah yang diminta. " +
  "Urutan sumber yang dipercaya: Standar Satuan Harga (SSH) / HSPK / HSD Pemda kabupaten atau provinsi itu, e-katalog LKPP, toko bangunan dan distributor setempat, " +
  "marketplace dengan lokasi penjual di wilayah itu, berita harga daerah. Upah mengikuti SSH/HSPK atau UMK setempat. " +
  "Harga yang dicari adalah harga SAMPAI DI LOKASI proyek (kawasan pesisir), bukan harga toko di kota besar; tambahkan ongkos angkut bila sumbernya harga kota dan sebut di alasan. " +
  "Konversi ke satuan yang diminta (mis. per sak → per zak, per batang → per kg) dan sebut konversinya. " +
  "JANGAN mengarang alamat sumber: cantumkan hanya alamat yang benar-benar Anda temukan lewat pencarian. Bila tidak menemukan sumber, beri estimasi konservatif, sumber kosong, keyakinan rendah. " +
  "Cari per kelompok (beberapa sumber daya sekaligus) supaya hemat pencarian.";

function promptWeb(lokasi: { desa: string; kabupaten: string; provinsi: string }, daftar: { id: string; kategori: string; nama: string; satuan: string }[]): string {
  return [
    `Tanggal: ${jakartaToday()}.`,
    `Wilayah: Desa ${lokasi.desa}, ${lokasi.kabupaten}, ${lokasi.provinsi}, Indonesia – proyek Kampung Nelayan Merah Putih (pesisir).`,
    "Cari harga satuan rupiah untuk setiap sumber daya berikut, lalu jawab HANYA satu objek JSON:",
    '{"harga":[{"id":"r1","harga":88000,"min":82000,"maks":95000,"keyakinan":"rendah|sedang|tinggi","alasan":"maks 400 huruf: dasar harga, konversi, ongkos angkut","sumber":[{"url":"https://…","judul":"…"}]}]}',
    "Setiap id wajib ada tepat sekali. Jangan mengubah satuan.",
    JSON.stringify(daftar),
  ].join("\n");
}

async function lewatWeb(
  pemakai: SessionUser,
  lokasi: { desa: string; kabupaten: string; provinsi: string },
  target: TargetRiset[],
): Promise<KeluaranRiset | { ok: false; error: string; jatuhKeEstimasi: true; catatan: string }> {
  const cfg = await getActiveAiConfig();
  if (!cfg || cfg.apiStyle !== "anthropic") {
    return { ok: false, error: "", jatuhKeEstimasi: true, catatan: "Provider AI aktif bukan Claude, jadi harga diestimasi tanpa pencarian web." };
  }
  const daftar = target.map((t, i) => ({ id: `r${i + 1}`, kategori: t.kategori, nama: t.nama, satuan: t.satuan || "satuan" }));
  const prompt = promptWeb(lokasi, daftar);
  try {
    await checkAiGuard(pemakai, { kind: "rapl.riset_harga", locationCount: 1, inputChars: prompt.length });
  } catch (err) {
    if (err instanceof AiGuardError) return { ok: false, error: err.message };
    throw err;
  }
  const web = await risetWeb(cfg, { system: SYSTEM_WEB, prompt, lokasi });
  if (!web.ok) {
    return {
      ok: false,
      error: web.error,
      jatuhKeEstimasi: true,
      catatan:
        web.kode === "web_tidak_aktif"
          ? "Pencarian web dimatikan di akun Claude (Console → Capabilities), jadi harga diestimasi tanpa sumber web."
          : `Pencarian web gagal (${web.error.slice(0, 120)}), jadi harga diestimasi tanpa sumber web.`,
    };
  }
  const blok = extractJsonBlock(web.teks);
  const parsed = blok ? jawabanWebSchema.safeParse((() => { try { return JSON.parse(blok); } catch { return null; } })()) : null;
  if (!parsed?.success) {
    return { ok: false, error: "Jawaban riset web tidak terbaca.", jatuhKeEstimasi: true, catatan: "Jawaban riset web tidak terbaca, jadi harga diestimasi tanpa sumber web." };
  }
  const perId = new Map(daftar.map((d, i) => [d.id, target[i]!]));
  const sudah = new Set<string>();
  const hasil: HasilRiset[] = [];
  for (const s of parsed.data.harga) {
    const t = perId.get(s.id);
    if (!t || sudah.has(s.id)) continue;
    sudah.add(s.id);
    const sumber = verifikasiSumber(s.sumber.map((x) => ({ url: x.url, judul: x.judul ?? null })), web.ditemukan);
    const metode = sumber.length > 0 ? "web" : "ai";
    const min = s.min != null && s.min <= s.harga ? BigInt(s.min) : null;
    const maks = s.maks != null && s.maks >= s.harga ? BigInt(s.maks) : null;
    hasil.push({
      kategori: t.kategori,
      nama: t.nama,
      satuan: t.satuan,
      harga: BigInt(s.harga),
      hargaMin: min,
      hargaMaks: maks,
      metode,
      keyakinan: batasiKeyakinan(metode, s.keyakinan),
      alasan: s.alasan.slice(0, 400),
      sumber,
    });
  }
  return { ok: true, model: web.model ?? cfg.model, hasil, pencarian: web.pencarian, catatan: null };
}

async function lewatEstimasi(
  pemakai: SessionUser,
  lokasi: { nama: string; desa: string; kabupaten: string; provinsi: string },
  target: TargetRiset[],
): Promise<KeluaranRiset> {
  const r = await usulkanHargaDenganAi(pemakai, {
    lokasi: { name: lokasi.nama, village: lokasi.desa, regency: lokasi.kabupaten, province: lokasi.provinsi },
    target: target.map((t) => ({ ...t, rekomendasi: [] })),
    totalKosong: target.length,
    tidakDiminta: 0,
  });
  if (!r.ok) return r;
  return {
    ok: true,
    model: r.model,
    pencarian: 0,
    catatan: null,
    hasil: r.usulan.map((u) => ({
      kategori: u.kategori,
      nama: u.nama,
      satuan: u.satuan,
      harga: BigInt(u.harga),
      hargaMin: null,
      hargaMaks: null,
      metode: "ai" as const,
      keyakinan: batasiKeyakinan("ai", u.keyakinan as Keyakinan),
      alasan: u.alasan,
      sumber: [],
    })),
  };
}

export async function risetHargaWilayah(
  pemakai: SessionUser,
  lokasi: { nama: string; desa: string; kabupaten: string; provinsi: string },
  target: TargetRiset[],
): Promise<KeluaranRiset> {
  if (target.length === 0) return { ok: true, model: "", hasil: [], pencarian: 0, catatan: null };
  const web = await lewatWeb(pemakai, lokasi, target);
  if (web.ok || !("jatuhKeEstimasi" in web)) return web;
  const est = await lewatEstimasi(pemakai, lokasi, target);
  return est.ok ? { ...est, catatan: web.catatan } : est;
}
