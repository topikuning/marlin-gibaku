import "server-only";
import { db } from "@/lib/db";
import { cocokkanLokasi, LABEL_BASIS, type BasisOtomatis, type Kandidat } from "./cocok";
import { lokasiUntukCocok } from "./sinkron";

/**
 * Bacaan layar sinkron & pencocokan Kawal (DECISIONS 690). Tidak ada angka
 * progres di sini – itu tahap 3.
 */

export type RingkasSinkron = {
  terakhir: {
    startedAt: Date;
    finishedAt: Date | null;
    outcome: string;
    trigger: string;
    rowCount: number | null;
    matchedCount: number | null;
    queueCount: number | null;
    discardedCount: number | null;
    error: string | null;
  } | null;
  /** Waktu tarikan terakhir yang BERHASIL (isinya berubah atau tidak). */
  berhasilTerakhir: Date | null;
  /** Waktu snapshot terakhir disimpan. */
  snapshotTerakhir: Date | null;
};

export async function ringkasSinkronKawal(): Promise<RingkasSinkron> {
  const [terakhir, berhasil, snap] = await Promise.all([
    db.kawalSyncRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        startedAt: true,
        finishedAt: true,
        outcome: true,
        trigger: true,
        rowCount: true,
        matchedCount: true,
        queueCount: true,
        discardedCount: true,
        error: true,
      },
    }),
    db.kawalSyncRun.findFirst({
      where: { outcome: { in: ["berhasil", "tidak_berubah"] } },
      orderBy: { startedAt: "desc" },
      select: { finishedAt: true },
    }),
    db.kawalSnapshot.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
  ]);
  return {
    terakhir,
    berhasilTerakhir: berhasil?.finishedAt ?? null,
    snapshotTerakhir: snap?.capturedAt ?? null,
  };
}

export type BarisKawalTampil = {
  kawalId: number;
  namaKnmp: string;
  desa: string | null;
  kecamatan: string | null;
  kabupaten: string;
  provinsi: string | null;
  noKontrak: string | null;
};

export type LokasiPilihan = {
  id: string;
  slug: string;
  nama: string;
  desa: string;
  kabupaten: string;
  paket: string;
};

export type KandidatTampil = Kandidat & { lokasi: LokasiPilihan };

export type DataPencocokan = {
  snapshotAt: Date | null;
  antrean: { baris: BarisKawalTampil; kandidat: KandidatTampil[] }[];
  berpasangan: {
    baris: BarisKawalTampil;
    lokasi: LokasiPilihan;
    status: "otomatis" | "dikonfirmasi";
    basis: string | null;
  }[];
  bukanMarlin: BarisKawalTampil[];
  /** Lokasi MARLIN organisasi ini yang belum punya pasangan – pilihan di Combobox. */
  lokasiBebas: LokasiPilihan[];
};

const PILIH_BARIS = {
  kawalId: true,
  namaKnmp: true,
  desa: true,
  kecamatan: true,
  kabupaten: true,
  provinsi: true,
  noKontrak: true,
  latitude: true,
  longitude: true,
} as const;

/**
 * Semua yang dibutuhkan layar pencocokan. Antrean DIHITUNG ULANG dari
 * snapshot terakhir terhadap pasangan saat ini – begitu satu baris
 * dipasangkan, kandidat baris lain langsung menyesuaikan tanpa menunggu
 * sinkron berikutnya.
 */
export async function dataPencocokanKawal(orgId: string): Promise<DataPencocokan> {
  const snap = await db.kawalSnapshot.findFirst({
    orderBy: { capturedAt: "desc" },
    select: { capturedAt: true, lokasi: { select: PILIH_BARIS, orderBy: { kawalId: "asc" } } },
  });
  const [peta, semuaLokasi, lokasiOrg] = await Promise.all([
    db.kawalLocationMap.findMany({ select: { kawalId: true, locationId: true, status: true, basis: true } }),
    lokasiUntukCocok(),
    db.location.findMany({
      where: { package: { orgId } },
      select: { id: true, slug: true, name: true, village: true, regency: true, package: { select: { name: true } } },
      orderBy: [{ package: { name: "asc" } }, { name: "asc" }],
    }),
  ]);

  const pilihan = new Map<string, LokasiPilihan>(
    lokasiOrg.map((l) => [
      l.id,
      { id: l.id, slug: l.slug, nama: l.name, desa: l.village, kabupaten: l.regency, paket: l.package.name },
    ]),
  );
  const barisSnap = snap?.lokasi ?? [];
  const tampil = (b: (typeof barisSnap)[number]): BarisKawalTampil => ({
    kawalId: b.kawalId,
    namaKnmp: b.namaKnmp,
    desa: b.desa,
    kecamatan: b.kecamatan,
    kabupaten: b.kabupaten,
    provinsi: b.provinsi,
    noKontrak: b.noKontrak,
  });

  const keputusan = cocokkanLokasi(
    barisSnap.map((b) => ({
      kawalId: b.kawalId,
      namaKnmp: b.namaKnmp,
      desa: b.desa,
      kabupaten: b.kabupaten,
      noKontrak: b.noKontrak,
      latitude: b.latitude == null ? null : Number(b.latitude),
      longitude: b.longitude == null ? null : Number(b.longitude),
    })),
    semuaLokasi,
    peta,
  );
  const perKawal = new Map(barisSnap.map((b) => [b.kawalId, b]));
  const antrean: DataPencocokan["antrean"] = [];
  for (const k of keputusan) {
    if (k.jenis !== "antre") continue;
    antrean.push({
      baris: tampil(perKawal.get(k.kawalId)!),
      kandidat: k.kandidat.flatMap((c) => {
        const lokasi = pilihan.get(c.locationId);
        return lokasi ? [{ ...c, lokasi }] : [];
      }),
    });
  }

  // Baris yang berpasangan / bukan MARLIN bisa saja tidak ada di snapshot
  // terakhir (baris "bukan MARLIN" memang tidak disimpan lagi): namanya
  // diambil dari snapshot terbaru yang memuatnya.
  const kurang = peta.map((p) => p.kawalId).filter((id) => !perKawal.has(id));
  if (kurang.length) {
    const lama = await db.kawalLocationSnapshot.findMany({
      where: { kawalId: { in: kurang } },
      orderBy: { snapshot: { capturedAt: "desc" } },
      distinct: ["kawalId"],
      select: PILIH_BARIS,
    });
    for (const b of lama) perKawal.set(b.kawalId, b);
  }

  const berpasangan: DataPencocokan["berpasangan"] = [];
  const bukanMarlin: BarisKawalTampil[] = [];
  const terpakai = new Set<string>();
  for (const p of peta) {
    if (p.locationId) terpakai.add(p.locationId);
    const b = perKawal.get(p.kawalId);
    if (!b) continue;
    if (p.status === "bukan_marlin") {
      bukanMarlin.push(tampil(b));
      continue;
    }
    const lokasi = p.locationId ? pilihan.get(p.locationId) : undefined;
    if (!lokasi) continue;
    berpasangan.push({
      baris: tampil(b),
      lokasi,
      status: p.status === "dikonfirmasi" ? "dikonfirmasi" : "otomatis",
      basis: p.basis && p.basis in LABEL_BASIS ? LABEL_BASIS[p.basis as BasisOtomatis] : null,
    });
  }
  berpasangan.sort(
    (a, b) => a.lokasi.paket.localeCompare(b.lokasi.paket) || a.lokasi.nama.localeCompare(b.lokasi.nama),
  );
  bukanMarlin.sort((a, b) => a.namaKnmp.localeCompare(b.namaKnmp));

  return {
    snapshotAt: snap?.capturedAt ?? null,
    antrean,
    berpasangan,
    bukanMarlin,
    lokasiBebas: [...pilihan.values()].filter((l) => !terpakai.has(l.id)),
  };
}
