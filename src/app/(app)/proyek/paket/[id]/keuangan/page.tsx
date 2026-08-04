import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState, KpiCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getPackageWorkspace } from "@/lib/package/queries";
import { getPackageFinance } from "@/lib/finance/package-calc";
import { formatRupiah, formatRupiahShort } from "@/lib/format";
import { withPpn } from "@/lib/money";

export const metadata: Metadata = { title: "Keuangan Paket" };
export const dynamic = "force-dynamic";

/**
 * KEUANGAN PAKET — gap P0 pada PRD.
 *
 * Menyandingkan rantai yang selama ini terputus di antara dua layar:
 * kontrak (hidup di paket) → alokasi pagu ke lokasi → komitmen → realisasi →
 * tagihan ke owner (hidup di lokasi / kontrak).
 *
 * Setiap angka bisa ditelusuri: tabel per lokasi di bawah adalah data
 * pembentuk ringkasan di atas, dan tiap barisnya menuju keuangan lokasinya
 * (PRD FR-CTRL-01/02).
 */
export default async function KeuanganPaketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "finance.view");
  const { id } = await params;

  const pkg = await getPackageWorkspace(id);
  if (!pkg) notFound();

  const f = await getPackageFinance(id);
  if (!f) notFound();

  if (!pkg.contract) {
    return (
      <EmptyState
        icon={Wallet}
        title="Paket belum berkontrak"
        description="Keuangan paket menampilkan rantai kontrak → alokasi → komitmen → realisasi → tagihan. Rantai itu baru punya pangkal setelah kontrak terbit."
      />
    );
  }

  // Nilai terpasang dibandingkan APEL-KE-APEL dengan nilai kontrak: kontrak
  // inklusif PPN, nilai terpasang dari calculation layer pra-PPN. Tanpa
  // penyetaraan ini persentasenya akan terbaca lebih kecil dari kenyataan.
  const installedWithPpn = withPpn(f.installedReportedPreTax, f.ppnPercent);
  const terpasangPct =
    f.contractValue > 0n ? Number((installedWithPpn * 1000n) / f.contractValue) / 10 : null;
  const tertagihPct =
    f.contractValue > 0n ? Number((f.billed * 1000n) / f.contractValue) / 10 : null;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Nilai kontrak berjalan"
          value={formatRupiahShort(f.contractValue)}
          sub={`inkl. PPN ${f.ppnPercent}% · sudah termasuk adendum`}
        />
        <KpiCard
          label="Terpasang dilaporkan"
          value={formatRupiahShort(installedWithPpn)}
          sub={
            terpasangPct != null
              ? `${terpasangPct.toLocaleString("id-ID")}% dari kontrak · level dikirim+disetujui+final`
              : "level dikirim+disetujui+final"
          }
        />
        <KpiCard
          label="Sudah ditagihkan ke owner"
          value={formatRupiahShort(f.billed)}
          sub={tertagihPct != null ? `${tertagihPct.toLocaleString("id-ID")}% dari kontrak` : undefined}
        />
        <KpiCard
          label="Terpasang belum ditagih"
          value={formatRupiahShort(f.unbilled)}
          tone={f.unbilled > 0n ? "warning" : "default"}
          sub="selisih terpasang − tagihan, inkl. PPN"
        />
      </section>

      <Card>
        <CardHeader
          title="Rantai dana paket"
          subtitle="Kontrak → alokasi pagu ke lokasi → komitmen → realisasi → tagihan owner. Seluruh angka dari calculation layer, tidak dihitung ulang di halaman ini."
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-3">
            <Sel label="Pagu dialokasikan ke lokasi" nilai={f.budgetTotal} />
            <Sel label="Komitmen terbuka" nilai={f.commitmentOpen} />
            <Sel label="Pengeluaran disetujui" nilai={f.expenseApproved} />
            <Sel label="Sisa pagu" nilai={f.availableBudget} />
            <Sel label="Utang usaha belum lunas" nilai={f.outstandingPayable} />
            <Sel label="Retensi ditahan owner" nilai={f.retentionHeld} />
          </dl>
          <p className="mt-2 text-[11.5px] text-ink-muted">
            Pencairan diterima dari owner: <b className="tabular">{formatRupiah(f.disbursed)}</b>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Rincian per lokasi"
          subtitle="Data pembentuk ringkasan di atas — buka lokasinya untuk melihat transaksinya."
        />
        <CardBody>
          {f.perLokasi.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Paket belum punya lokasi"
              description="Alokasi pagu dan transaksi keuangan menempel pada lokasi, jadi rinciannya baru muncul setelah lokasi ditambahkan."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] tracking-wide text-ink-faint uppercase">
                    <th className="py-2 pr-3 font-semibold">Lokasi</th>
                    <th className="py-2 pr-3 text-right font-semibold">Pagu</th>
                    <th className="py-2 pr-3 text-right font-semibold">Komitmen</th>
                    <th className="py-2 pr-3 text-right font-semibold">Pengeluaran</th>
                    <th className="py-2 pr-3 text-right font-semibold">Sisa pagu</th>
                    <th className="py-2 text-right font-semibold">Terpasang</th>
                  </tr>
                </thead>
                <tbody>
                  {f.perLokasi.map((l) => (
                    <tr key={l.locationId} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/proyek/lokasi/${l.slug}/keuangan`}
                          className="font-medium text-primary hover:underline"
                        >
                          {l.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-right tabular">{formatRupiahShort(l.budgetTotal)}</td>
                      <td className="py-2 pr-3 text-right tabular">{formatRupiahShort(l.commitmentOpen)}</td>
                      <td className="py-2 pr-3 text-right tabular">{formatRupiahShort(l.expenseApproved)}</td>
                      <td className="py-2 pr-3 text-right tabular">{formatRupiahShort(l.availableBudget)}</td>
                      <td className="py-2 text-right tabular">
                        {formatRupiahShort(l.installedReportedPreTax)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11.5px] text-ink-muted">
                Kolom “Terpasang” pra-PPN (sesuai calculation layer); ringkasan di atas disetarakan
                inkl. PPN agar sebanding dengan nilai kontrak.
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Sel({ label, nilai }: { label: string; nilai: bigint }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="text-[10px] font-semibold tracking-wide text-ink-faint uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular">{formatRupiah(nilai)}</dd>
    </div>
  );
}
