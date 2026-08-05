import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banner, Card, CardBody, CardHeader, KpiCard, PageHeader, ProgressBar } from "@/components/ui";
import { requireUser, hasLocationAccess } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  financeSummary,
  latestBudgetByCategory,
  listCommitments,
  listExpenses,
  listInvoices,
  listOwnerBillings,
  listVendors,
} from "@/lib/finance/queries";
import { formatPct, formatRupiah, formatRupiahShort, jakartaDateKey } from "@/lib/format";
import { pct } from "@/lib/money";
import { COMMITMENT_TYPE_LABEL, COST_CATEGORIES } from "@/app/(app)/pengendalian/keuangan/finance-ui";
import {
  BillingSection,
  BudgetSection,
  CommitmentSection,
  ExpenseSection,
  InvoiceSection,
  type BillingRowUI,
  type BudgetRowUI,
  type CommitmentOption,
  type CommitmentRowUI,
  type ExpenseRowUI,
  type InvoiceRowUI,
} from "./lokasi-keuangan-client";

export const metadata: Metadata = { title: "Keuangan Lokasi" };
export const dynamic = "force-dynamic";

export default async function LokasiKeuanganPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  requireCapabilityPage(user.role, "finance.view");

  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      province: true,
      package: {
        select: {
          name: true,
          contract: { select: { id: true, contractNumber: true, contractValue: true } },
          locations: { select: { id: true } },
        },
      },
    },
  });
  if (!location) notFound();
  if (!(await hasLocationAccess(user, location.id))) notFound();

  const canInput = can(user.role, "finance.input");
  const canApprove = can(user.role, "finance.approve");
  const contract = location.package.contract;

  const [summaryMap, budget, commitments, expenses, invoices, vendors, billings] = await Promise.all([
    financeSummary([location.id]),
    latestBudgetByCategory(location.id),
    listCommitments(location.id),
    listExpenses(location.id),
    listInvoices(location.id),
    listVendors(user.orgId),
    contract ? listOwnerBillings(contract.id) : Promise.resolve([]),
  ]);
  const s = summaryMap.get(location.id);
  const budgetTotal = s?.budgetTotal ?? 0n;
  const expenseApproved = s?.expenseApproved ?? 0n;
  // BUKAN progress fisik. Ini serapan BIAYA terhadap budget — besaran yang
  // berbeda dari `realizedPct` di lib/progress.ts. Dinamai & dilabeli berbeda
  // supaya dua angka ini tidak pernah dibandingkan di rapat (audit 2026-07-27, H4).
  const serapanBiayaPct = pct(expenseApproved, budgetTotal);
  const today = jakartaDateKey(new Date());

  // ── Serialisasi untuk client components (BigInt → string, Date → ISO) ──
  const budgetRows: BudgetRowUI[] = COST_CATEGORIES.map((category) => {
    const b = budget.get(category);
    return { category, amount: b ? b.amount.toString() : null, note: b?.note ?? null };
  });

  const commitmentRows: CommitmentRowUI[] = commitments.map((c) => ({
    id: c.id,
    type: c.type,
    number: c.number,
    description: c.description,
    category: c.category,
    amount: c.amount.toString(),
    realizedAmount: c.realizedAmount.toString(),
    dueDate: c.dueDate?.toISOString() ?? null,
    status: c.status,
    closedAt: c.closedAt?.toISOString() ?? null,
    vendorName: c.vendor?.name ?? null,
  }));

  // Komitmen terbuka (disetujui, belum ditutup, masih ada sisa) untuk form realisasi
  const openCommitments: CommitmentOption[] = commitments
    .filter((c) => c.status === "disetujui" && c.closedAt === null && c.realizedAmount < c.amount)
    .map((c) => ({
      id: c.id,
      label: `${c.number} · ${COMMITMENT_TYPE_LABEL[c.type]} — sisa ${formatRupiah(Number(c.amount - c.realizedAmount))}`,
    }));

  // Komitmen disetujui (terbuka) untuk form invoice
  const invoiceCommitments: CommitmentOption[] = commitments
    .filter((c) => c.status === "disetujui" && c.closedAt === null)
    .map((c) => ({
      id: c.id,
      label: `${c.number} · ${COMMITMENT_TYPE_LABEL[c.type]}${c.vendor ? ` — ${c.vendor.name}` : ""}`,
    }));

  const expenseRows: ExpenseRowUI[] = expenses.map((e) => ({
    id: e.id,
    category: e.category,
    amount: e.amount.toString(),
    txDate: e.txDate.toISOString(),
    description: e.description,
    status: e.status,
    commitmentNumber: e.commitment?.number ?? null,
  }));

  /*
   * APPROVAL-FIRST (fase 5 redesign, PRD §5.5).
   *
   * Halaman ini mengurutkan dirinya menurut struktur data — budget, komitmen,
   * realisasi, invoice, penagihan — bukan menurut apa yang harus DIPUTUSKAN.
   * Bagi approver, satu-satunya alasan membuka halaman ini biasanya adalah ada
   * yang menunggu tanda tangannya, dan itu tersebar di tiga kartu berbeda yang
   * masing-masing harus digulir dan dibaca statusnya satu per satu.
   *
   * Angkanya dihitung dari baris yang SUDAH diambil di atas — tidak ada kueri
   * tambahan, dan tidak ada formula baru: statusnya sudah ada di datanya.
   */
  const menungguKomitmen = commitments.filter((c) => c.status === "diajukan");
  const menungguBiaya = expenses.filter((e) => e.status === "diajukan");
  const nilaiMenunggu =
    menungguKomitmen.reduce((t, c) => t + c.amount, 0n) +
    menungguBiaya.reduce((t, e) => t + e.amount, 0n);
  const jumlahMenunggu = menungguKomitmen.length + menungguBiaya.length;

  const invoiceRows: InvoiceRowUI[] = invoices.map((i) => ({
    id: i.id,
    number: i.number,
    amount: i.amount.toString(),
    paidTotal: i.paidTotal.toString(),
    invoiceDate: i.invoiceDate.toISOString(),
    dueDate: i.dueDate?.toISOString() ?? null,
    status: i.status,
    commitmentNumber: i.commitment?.number ?? null,
    vendorName: i.commitment?.vendor?.name ?? null,
  }));

  const billingRows: BillingRowUI[] = billings.map((b) => ({
    id: b.id,
    terminNo: b.terminNo,
    description: b.description,
    amount: b.amount.toString(),
    retentionHeld: b.retentionHeld.toString(),
    disbursedTotal: b.disbursedTotal.toString(),
    billedDate: b.billedDate?.toISOString() ?? null,
    status: b.status,
  }));

  const multiLocation = location.package.locations.length > 1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={location.package.name}
        title={`Keuangan — ${location.name}`}
        description={location.province}
        breadcrumb={[{ label: "Keuangan", href: "/pengendalian/keuangan" }, { label: location.name }]}
      />

      {/*
       * Ditaruh SEBELUM KPI dan seluruh kartu lain: yang menunggu keputusan
       * adalah satu-satunya hal di halaman ini yang berhenti bergerak sampai
       * seseorang bertindak. KPI menjelaskan keadaan; ini meminta tindakan.
       */}
      {jumlahMenunggu > 0 ? (
        <Card className="border-warning-border">
          <CardHeader
            title={
              canApprove
                ? `Menunggu keputusan Anda (${jumlahMenunggu})`
                : `Menunggu persetujuan (${jumlahMenunggu})`
            }
            subtitle={
              canApprove
                ? `Total ${formatRupiah(nilaiMenunggu)} tertahan sampai diputuskan. Persetujuannya ada di kartu masing-masing di bawah.`
                : // Jangan menyuruh orang menekan tombol yang tidak akan muncul
                  // untuknya — itu membuat halaman terasa rusak, bukan terbatas.
                  `Total ${formatRupiah(nilaiMenunggu)} menunggu approver. Anda bisa melihatnya, tetapi tidak menyetujuinya.`
            }
          />
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {menungguKomitmen.length > 0 ? (
                <li className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink">
                    {menungguKomitmen.length} komitmen (PO / kontrak vendor / kasbon)
                  </span>
                  <span className="tabular text-ink-muted">
                    {formatRupiah(menungguKomitmen.reduce((t, c) => t + c.amount, 0n))}
                  </span>
                </li>
              ) : null}
              {menungguBiaya.length > 0 ? (
                <li className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink">{menungguBiaya.length} realisasi biaya</span>
                  <span className="tabular text-ink-muted">
                    {formatRupiah(menungguBiaya.reduce((t, e) => t + e.amount, 0n))}
                  </span>
                </li>
              ) : null}
            </ul>
            <p className="mt-2 text-[13px] text-ink-muted">
              Komitmen yang belum disetujui <strong className="font-medium text-ink">belum</strong>{" "}
              mengikat available budget, dan biaya yang belum disetujui belum masuk serapan — jadi
              angka di atas belum tercermin di KPI mana pun.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6" aria-label="Ringkasan keuangan lokasi">
        <KpiCard label="Budget" value={formatRupiahShort(budgetTotal)} />
        <KpiCard label="Serapan Biaya" value={formatRupiahShort(expenseApproved)} sub={formatPct(serapanBiayaPct)} />
        <KpiCard label="Komitmen terbuka" value={formatRupiahShort(s?.commitmentOpen ?? 0n)} />
        <KpiCard
          label="Available budget"
          value={formatRupiahShort(s?.availableBudget ?? 0n)}
          tone={(s?.availableBudget ?? 0n) < 0n ? "danger" : "default"}
          sub={(s?.availableBudget ?? 0n) < 0n ? "melebihi budget" : undefined}
        />
        <KpiCard label="Outstanding payable" value={formatRupiahShort(s?.outstandingPayable ?? 0n)} />
        <KpiCard label="Terpasang" value={formatRupiahShort(s?.installedValue ?? 0n)} sub="dilaporkan — belum tentu terverifikasi" />
      </section>

      <Card>
        <CardBody>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-ink">Serapan biaya vs budget</span>
            <span className="tabular text-ink-muted">
              {formatRupiah(expenseApproved)} / {formatRupiah(budgetTotal)} ({formatPct(serapanBiayaPct)})
            </span>
          </div>
          <ProgressBar
            value={serapanBiayaPct}
            label="Serapan biaya vs budget"
            tone={serapanBiayaPct > 100 ? "danger" : serapanBiayaPct > 90 ? "warning" : "primary"}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Budget per kategori"
          subtitle="Nilai berlaku = baris disetujui terbaru per kategori. Perubahan hanya oleh approver."
        />
        <CardBody>
          <BudgetSection locationId={location.id} rows={budgetRows} canApprove={canApprove} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Komitmen"
          subtitle="PO, kontrak vendor, kasbon — diajukan saat dibuat, mengikat available budget setelah disetujui."
        />
        <CardBody>
          <CommitmentSection
            locationId={location.id}
            rows={commitmentRows}
            vendors={vendors.map((v) => v.name)}
            canInput={canInput}
            canApprove={canApprove}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Realisasi Biaya"
          subtitle="Pengeluaran aktual — termasuk settlement kasbon (pilih komitmen terbuka)."
        />
        <CardBody>
          <ExpenseSection
            locationId={location.id}
            rows={expenseRows}
            openCommitments={openCommitments}
            canInput={canInput}
            canApprove={canApprove}
            today={today}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Invoice vendor" subtitle="Tagihan masuk dari vendor + pembayaran keluar (bisa parsial)." />
        <CardBody>
          <InvoiceSection
            locationId={location.id}
            rows={invoiceRows}
            commitments={invoiceCommitments}
            canInput={canInput}
            canApprove={canApprove}
            today={today}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Penagihan owner"
          subtitle={
            contract
              ? `Kontrak ${contract.contractNumber} — nilai ${formatRupiah(contract.contractValue)}`
              : "Termin tagihan ke owner (KKP) per kontrak."
          }
        />
        <CardBody>
          {contract ? (
            <>
              {multiLocation ? (
                <Banner
                  tone="info"
                  title="Termin level kontrak"
                  description={`Kontrak paket ini mencakup ${location.package.locations.length} lokasi — termin di bawah berlaku untuk seluruh paket, bukan hanya lokasi ini.`}
                  className="mb-3"
                />
              ) : null}
              <BillingSection
                contractId={contract.id}
                rows={billingRows}
                canInput={canInput}
                canApprove={canApprove}
                today={today}
              />
            </>
          ) : (
            <p className="text-sm text-ink-muted">Paket lokasi ini belum punya kontrak — penagihan owner belum bisa dibuat.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
