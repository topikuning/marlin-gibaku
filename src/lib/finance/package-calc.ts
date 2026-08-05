import "server-only";
import { db } from "@/lib/db";
import { getLocationsFinance, getContractsBilling, unbilledWork } from "@/lib/finance/calc";
import { getLocationsProgress } from "@/lib/progress";
import { runningContractValue } from "@/lib/package/queries";

/**
 * KEUANGAN TINGKAT PAKET — gap P0 pada PRD ("Package-level Finance").
 *
 * PRD §4: "Portfolio dan lokasi tersedia, tetapi ringkasan keuangan paket
 * tidak menjadi tab paket. Sulit memahami kontrak → alokasi lokasi → komitmen
 * → realisasi → billing secara utuh." Dua ujung rantai itu selama ini ada,
 * tengahnya tidak: nilai kontrak hidup di paket, transaksi hidup di lokasi,
 * dan tidak ada satu layar pun yang menyandingkannya.
 *
 * TIDAK ADA formula baru di berkas ini, dan tidak ada tabel baru. Seluruh
 * angka datang dari calculation layer yang sudah ada — `finance/calc.ts`
 * untuk uang dan `progress.ts` untuk nilai terpasang (CLAUDE.md §7). Yang
 * dikerjakan di sini hanya MENJUMLAHKAN per-lokasi ke tingkat paket, dan
 * penjumlahan bukan formula: ia tidak bisa berselisih dengan sumbernya karena
 * tidak menghitung apa pun sendiri.
 */

export type PackageFinance = {
  /** Nilai kontrak berjalan (kontrak + Σ adendum), inklusif PPN. */
  contractValue: bigint;
  ppnPercent: number;

  /** Σ pagu yang dialokasikan ke lokasi-lokasi paket ini. */
  budgetTotal: bigint;
  /** Σ komitmen disetujui yang belum terealisasi/ditutup. */
  commitmentOpen: bigint;
  /** Σ pengeluaran disetujui. */
  expenseApproved: bigint;
  /** Σ sisa pagu (pagu − pengeluaran − komitmen terbuka). */
  availableBudget: bigint;
  /** Σ invoice disetujui yang belum lunas. */
  outstandingPayable: bigint;

  /** Nilai terpasang DILAPORKAN, pra-PPN — level counted, bukan terverifikasi. */
  installedReportedPreTax: bigint;
  /** Σ tagihan ke owner yang sudah diajukan (atau lebih). */
  billed: bigint;
  /** Σ pencairan diterima dari owner. */
  disbursed: bigint;
  /** Retensi yang ditahan owner. */
  retentionHeld: bigint;
  /**
   * Pekerjaan terpasang yang BELUM ditagihkan ke owner (inkl. PPN).
   * Dihitung `unbilledWork()` dari calculation layer, bukan di sini.
   */
  unbilled: bigint;

  /** Rincian per lokasi — supaya angka paket bisa ditelusuri ke pembentuknya. */
  perLokasi: {
    locationId: string;
    name: string;
    slug: string;
    budgetTotal: bigint;
    expenseApproved: bigint;
    commitmentOpen: bigint;
    availableBudget: bigint;
    outstandingPayable: bigint;
    installedReportedPreTax: bigint;
  }[];
};

/**
 * Rakit keuangan satu paket. `null` bila paketnya tidak ada / di luar scope —
 * pemanggil sudah memagari akses lewat `getPackageWorkspace`.
 */
export async function getPackageFinance(packageId: string): Promise<PackageFinance | null> {
  const pkg = await db.package.findUnique({
    where: { id: packageId },
    select: {
      locations: { select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } },
      contract: {
        select: {
          id: true,
          contractValue: true,
          ppnPercent: true,
          amendments: { select: { valueDelta: true } },
        },
      },
    },
  });
  if (!pkg) return null;

  const locIds = pkg.locations.map((l) => l.id);
  const [finance, progress, billing] = await Promise.all([
    getLocationsFinance(locIds),
    getLocationsProgress(locIds),
    pkg.contract ? getContractsBilling([pkg.contract.id]) : Promise.resolve(new Map()),
  ]);

  let budgetTotal = 0n;
  let commitmentOpen = 0n;
  let expenseApproved = 0n;
  let availableBudget = 0n;
  let outstandingPayable = 0n;
  let installedReportedPreTax = 0n;

  const perLokasi: PackageFinance["perLokasi"] = [];
  for (const l of pkg.locations) {
    const f = finance.get(l.id);
    const p = progress.get(l.id);
    // Lokasi tanpa transaksi TETAP didaftar dengan nol, bukan dilewati:
    // daftar yang menyembunyikan lokasi bernilai nol membuat "kenapa lokasi
    // saya tidak ada di sini" jadi pertanyaan yang tak terjawab di layar.
    const row = {
      locationId: l.id,
      name: l.name,
      slug: l.slug,
      budgetTotal: f?.budgetTotal ?? 0n,
      expenseApproved: f?.expenseApproved ?? 0n,
      commitmentOpen: f?.commitmentOpen ?? 0n,
      availableBudget: f?.availableBudget ?? 0n,
      outstandingPayable: f?.outstandingPayable ?? 0n,
      installedReportedPreTax: p?.realizedValue ?? 0n,
    };
    perLokasi.push(row);

    budgetTotal += row.budgetTotal;
    expenseApproved += row.expenseApproved;
    commitmentOpen += row.commitmentOpen;
    availableBudget += row.availableBudget;
    outstandingPayable += row.outstandingPayable;
    installedReportedPreTax += row.installedReportedPreTax;
  }

  const contractValue = pkg.contract
    ? runningContractValue(pkg.contract.contractValue, pkg.contract.amendments)
    : 0n;
  // `ppnPercent` disimpan Decimal(5,2) di Prisma — dinormalkan ke number di
  // batas modul ini supaya pemanggil tidak perlu tahu bentuk penyimpanannya.
  const ppnPercent = pkg.contract ? Number(pkg.contract.ppnPercent) : 0;
  const b = pkg.contract ? billing.get(pkg.contract.id) : undefined;
  const billed = b?.billed ?? 0n;

  return {
    contractValue,
    ppnPercent,
    budgetTotal,
    commitmentOpen,
    expenseApproved,
    availableBudget,
    outstandingPayable,
    installedReportedPreTax,
    billed,
    disbursed: b?.disbursed ?? 0n,
    retentionHeld: b?.retentionHeld ?? 0n,
    unbilled: unbilledWork(installedReportedPreTax, billed, ppnPercent),
    perLokasi,
  };
}
