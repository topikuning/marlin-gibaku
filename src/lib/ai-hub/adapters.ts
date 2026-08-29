import "server-only";
import { TZDate } from "@date-fns/tz";
import { db } from "@/lib/db";
import { can } from "@/lib/authz";
import { getContractsBilling, getLocationsFinance } from "@/lib/finance/calc";
import { APP_TZ, formatRupiah, jakartaDateKey, jakartaToday, parseDateKey } from "@/lib/format";
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
 * ### "Belum tertagih" belum ada di sini — tapi halangannya sudah hilang
 *
 * Dulu angka ini tidak bisa disediakan tanpa menyalin formulanya: Σ nilai
 * terpasang satu kontrak + alokasi proporsional untuk kontrak multi-lokasi
 * hidup di dalam halaman Keuangan, bukan di calculation layer.
 *
 * Sejak audit 2026-08-28 (C-4) penjumlahan itu sudah dipindah ke
 * `finance/calc.ts` sebagai `alokasiBelumTertagih()`. Menambahkan faktanya di
 * sini kini tinggal MEMANGGIL fungsi itu — tanpa implementasi kedua.
 *
 * Yang masih menahan bukan lagi soal teknis melainkan kapabilitas: uang
 * INTERNAL pelaksana bukan urusan tiap pembaca, jadi fakta ini harus ikut
 * pagar kapabilitas seperti adapter keuangan lainnya. Itu keputusan produk,
 * bukan pekerjaan yang tersisa.
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
 * WAKTU yang berlaku untuk satu run adapter.
 *
 * Sampai review 2026-08-29 hanya `periodKey` yang diedarkan, dan komentar di
 * bawah menjanjikan "satu jawaban tidak mencampur dua waktu" — janji yang tidak
 * ditepati. Sebagian adapter memang membaca keadaan SEKARANG (temuan yang masih
 * terbuka, surat yang masih menunggu jawaban, kesiapan, peringatan dini, RAB
 * aktif, angka keuangan, milestone), lalu faktanya distempel periode yang
 * DIMINTA. Pertanyaan "kondisi per 30 Juni" karenanya bisa memadukan progres 30
 * Juni dengan temuan hari ini — dan tidak ada apa pun di jawabannya yang
 * memberi tahu pembacanya.
 *
 * Keputusan user 2026-08-29 (jalan a): JUJUR DULU, akurat kemudian.
 *
 *  - Yang punya tanggal dan bisa dibatasi murah — inspeksi, verifikasi, sisa
 *    hari kontrak — dihitung terhadap AKHIR PERIODE yang diminta.
 *  - Yang inheren keadaan sekarang tidak dipaksa direkonstruksi (butuh histori
 *    status yang belum tentu ada, dan menebaknya lebih buruk daripada mengaku).
 *    Faktanya distempel TANGGAL HARI INI — bukan periode yang diminta — dan
 *    labelnya menyebutnya. Penstempelan itu bukan kosmetik: `validasiKlaim`
 *    membandingkan `periodKey` klaim dengan `periodKey` fakta, jadi klaim yang
 *    memakai angka ini terpaksa mengaku "per hari ini".
 *
 * Pada pertanyaan yang periodenya memang hari ini — mayoritasnya — tidak ada
 * yang berubah sama sekali: `kunciHariIni === periodKey`.
 */
export type WaktuAdapter = {
  /** Akhir periode yang DIMINTA (YYYY-MM-DD). */
  periodKey: string;
  /** Hari ini di Asia/Jakarta (YYYY-MM-DD). */
  kunciHariIni: string;
  /** Akhir periode sebagai Date; jatuh ke hari ini bila kuncinya tak terbaca. */
  akhirPeriode: Date;
  /** Periode yang diminta sudah LEWAT — di sinilah pencampuran waktu berbahaya. */
  historis: boolean;
};

export function waktuAdapter(periodKey: string): WaktuAdapter {
  const hariIni = jakartaToday();
  const kunciHariIni = jakartaDateKey(hariIni);
  const akhir = parseDateKey(periodKey) ?? hariIni;
  return {
    periodKey,
    kunciHariIni,
    akhirPeriode: akhir,
    historis: periodKey < kunciHariIni,
  };
}

/**
 * Tempelan untuk fakta yang TIDAK bisa dibaca ulang ke masa lalu.
 *
 * Kosong bila periodenya memang hari ini — menambahi tiap label dengan
 * "keadaan hari ini" pada pertanyaan hari ini hanya bising, dan bising membuat
 * orang berhenti membaca peringatan yang sungguhan.
 */
function capSekarang(w: WaktuAdapter): string {
  return w.historis ? ` · KEADAAN HARI INI (${w.kunciHariIni}), bukan per ${w.periodKey}` : "";
}

/**
 * Sitasi yang isinya KEADAAN SEKARANG, dikenali dari akhiran id-nya.
 *
 * Ditulis sebagai daftar di SATU tempat, bukan ditempelkan satu per satu di
 * tiap `refs.push` — penempelan tersebar akan terlewat pada adapter berikutnya,
 * dan yang terlewat justru tidak kelihatan (labelnya cuma kehilangan
 * peringatan, bukan memunculkan galat).
 */
const REF_KEADAAN_SEKARANG = new Set([
  "rab",
  "keuangan",
  "tagihan",
  "milestone-kkp",
  "temuan",
  "kesiapan",
  "peringatan",
  "surat",
]);

/** Tempelkan cap "keadaan hari ini" pada sitasi yang tidak bisa dibaca ulang. */
function tandaiKeadaanSekarang(hasil: HasilAdapter, w: WaktuAdapter): void {
  if (!w.historis) return;
  const cap = capSekarang(w);
  for (const r of hasil.refs) {
    const akhiran = r.id.split(":").pop() ?? "";
    if (REF_KEADAAN_SEKARANG.has(akhiran)) r.value = `${r.value}${cap}`;
  }
}

/**
 * Kumpulkan fakta tambahan untuk seluruh lokasi dalam scope — BATCHED.
 *
 * Tidak ada query per lokasi di sini: pola N+1 pada run berisi 83 lokasi
 * berarti ratusan perjalanan basis data untuk satu pertanyaan.
 *
 * `periodKey` diterima dari pemanggil (akhir periode run), sama dengan yang
 * dipakai fakta progress. Yang tidak bisa dibaca ulang ke masa lalu TIDAK
 * dipaksa memakai kunci itu — lihat `WaktuAdapter`. Sebelum review 2026-08-29
 * komentar di sini berbunyi "supaya satu jawaban tidak mencampur dua waktu",
 * padahal separuh adapternya membaca keadaan sekarang; klaim yang salah lebih
 * berbahaya daripada tidak ada klaim.
 */
export async function buildAdapterFacts(
  user: SessionUser,
  locIds: string[],
  periodKey: string,
): Promise<HasilAdapter> {
  const hasil: HasilAdapter = { refs: [], fakta: [], dilewati: [] };
  if (locIds.length === 0) return hasil;
  const w = waktuAdapter(periodKey);

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

  if (bolehKontrak) await tambahKontrak(hasil, lokasi, paketIds, w);
  if (bolehRab) await tambahRab(hasil, lokasi, w);
  if (bolehKeuangan) await tambahKeuangan(hasil, lokasi, paketIds, w);
  if (bolehMilestone) await tambahMilestone(hasil, lokasi, w);
  if (bolehTemuan) await tambahTemuan(hasil, lokasi, w);
  if (bolehKesiapan) await tambahKesiapan(hasil, user, lokasi, w);
  if (bolehEws) await tambahEws(hasil, user, lokasi, w);
  if (bolehVerifikasi) await tambahVerifikasi(hasil, lokasi, w);
  if (bolehInspeksi) await tambahInspeksi(hasil, lokasi, w);
  if (bolehSurat) await tambahSurat(hasil, user, lokasi, paketIds, w);

  tandaiKeadaanSekarang(hasil, w);
  return hasil;
}

/* ------------------------------------------------------------------ */
/* Kontrak                                                             */
/* ------------------------------------------------------------------ */

async function tambahKontrak(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  paketIds: string[],
  w: WaktuAdapter,
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
  // Sisa hari dihitung terhadap AKHIR PERIODE yang diminta, bukan hari ini:
  // "sisa 40 hari" pada pertanyaan per 30 Juni harus berarti sisa PER 30 JUNI.
  const patokan = w.akhirPeriode.getTime();

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
        ? Math.ceil((k.endDate.getTime() - patokan) / (24 * 3600 * 1000))
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

    dorong(hasil, fakta(l.id, "nilai_kontrak", rupiahKeAngka(k.contractValue), w.periodKey, refId));
    dorong(hasil, fakta(l.id, "durasi_kontrak_hari", k.durationDays, w.periodKey, refId));
    if (sisaHari != null) {
      dorong(hasil, fakta(l.id, "sisa_hari_kontrak", sisaHari, w.periodKey, refId));
    }
  }
}

/* ------------------------------------------------------------------ */
/* RAB                                                                 */
/* ------------------------------------------------------------------ */

async function tambahRab(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  w: WaktuAdapter,
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
    dorong(hasil, fakta(l.id, "rab_aktif", rupiahKeAngka(r.totalValue), w.kunciHariIni, refId));
    dorong(hasil, fakta(l.id, "rab_revisi_no", r.revisionNo, w.kunciHariIni, refId));
  }
}

/* ------------------------------------------------------------------ */
/* Keuangan                                                            */
/* ------------------------------------------------------------------ */

async function tambahKeuangan(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  paketIds: string[],
  w: WaktuAdapter,
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
      dorong(hasil, fakta(l.id, "anggaran_total", rupiahKeAngka(f.budgetTotal), w.kunciHariIni, refId));
      dorong(hasil, fakta(l.id, "anggaran_tersedia", rupiahKeAngka(f.availableBudget), w.kunciHariIni, refId));
      dorong(hasil, fakta(l.id, "pengeluaran_disetujui", rupiahKeAngka(f.expenseApproved), w.kunciHariIni, refId));
      dorong(hasil, fakta(l.id, "utang_belum_bayar", rupiahKeAngka(f.outstandingPayable), w.kunciHariIni, refId));
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
    dorong(hasil, fakta(l.id, "tertagih_owner", rupiahKeAngka(t.billed), w.kunciHariIni, refTagihan));
    dorong(hasil, fakta(l.id, "cair_owner", rupiahKeAngka(t.disbursed), w.kunciHariIni, refTagihan));
    dorong(hasil, fakta(l.id, "retensi_ditahan", rupiahKeAngka(t.retentionHeld), w.kunciHariIni, refTagihan));
  }
}

/* ------------------------------------------------------------------ */
/* Milestone KKP                                                       */
/* ------------------------------------------------------------------ */

async function tambahMilestone(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  w: WaktuAdapter,
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
    dorong(hasil, fakta(l.id, "milestone_total", total, w.kunciHariIni, refId));
    dorong(hasil, fakta(l.id, "milestone_selesai", selesai, w.kunciHariIni, refId));
    dorong(hasil, fakta(l.id, "milestone_perlu_perbaikan", perluPerbaikan, w.kunciHariIni, refId));
  }
}

/* ------------------------------------------------------------------ */
/* Temuan pemeriksa (DECISIONS 426)                                    */
/* ------------------------------------------------------------------ */

async function tambahTemuan(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  w: WaktuAdapter,
): Promise<void> {
  const terbuka = await db.finding.findMany({
    where: {
      locationId: { in: lokasi.map((l) => l.id) },
      status: { in: [...OPEN_FINDING_STATUSES] },
    },
    select: { locationId: true, severity: true, status: true, dueDate: true },
  });
  if (terbuka.length === 0) return;
  /*
   * Ambang "lewat tenggat" memakai HARI INI, bukan akhir periode — himpunan
   * temuannya sendiri adalah keadaan sekarang, dan memasangkan himpunan
   * sekarang dengan ambang masa lalu adalah pencampuran waktu yang sama persis
   * dengan yang sedang ditutup. Seluruh fakta di adapter ini karenanya
   * distempel `kunciHariIni` dan labelnya membawa cap.
   */
  const patokan = jakartaToday();

  for (const l of lokasi) {
    const milik = terbuka.filter((t) => t.locationId === l.id);
    if (milik.length === 0) continue;
    const kritis = milik.filter((t) => t.severity === "kritis").length;
    const lewat = milik.filter((t) => t.dueDate !== null && t.dueDate < patokan).length;
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
    dorong(hasil, fakta(l.id, "temuan_terbuka", milik.length, w.kunciHariIni, refId));
    dorong(hasil, fakta(l.id, "temuan_kritis", kritis, w.kunciHariIni, refId));
    dorong(hasil, fakta(l.id, "temuan_lewat_tenggat", lewat, w.kunciHariIni, refId));
    dorong(hasil, fakta(l.id, "temuan_dibuka_kembali", dibukaKembali, w.kunciHariIni, refId));
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
  w: WaktuAdapter,
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
      dorong(hasil, fakta(l.id, "kesiapan_syarat_belum", belum, w.kunciHariIni, refId));
    }
  }
}

/**
 * Peringatan dini (`/perlu-tindakan`).
 *
 * ### Yang diperbaiki review 2026-08-28
 *
 * Versi pertama memetakan warning ke lokasi dengan `href.includes("/lokasi/" +
 * slug)`. Dua cacat sekaligus:
 *
 * 1. **Setengah datanya tidak pernah sampai.** Peringatan tingkat PAKET
 *    (dokumen kadaluarsa, milestone terlambat) ber-href `/paket/<id>/dokumen`,
 *    peringatan SURAT ber-href `/surat?sorot=<id>`, dan sebagian peringatan
 *    lokasi ber-href `/temuan?...` atau `/kendala?...`. Tidak satu pun cocok
 *    dengan polanya — jadi adapter yang mengaku "peringatan dini" hanya
 *    membawa sebagian, tanpa mengaku sebagian.
 * 2. **Slug berawalan sama bisa tertukar.** "kranji" cocok di dalam
 *    "kranji-2".
 *
 * Sekarang `EwsWarning` membawa `locationSlug` / `packageId` / `letterId`
 * eksplisit, dan pemetaannya perbandingan sama-persis. Peringatan tingkat
 * paket dilekatkan ke tiap lokasi paket itu dengan LABEL yang menyebut
 * paketnya — sama seperti kesiapan, dan dengan alasan yang sama.
 */
async function tambahEws(
  hasil: HasilAdapter,
  user: SessionUser,
  lokasi: LokasiRingkas[],
  w: WaktuAdapter,
): Promise<void> {
  const { bangunEws } = await import("@/lib/ews/builder");
  const warning = await bangunEws(user);
  if (warning.length === 0) return;

  const paketLokasi = new Set(lokasi.map((l) => l.packageId));
  for (const l of lokasi) {
    /*
     * Milik lokasi ini = yang menyebut slug-nya, DITAMBAH yang menyebut
     * paketnya (dokumen/milestone/surat paket). Peringatan paket memang
     * menyangkut tiap lokasi di dalamnya: dokumen jaminan yang kadaluarsa
     * menahan seluruh paket, bukan satu titik.
     */
    const milik = warning.filter(
      (w) =>
        w.locationSlug === l.slug ||
        (w.packageId != null && w.packageId === l.packageId && paketLokasi.has(l.packageId)) ||
        // Tingkat ORGANISASI: surat yang belum menempel ke paket mana pun
        // (`packageId: null`). Ia ada di halaman Surat dan di /perlu-tindakan,
        // dan versi pertama menjatuhkannya di sini — peringatan yang terlihat
        // di layar tetapi tidak bisa ditanyakan (review 2026-08-28).
        (w.letterId != null && w.packageId == null),
    );
    if (milik.length === 0) continue;
    const kritis = milik.filter((w) => w.severity === "kritis").length;
    // Dua tingkat di atas lokasi, DIHITUNG TERPISAH: menyebut peringatan
    // organisasi sebagai "tingkat paket" akan mengirim orang mencarinya di
    // paket yang salah.
    const tingkatPaket = milik.filter((w) => w.locationSlug == null && w.packageId != null).length;
    const tingkatOrg = milik.filter((w) => w.locationSlug == null && w.packageId == null).length;
    const refId = `${l.slug}:peringatan`;
    hasil.refs.push({
      id: refId,
      entityType: "location",
      entityId: l.id,
      label: `${l.name} – peringatan dini`,
      value:
        `${milik.length} peringatan (${kritis} kritis` +
        (tingkatPaket > 0 ? `, ${tingkatPaket} tingkat paket` : "") +
        (tingkatOrg > 0 ? `, ${tingkatOrg} tingkat organisasi` : "") +
        `) · terparah: ${milik[0].alasan}`,
      href: `/perlu-tindakan`,
    });
    dorong(hasil, fakta(l.id, "peringatan_terbuka", milik.length, w.kunciHariIni, refId));
    dorong(hasil, fakta(l.id, "peringatan_kritis", kritis, w.kunciHariIni, refId));
  }
}

/** Verifikasi EKSTERNAL laporan harian oleh Wakil PPK — jejak pemeriksaan. */
async function tambahVerifikasi(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  w: WaktuAdapter,
): Promise<void> {
  const { COUNTED_REPORT_STATUSES } = await import("@/lib/lifecycle");
  const tahun = w.akhirPeriode.getUTCFullYear();
  const bulan = w.akhirPeriode.getUTCMonth();
  const hari = w.akhirPeriode.getUTCDate();
  // Batas eksklusif memakai tengah malam JAKARTA, bukan UTC. Railway berjalan
  // di UTC; memakai UTC-midnight akan ikut menghitung tujuh jam pertama pada
  // hari berikutnya sebagai bagian dari tanggal laporan yang diminta.
  const setelahAkhirPeriode = new TZDate(tahun, bulan, hari + 1, 0, 0, 0, 0, APP_TZ);
  const laporan = await db.dailyReport.findMany({
    /*
     * Dua waktunya sama-sama dibatasi: tanggal laporan tidak melewati periode,
     * dan pemeriksaannya memang sudah tercatat sebelum pergantian hari Jakarta.
     * Tanpa pagar kedua, laporan Juni yang baru diperiksa Juli terbaca seolah
     * sudah diperiksa pada laporan historis Juni.
     */
    where: {
      locationId: { in: lokasi.map((l) => l.id) },
      status: { in: [...COUNTED_REPORT_STATUSES] },
      reportDate: { lte: w.akhirPeriode },
    },
    select: {
      locationId: true,
      verifications: {
        where: { createdAt: { lt: setelahAkhirPeriode } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
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
    dorong(hasil, fakta(l.id, "laporan_sudah_diverifikasi", sudah, w.periodKey, refId));
    dorong(hasil, fakta(l.id, "laporan_belum_diverifikasi", belum, w.periodKey, refId));
  }
}

/** Inspeksi lapangan Wakil PPK — hanya yang sudah FINAL yang dihitung. */
async function tambahInspeksi(
  hasil: HasilAdapter,
  lokasi: LokasiRingkas[],
  w: WaktuAdapter,
): Promise<void> {
  const inspeksi = await db.inspection.findMany({
    /*
     * Dibatasi ke AKHIR PERIODE: inspeksi punya tanggalnya sendiri, jadi
     * "inspeksi per 30 Juni" bisa dijawab benar tanpa rekonstruksi apa pun.
     * Tanpa batas ini, jawaban historis memuat inspeksi yang belum terjadi.
     */
    where: {
      locationId: { in: lokasi.map((l) => l.id) },
      status: "final",
      inspectionDate: { lte: w.akhirPeriode },
    },
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
    dorong(hasil, fakta(l.id, "inspeksi_final", milik.length, w.periodKey, refId));
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
  user: SessionUser,
  lokasi: LokasiRingkas[],
  paketIds: string[],
  w: WaktuAdapter,
): Promise<void> {
  const surat = await db.letter.findMany({
    /*
     * Surat TINGKAT ORGANISASI (`packageId: null`) ikut (review 2026-08-28).
     *
     * Register surat memang membolehkan surat yang belum menempel ke paket
     * mana pun — surat masuk dari KKP sering datang sebelum diketahui paket
     * mana yang harus menjawabnya. Versi pertama menyaring `packageId in
     * paketIds` saja, jadi surat itu terlihat di halaman Surat dan di EWS,
     * tetapi AI menjawab "tidak ada". Fakta yang ada di layar tapi tidak ada di
     * AI lebih buruk daripada tidak ada sama sekali: penanya menyimpulkan
     * tidak ada surat yang menunggu.
     */
    where: {
      orgId: user.orgId,
      needsReply: true,
      status: { not: "selesai" },
      OR: [{ packageId: { in: paketIds } }, { packageId: null }],
    },
    orderBy: { replyDueDate: "asc" },
    select: { packageId: true, subject: true, replyDueDate: true },
  });
  if (surat.length === 0) return;
  // Sama seperti temuan: himpunannya keadaan sekarang, jadi ambangnya hari ini.
  const patokan = jakartaToday();

  for (const l of lokasi) {
    // Surat organisasi menyangkut SETIAP lokasi dalam lingkup — sama seperti
    // peringatan tingkat paket dilekatkan ke tiap lokasi paketnya. Jumlahnya
    // disebut supaya tidak terbaca sebagai surat milik lokasi ini.
    const milik = surat.filter((x) => x.packageId === l.packageId || x.packageId === null);
    if (milik.length === 0) continue;
    const lewat = milik.filter((x) => x.replyDueDate != null && x.replyDueDate < patokan).length;
    const tingkatOrg = milik.filter((x) => x.packageId === null).length;
    const refId = `${l.slug}:surat`;
    hasil.refs.push({
      id: refId,
      entityType: "letter",
      entityId: l.packageId,
      label: `${l.name} – surat yang menunggu jawaban`,
      value:
        `${milik.length} perlu dijawab · ${lewat} lewat tenggat` +
        (tingkatOrg > 0 ? ` · ${tingkatOrg} tingkat organisasi` : "") +
        ` · terdekat: "${milik[0].subject}"`,
      href: `/surat`,
    });
    dorong(hasil, fakta(l.id, "surat_perlu_jawab", milik.length, w.kunciHariIni, refId));
    dorong(hasil, fakta(l.id, "surat_lewat_tenggat", lewat, w.kunciHariIni, refId));
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
