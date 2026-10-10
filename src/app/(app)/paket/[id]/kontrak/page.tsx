import type { Metadata } from "next";
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
import { formatPct, formatRupiah, formatTanggal, jakartaDateKey } from "@/lib/format";
import { adendumTertunda } from "@/lib/package/aktivasi-adendum";
import {
  getPackageWorkspace,
  listVendors,
  runningContractValue,
  runningEndDate,
} from "@/lib/package/queries";
import { StartPelaksanaanButton } from "../stage-actions";
import {
  AktivasiAdendumForm,
  type ItemAdendumForm,
  ConvertContractForm,
  EditContractForm,
  WeekModeForm,
  SignatoriesForm,
  TtdStempelForm,
} from "./kontrak-forms";
import { presignKeys } from "@/lib/photos";
import { PERSONEL_KONTRAK } from "@/lib/laporan/penandatangan";
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
  // Mode minggu punya kapabilitasnya sendiri: PM boleh, tanpa ikut membuka
  // koreksi kontrak (DECISIONS 507).
  const canWeekMode = can(user.role, "contract.week_mode");

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
              description="Data kontrak baru bisa diisi setelah paket sampai di tahap Penetapan. Naikkan tahapnya di tab Tender & Administrasi."
            />
          ) : null}
          <EmptyState
            icon={FileSignature}
            title="Belum ada kontrak"
            description={
              canContract
                ? "Naikkan paket ke tahap Penetapan lalu isi form konversi kontrak di sini."
                : "Data kontrak diisi oleh orang yang punya akses kontrak."
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
    contract.wakilSahTtdKey,
    contract.supervisorTtdKey,
    contract.supervisorLogoKey,
    contract.supervisorStempelKey,
    contract.contractorTtdKey,
    contract.contractorStempelKey,
    contract.vendor.stempelKey,
    pkg.pelaksanaTtdKey,
    ...PERSONEL_KONTRAK.map((p) => contract[p.ttd]),
  ].filter((k): k is string => !!k);
  // Satu jam: formulir ini dibuka lama; tautan 5 menit membuat gambar yang
  // tersimpan tampil rusak (DECISIONS 634).
  const urlsTtd = kunciTtd.length > 0 ? await presignKeys(kunciTtd, 3600) : new Map<string, string>();
  const urlTtd = (k: string | null) => (k ? (urlsTtd.get(k) ?? null) : null);

  // Draft adendum yang menunggu diberlakukan (DECISIONS 613). Nilainya hanya
  // DIFORMAT di sini; selisih CCO dihitung server lewat calc layer.
  const tertunda = canAmend ? await adendumTertunda(pkg.id) : { revisi: [], lingkup: [] };
  const rp = (v: bigint | null) => (v === null ? "belum ada RAB" : formatRupiah(v));
  const itemAdendum: ItemAdendumForm[] = [
    ...tertunda.revisi.map((r) => ({
      jenis: "revisi" as const,
      id: r.revisionId,
      lokasi: r.locationName,
      href: `/lokasi/${r.locationSlug}/rab/adendum`,
      judul: r.sudahBerlaku ? `Revisi RAB #${r.revisionNo} – sudah aktif` : `Draft revisi RAB #${r.revisionNo}`,
      nilai: `RAB ${rp(r.totalAktif)} → ${formatRupiah(r.totalDraft)} (pra-PPN)`,
      lengkap: r.lengkap,
      kurang: r.kurang,
    })),
    ...tertunda.lingkup.map((l) => ({
      jenis: "lingkup" as const,
      id: l.changeId,
      lokasi: l.locationName,
      href: `/paket/${pkg.id}/lokasi`,
      judul:
        (l.kind === "cabut" ? "Cabut lokasi dari kontrak" : "Tambah lokasi ke kontrak") +
        (l.sudahBerlaku && l.effectiveDate ? ` – berlaku sejak ${formatTanggal(l.effectiveDate)}` : ""),
      nilai:
        l.kind === "cabut"
          ? `Seluruh RAB keluar: ${rp(l.totalAktif)} (pra-PPN)`
          : `RAB masuk: ${rp(l.totalAktif)} (pra-PPN)`,
      lengkap: l.lengkap,
      kurang: l.kurang,
    })),
  ];
  const siap = itemAdendum.filter((i) => i.lengkap).length;


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
            penjelasan={
              itemAdendum.length === 0
                ? "Tidak ada perubahan yang menunggu nomor CCO. Revisi RAB dan cabut/tambah lokasi yang sudah disetujui muncul di sini untuk dicatat nomor CCO-nya."
                : `${siap} perubahan siap dicatat dalam CCO` +
                  (itemAdendum.length > siap ? `, ${itemAdendum.length - siap} masih menunggu persetujuan` : "") +
                  ". Perubahan sudah berlaku begitu dua persetujuan lengkap. Di sini tinggal mencatat nomor CCO dan nilainya."
            }
            aksi={
              <Drawer
                trigger="Catat CCO"
                triggerVariant="primary"
                title="Catat adendum kontrak (CCO)"
                subtitle="Centang perubahan yang masuk CCO ini. Nilainya diambil dari RAB."
              >
                <AktivasiAdendumForm
                  packageId={pkg.id}
                  items={itemAdendum}
                  hariIni={jakartaDateKey(new Date())}
                />
              </Drawer>
            }
          />
        ) : null}

        {canWeekMode ? (
          <AksiTile
            judul="Periode minggu laporan"
            penjelasan="Batas tanggal M1–MN di laporan mingguan, kurva-S, dan blanko harian. Kalau diganti, jadwal & kurva-S SEMUA lokasi paket ini ikut disesuaikan ke pembagian minggu yang baru."
            aksi={
              <Drawer
                trigger="Ubah periode minggu"
                title="Periode minggu laporan"
                subtitle="Berlaku untuk seluruh lokasi paket ini."
              >
                <WeekModeForm packageId={pkg.id} weekMode={contract.weekMode} />
              </Drawer>
            }
          />
        ) : null}

        {canEditContract ? (
          <AksiTile
            judul="Koreksi data kontrak"
            penjelasan="Khusus untuk membetulkan SALAH INPUT, bukan pengganti adendum. Kalau masa pelaksanaan atau SPMK ikut berubah, kurva-S semua lokasi dihitung ulang otomatis."
            aksi={
              <Drawer
                trigger="Koreksi data"
                title="Koreksi kontrak (Super Admin)"
                subtitle="Betulkan data kontrak, termasuk WAKTU. Ini bukan adendum. Perubahan resmi tetap dicatat lewat adendum."
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
              ? "Nama PPK, Wakil Sah PPK, konsultan pengawas, dan penyedia yang tercetak pada bagian tanda tangan laporan."
              : "Nama yang tercetak pada bagian tanda tangan laporan. Hanya pengelola kontrak yang boleh mengubahnya."
          }
          aksi={
            <Drawer
              trigger={canContract ? "Kelola nama" : "Lihat nama"}
              title="Penanda tangan dokumen KKP"
              subtitle="Nama yang tercetak di bagian tanda tangan laporan. Bisa diganti kalau ada pergantian personel. Tabel di bawah isian menunjukkan siapa meneken dokumen mana."
            >
              {canContract ? (
                <SignatoriesForm
                  contractId={contract.id}
                  value={{
                    ppkName: contract.ppkName,
                    ppkNip: contract.ppkNip,
                    wakilSahName: contract.wakilSahName,
                    wakilSahNip: contract.wakilSahNip,
                    supervisorName: contract.supervisorName,
                    supervisorFirm: contract.supervisorFirm,
                    contractorSignerName: contract.contractorSignerName,
                    contractorSignerTitle: contract.contractorSignerTitle,
                    pelaksanaName: pkg.pelaksanaName,
                    pelaksanaTitle: pkg.pelaksanaTitle,
                    coTeamLeaderName: contract.coTeamLeaderName,
                    teamLeaderName: contract.teamLeaderName,
                    qualitySurveyorName: contract.qualitySurveyorName,
                    projectManagerName: contract.projectManagerName,
                    siteManagerName: contract.siteManagerName,
                  }}
                />
              ) : (
                <dl className="space-y-3 text-sm">
                  {[
                    { label: "PPK", nama: contract.ppkName, sub: contract.ppkNip ? `NIP. ${contract.ppkNip}` : null },
                    {
                      label: "Wakil Sah PPK",
                      nama: contract.wakilSahName,
                      sub: contract.wakilSahNip ? `NIP. ${contract.wakilSahNip}` : null,
                    },
                    { label: "Pengawas Lapangan", nama: contract.supervisorName, sub: contract.supervisorFirm },
                    ...PERSONEL_KONTRAK.filter((p) => p.pihak === "konsultan").map((p) => ({
                      label: p.jabatan,
                      nama: contract[p.nama],
                      sub: null,
                    })),
                    { label: "Direktur", nama: contract.contractorSignerName, sub: contract.contractorSignerTitle },
                    ...PERSONEL_KONTRAK.filter((p) => p.pihak === "penyedia").map((p) => ({
                      label: p.jabatan,
                      nama: contract[p.nama],
                      sub: null,
                    })),
                    { label: "Pelaksana Lapangan", nama: pkg.pelaksanaName, sub: pkg.pelaksanaTitle },
                  ].map((r) => (
                    <div key={r.label}>
                      <dt className="text-ink-muted">{r.label}</dt>
                      <dd className="font-medium text-ink">{r.nama || "–"}</dd>
                      {r.sub ? <dd className="text-xs text-ink-muted">{r.sub}</dd> : null}
                    </div>
                  ))}
                </dl>
              )}
            </Drawer>
          }
        />

        {canContract ? (
          <AksiTile
            judul="Tanda tangan & stempel"
            penjelasan="Gambar tanda tangan dan stempel para penanda tangan untuk ditempel pada laporan cetak. Boleh dikosongkan kalau laporan tetap ditandatangani dengan pena."
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
                    wakilSahTtdUrl: urlTtd(contract.wakilSahTtdKey),
                    supervisorTtdUrl: urlTtd(contract.supervisorTtdKey),
                    supervisorStempelUrl: urlTtd(contract.supervisorStempelKey),
                    supervisorLogoUrl: urlTtd(contract.supervisorLogoKey),
                    contractorTtdUrl: urlTtd(contract.contractorTtdKey),
                    contractorStempelUrl: urlTtd(contract.contractorStempelKey),
                    pelaksanaTtdUrl: urlTtd(pkg.pelaksanaTtdKey),
                    vendorStempelUrl: urlTtd(contract.vendor.stempelKey),
                    vendorName: contract.vendor.name,
                    supervisorFirm: contract.supervisorFirm,
                    personelTtdUrl: Object.fromEntries(PERSONEL_KONTRAK.map((p) => [p.ttd, urlTtd(contract[p.ttd])])),
                  }}
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
                        {a.valueDeltaRab !== null && a.valueDeltaRab !== a.valueDelta ? (
                          <span className="block text-[12px] text-ink-muted">
                            dari RAB {formatRupiah(a.valueDeltaRab)}
                          </span>
                        ) : null}
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
