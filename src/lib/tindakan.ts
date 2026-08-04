import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { can } from "@/lib/authz";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { getLocationsProgress } from "@/lib/progress";
import { formatPct, jakartaToday } from "@/lib/format";
import { tingkatDeviasi, type TingkatDeviasi } from "@/lib/deviasi";

/**
 * PERLU TINDAKAN — satu antrean lintas jenis.
 *
 * Alasan modul ini ada: sampai sekarang "yang harus dikerjakan" tersebar di
 * tiga tempat yang tidak saling tahu — kartu exception di Beranda, antrean di
 * Pusat Laporan, dan saran di hub AI. Tidak ada satu pun yang bisa menjawab
 * "apa saja yang menunggu SAYA, dan mana yang paling telat", karena masing-
 * masing hanya melihat satu jenis pekerjaan. PRD menyebutnya gap P0 (Unified
 * Task & Approval Inbox); rancangan Claude Design menyebutnya keputusan K1.
 *
 * Modul ini TIDAK membuat tabel baru dan tidak menyimpan status apa pun. Ia
 * membaca sumber yang sudah ada lalu menormalkannya ke satu bentuk. Sebuah
 * item hilang dari antrean karena keadaan aslinya berubah (laporan disetujui,
 * kendala ditutup) — bukan karena ada yang "menandai sudah dibaca". Antrean
 * yang punya status sendiri akan cepat berselisih dengan kenyataan.
 *
 * Angka deviasi TIDAK dihitung ulang di sini: sumbernya `getLocationsProgress`
 * (CLAUDE.md §7). Yang ditentukan modul ini hanya URUTAN dan PENGELOMPOKAN.
 */

export type JenisTindakan =
  | "verifikasi"
  | "koreksi"
  | "deviasi"
  | "kendala"
  | "recovery"
  | "dokumen"
  | "keuangan";

/** Bobot keparahan — dipakai mengurutkan dan mewarnai chip. */
export type Keparahan = "kritis" | "perhatian" | "info";

export type ItemTindakan = {
  /** Unik lintas jenis: `${jenis}:${id sumber}`. */
  key: string;
  jenis: JenisTindakan;
  judul: string;
  /** Konteks satu baris — tanggal, nilai, atau alasan. */
  detail: string;
  lokasiNama: string | null;
  keparahan: Keparahan;
  /** Tenggat bila sumbernya punya; `null` = tidak berbatas waktu. */
  jatuhTempo: Date | null;
  /** Berapa hari terlewat dari tenggat (positif = telat). `null` = tak relevan. */
  telatHari: number | null;
  /** Deep link ke DATA PEMBENTUK, bukan ke halaman ringkasan (PRD §5.1). */
  href: string;
};

export const LABEL_JENIS: Record<JenisTindakan, string> = {
  verifikasi: "Menunggu verifikasi",
  koreksi: "Perlu koreksi",
  deviasi: "Deviasi kritis",
  kendala: "Kendala terbuka",
  recovery: "Recovery overdue",
  dokumen: "Dokumen kedaluwarsa",
  keuangan: "Menunggu persetujuan",
};

/** Ambang "segera kedaluwarsa" untuk dokumen, dalam hari. */
const AMBANG_EXPIRY_HARI = 30;

const URUTAN_KEPARAHAN: Record<Keparahan, number> = { kritis: 0, perhatian: 1, info: 2 };

function tanggalKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Selisih hari kalender (positif = `batas` sudah lewat dari `acuan`). */
function selisihHari(batas: Date, acuan: Date): number {
  const MS = 86_400_000;
  const a = Date.UTC(batas.getUTCFullYear(), batas.getUTCMonth(), batas.getUTCDate());
  const b = Date.UTC(acuan.getUTCFullYear(), acuan.getUTCMonth(), acuan.getUTCDate());
  return Math.round((b - a) / MS);
}

const KEPARAHAN_DARI_DEVIASI: Record<TingkatDeviasi, Keparahan> = {
  kritis: "kritis",
  perhatian: "perhatian",
  aman: "info",
};

/**
 * Rakit antrean untuk satu pengguna, dibatasi lokasi yang boleh dilihatnya.
 *
 * Setiap sumber dipagari capability-nya sendiri: seorang Pelaksana melihat
 * koreksi laporannya tetapi tidak pernah melihat antrean persetujuan
 * keuangan. Pagar sesungguhnya tetap di server action masing-masing — ini
 * hanya menjaga antrean tidak menjanjikan pekerjaan yang tak bisa diselesaikan.
 */
export const getAntreanTindakan = cache(_getAntreanTindakan);

/**
 * Dibungkus `cache()` di atas: shell menghitung lencana lonceng dan halaman
 * `/tindakan` menyusun daftarnya dari sumber yang sama. Keduanya dirender
 * dalam satu pass, jadi tanpa dedupe permintaan ini berjalan dua kali persis
 * pada halaman yang paling sering dibuka untuknya.
 *
 * Lencana sengaja memakai antrean PENUH, bukan enam `count()` murah yang
 * melewatkan deviasi kritis: lencana yang menunjukkan 6 lalu membuka daftar
 * berisi 8 membuat angkanya berhenti dipercaya, dan deviasi kritis justru
 * jenis yang paling perlu memanggil orang.
 */
async function _getAntreanTindakan(user: SessionUser): Promise<ItemTindakan[]> {
  const locIds = await accessibleLocationIds(user);
  const locWhere = locationScopeWhere(user, locIds);
  const hariIni = jakartaToday();

  const [reviewQueue, koreksiQueue, issues, recoveries, dokumen, komitmen, pengeluaran, lokasi] =
    await Promise.all([
      can(user.role, "daily_report.review")
        ? db.dailyReport.findMany({
            where: { status: "dikirim", location: locWhere },
            select: {
              id: true,
              reportDate: true,
              location: { select: { name: true, slug: true } },
            },
            orderBy: { reportDate: "asc" },
            take: 50,
          })
        : Promise.resolve([]),

      can(user.role, "daily_report.create")
        ? db.dailyReport.findMany({
            where: { status: "perlu_koreksi", location: locWhere },
            select: {
              id: true,
              reportDate: true,
              location: { select: { name: true, slug: true } },
            },
            orderBy: { reportDate: "asc" },
            take: 50,
          })
        : Promise.resolve([]),

      db.issue.findMany({
        where: { status: { in: ["terbuka", "ditangani"] }, location: locWhere },
        select: {
          id: true,
          title: true,
          severity: true,
          createdAt: true,
          location: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 50,
      }),

      db.recoveryAction.findMany({
        where: {
          status: { in: ["direncanakan", "berjalan"] },
          dueDate: { not: null, lt: hariIni },
          issue: { location: locWhere },
        },
        select: {
          id: true,
          description: true,
          dueDate: true,
          picName: true,
          issue: { select: { severity: true, location: { select: { name: true, slug: true } } } },
        },
        orderBy: { dueDate: "asc" },
        take: 50,
      }),

      can(user.role, "document.view")
        ? db.document.findMany({
            where: {
              status: "aktif",
              expiryDate: {
                not: null,
                lt: new Date(hariIni.getTime() + AMBANG_EXPIRY_HARI * 86_400_000),
              },
              OR: [{ location: locWhere }, { locationId: null }],
            },
            select: {
              id: true,
              title: true,
              expiryDate: true,
              location: { select: { name: true } },
            },
            orderBy: { expiryDate: "asc" },
            take: 50,
          })
        : Promise.resolve([]),

      can(user.role, "finance.approve")
        ? db.commitment.findMany({
            where: { status: "diajukan", location: locWhere },
            select: {
              id: true,
              description: true,
              createdAt: true,
              location: { select: { name: true, slug: true } },
            },
            orderBy: { createdAt: "asc" },
            take: 50,
          })
        : Promise.resolve([]),

      can(user.role, "finance.approve")
        ? db.expense.findMany({
            where: { status: "diajukan", location: locWhere },
            select: {
              id: true,
              description: true,
              createdAt: true,
              location: { select: { name: true, slug: true } },
            },
            orderBy: { createdAt: "asc" },
            take: 50,
          })
        : Promise.resolve([]),

      can(user.role, "progress.view")
        ? db.location.findMany({
            where: { ...locWhere, isActive: true },
            select: { id: true, name: true, slug: true },
          })
        : Promise.resolve([]),
    ]);

  const items: ItemTindakan[] = [];

  for (const r of reviewQueue) {
    const tgl = tanggalKey(r.reportDate);
    items.push({
      key: `verifikasi:${r.id}`,
      jenis: "verifikasi",
      judul: r.location.name,
      detail: `Laporan ${tgl} menunggu diperiksa`,
      lokasiNama: r.location.name,
      // Laporan yang menggantung menghambat angka progres seluruh lokasi,
      // jadi keterlambatannya naik kelas setelah lewat sehari.
      keparahan: selisihHari(r.reportDate, hariIni) > 1 ? "perhatian" : "info",
      jatuhTempo: r.reportDate,
      telatHari: selisihHari(r.reportDate, hariIni),
      href: `/lokasi/${r.location.slug}/harian/${tgl}`,
    });
  }

  for (const r of koreksiQueue) {
    const tgl = tanggalKey(r.reportDate);
    items.push({
      key: `koreksi:${r.id}`,
      jenis: "koreksi",
      judul: r.location.name,
      detail: `Laporan ${tgl} dikembalikan untuk diperbaiki`,
      lokasiNama: r.location.name,
      keparahan: "perhatian",
      jatuhTempo: r.reportDate,
      telatHari: selisihHari(r.reportDate, hariIni),
      href: `/lokasi/${r.location.slug}/harian/${tgl}`,
    });
  }

  for (const i of issues) {
    items.push({
      key: `kendala:${i.id}`,
      jenis: "kendala",
      judul: i.title,
      detail: `Kendala ${i.severity} di ${i.location.name}`,
      lokasiNama: i.location.name,
      keparahan: i.severity === "kritis" || i.severity === "tinggi" ? "kritis" : "perhatian",
      jatuhTempo: null,
      telatHari: null,
      href: `/lokasi/${i.location.slug}/progress`,
    });
  }

  for (const a of recoveries) {
    // `dueDate` dijamin ada oleh filter query; penjaga ini untuk tipe saja.
    if (!a.dueDate) continue;
    const telat = selisihHari(a.dueDate, hariIni);
    items.push({
      key: `recovery:${a.id}`,
      jenis: "recovery",
      judul: a.description,
      detail: a.picName
        ? `PIC ${a.picName} · telat ${telat} hari`
        : `Tanpa PIC · telat ${telat} hari`,
      lokasiNama: a.issue.location.name,
      keparahan: "kritis",
      jatuhTempo: a.dueDate,
      telatHari: telat,
      href: `/lokasi/${a.issue.location.slug}/progress`,
    });
  }

  for (const d of dokumen) {
    if (!d.expiryDate) continue;
    const telat = selisihHari(d.expiryDate, hariIni);
    items.push({
      key: `dokumen:${d.id}`,
      jenis: "dokumen",
      judul: d.title,
      detail:
        telat > 0
          ? `Kedaluwarsa ${telat} hari lalu`
          : `Kedaluwarsa dalam ${Math.abs(telat)} hari`,
      lokasiNama: d.location?.name ?? null,
      keparahan: telat > 0 ? "kritis" : "perhatian",
      jatuhTempo: d.expiryDate,
      telatHari: telat,
      href: `/dokumen/${d.id}`,
    });
  }

  for (const k of komitmen) {
    items.push({
      key: `keuangan:komitmen:${k.id}`,
      jenis: "keuangan",
      judul: k.description,
      detail: `Komitmen menunggu persetujuan · ${k.location.name}`,
      lokasiNama: k.location.name,
      keparahan: "perhatian",
      jatuhTempo: null,
      telatHari: null,
      href: `/lokasi/${k.location.slug}/keuangan`,
    });
  }

  for (const e of pengeluaran) {
    items.push({
      key: `keuangan:pengeluaran:${e.id}`,
      jenis: "keuangan",
      judul: e.description,
      detail: `Pengeluaran menunggu persetujuan · ${e.location.name}`,
      lokasiNama: e.location.name,
      keparahan: "perhatian",
      jatuhTempo: null,
      telatHari: null,
      href: `/lokasi/${e.location.slug}/keuangan`,
    });
  }

  if (lokasi.length > 0) {
    const progress = await getLocationsProgress(lokasi.map((l) => l.id));
    for (const l of lokasi) {
      const p = progress.get(l.id);
      if (!p) continue;
      const tingkat = tingkatDeviasi(p.deviationPct);
      // Hanya yang KRITIS masuk antrean tindakan. Yang amber sudah terlihat di
      // Progress & Deviasi; memasukkannya ke sini membuat antrean panjang
      // sehingga yang benar-benar mendesak justru tenggelam.
      if (tingkat !== "kritis") continue;
      items.push({
        key: `deviasi:${l.id}`,
        jenis: "deviasi",
        judul: l.name,
        detail: `Realisasi ${formatPct(p.deviationPct)} terhadap rencana`,
        lokasiNama: l.name,
        keparahan: KEPARAHAN_DARI_DEVIASI[tingkat],
        jatuhTempo: null,
        telatHari: null,
        href: `/lokasi/${l.slug}/progress`,
      });
    }
  }

  // Urutan: paling parah dulu, lalu yang paling lama telat. Item tanpa tenggat
  // jatuh ke belakang dalam kelasnya — bukan karena kurang penting, tetapi
  // karena tidak ada dasar untuk membandingkan mendesaknya.
  items.sort((a, b) => {
    const k = URUTAN_KEPARAHAN[a.keparahan] - URUTAN_KEPARAHAN[b.keparahan];
    if (k !== 0) return k;
    return (b.telatHari ?? -Infinity) - (a.telatHari ?? -Infinity);
  });

  return items;
}

/** Jumlah per jenis — untuk chip filter dan lencana menu. */
export function ringkasPerJenis(items: ItemTindakan[]): Record<JenisTindakan, number> {
  const out = {
    verifikasi: 0,
    koreksi: 0,
    deviasi: 0,
    kendala: 0,
    recovery: 0,
    dokumen: 0,
    keuangan: 0,
  } satisfies Record<JenisTindakan, number>;
  for (const i of items) out[i.jenis] += 1;
  return out;
}
