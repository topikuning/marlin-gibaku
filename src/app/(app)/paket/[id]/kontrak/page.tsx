import type { Metadata } from "next";
import { PelaksanaForm } from "@/components/knmp/pelaksana-form";
import { notFound } from "next/navigation";
import { FileSignature } from "lucide-react";
import {
  Banner,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  EmptyState,
  MiniStat,
} from "@/components/ui";
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
import {
  AmendmentForm,
  ConvertContractForm,
  EditContractForm,
  SignatoriesForm,
  TtdStempelForm,
} from "./kontrak-forms";
import { presignKeys } from "@/lib/photos";
import { AmendmentDocUpload } from "./amendment-doc-upload";
import { AksiTile } from "./aksi-tile";

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
  const canEditContract = can(user.role, "contract.edit");

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

  // Pratinjau tanda tangan & stempel (DECISIONS 328). Satu kali presign untuk
  // tujuh kunci sekaligus; yang belum diunggah tidak ikut diminta.
  const kunciTtd = [
    contract.ppkTtdKey,
    contract.ppkStempelKey,
    contract.supervisorTtdKey,
    contract.supervisorStempelKey,
    contract.contractorTtdKey,
    contract.contractorStempelKey,
    contract.vendor.stempelKey,
    pkg.pelaksanaTtdKey,
    pkg.pelaksanaStempelKey,
  ].filter((k): k is string => !!k);
  const urlsTtd = kunciTtd.length > 0 ? await presignKeys(kunciTtd) : new Map<string, string>();
  const urlTtd = (k: string | null) => (k ? (urlsTtd.get(k) ?? null) : null);


  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Kontrak berjalan"
          subtitle={contract.contractNumber}
          action={
            pkg.stage === "kontrak" && canContract ? (
              <StartPelaksanaanButton packageId={pkg.id} />
            ) : null
          }
        />
        <CardBody className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <MiniStat label="Vendor" value={contract.vendor.name} />
            <MiniStat
              label="Nilai awal (inkl. PPN)"
              value={formatRupiah(contract.contractValue)}
            />
            <MiniStat
              label="Nilai berjalan"
              value={formatRupiah(running)}
              sub={
                contract.amendments.length > 0
                  ? `termasuk ${contract.amendments.length} adendum`
                  : "belum ada adendum"
              }
            />
            <MiniStat label="PPN" value={formatPct(Number(contract.ppnPercent))} />
            <MiniStat
              label="Uang muka"
              value={
                contract.advancePercent != null
                  ? formatPct(Number(contract.advancePercent))
                  : "–"
              }
            />
            <MiniStat
              label="Retensi"
              value={
                contract.retentionPercent != null
                  ? formatPct(Number(contract.retentionPercent))
                  : "–"
              }
            />
            <MiniStat label="Tanda tangan kontrak" value={formatTanggal(contract.signedDate)} />
            <MiniStat
              label="Masa pelaksanaan"
              value={`${contract.durationDays} hari`}
              sub="hari kalender"
            />
            <MiniStat
              label="Mulai (SPMK)"
              value={
                contract.startDate ? (
                  formatTanggal(contract.startDate)
                ) : (
                  <span className="text-ink-muted italic">Belum terbit</span>
                )
              }
              /* SPMK sudah dicatat tapi paket masih Kontrak = tanggalnya belum
                 tiba. Tanpa keterangan ini, tanggal yang tampil terbaca seolah
                 pelaksanaan sudah jalan (DECISIONS 202). */
              sub={
                contract.startDate && pkg.stage === "kontrak" ? (
                  <span className="text-warning">terjadwal, pelaksanaan belum dimulai</span>
                ) : undefined
              }
            />
            <MiniStat
              label={`Selesai${endRunning && contract.amendments.length > 0 ? " (+adendum)" : ""}`}
              value={
                endRunning ? (
                  formatTanggal(endRunning)
                ) : (
                  <span className="text-ink-muted italic">Menunggu SPMK</span>
                )
              }
            />
          </div>
          {contract.workTitle ? (
            <p className="text-[13px] text-ink-muted">
              Pekerjaan: <span className="text-ink">{contract.workTitle}</span>
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/*
        Empat pekerjaan kontrak yang JARANG dilakukan. Sebelumnya keempat
        formnya terbuka sekaligus di bawah ringkasan, sehingga ringkasan yang
        justru dibaca berulang terdorong hilang dari layar. Sekarang tetap di
        halaman yang sama, hanya di belakang satu klik.
      */}
      <div className="grid gap-2 sm:grid-cols-2">
        {canAmend ? (
          <AksiTile
            judul="Adendum kontrak (CCO)"
            penjelasan="Perubahan RESMI nilai dan/atau waktu. Riwayatnya append-only; revisi RAB lokasi tetap dilakukan di modul RAB."
            aksi={
              <Drawer
                trigger="Catat adendum"
                triggerVariant="primary"
                title="Catat adendum kontrak (CCO)"
                subtitle="Append-only – revisi RAB lokasi terkait dilakukan di modul RAB."
              >
                <AmendmentForm contractId={contract.id} />
              </Drawer>
            }
          />
        ) : null}

        {canEditContract ? (
          <AksiTile
            judul="Koreksi data kontrak"
            penjelasan="Khusus membetulkan SALAH INPUT – bukan pengganti adendum. Bila masa pelaksanaan / SPMK ikut berubah, kurva-S semua lokasi dihitung ulang otomatis."
            aksi={
              <Drawer
                trigger="Koreksi data"
                title="Koreksi kontrak (Super Admin)"
                subtitle="Betulkan data kontrak termasuk WAKTU. Berbeda dari adendum, yang mencatat perubahan resmi."
              >
                <EditContractForm
                  packageId={pkg.id}
                  initial={{
                    packageName: pkg.name,
                    packageNumber: pkg.packageNumber ?? "",
                    workTitle: contract.workTitle ?? "",
                    contractNumber: contract.contractNumber,
                    contractValue: String(contract.contractValue),
                    ppnPercent: Number(contract.ppnPercent),
                    signedDate: contract.signedDate.toISOString().slice(0, 10),
                    durationDays: contract.durationDays,
                    startDate: contract.startDate
                      ? contract.startDate.toISOString().slice(0, 10)
                      : "",
                  }}
                />
              </Drawer>
            }
          />
        ) : null}

        <AksiTile
          judul="Penanda tangan dokumen KKP"
          penjelasan={
            canContract
              ? "Nama PPK, Konsultan Pengawas, dan Penyedia yang tercetak pada blok tanda tangan laporan."
              : "Nama yang tercetak pada blok tanda tangan laporan. Hanya pengelola kontrak yang boleh mengubahnya."
          }
          aksi={
            <Drawer
              trigger={canContract ? "Kelola nama" : "Lihat nama"}
              title="Penanda tangan dokumen KKP"
              subtitle="Nama tercetak di blok tanda tangan laporan – bisa diganti bila ada pergantian personel."
            >
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
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-ink-muted">PPK</dt>
                    <dd className="font-medium text-ink">{contract.ppkName || "–"}</dd>
                    {contract.ppkNip ? (
                      <dd className="text-xs text-ink-muted">NIP. {contract.ppkNip}</dd>
                    ) : null}
                  </div>
                  <div>
                    <dt className="text-ink-muted">Konsultan Pengawas</dt>
                    <dd className="font-medium text-ink">{contract.supervisorName || "–"}</dd>
                    {contract.supervisorFirm ? (
                      <dd className="text-xs text-ink-muted">{contract.supervisorFirm}</dd>
                    ) : null}
                  </div>
                  <div>
                    <dt className="text-ink-muted">Penyedia / Pelaksana</dt>
                    <dd className="font-medium text-ink">
                      {contract.contractorSignerName || "–"}
                    </dd>
                    {contract.contractorSignerTitle ? (
                      <dd className="text-xs text-ink-muted">{contract.contractorSignerTitle}</dd>
                    ) : null}
                  </div>
                </dl>
              )}
            </Drawer>
          }
        />

        {canContract ? (
          <AksiTile
            judul="Tanda tangan & stempel"
            penjelasan="Gambar OPSIONAL yang ditempel pada laporan cetak. Kosongkan bila laporan tetap ditandatangani dengan pena."
            aksi={
              <Drawer
                trigger="Kelola gambar"
                title="Tanda tangan & stempel untuk laporan cetak"
                subtitle="Ditempel otomatis pada laporan harian, rencana mingguan, laporan periodik & lembar kurva-S yang dicetak."
              >
                <TtdStempelForm
                  contractId={contract.id}
                  gambar={{
                    ppkTtdUrl: urlTtd(contract.ppkTtdKey),
                    ppkStempelUrl: urlTtd(contract.ppkStempelKey),
                    supervisorTtdUrl: urlTtd(contract.supervisorTtdKey),
                    supervisorStempelUrl: urlTtd(contract.supervisorStempelKey),
                    contractorTtdUrl: urlTtd(contract.contractorTtdKey),
                    contractorStempelUrl: urlTtd(contract.contractorStempelKey),
                    vendorStempelUrl: urlTtd(contract.vendor.stempelKey),
                    vendorName: contract.vendor.name,
                  }}
                />
              </Drawer>
            }
          />
        ) : null}

        {canContract ? (
          <AksiTile
            judul="Pelaksana Lapangan"
            penjelasan={
              pkg.pelaksanaName
                ? `${pkg.pelaksanaName} – ${pkg.pelaksanaTitle || "Pelaksana Lapangan"}. Meneken laporan harian & mingguan; bulanan, MC, dan CCO tetap Direktur.`
                : "BELUM DIISI – blok tanda tangan laporan harian & mingguan akan tercetak tanpa nama."
            }
            aksi={
              <Drawer
                trigger={pkg.pelaksanaName ? "Ubah" : "Isi sekarang"}
                title="Pelaksana Lapangan paket ini"
                subtitle="Meneken laporan HARIAN dan MINGGUAN. Laporan bulanan, MC, dan CCO tetap diteken Direktur (penanda tangan kontrak)."
              >
                <PelaksanaForm
                  sasaran="paket"
                  id={pkg.id}
                  nama={pkg.pelaksanaName}
                  jabatan={pkg.pelaksanaTitle}
                  ttdUrl={urlTtd(pkg.pelaksanaTtdKey)}
                  stempelUrl={urlTtd(pkg.pelaksanaStempelKey)}
                />
              </Drawer>
            }
          />
        ) : null}
      </div>

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
                  <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                    <th className="py-2 pr-3">Nomor CCO</th>
                    <th className="py-2 pr-3 text-right">Perubahan nilai</th>
                    <th className="py-2 pr-3 text-right">Waktu</th>
                    <th className="py-2 pr-3">Berlaku</th>
                    <th className="py-2 pr-3">Alasan</th>
                    <th className="py-2">Dokumen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contract.amendments.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 pr-3 font-medium text-ink">{a.ccoNumber}</td>
                      <td
                        className={`tabular py-2 pr-3 text-right ${a.valueDelta < 0n ? "text-danger" : a.valueDelta > 0n ? "text-success" : "text-ink"}`}
                      >
                        {a.valueDelta > 0n ? "+" : ""}
                        {formatRupiah(a.valueDelta)}
                      </td>
                      <td className="tabular py-2 pr-3 text-right">
                        {a.endDateDelta > 0 ? "+" : ""}
                        {a.endDateDelta} hari
                      </td>
                      <td className="py-2 pr-3">{formatTanggal(a.effectiveDate)}</td>
                      <td className="py-2 pr-3 text-ink-muted">{a.reason}</td>
                      <td className="py-2">
                        <span className="flex flex-wrap items-center gap-2">
                          {a.documents.map((doc) => (
                            <a
                              key={doc.id}
                              href={`/api/documents/${doc.id}`}
                              className="text-[12px] font-medium text-primary hover:underline"
                              target="_blank"
                            >
                              {doc.title}
                            </a>
                          ))}
                          {canAmend ? (
                            <AmendmentDocUpload
                              packageId={pkg.id}
                              contractId={contract.id}
                              amendmentId={a.id}
                              ccoNumber={a.ccoNumber}
                            />
                          ) : null}
                        </span>
                      </td>
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
