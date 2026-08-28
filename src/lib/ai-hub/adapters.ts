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
  const bolehKesiapan = boleh("kesiapan");
  const bolehEws = boleh("ews");
  const bolehVerifikasi = boleh("verifikasi");
  const bolehInspeksi = boleh("inspeksi");
  const bolehSurat = boleh("surat");

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
  if (bolehKesiapan) await tambahKesiapan(hasil, user, lokasi, periodKey);
  if (bolehEws) await tambahEws(hasil, user, lokasi, periodKey);
  if (bolehVerifikasi) await tambahVerifikasi(hasil, lokasi, periodKey);
  if (bolehInspeksi) await tambahInspeksi(hasil, lokasi, periodKey);
  if (bolehSurat) await tambahSurat(hasil, lokasi, paketIds, periodKey);

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

/* ------------------------------------------------------------------ */
/* LAPISAN PENGENDALIAN (DECISIONS 459)                                */
/* ------------------------------------------------------------------ */
/*
 * Permintaan user 2026-08-28: *"pastikan semua hal yang ada di marlin bisa
 * ditanyakan secara jelas di ai (kecuali keuangan)"*.
 *
 * Empat wilayah di bawah adalah lapisan pengendalian DECISIONS 426 — kesiapan
 * termin/PHO/FHO, peringatan dini, verifikasi eksternal Wakil PPK, dan
 * inspeksi lapangan. Sebelum ini tidak satu pun sampai ke AI: halamannya ada,
 * datanya ada, tetapi pertanyaan *"sudah bisa ajukan termin belum?"* dijawab
 * "tidak ada datanya" karena memang tidak pernah dikirim.
 *
 * Menambahkannya di ADAPTER, bukan sebagai niat WhatsApp baru, disengaja:
 * jalur tanya-bebas WhatsApp memakai `buildAdapterFacts` yang sama dengan Ask
 * MARLIN, jadi satu tempat menutup kedua permukaan sekaligus.
 *
 * Angkanya tetap tidak lahir di sini — `kesiapanPortofolio` dan `bangunEws`
 * adalah mesin rule yang sudah dipakai halamannya, dan dua sisanya cuma
 * cacahan baris.
 */

/**
 * Kesiapan termin/PHO/FHO — per PAKET, dilekatkan ke tiap lokasi paket itu.
 *
 * Labelnya menyebut nama PAKET secara eksplisit supaya tidak terbaca sebagai
 * kesiapan satu lokasi: kesiapan memang diputuskan per paket, dan menuliskannya
 * seolah milik satu lokasi akan membuat orang mengajukan termin atas dasar yang
 * salah.
 */
async function tambahKesiapan(
  hasil: HasilAdapter,
  user: SessionUser,
  lokasi: LokasiRingkas[],
  periodKey: string,
): Promise<void> {
  const { kesiapanPortofolio } = await import("@/lib/kesiapan/builder");
  const { KESIAPAN_VERDICT_LABEL } = await import("@/lib/kesiapan/rules");
  const paket = await kesiapanPortofolio(user);
  if (paket.length === 0) return;
  const dalamLingkup = new Set(lokasi.map((l) => l.id));

  for (const p of paket) {
    const milik = lokasi.filter((l) => p.lokasi.some((x) => x.id === l.id && dalamLingkup.has(l.id)));
    if (milik.length === 0) continue;
    const belum = p.kartu.reduce(
      (n, k) => n + k.syarat.filter((s) => s.status === "gagal").length,
      0,
    );
    const ringkas = p.kartu
      .map((k) => `${k.judul}: ${KESIAPAN_VERDICT_LABEL[k.verdict]}`)
      .join(" · ");
    for (const l of milik) {
      const refId = `${l.slug}:kesiapan`;
      hasil.refs.push({
        id: refId,
        entityType: "package",
        entityId: p.packageId,
        label: `Paket ${p.packageName} – kesiapan termin/PHO/FHO`,
        value: `${ringkas} · ${belum} syarat belum terpenuhi`,
        href: `/kesiapan`,
      });
      dorong(hasil, fakta(l.id, "kesiapan_syarat_belum", belum, periodKey, refId));
    }
  }
}

/**
 * Peringatan dini (`/perlu-tindakan`).
 *
 * Warning EWS menyebut objeknya lewat `href`, bukan lewat id. Karena itu
 * pemetaan ke lokasi dilakukan atas SLUG di dalam href — dan yang tidak
 * menunjuk lokasi mana pun (peringatan tingkat paket/surat) sengaja tidak
 * dipaksa menempel pada satu lokasi: memaksanya berarti menerbitkan angka yang
 * salah alamat.
 */
async function tambahEws(
  hasil: HasilAdapter,
  user: SessionUser,
  lokasi: LokasiRingkas[],
  periodKey: string,
): Promise<void> {
  const { bangunEws } = await import("@/lib/ews/builder");
  const warning = await bangunEws(user);
  if (warning.length === 0) return;

  for (const l of lokasi) {
    const milik = warning.filter((w) => w.href.includes(`/lokasi/${l.slug}`));
    if (milik.length === 0) continue;
    const kritis = milik.filter((w) => w.severity === "kritis").length;
    const refId = `${l.slug}:peringatan`;
    hasil.refs.push({
      id: refId,
      entityType: "location",
      entityId: l.id,
      label: `${l.name} – peringatan dini`,
      value: `${milik.length} peringatan (${kritis} kritis) · terparah: ${milik[0].alasan}`,
      href: `/perlu-tindakan`,
    });
    dorong(hasil, fakta(l.id, "peringatan_terbuka", milik.length, periodKey, refId));
    dorong(hasil, fakta(l.id, "peringatan_kritis", kritis, periodKey, refId));
  }
}

/** Verifikasi EKSTERNAL laporan harian oleh Wakil PPK — jejak pemeriksaan. */
async function tambahVerifikasi(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  periodKey: string,
): Promise<void> {
  const { COUNTED_REPORT_STATUSES } = await import("@/lib/lifecycle");
  const laporan = await db.dailyReport.findMany({
    where: {
      locationId: { in: lokasi.map((l) => l.id) },
      status: { in: [...COUNTED_REPORT_STATUSES] },
    },
    select: { locationId: true, verifications: { take: 1, select: { id: true } } },
  });
  if (laporan.length === 0) return;

  for (const l of lokasi) {
    const milik = laporan.filter((r) => r.locationId === l.id);
    if (milik.length === 0) continue;
    const sudah = milik.filter((r) => r.verifications.length > 0).length;
    const belum = milik.length - sudah;
    const refId = `${l.slug}:verifikasi`;
    hasil.refs.push({
      id: refId,
      entityType: "daily_report",
      entityId: l.id,
      label: `${l.name} – verifikasi laporan oleh Wakil PPK`,
      value: `${sudah} sudah diperiksa · ${belum} belum diperiksa (dari ${milik.length} laporan)`,
      href: `/verifikasi`,
    });
    dorong(hasil, fakta(l.id, "laporan_sudah_diverifikasi", sudah, periodKey, refId));
    dorong(hasil, fakta(l.id, "laporan_belum_diverifikasi", belum, periodKey, refId));
  }
}

/** Inspeksi lapangan Wakil PPK — hanya yang sudah FINAL yang dihitung. */
async function tambahInspeksi(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  periodKey: string,
): Promise<void> {
  const inspeksi = await db.inspection.findMany({
    where: { locationId: { in: lokasi.map((l) => l.id) }, status: "final" },
    orderBy: { inspectionDate: "desc" },
    select: {
      locationId: true,
      title: true,
      inspectionDate: true,
      _count: { select: { findings: true } },
    },
  });
  if (inspeksi.length === 0) return;

  for (const l of lokasi) {
    const milik = inspeksi.filter((i) => i.locationId === l.id);
    if (milik.length === 0) continue;
    const terakhir = milik[0];
    const refId = `${l.slug}:inspeksi`;
    hasil.refs.push({
      id: refId,
      entityType: "inspection",
      entityId: l.id,
      label: `${l.name} – inspeksi lapangan`,
      value: `${milik.length} inspeksi final · terakhir ${terakhir.inspectionDate.toISOString().slice(0, 10)} "${terakhir.title}" (${terakhir._count.findings} temuan)`,
      href: `/verifikasi`,
    });
    dorong(hasil, fakta(l.id, "inspeksi_final", milik.length, periodKey, refId));
  }
}

/**
 * PERSURATAN resmi — utang jawab dan tenggatnya.
 *
 * Surat melekat pada PAKET (dan kadang lokasi), jadi yang dilaporkan adalah
 * surat paket si lokasi. Yang dihitung hanya yang MENUNTUT JAWABAN: arsip surat
 * biasa tidak menuntut tindakan siapa pun, dan mencampurnya membuat angka
 * "perlu dijawab" kehilangan artinya.
 */
async function tambahSurat(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  paketIds: string[],
  periodKey: string,
): Promise<void> {
  const surat = await db.letter.findMany({
    where: { packageId: { in: paketIds }, needsReply: true, status: { not: "selesai" } },
    orderBy: { replyDueDate: "asc" },
    select: { packageId: true, subject: true, replyDueDate: true },
  });
  if (surat.length === 0) return;
  const hariIni = jakartaToday();

  for (const l of lokasi) {
    const milik = surat.filter((x) => x.packageId === l.packageId);
    if (milik.length === 0) continue;
    const lewat = milik.filter((x) => x.replyDueDate != null && x.replyDueDate < hariIni).length;
    const refId = `${l.slug}:surat`;
    hasil.refs.push({
      id: refId,
      entityType: "letter",
      entityId: l.packageId,
      label: `${l.name} – surat yang menunggu jawaban`,
      value: `${milik.length} perlu dijawab · ${lewat} lewat tenggat · terdekat: "${milik[0].subject}"`,
      href: `/surat`,
    });
    dorong(hasil, fakta(l.id, "surat_perlu_jawab", milik.length, periodKey, refId));
    dorong(hasil, fakta(l.id, "surat_lewat_tenggat", lewat, periodKey, refId));
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
