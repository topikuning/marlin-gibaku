import "server-only";
import { db } from "@/lib/db";
import { COUNTED_REPORT_STATUSES, volumeTidakTerbobotByLineage } from "@/lib/progress";
import { jalurNodeById } from "./jalur";

/**
 * REALISASI YANG TIDAK TERBOBOT KARENA PERUBAHAN RAB — data halaman
 * `/lokasi/[slug]/rab/tidak-terbobot`.
 *
 * Permintaan user 2026-10-04: *"aku ingin ada halaman atau menu untuk melihat
 * item pekerjaan apa saja yang tidak terbobot karena perubahan RAB"*.
 *
 * Kasusnya: kategori yang sudah dilaporkan hilang dari RAB lewat adendum
 * (impor). Baris laporan hariannya tetap ada dan tetap tampil normal di
 * laporan tanggalnya, tapi progres hanya membobot lineage yang ada di RAB
 * aktif – jadi realisasinya keluar dari hitungan tanpa disebut di mana pun.
 *
 * ANGKA volume datang dari `volumeTidakTerbobotByLineage` (calculation layer
 * kanonik). Modul ini hanya menambahkan IDENTITAS: nama, kategori, jalur, dan
 * revisi tempat item itu terakhir ada – semuanya dari revisi lama yang memang
 * tidak pernah diubah.
 *
 * Sengaja TANPA rupiah: `valueDone` dibekukan memakai harga saat lapor dan
 * bukan basis agregat mana pun (CALCULATION_INTEGRITY_PROTOCOL). Nilai per
 * baris tetap terlihat di halaman riwayat input item.
 */

export type ItemTidakTerbobot = {
  lineageKey: string;
  code: string;
  name: string;
  /** Kategori teratas di revisi tempat item ini terakhir ada, mis. "VIII. PEKERJAAN DPT". */
  kategori: string;
  /** Rantai kode, mis. "VIII · 1 · a". */
  jalur: string;
  unit: string | null;
  /** Σ volume terhitung (laporan dikirim/disetujui/final, basis aktif). */
  volume: number;
  /** Volume kontrak item ini di revisi terakhir yang memuatnya. */
  volumeKontrakTerakhir: number | null;
  /** Nomor revisi terakhir yang masih memuat item ini; null bila tak pernah ada di revisi berlaku. */
  terakhirDiRevisi: number | null;
  /** Nomor revisi yang menggantikannya – revisi tempat item ini hilang. */
  hilangDiRevisi: number | null;
  /** Kapan revisi terakhir itu digantikan. */
  hilangPada: Date | null;
  /** Berapa laporan harian terhitung yang memuat item ini. */
  jumlahLaporan: number;
  pertama: Date | null;
  terakhir: Date | null;
};

const tanpaTitik = (code: string) => code.replace(/(?:#\d+)+$/, "").trim().replace(/\.$/, "");

export async function realisasiTidakTerbobot(locationId: string): Promise<ItemTidakTerbobot[]> {
  const volume = await volumeTidakTerbobotByLineage(locationId);
  if (volume.size === 0) return [];
  const keys = [...volume.keys()];

  // Revisi yang pernah BERLAKU, urut nomor. Draft tidak dihitung: item yang
  // hanya ada di draft tidak pernah jadi dasar laporan resmi.
  const revisi = await db.rabRevision.findMany({
    where: { locationId, status: { in: ["aktif", "digantikan"] } },
    select: { id: true, revisionNo: true, supersededAt: true },
    orderBy: { revisionNo: "asc" },
  });
  const urutan = new Map(revisi.map((r, i) => [r.id, i]));

  const simpul = revisi.length
    ? await db.rabNode.findMany({
        where: { revisionId: { in: revisi.map((r) => r.id) } },
        select: {
          id: true, parentId: true, revisionId: true, lineageKey: true, kind: true, code: true, name: true,
          unit: true, volume: true, sortOrder: true,
        },
      })
    : [];
  const byId = new Map(simpul.map((n) => [n.id, n]));

  // Node item TERAKHIR (revisi bernomor tertinggi) per lineage.
  const terakhirPerKey = new Map<string, (typeof simpul)[number]>();
  for (const n of simpul) {
    if (n.kind !== "item" || !volume.has(n.lineageKey)) continue;
    const ada = terakhirPerKey.get(n.lineageKey);
    if (!ada || urutan.get(n.revisionId)! > urutan.get(ada.revisionId)!) terakhirPerKey.set(n.lineageKey, n);
  }

  // Baris laporan terhitung – untuk cacah laporan, rentang tanggal, dan
  // identitas cadangan bila item tak pernah ada di revisi berlaku.
  const baris = await db.dailyReportItem.findMany({
    where: {
      lineageKey: { in: keys },
      basis: "aktif",
      report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } },
    },
    select: {
      lineageKey: true,
      rabNodeId: true,
      reportId: true,
      report: { select: { reportDate: true } },
      rabNode: { select: { code: true, name: true, unit: true, volume: true } },
    },
  });
  const statPerKey = new Map<
    string,
    { laporan: Set<string>; pertama: Date | null; terakhir: Date | null; contoh: (typeof baris)[number] }
  >();
  for (const b of baris) {
    const s = statPerKey.get(b.lineageKey) ?? { laporan: new Set(), pertama: null, terakhir: null, contoh: b };
    s.laporan.add(b.reportId);
    const t = b.report.reportDate;
    if (!s.pertama || t < s.pertama) s.pertama = t;
    if (!s.terakhir || t > s.terakhir) s.terakhir = t;
    statPerKey.set(b.lineageKey, s);
  }

  const jalur = await jalurNodeById(
    keys.map((k) => terakhirPerKey.get(k)?.id ?? statPerKey.get(k)?.contoh.rabNodeId).filter((x): x is string => !!x),
  );

  const kategoriDari = (nodeId: string | undefined): { label: string; urut: number } => {
    let kini = nodeId ? byId.get(nodeId) : undefined;
    let pagar = 0;
    while (kini?.parentId && pagar++ < 20) {
      const induk = byId.get(kini.parentId);
      if (!induk) break;
      kini = induk;
    }
    if (!kini || kini.kind !== "kategori") return { label: "Tanpa kategori", urut: Number.MAX_SAFE_INTEGER };
    const kode = tanpaTitik(kini.code);
    return { label: kode ? `${kode}. ${kini.name.trim()}` : kini.name.trim(), urut: kini.sortOrder };
  };

  const hasil: (ItemTidakTerbobot & { _urutKat: number; _urut: number })[] = keys.map((key) => {
    const node = terakhirPerKey.get(key);
    const stat = statPerKey.get(key);
    const cadangan = stat?.contoh.rabNode;
    const idxRev = node ? urutan.get(node.revisionId)! : -1;
    const revTerakhir = idxRev >= 0 ? revisi[idxRev] : undefined;
    const revBerikut = idxRev >= 0 ? revisi[idxRev + 1] : undefined;
    const kat = kategoriDari(node?.id);
    const idJalur = node?.id ?? stat?.contoh.rabNodeId;
    return {
      lineageKey: key,
      code: tanpaTitik(node?.code ?? cadangan?.code ?? key),
      name: node?.name ?? cadangan?.name ?? key,
      kategori: kat.label,
      jalur: (idJalur ? jalur.get(idJalur)?.kode : undefined) ?? tanpaTitik(node?.code ?? cadangan?.code ?? key),
      unit: node?.unit ?? cadangan?.unit ?? null,
      volume: volume.get(key)!,
      volumeKontrakTerakhir:
        node?.volume != null ? Number(node.volume) : cadangan?.volume != null ? Number(cadangan.volume) : null,
      terakhirDiRevisi: revTerakhir?.revisionNo ?? null,
      hilangDiRevisi: revBerikut?.revisionNo ?? null,
      hilangPada: revTerakhir?.supersededAt ?? null,
      jumlahLaporan: stat?.laporan.size ?? 0,
      pertama: stat?.pertama ?? null,
      terakhir: stat?.terakhir ?? null,
      _urutKat: kat.urut,
      _urut: node?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    };
  });

  // Urut seperti RAB-nya: kategori, lalu urutan item di revisi lamanya.
  hasil.sort((a, b) => a._urutKat - b._urutKat || a.kategori.localeCompare(b.kategori, "id") || a._urut - b._urut);
  return hasil.map(({ _urutKat: _a, _urut: _b, ...x }) => x);
}
