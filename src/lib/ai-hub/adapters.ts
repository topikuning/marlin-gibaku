import "server-only";
import { db } from "@/lib/db";
import { can } from "@/lib/authz";
import { getContractsBilling, getLocationsFinance } from "@/lib/finance/calc";
import { formatRupiah, jakartaToday } from "@/lib/format";
import { OPEN_FINDING_STATUSES } from "@/lib/lifecycle";
import type { SessionUser } from "@/lib/auth/session";
import { kunciFakta, type FaktaResmi, type Metrik } from "./schemas";
import {
  KAPABILITAS_ADAPTER,
  LABEL_WILAYAH,
  rupiahKeAngka,
  type WilayahAdapter,
} from "./adapters-pagar";

// Satu pintu untuk pemanggil; pemisahan murni/tidak-murni di dalam bukan
// urusan mereka.
export { KAPABILITAS_ADAPTER, LABEL_WILAYAH, rupiahKeAngka };
export type { WilayahAdapter };

export type HasilAdapter = {
  refs: SourceRef[];
  fakta: FaktaResmi[];
  /** Wilayah yang TIDAK diikutkan karena kapabilitas penanya. */
  dilewati: WilayahAdapter[];
};
import type { SourceRef } from "./types";

/**
 * ADAPTER SUMBER — kontrak, keuangan, RAB, milestone (DECISIONS 379).
 *
 * `buildPortfolioPulse` hanya tahu progress, laporan, kendala, foto, dan
 * milestone-yang-perlu-perbaikan. Empat wilayah data lain tidak pernah sampai
 * ke AI sama sekali, jadi pertanyaan seperti *"berapa nilai kontraknya"* atau
 * *"sudah tertagih berapa"* dijawab "tidak ada datanya" — padahal datanya ada,
 * hanya tidak pernah dikirim.
 *
 * ### AI tetap BUKAN sumber angka
 *
 * Tidak ada satu pun formula di berkas ini. Angkanya diambil dari calculation
 * layer yang sudah ada (`finance/calc.ts`) atau dibaca apa adanya dari kolom
 * yang memang menyimpannya (`Contract.contractValue`,
 * `RabRevision.totalValue`). PPN memakai `withPpn` dengan `ppnPercent` kontrak
 * — tidak pernah di-hardcode (CLAUDE.md).
 *
 * ### Kenapa DIPAGARI KAPABILITAS, bukan cuma scope lokasi
 *
 * Ini bagian terpenting berkas ini. `site_manager` punya `ai.ask` tetapi TIDAK
 * punya `finance.view` — ia hanya `finance.input`. Kalau fakta keuangan
 * disuntikkan ke setiap prompt, Site Manager bisa menanyakan — dan menerima —
 * angka uang yang di layar MARLIN sendiri tidak boleh ia lihat. Lubang seperti
 * itu tidak menghasilkan galat apa pun; ia hanya menjawab dengan sopan.
 *
 * `wakil_ppk` bahkan sengaja dijauhkan dari `finance.view` dengan alasan
 * tertulis (uang INTERNAL pelaksana bukan urusan pemberi kerja). Melewati
 * pagar itu lewat pintu AI akan membatalkan keputusan itu diam-diam.
 *
 * Karena itu tiap adapter menyebut kapabilitasnya sendiri, dan yang tidak
 * berhak **tidak menerima angkanya sama sekali** — bukan menerima angka lalu
 * diminta tidak menyebutnya.
 *
 * ### "Belum tertagih" sengaja TIDAK ada di sini
 *
 * Angka itu berguna, tapi menghitungnya butuh Σ nilai terpasang seluruh lokasi
 * satu kontrak plus alokasi proporsional untuk kontrak multi-lokasi — dan
 * penjumlahan itu hari ini hidup di dalam halaman Keuangan
 * (`src/app/(app)/keuangan/page.tsx`), bukan di `finance/calc.ts`.
 *
 * Menyalinnya ke sini akan melahirkan IMPLEMENTASI KEDUA dari satu formula
 * uang. Dua salinan berarti dua jawaban yang bisa berbeda tanpa ada yang
 * memberi tahu — persis yang dilarang CLAUDE.md. Menambahkannya dengan benar
 * berarti memindahkan Σ + alokasinya ke `finance/calc.ts` lebih dulu, dan itu
 * perubahan tersendiri yang menyentuh halaman yang sudah bekerja.
 *
 * ### Yang dilewati DIKATAKAN
 *
 * Wilayah yang dilewati karena kapabilitas dicatat dan ikut ke prompt sebagai
 * keterangan. Tanpa itu, "tidak ada data keuangan" terbaca sebagai *tidak ada
 * uangnya* — jawaban yang salah untuk alasan yang tidak kelihatan.
 */

/** Bangun satu fakta; `null` untuk nilai yang tidak bisa dibandingkan eksak. */
function fakta(
  locationId: string,
  metric: Metrik,
  value: number | null,
  periodKey: string,
  sourceRefId: string,
): FaktaResmi | null {
  if (value == null || !Number.isFinite(value)) return null;
  return { locationId, metric, value, periodKey, sourceRefId };
}

type LokasiRingkas = {
  id: string;
  slug: string;
  name: string;
  packageId: string;
};

/**
 * Kumpulkan fakta tambahan untuk seluruh lokasi dalam scope — BATCHED.
 *
 * Tidak ada query per lokasi di sini: pola N+1 pada run berisi 83 lokasi
 * berarti ratusan perjalanan basis data untuk satu pertanyaan.
 *
 * `periodKey` diterima dari pemanggil (akhir periode run), sama dengan yang
 * dipakai fakta progress — supaya satu jawaban tidak mencampur dua waktu
 * (DECISIONS 369).
 */
export async function buildAdapterFacts(
  user: SessionUser,
  locIds: string[],
  periodKey: string,
): Promise<HasilAdapter> {
  const hasil: HasilAdapter = { refs: [], fakta: [], dilewati: [] };
  if (locIds.length === 0) return hasil;

  const boleh = (w: WilayahAdapter): boolean => {
    if (can(user.role, KAPABILITAS_ADAPTER[w])) return true;
    hasil.dilewati.push(w);
    return false;
  };
  const bolehKontrak = boleh("kontrak");
  const bolehKeuangan = boleh("keuangan");
  const bolehRab = boleh("rab");
  const bolehMilestone = boleh("milestone");
  const bolehTemuan = boleh("temuan");

  const lokasi: LokasiRingkas[] = await db.location.findMany({
    where: { id: { in: locIds } },
    select: { id: true, slug: true, name: true, packageId: true },
  });
  if (lokasi.length === 0) return hasil;

  const paketIds = [...new Set(lokasi.map((l) => l.packageId))];

  if (bolehKontrak) await tambahKontrak(hasil, lokasi, paketIds, periodKey);
  if (bolehRab) await tambahRab(hasil, lokasi, periodKey);
  if (bolehKeuangan) await tambahKeuangan(hasil, lokasi, paketIds, periodKey);
  if (bolehMilestone) await tambahMilestone(hasil, lokasi, periodKey);
  if (bolehTemuan) await tambahTemuan(hasil, lokasi, periodKey);

  return hasil;
}

/* ------------------------------------------------------------------ */
/* Kontrak                                                             */
/* ------------------------------------------------------------------ */

async function tambahKontrak(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  paketIds: string[],
  periodKey: string,
): Promise<void> {
  const kontrak = await db.contract.findMany({
    where: { packageId: { in: paketIds } },
    select: {
      packageId: true,
      contractNumber: true,
      contractValue: true,
      ppnPercent: true,
      durationDays: true,
      startDate: true,
      endDate: true,
      vendor: { select: { name: true } },
    },
  });
  const perPaket = new Map(kontrak.map((k) => [k.packageId, k]));
  const hariIni = jakartaToday().getTime();

  for (const l of lokasi) {
    const k = perPaket.get(l.packageId);
    if (!k) continue;
    const refId = `${l.slug}:kontrak`;

    /*
     * Sisa hari dihitung dari tanggal SELESAI kontrak, dan hanya bila SPMK
     * sudah terbit. Sebelum SPMK, `endDate` null dan jadwalnya masih relatif —
     * mengarang tanggal selesai dari `durationDays` berarti menerbitkan
     * tenggat yang tidak pernah disepakati siapa pun.
     */
    const sisaHari =
      k.endDate != null
        ? Math.ceil((k.endDate.getTime() - hariIni) / (24 * 3600 * 1000))
        : null;

    hasil.refs.push({
      id: refId,
      entityType: "contract",
      entityId: l.packageId,
      label: `${l.name} – kontrak ${k.contractNumber}`,
      value: [
        `nilai ${formatRupiah(k.contractValue)} (incl. PPN ${k.ppnPercent}%)`,
        `vendor ${k.vendor.name}`,
        `durasi ${k.durationDays} hari`,
        k.startDate ? `mulai ${k.startDate.toISOString().slice(0, 10)}` : "SPMK belum terbit",
        k.endDate ? `selesai ${k.endDate.toISOString().slice(0, 10)}` : null,
        sisaHari != null ? `sisa ${sisaHari} hari` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/paket/${l.packageId}/kontrak`,
    });

    dorong(hasil, fakta(l.id, "nilai_kontrak", rupiahKeAngka(k.contractValue), periodKey, refId));
    dorong(hasil, fakta(l.id, "durasi_kontrak_hari", k.durationDays, periodKey, refId));
    if (sisaHari != null) {
      dorong(hasil, fakta(l.id, "sisa_hari_kontrak", sisaHari, periodKey, refId));
    }
  }
}

/* ------------------------------------------------------------------ */
/* RAB                                                                 */
/* ------------------------------------------------------------------ */

async function tambahRab(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  periodKey: string,
): Promise<void> {
  const revisi = await db.rabRevision.findMany({
    where: { locationId: { in: lokasi.map((l) => l.id) }, status: "aktif" },
    select: {
      id: true,
      locationId: true,
      revisionNo: true,
      totalValue: true,
      _count: { select: { nodes: true } },
    },
  });
  const perLokasi = new Map(revisi.map((r) => [r.locationId, r]));

  for (const l of lokasi) {
    const r = perLokasi.get(l.id);
    const refId = `${l.slug}:rab`;
    if (!r) {
      /*
       * Lokasi TANPA RAB aktif tetap disebut, dan itu disengaja. Diam di sini
       * membuat "tidak ada RAB" tidak bisa dibedakan dari "lokasinya tidak
       * ikut ditanyakan" — padahal belum ada RAB aktif adalah temuan, bukan
       * ketiadaan informasi.
       */
      hasil.refs.push({
        id: refId,
        entityType: "rab",
        entityId: l.id,
        label: `${l.name} – RAB`,
        value: "belum ada revisi aktif",
        href: `/lokasi/${l.slug}/rab`,
      });
      continue;
    }
    hasil.refs.push({
      id: refId,
      entityType: "rab",
      entityId: l.id,
      label: `${l.name} – RAB revisi ${r.revisionNo} (aktif)`,
      value: `nilai ${formatRupiah(r.totalValue)} (pre-PPN) · ${r._count.nodes} baris`,
      href: `/lokasi/${l.slug}/rab`,
    });
    dorong(hasil, fakta(l.id, "rab_aktif", rupiahKeAngka(r.totalValue), periodKey, refId));
    dorong(hasil, fakta(l.id, "rab_revisi_no", r.revisionNo, periodKey, refId));
  }
}

/* ------------------------------------------------------------------ */
/* Keuangan                                                            */
/* ------------------------------------------------------------------ */

async function tambahKeuangan(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  paketIds: string[],
  periodKey: string,
): Promise<void> {
  const locIds = lokasi.map((l) => l.id);
  /*
   * Angkanya datang UTUH dari calculation layer keuangan. Tidak ada satu pun
   * penjumlahan di sini — formula keuangan hanya boleh hidup di
   * `src/lib/finance/calc.ts` (CLAUDE.md).
   */
  const [keuangan, kontrak] = await Promise.all([
    getLocationsFinance(locIds),
    db.contract.findMany({
      where: { packageId: { in: paketIds } },
      select: { id: true, packageId: true, ppnPercent: true },
    }),
  ]);
  const tagihan = await getContractsBilling(kontrak.map((k) => k.id));
  const kontrakPerPaket = new Map(kontrak.map((k) => [k.packageId, k]));

  for (const l of lokasi) {
    const f = keuangan.get(l.id);
    const refId = `${l.slug}:keuangan`;
    if (f) {
      hasil.refs.push({
        id: refId,
        entityType: "finance",
        entityId: l.id,
        label: `${l.name} – keuangan`,
        value: [
          `anggaran ${formatRupiah(f.budgetTotal)}`,
          `terpakai ${formatRupiah(f.expenseApproved)}`,
          `tersedia ${formatRupiah(f.availableBudget)}`,
          `utang belum bayar ${formatRupiah(f.outstandingPayable)}`,
        ].join(" · "),
        href: `/keuangan?lokasi=${l.slug}`,
      });
      dorong(hasil, fakta(l.id, "anggaran_total", rupiahKeAngka(f.budgetTotal), periodKey, refId));
      dorong(hasil, fakta(l.id, "anggaran_tersedia", rupiahKeAngka(f.availableBudget), periodKey, refId));
      dorong(hasil, fakta(l.id, "pengeluaran_disetujui", rupiahKeAngka(f.expenseApproved), periodKey, refId));
      dorong(hasil, fakta(l.id, "utang_belum_bayar", rupiahKeAngka(f.outstandingPayable), periodKey, refId));
    }

    const k = kontrakPerPaket.get(l.packageId);
    const t = k ? tagihan.get(k.id) : undefined;
    if (!k || !t) continue;
    const refTagihan = `${l.slug}:tagihan`;
    hasil.refs.push({
      id: refTagihan,
      entityType: "owner_billing",
      entityId: k.id,
      label: `${l.name} – termin ke pemberi kerja`,
      value: [
        `tertagih ${formatRupiah(t.billed)}`,
        `cair ${formatRupiah(t.disbursed)}`,
        `retensi ditahan ${formatRupiah(t.retentionHeld)}`,
      ].join(" · "),
      href: `/paket/${l.packageId}/kontrak`,
    });
    dorong(hasil, fakta(l.id, "tertagih_owner", rupiahKeAngka(t.billed), periodKey, refTagihan));
    dorong(hasil, fakta(l.id, "cair_owner", rupiahKeAngka(t.disbursed), periodKey, refTagihan));
    dorong(hasil, fakta(l.id, "retensi_ditahan", rupiahKeAngka(t.retentionHeld), periodKey, refTagihan));
  }
}

/* ------------------------------------------------------------------ */
/* Milestone KKP                                                       */
/* ------------------------------------------------------------------ */

async function tambahMilestone(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  periodKey: string,
): Promise<void> {
  const baris = await db.adminMilestone.groupBy({
    by: ["locationId", "status"],
    where: { locationId: { in: lokasi.map((l) => l.id) } },
    _count: { _all: true },
  });
  const perLokasi = new Map<string, Record<string, number>>();
  for (const b of baris) {
    if (!b.locationId) continue;
    const rec = perLokasi.get(b.locationId) ?? {};
    rec[b.status] = b._count._all;
    perLokasi.set(b.locationId, rec);
  }

  for (const l of lokasi) {
    const rec = perLokasi.get(l.id);
    if (!rec) continue;
    const total = Object.values(rec).reduce((s, n) => s + n, 0);
    const selesai = rec.selesai ?? 0;
    const perluPerbaikan = rec.perlu_perbaikan ?? 0;
    const refId = `${l.slug}:milestone-kkp`;
    hasil.refs.push({
      id: refId,
      entityType: "milestone",
      entityId: l.id,
      label: `${l.name} – kelengkapan dokumen KKP`,
      value: `${selesai}/${total} selesai · ${perluPerbaikan} perlu perbaikan`,
      href: `/lokasi/${l.slug}/administrasi`,
    });
    dorong(hasil, fakta(l.id, "milestone_total", total, periodKey, refId));
    dorong(hasil, fakta(l.id, "milestone_selesai", selesai, periodKey, refId));
    dorong(hasil, fakta(l.id, "milestone_perlu_perbaikan", perluPerbaikan, periodKey, refId));
  }
}

/* ------------------------------------------------------------------ */
/* Temuan pemeriksa (DECISIONS 426)                                    */
/* ------------------------------------------------------------------ */

async function tambahTemuan(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  periodKey: string,
): Promise<void> {
  const terbuka = await db.finding.findMany({
    where: {
      locationId: { in: lokasi.map((l) => l.id) },
      status: { in: [...OPEN_FINDING_STATUSES] },
    },
    select: { locationId: true, severity: true, status: true, dueDate: true },
  });
  if (terbuka.length === 0) return;
  const hariIni = jakartaToday();

  for (const l of lokasi) {
    const milik = terbuka.filter((t) => t.locationId === l.id);
    if (milik.length === 0) continue;
    const kritis = milik.filter((t) => t.severity === "kritis").length;
    const lewat = milik.filter((t) => t.dueDate !== null && t.dueDate < hariIni).length;
    const dibukaKembali = milik.filter((t) => t.status === "dibuka_kembali").length;
    const refId = `${l.slug}:temuan`;
    hasil.refs.push({
      id: refId,
      entityType: "finding",
      entityId: l.id,
      label: `${l.name} – temuan pemeriksa terbuka`,
      value: `${milik.length} terbuka · ${kritis} kritis · ${lewat} lewat tenggat · ${dibukaKembali} dibuka kembali`,
      href: `/temuan?status=terbuka&lokasi=${l.slug}`,
    });
    dorong(hasil, fakta(l.id, "temuan_terbuka", milik.length, periodKey, refId));
    dorong(hasil, fakta(l.id, "temuan_kritis", kritis, periodKey, refId));
    dorong(hasil, fakta(l.id, "temuan_lewat_tenggat", lewat, periodKey, refId));
    dorong(hasil, fakta(l.id, "temuan_dibuka_kembali", dibukaKembali, periodKey, refId));
  }
}

function dorong(hasil: HasilAdapter, f: FaktaResmi | null): void {
  if (f) hasil.fakta.push(f);
}

/**
 * Gabungkan fakta adapter ke peta fakta run.
 *
 * Fakta progress yang sudah ada TIDAK ditimpa: kalau suatu saat dua sumber
 * mengaku metrik yang sama untuk lokasi yang sama, yang menang adalah yang
 * lebih dulu — dan tabrakan itu seharusnya tidak pernah terjadi karena nama
 * metriknya berbeda. Dibuat eksplisit supaya tidak berubah diam-diam.
 */
export function gabungFakta(
  dasar: Map<string, FaktaResmi>,
  tambahan: FaktaResmi[],
): Map<string, FaktaResmi> {
  for (const f of tambahan) {
    const k = kunciFakta(f.locationId, f.metric);
    if (!dasar.has(k)) dasar.set(k, f);
  }
  return dasar;
}
