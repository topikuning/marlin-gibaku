import "server-only";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { kunciSumberDaya } from "@/lib/ahsp/rapl-calc";
import {
  hargaBuatanOrang,
  masihSegar,
  medianRupiah,
  susunAlasan,
  type Keyakinan,
  type MetodeHarga,
  type SumberHarga,
} from "./aturan";
import { risetHargaWilayah, type HasilRiset, type TargetRiset } from "./riset";

/**
 * KATALOG HARGA WILAYAH → USULAN HARGA LOKASI (DECISIONS 806).
 *
 * Untuk sekumpulan sumber daya yang belum berharga di satu lokasi, urutannya:
 *
 * 1. **Harga lapangan** – median harga yang DIISI ORANG di lokasi lain
 *    sekabupaten (organisasi yang sama). Paling dekat dengan kenyataan.
 * 2. **Katalog wilayah** yang masih segar (≤ 90 hari) untuk kabupaten itu.
 * 3. **Riset** untuk sisanya (web, atau estimasi) – hasilnya DISIMPAN ke
 *    katalog, jadi lokasi sekabupaten berikutnya tidak meriset ulang.
 *
 * Hasilnya usulan (draf), bukan harga. Biaya tetap hanya dari HSD lokasi.
 */

export type LokasiHarga = {
  id: string;
  orgId: string;
  nama: string;
  desa: string;
  kabupaten: string;
  provinsi: string;
};

export type UsulanHarga = {
  kategori: string;
  nama: string;
  satuan: string;
  harga: string;
  keyakinan: Keyakinan;
  alasan: string;
  metode: MetodeHarga;
  sumber: SumberHarga[];
};

export async function muatLokasiHarga(locationId: string): Promise<LokasiHarga | null> {
  const l = await db.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, village: true, regency: true, province: true, package: { select: { orgId: true } } },
  });
  return l ? { id: l.id, orgId: l.package.orgId, nama: l.name, desa: l.village, kabupaten: l.regency, provinsi: l.province } : null;
}

type BarisKatalog = {
  harga: bigint;
  metode: string;
  keyakinan: string;
  alasan: string;
  sumber: unknown;
  diperbarui: Date;
};

export async function katalogSegar(
  lokasi: Pick<LokasiHarga, "orgId" | "provinsi" | "kabupaten">,
  kunci: ReadonlySet<string>,
  sekarang = new Date(),
): Promise<Map<string, BarisKatalog>> {
  if (kunci.size === 0) return new Map();
  const baris = await db.hargaWilayah.findMany({
    where: { orgId: lokasi.orgId, provinsi: lokasi.provinsi, kabupaten: lokasi.kabupaten },
    select: { kategori: true, nama: true, satuan: true, harga: true, metode: true, keyakinan: true, alasan: true, sumber: true, diperbarui: true },
  });
  const peta = new Map<string, BarisKatalog>();
  for (const b of baris) {
    const k = kunciSumberDaya(b.kategori, b.nama, b.satuan);
    if (kunci.has(k) && masihSegar(b.diperbarui, sekarang)) peta.set(k, b);
  }
  return peta;
}

/** Median harga buatan orang di lokasi LAIN sekabupaten, per kunci. */
export async function hargaLapangan(
  lokasi: Pick<LokasiHarga, "id" | "orgId" | "provinsi" | "kabupaten">,
  kunci: ReadonlySet<string>,
): Promise<Map<string, { harga: bigint; lokasi: string[] }>> {
  if (kunci.size === 0) return new Map();
  const baris = await db.hargaSatuanDasar.findMany({
    where: {
      locationId: { not: lokasi.id },
      harga: { gt: 0n },
      location: { regency: lokasi.kabupaten, province: lokasi.provinsi, package: { orgId: lokasi.orgId } },
    },
    select: { kategori: true, nama: true, satuan: true, harga: true, sumber: true, location: { select: { name: true } } },
  });
  const kumpul = new Map<string, { harga: bigint[]; lokasi: string[] }>();
  for (const b of baris) {
    if (!hargaBuatanOrang(b.sumber)) continue;
    const k = kunciSumberDaya(b.kategori, b.nama, b.satuan);
    if (!kunci.has(k)) continue;
    const a = kumpul.get(k) ?? { harga: [], lokasi: [] };
    a.harga.push(b.harga);
    a.lokasi.push(b.location.name);
    kumpul.set(k, a);
  }
  const hasil = new Map<string, { harga: bigint; lokasi: string[] }>();
  for (const [k, a] of kumpul) hasil.set(k, { harga: medianRupiah(a.harga)!, lokasi: [...new Set(a.lokasi)] });
  return hasil;
}

export async function simpanKatalog(
  lokasi: Pick<LokasiHarga, "orgId" | "provinsi" | "kabupaten">,
  hasil: readonly HasilRiset[],
  model: string,
): Promise<void> {
  if (hasil.length === 0) return;
  const sekarang = new Date();
  await db.$transaction(
    async (tx) => {
      for (const h of hasil) {
        const data = {
          harga: h.harga,
          hargaMin: h.hargaMin,
          hargaMaks: h.hargaMaks,
          metode: h.metode,
          keyakinan: h.keyakinan,
          alasan: h.alasan,
          sumber: h.sumber,
          model,
          diperbarui: sekarang,
        };
        await tx.hargaWilayah.upsert({
          where: {
            orgId_provinsi_kabupaten_kategori_nama_satuan: {
              orgId: lokasi.orgId,
              provinsi: lokasi.provinsi,
              kabupaten: lokasi.kabupaten,
              kategori: h.kategori,
              nama: h.nama,
              satuan: h.satuan,
            },
          },
          create: { orgId: lokasi.orgId, provinsi: lokasi.provinsi, kabupaten: lokasi.kabupaten, kategori: h.kategori, nama: h.nama, satuan: h.satuan, ...data },
          update: data,
        });
      }
    },
    { timeout: 30_000 },
  );
}

export type KeluaranUsulan =
  | { ok: true; model: string; usulan: UsulanHarga[]; diriset: number; pencarian: number; catatan: string | null }
  | { ok: false; error: string };

const sumberArray = (x: unknown): SumberHarga[] =>
  Array.isArray(x) ? (x as SumberHarga[]).filter((s) => s && typeof s.url === "string") : [];

/** Usulan harga untuk sekumpulan sumber daya satu lokasi: lapangan → katalog → riset. */
export async function usulanDariKatalog(user: SessionUser, lokasi: LokasiHarga, target: readonly TargetRiset[]): Promise<KeluaranUsulan> {
  const kunciDari = (t: { kategori: string; nama: string; satuan: string }) => kunciSumberDaya(t.kategori, t.nama, t.satuan);
  const semua = new Set(target.map(kunciDari));
  const [lapangan, katalog] = await Promise.all([hargaLapangan(lokasi, semua), katalogSegar(lokasi, semua)]);

  const kurang = target.filter((t) => !lapangan.has(kunciDari(t)) && !katalog.has(kunciDari(t)));
  let model = "katalog wilayah";
  let pencarian = 0;
  let catatan: string | null = null;
  if (kurang.length > 0) {
    const r = await risetHargaWilayah(user, lokasi, kurang);
    if (!r.ok) {
      // Tanpa riset pun, yang sudah ada di lapangan/katalog tetap diusulkan.
      if (lapangan.size === 0 && katalog.size === 0) return r;
      catatan = r.error;
    } else {
      await simpanKatalog(lokasi, r.hasil, r.model);
      model = r.model || model;
      pencarian = r.pencarian;
      catatan = r.catatan;
      const kini = new Date();
      for (const h of r.hasil)
        katalog.set(kunciDari(h), { harga: h.harga, metode: h.metode, keyakinan: h.keyakinan, alasan: h.alasan, sumber: h.sumber, diperbarui: kini });
    }
  }

  const usulan: UsulanHarga[] = [];
  for (const t of target) {
    const k = kunciDari(t);
    const lap = lapangan.get(k);
    if (lap) {
      usulan.push({
        kategori: t.kategori,
        nama: t.nama,
        satuan: t.satuan,
        harga: lap.harga.toString(),
        keyakinan: lap.lokasi.length >= 2 ? "tinggi" : "sedang",
        alasan: susunAlasan({
          alasan: `Median harga yang diisi di ${lap.lokasi.length} lokasi sekabupaten: ${lap.lokasi.slice(0, 3).join(", ")}${lap.lokasi.length > 3 ? ", …" : ""}`,
          metode: "lapangan",
          sumber: [],
        }),
        metode: "lapangan",
        sumber: [],
      });
      continue;
    }
    const kat = katalog.get(k);
    if (!kat) continue;
    const metode = kat.metode === "web" ? "web" : "ai";
    const sumber = sumberArray(kat.sumber);
    usulan.push({
      kategori: t.kategori,
      nama: t.nama,
      satuan: t.satuan,
      harga: kat.harga.toString(),
      keyakinan: (["rendah", "sedang", "tinggi"].includes(kat.keyakinan) ? kat.keyakinan : "rendah") as Keyakinan,
      alasan: susunAlasan({ alasan: kat.alasan, metode, sumber, diperbarui: kat.diperbarui }),
      metode,
      sumber,
    });
  }
  return { ok: true, model, usulan, diriset: kurang.length, pencarian, catatan };
}
