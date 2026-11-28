import "server-only";
import { db } from "@/lib/db";
import { keadaanItemRapl } from "@/lib/ahsp/rapl";
import { kunciSumberDaya, type BiayaItem } from "@/lib/ahsp/rapl-calc";
import { kategoriDariLineage } from "@/lib/rab/kategori-lineage";
import { HARI_ADENDUM } from "@/lib/kontrak-berlaku";
import { durasiKontrakBerlaku } from "@/lib/progress-calc";

/**
 * Data satu lokasi untuk Excel "RAPL siap isi harga" (DECISIONS 803).
 *
 * Seluruh angka item dan komponennya datang dari `keadaanItemRapl` – jalur
 * yang SAMA dengan layar RAPL (analisa kontrak → AHSP disetujui → draf AI
 * diterima, termasuk analisa uraian yang sama di lokasi lain – DECISIONS 807).
 * Berkas ini hanya merakit dan mengelompokkan.
 */
export type LokasiRaplSiapIsi = {
  id: string;
  nama: string;
  desa: string;
  kabupaten: string;
  provinsi: string;
  paket: string;
  nomorKontrak: string | null;
  pelaksana: string | null;
  /** Masa kontrak berlaku dalam bulan (kelipatan 0,5) – volume biaya bulanan. */
  bulanKontrak: number;
  /** Σ nilai RAB item kerja (pra-PPN). */
  nilaiRab: bigint;
  /** Volume beton struktural (m³) – banyaknya benda uji kuat tekan. */
  volumeBetonM3: number;
  kategori: { kode: string; nama: string; item: BiayaItem[] }[];
  /**
   * Usulan harga estimasi untuk LOKASI INI yang belum diputuskan (draf run
   * terakhir, DECISIONS 805), per `kunciSumberDaya`. Rujukan, bukan harga.
   */
  usulan: Map<string, bigint>;
};

/** Bulan dibulatkan ke 0,5 terdekat, minimal 1. */
export function bulanDariHari(hari: number): number {
  return Math.max(1, Math.round((hari / 30) * 2) / 2);
}

export async function muatRaplSiapIsi(locationIds: string[]): Promise<LokasiRaplSiapIsi[]> {
  const hasil: LokasiRaplSiapIsi[] = [];
  for (const id of locationIds) {
    const loc = await db.location.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        village: true,
        regency: true,
        province: true,
        package: {
          select: {
            name: true,
            contract: {
              select: { contractNumber: true, durationDays: true, vendor: { select: { name: true } }, ...HARI_ADENDUM },
            },
          },
        },
      },
    });
    if (!loc) continue;
    const [per, kategoriRab, run] = await Promise.all([
      keadaanItemRapl(id),
      db.rabNode.findMany({
        where: { revision: { locationId: id, status: "aktif" }, kind: "kategori" },
        orderBy: { sortOrder: "asc" },
        select: { lineageKey: true, code: true, name: true },
      }),
      db.hsdUsulanRun.findFirst({
        where: { locationId: id },
        orderBy: { createdAt: "desc" },
        select: { usulan: { where: { status: "draf" }, select: { kategori: true, nama: true, satuan: true, harga: true } } },
      }),
    ]);
    const kunci = kategoriRab.map((k) => k.lineageKey);
    const kelompok = new Map(kategoriRab.map((k) => [k.lineageKey, { kode: k.code, nama: k.name, item: [] as BiayaItem[] }]));
    const lain = { kode: "", nama: "Pekerjaan lain", item: [] as BiayaItem[] };
    for (const it of per.item) {
      const k = kategoriDariLineage(it.lineageKey, kunci);
      (k ? kelompok.get(k)! : lain).item.push(it);
    }
    const kontrak = loc.package.contract;
    const hari = kontrak ? durasiKontrakBerlaku(kontrak.durationDays, kontrak.amendments) : 0;
    hasil.push({
      id: loc.id,
      nama: loc.name,
      desa: loc.village,
      kabupaten: loc.regency,
      provinsi: loc.province,
      paket: loc.package.name,
      nomorKontrak: kontrak?.contractNumber ?? null,
      pelaksana: kontrak?.vendor.name ?? null,
      bulanKontrak: bulanDariHari(hari || 90),
      nilaiRab: per.item.reduce((s, i) => s + i.nilaiRab, 0n),
      volumeBetonM3: per.item
        .filter((i) => /m3|m³/i.test(i.satuan) && /beton/i.test(i.uraian) && /fc|mpa|k-?\d{3}/i.test(i.uraian))
        .reduce((s, i) => s + (i.volume ?? 0), 0),
      kategori: [...kelompok.values(), lain].filter((k) => k.item.length > 0),
      usulan: new Map((run?.usulan ?? []).map((u) => [kunciSumberDaya(u.kategori, u.nama, u.satuan), u.harga])),
    });
  }
  return hasil;
}
