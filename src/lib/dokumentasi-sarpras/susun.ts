import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey } from "@/lib/format";
import { COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";
import { getPeriodBounds } from "@/lib/periodic-report";
import { volumeHarianByLineage } from "@/lib/progress";
import { progresKelompokPerTanggal, weekOfDate } from "@/lib/progress-calc";
import { itemPerKategori, kategoriDariLineage } from "@/lib/rab/kategori-lineage";
import { urutkanFoto } from "./murni";

/**
 * DOKUMENTASI FOTO PER SARANA & PRASARANA (DECISIONS 683).
 *
 * Permintaan user 2026-10-16: sistem KKP (kawal-knmp) memilah foto per sarana
 * & prasarana dan menampilkannya berurutan dari progres kecil ke besar.
 *
 * - Sarana/prasarana = kategori RAB tingkat 1 revisi AKTIF (sama dengan folder
 *   bangunan di Drive, DECISIONS 666), urut seperti RAB.
 * - Foto = foto laporan harian berstatus TERHITUNG (dikirim, disetujui, final)
 *   yang menempel ke pekerjaan; sarananya dicari lewat `lineageKey` pekerjaan,
 *   jadi foto dari revisi lama tetap jatuh ke sarana yang sama.
 * - Progres tiap foto = progres sarana s/d tanggal laporannya, dihitung
 *   `progresKelompokPerTanggal` – rumus yang sama dengan "Progres per
 *   Kategori" laporan mingguan.
 * - Foto yang tidak menempel ke pekerjaan (material, alat, foto umum laporan)
 *   tidak masuk sarana mana pun, dan jumlahnya disebut.
 */
export type FotoSarpras = {
  id: string;
  r2Key: string;
  thumbnailKey: string | null;
  /** YYYY-MM-DD, tanggal laporan harian. */
  tanggal: string;
  dibuat: number;
  /** Minggu kontrak sejak SPMK; `null` bila SPMK belum ada. */
  minggu: number | null;
  /** Progres sarana s/d tanggal laporan foto ini (%). */
  progres: number;
  lineageKey: string;
  pekerjaan: string;
  takenAt: string | null;
};

export type Sarpras = {
  kunci: string;
  code: string;
  name: string;
  nilai: number;
  /** Progres sarana s/d hari ini (%). */
  progresKini: number;
  foto: FotoSarpras[];
  /** Pekerjaan di sarana ini yang punya foto – pilihan saring di slide. */
  pekerjaan: { lineageKey: string; label: string; jumlah: number }[];
};

export type DokumentasiSarpras = {
  revisionNo: number;
  sarpras: Sarpras[];
  /** Foto laporan terhitung yang tidak menempel ke pekerjaan. */
  tanpaSarana: { material: number; alat: number; umum: number; tanpaKategori: number };
  adaSpmk: boolean;
};

export async function susunDokumentasiSarpras(locationId: string): Promise<DokumentasiSarpras | null> {
  const rev = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true, revisionNo: true, totalValue: true },
  });
  if (!rev) return null;

  const [nodes, foto, realisasi, bounds] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: rev.id },
      select: { parentId: true, kind: true, code: true, name: true, lineageKey: true, amount: true, volume: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.photo.findMany({
      where: { report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } } },
      select: {
        id: true,
        r2Key: true,
        thumbnailKey: true,
        exifTakenAt: true,
        createdAt: true,
        reportMaterialId: true,
        reportEquipmentId: true,
        report: { select: { reportDate: true } },
        reportItem: { select: { lineageKey: true, rabNode: { select: { code: true, name: true } } } },
      },
    }),
    volumeHarianByLineage(locationId),
    getPeriodBounds(locationId),
  ]);

  const { akar, item: itemPerAkar } = itemPerKategori(nodes);
  const kunciAkar = akar.map((n) => n.lineageKey);

  const adaSpmk = bounds != null && !bounds.assumed;
  const minggu = (tanggal: string) =>
    adaSpmk ? weekOfDate(bounds!.startDate, new Date(`${tanggal}T00:00:00Z`), bounds!.weekMode) || null : null;

  const tanpaSarana = { material: 0, alat: 0, umum: 0, tanpaKategori: 0 };
  const fotoPerAkar = new Map<string, Omit<FotoSarpras, "progres" | "minggu">[]>();
  for (const p of foto) {
    if (!p.reportItem) {
      if (p.reportMaterialId) tanpaSarana.material++;
      else if (p.reportEquipmentId) tanpaSarana.alat++;
      else tanpaSarana.umum++;
      continue;
    }
    const k = kategoriDariLineage(p.reportItem.lineageKey, kunciAkar);
    if (!k) {
      tanpaSarana.tanpaKategori++;
      continue;
    }
    const arr = fotoPerAkar.get(k) ?? [];
    arr.push({
      id: p.id,
      r2Key: p.r2Key,
      thumbnailKey: p.thumbnailKey,
      tanggal: jakartaDateKey(p.report!.reportDate),
      dibuat: p.createdAt.getTime(),
      lineageKey: p.reportItem.lineageKey,
      pekerjaan: [p.reportItem.rabNode.code, p.reportItem.rabNode.name].filter(Boolean).join(" "),
      takenAt: p.exifTakenAt ? p.exifTakenAt.toISOString() : null,
    });
    fotoPerAkar.set(k, arr);
  }

  const hariIni = jakartaDateKey(new Date());
  const grandTotal = Number(rev.totalValue);
  const sarpras: Sarpras[] = akar.map((a) => {
    const items = (itemPerAkar.get(a.lineageKey) ?? []).map((n) => ({
      lineageKey: n.lineageKey,
      amount: Number(n.amount),
      volume: n.volume == null ? null : Number(n.volume),
    }));
    const mentah = urutkanFoto(fotoPerAkar.get(a.lineageKey) ?? []);
    const progres = progresKelompokPerTanggal(items, realisasi, grandTotal, [...mentah.map((f) => f.tanggal), hariIni]);
    const jumlahPekerjaan = new Map<string, { label: string; jumlah: number }>();
    for (const f of mentah) {
      const j = jumlahPekerjaan.get(f.lineageKey) ?? { label: f.pekerjaan, jumlah: 0 };
      j.jumlah++;
      jumlahPekerjaan.set(f.lineageKey, j);
    }
    return {
      kunci: a.lineageKey,
      code: a.code,
      name: a.name,
      nilai: Number(a.amount),
      progresKini: progres.get(hariIni) ?? 0,
      foto: mentah.map((f) => ({ ...f, minggu: minggu(f.tanggal), progres: progres.get(f.tanggal) ?? 0 })),
      pekerjaan: [...jumlahPekerjaan].map(([lineageKey, v]) => ({ lineageKey, ...v })),
    };
  });

  return { revisionNo: rev.revisionNo, sarpras, tanpaSarana, adaSpmk };
}
