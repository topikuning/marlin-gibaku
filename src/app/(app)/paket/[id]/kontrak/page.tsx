import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileSignature } from "lucide-react";
import { Banner, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { PACKAGE_STAGE_LABEL } from "@/lib/lifecycle";
import { formatPct, formatRupiah, formatTanggal } from "@/lib/format";
import {
  getPackageWorkspace,
  listVendors,
  runningContractValue,
  runningEndDate,
} from "@/lib/package/queries";
import { StartPelaksanaanButton } from "../stage-actions";
import { AmendmentForm, ConvertContractForm, SignatoriesForm } from "./kontrak-forms";

export const metadata: Metadata = { title: "Kontrak & Adendum" };
export const dynamic = "force-dynamic";

export default async function KontrakPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;

  const pkg = await getPackageWorkspace(id);
  if (!pkg) notFound();

  const contract = pkg.contract;
  const canContract = can(user.role, "contract.manage");
  const canAmend = can(user.role, "amendment.manage");

  /* ---------- Belum ada kontrak ---------- */
  if (!contract) {
    const convertible = pkg.stage === "penetapan" || pkg.stage === "kontrak";
    if (!canContract || !convertible) {
      return (
        <div className="space-y-4">
          {pkg.stage === "prospek" || pkg.stage === "tender" ? (
            <Banner
              tone="info"
              title={`Paket masih di tahap ${PACKAGE_STAGE_LABEL[pkg.stage]}.`}
              description="Konversi kontrak baru bisa dilakukan setelah paket mencapai tahap Penetapan (tab Tender & Administrasi)."
            />
          ) : null}
          <EmptyState
            icon={FileSignature}
            title="Belum ada kontrak"
            description={
              canContract
                ? "Naikkan paket ke tahap Penetapan lalu isi form konversi kontrak di sini."
                : "Konversi kontrak dilakukan oleh pemegang akses kontrak."
            }
          />
        </div>
      );
    }

    const vendors = await listVendors();
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader
            title="Konversi ke Kontrak"
            subtitle={`Vendor, nilai, dan tanggal kontrak. Semua lokasi target (${pkg.locations.length}) akan diaktifkan.`}
          />
          <CardBody>
            {pkg.locations.length === 0 ? (
              <Banner
                tone="warning"
                title="Paket belum punya lokasi target."
                description="Tambahkan minimal satu lokasi di tab Lokasi sebelum konversi kontrak."
                className="mb-4"
              />
            ) : null}
            <ConvertContractForm
              packageId={pkg.id}
              vendors={vendors}
              defaultVendorName={pkg.candidateVendorName ?? ""}
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  /* ---------- Kontrak sudah ada ---------- */
  const running = runningContractValue(contract.contractValue, contract.amendments);
  const endRunning = runningEndDate(contract.endDate, contract.amendments);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Detail kontrak" subtitle={contract.contractNumber} />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-muted">Vendor</dt>
                <dd className="font-medium text-ink">{contract.vendor.name}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Nilai kontrak (inkl. PPN)</dt>
                <dd className="tabular font-medium text-ink">
                  {formatRupiah(contract.contractValue)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Nilai berjalan (+adendum)</dt>
                <dd className="tabular font-semibold text-primary">{formatRupiah(running)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">PPN</dt>
                <dd className="tabular font-medium text-ink">
                  {formatPct(Number(contract.ppnPercent))}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Uang muka</dt>
                <dd className="tabular font-medium text-ink">
                  {contract.advancePercent != null
                    ? formatPct(Number(contract.advancePercent))
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Retensi</dt>
                <dd className="tabular font-medium text-ink">
                  {contract.retentionPercent != null
                    ? formatPct(Number(contract.retentionPercent))
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Tanda tangan kontrak</dt>
                <dd className="font-medium text-ink">{formatTanggal(contract.signedDate)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Masa pelaksanaan</dt>
                <dd className="font-medium text-ink">{contract.durationDays} hari kalender</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Mulai (SPMK)</dt>
                <dd className="font-medium text-ink">
                  {contract.startDate ? (
                    formatTanggal(contract.startDate)
                  ) : (
                    <span className="text-ink-muted italic">Belum terbit</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Selesai {endRunning ? "(+adendum)" : ""}</dt>
                <dd className="font-medium text-ink">
                  {endRunning ? (
                    formatTanggal(endRunning)
                  ) : (
                    <span className="text-ink-muted italic">Menunggu SPMK</span>
                  )}
                </dd>
              </div>
            </dl>

            {pkg.stage === "kontrak" && canContract ? (
              <div className="mt-4 border-t border-border pt-4">
                <StartPelaksanaanButton packageId={pkg.id} />
              </div>
            ) : null}
          </CardBody>
        </Card>

        {canAmend ? (
          <Card className="self-start">
            <CardHeader
              title="Tambah adendum (CCO)"
              subtitle="Append-only — revisi RAB lokasi terkait dilakukan di modul RAB."
            />
            <CardBody>
              <AmendmentForm contractId={contract.id} />
            </CardBody>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardHeader
          title="Penanda tangan dokumen KKP"
          subtitle="Nama tercetak di blok tanda tangan laporan — bisa diganti bila ada pergantian personel."
        />
        <CardBody>
          {canContract ? (
            <SignatoriesForm
              contractId={contract.id}
              value={{
                ppkName: contract.ppkName,
                ppkNip: contract.ppkNip,
                supervisorName: contract.supervisorName,
                supervisorFirm: contract.supervisorFirm,
                contractorSignerName: contract.contractorSignerName,
                contractorSignerTitle: contract.contractorSignerTitle,
              }}
            />
          ) : (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-muted">PPK</dt>
                <dd className="font-medium text-ink">{contract.ppkName || "—"}</dd>
                {contract.ppkNip ? <dd className="text-xs text-ink-muted">NIP. {contract.ppkNip}</dd> : null}
              </div>
              <div>
                <dt className="text-ink-muted">Konsultan Pengawas</dt>
                <dd className="font-medium text-ink">{contract.supervisorName || "—"}</dd>
                {contract.supervisorFirm ? <dd className="text-xs text-ink-muted">{contract.supervisorFirm}</dd> : null}
              </div>
              <div>
                <dt className="text-ink-muted">Penyedia / Pelaksana</dt>
                <dd className="font-medium text-ink">{contract.contractorSignerName || "—"}</dd>
                {contract.contractorSignerTitle ? <dd className="text-xs text-ink-muted">{contract.contractorSignerTitle}</dd> : null}
              </div>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Riwayat adendum"
          subtitle={`${contract.amendments.length} adendum tercatat`}
        />
        <CardBody>
          {contract.amendments.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada adendum.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="py-2 pr-3">Nomor CCO</th>
                    <th className="py-2 pr-3 text-right">Perubahan nilai</th>
                    <th className="py-2 pr-3 text-right">Waktu</th>
                    <th className="py-2 pr-3">Berlaku</th>
                    <th className="py-2">Alasan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contract.amendments.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 pr-3 font-medium text-ink">{a.ccoNumber}</td>
                      <td
                        className={`py-2 pr-3 text-right tabular ${a.valueDelta < 0n ? "text-danger" : a.valueDelta > 0n ? "text-success" : "text-ink"}`}
                      >
                        {a.valueDelta > 0n ? "+" : ""}
                        {formatRupiah(a.valueDelta)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular">
                        {a.endDateDelta > 0 ? "+" : ""}
                        {a.endDateDelta} hari
                      </td>
                      <td className="py-2 pr-3">{formatTanggal(a.effectiveDate)}</td>
                      <td className="py-2 text-ink-muted">{a.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
