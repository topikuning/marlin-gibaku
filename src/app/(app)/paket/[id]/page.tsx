import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Banner,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  KpiCard,
  MiniStat,
  ProgressBar,
  StatusPill,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import {
  PACKAGE_STAGE_LABEL,
  PACKAGE_STAGE_TONE,
  LOCATION_STATUS_LABEL,
  LOCATION_STATUS_TONE,
  revertTargetFor,
} from "@/lib/lifecycle";
import {
  formatPct,
  formatRupiah,
  formatRupiahShort,
  formatTanggal,
  formatTanggalWaktu,
} from "@/lib/format";
import { getLocationsProgress } from "@/lib/progress";
import { weightedRealizedPct } from "@/lib/progress-calc";
import { getScurveSeriesPaket } from "@/lib/baseline";
import { getAdendumBerjalan } from "@/lib/package/adendum-berjalan";
import { daftarPerubahanLingkup, lingkupLokasi } from "@/lib/package/lingkup-lokasi";
import { LingkupPanel } from "./lingkup-panel";
import { ScurveChart } from "@/components/knmp/scurve-chart";
import {
  getPackageWorkspace,
  getStageHistory,
  runningContractValue,
  runningEndDate,
} from "@/lib/package/queries";
import type { PackageStage } from "@/generated/prisma/enums";
import { isWahaConfigured } from "@/lib/waha/client";
import {
  AdvanceStageButton,
  RevertStageButton,
  StartPelaksanaanButton,
} from "./stage-actions";
import { WaGroupForm } from "./wa-group-form";
import { DriveFolderForm } from "./drive-folder-form";
import { mingguKontrak, rentangMingguKontrak } from "@/lib/mingguan/kirim";
import { LaporanMingguanWa } from "./laporan-mingguan-wa";
import { getGDriveConfigDisplay } from "@/lib/gdrive/config";
import { getDriveCoverage } from "@/lib/gdrive/coverage";
import { milestoneBoard } from "@/lib/milestones/queries";
import { SiklusPanel } from "./siklus-panel";
import { BarisIntegrasi } from "./komunikasi-panel";

export const metadata: Metadata = { title: "Ringkasan Paket" };
export const dynamic = "force-dynamic";

/**
 * RINGKASAN PAKET – halaman KEPUTUSAN, bukan tempat menumpuk form pengaturan
 * (DECISIONS 386).
 *
 * Yang berubah dari versi sebelumnya bukan warnanya melainkan urutan
 * kepentingannya. Dulu halaman ini satu kolom panjang: stepper, KPI,
 * rekonsiliasi, langkah berikutnya, lalu EMPAT kartu pengaturan berturut-turut
 * (grup WhatsApp, laporan mingguan, folder Drive, tabel kelengkapan Drive).
 * Akibatnya dua hal yang dibuka paling sering – kondisi lokasi dan aktivitas
 * terakhir – terdorong ke dasar halaman oleh formulir yang mungkin disentuh
 * sekali seumur paket.
 *
 * Sekarang: kolom kiri untuk yang DIBACA (langkah berikutnya, tanggal kontrak,
 * rekonsiliasi, lokasi, aktivitas), kolom kanan untuk keadaan integrasi yang
 * cukup DILIHAT statusnya – formnya di belakang satu tombol. Tidak ada
 * kemampuan yang dihapus; semuanya masih di halaman ini, hanya tidak lagi
 * berebut tempat dengan angka.
 */

/**
 * Minggu kontrak yang boleh dipilih untuk laporan mingguan → grup WA
 * (DECISIONS 357). Terbaru dulu; minggu berjalan tetap yang PERTAMA supaya
 * bawaannya tidak berubah.
 *
 * Dibangun di server: aritmetika tanggalnya milik `kirim.ts`, dan menyalinnya
 * ke komponen klien akan melahirkan salinan kedua yang bisa menyimpang dari
 * yang benar-benar dipakai saat mengirim.
 */
function pilihanMingguPaket(
  startDate: Date | null,
  weekMode: "tujuh_hari" | "senin_minggu" = "tujuh_hari",
): { nilai: number; label: string }[] {
  if (!startDate) return [];
  const now = new Date();
  const berjalan = mingguKontrak(startDate, now, weekMode);
  if (berjalan < 1) return [];
  const keluar: { nilai: number; label: string }[] = [];
  // Minggu berjalan + hingga 8 minggu selesai terakhir — cukup untuk mengejar
  // kiriman yang terlewat tanpa membuat daftarnya jadi gulungan panjang.
  for (let n = berjalan; n >= Math.max(1, berjalan - 8); n--) {
    const r = rentangMingguKontrak(startDate, n, weekMode);
    const rentang = `${formatTanggal(r.mulai, "d MMM")} – ${formatTanggal(r.akhir, "d MMM")}`;
    keluar.push({
      nilai: n,
      label:
        n === berjalan
          ? `Minggu ke-${n} – berjalan (${rentang})`
          : `Minggu ke-${n} – selesai (${rentang})`,
    });
  }
  return keluar;
}

export default async function RingkasanPaketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;

  const pkg = await getPackageWorkspace(id);
  if (!pkg) notFound();

  const canProspect = can(user.role, "prospect.manage");
  const canContract = can(user.role, "contract.manage");
  const canWaConfigure = can(user.role, "wa.configure");
  const canKirimLaporan = can(user.role, "ai.report_send");
  const canDocument = can(user.role, "document.view");

  const idLokasi = pkg.locations.map((l) => l.id);
  /*
   * LINGKUP dibaca LEBIH DULU karena seluruh agregat bergantung padanya:
   * lokasi yang sudah dicabut lewat adendum tidak boleh ikut menghitung progres,
   * kurva-S, maupun Σ RAB paket. Angka lampaunya sendiri tidak diubah — laporan
   * dan fotonya tetap ada di lokasinya (ketetapan user 2026-09-05).
   */
  const lingkup = await lingkupLokasi(idLokasi);
  const idIkut = idLokasi.filter((id) => !lingkup.dicabut.has(id));
  const lokasiDicabut = pkg.locations.filter((l) => lingkup.dicabut.has(l.id));
  const [progressMap, history, kepatuhan, kurvaPaket, adendum, perubahanLingkup] =
    await Promise.all([
    getLocationsProgress(idLokasi),
    getStageHistory(pkg.id),
    // Ringkasan kepatuhan dibaca dari papan yang SAMA dengan tab Dokumen —
    // bukan dihitung ulang di sini, supaya tidak lahir angka kedua untuk hal
    // yang sama.
    canDocument ? milestoneBoard({ packageId: pkg.id }) : Promise.resolve(null),
    // Kurva-S paket: rencana vs realisasi seluruh lokasi, ditimbang RAB
    // (keluhan user 2026-09-05 – progres agregat tanpa rencana di sebelahnya
    // tidak bisa menjawab "telat atau tidak").
    getScurveSeriesPaket(idIkut),
    // Draft adendum yang sedang berjalan di lokasi-lokasi paket ini.
    getAdendumBerjalan(idLokasi),
    // Lingkup lokasi: adendum yang menambah / mencabut lokasi (kebutuhan user
    // 2026-09-05). Yang DICABUT keluar dari agregat sejak tanggal berlakunya;
    // angka lampaunya tidak diubah.
    daftarPerubahanLingkup(idLokasi),
  ]);

  // Progress agregat — formula kanonik weightedRealizedPct (B13). Lokasi yang
  // sudah dicabut lewat adendum TIDAK ikut: pekerjaannya bukan lagi bagian
  // kontrak sejak tanggal berlaku CCO.
  const progresIkut = idIkut.map((id) => progressMap.get(id)).filter((p) => p != null);
  const aggregatePct = weightedRealizedPct(progresIkut);
  // Σ RAB lokasi yang masih dalam lingkup — dipakai rekonsiliasi kontrak vs RAB.
  let totalRab = 0n;
  for (const p of progresIkut) totalRab += p.grandTotal;

  const contract = pkg.contract;
  const running = contract
    ? runningContractValue(contract.contractValue, contract.amendments)
    : null;
  const akhirBerjalan = contract
    ? runningEndDate(contract.endDate, contract.amendments)
    : null;

  /*
   * Tanggal MASUK per tahap, dari histori transisi.
   *
   * Yang dipakai transisi PALING AWAL menuju tahap itu: paket yang pernah
   * dimundurkan untuk koreksi lalu dinaikkan lagi tetap harus menunjukkan
   * kapan ia benar-benar pertama kali sampai di sana. `getStageHistory`
   * mengurutkan terbaru dulu, jadi penulisan berulang di bawah menyisakan yang
   * paling tua.
   */
  const masukTahap = new Map<PackageStage, Date>();
  for (const h of history) masukTahap.set(h.toStage, h.changedAt);

  // Rekonsiliasi: nilai kontrak (INPUT, incl PPN) vs Σ RAB semua lokasi (pra-PPN).
  // Kontrak incl-PPN, RAB pra-PPN (konvensi uang) → banding pada basis pra-PPN.
  const recon = (() => {
    if (!contract || running == null) return null;
    // Rekonsiliasi membandingkan nilai kontrak SEUTUHNYA dengan Σ RAB SEMUA
    // lokasi. Untuk user ber-scope sempit, `totalRab` hanya mencakup lokasi
    // yang terlihat — selisihnya akan tampak besar dan salah. Lebih baik tidak
    // ditampilkan daripada menampilkan angka yang tidak bisa benar
    // (DECISIONS 201).
    if (pkg.locationsHidden > 0) return null;
    const ppn = Number(contract.ppnPercent);
    const runningNum = Number(running);
    const basePraPpn = ppn > 0 ? runningNum / (1 + ppn / 100) : runningNum;
    const rabSum = Number(totalRab);
    const selisih = basePraPpn - rabSum;
    const rows = pkg.locations
      .filter((l) => !lingkup.dicabut.has(l.id))
      .map((l) => ({ name: l.name, rab: Number(progressMap.get(l.id)?.grandTotal ?? 0n) }))
      .sort((a, b) => b.rab - a.rab);
    const withRab = rows.filter((r) => r.rab > 0).length;
    const alokasiPct = basePraPpn > 0 ? (rabSum / basePraPpn) * 100 : 0;
    const semuaBerRab = withRab === rows.length && rows.length > 0;
    const cocok = semuaBerRab && Math.abs(selisih) <= basePraPpn * 0.01;
    return { ppn, basePraPpn, rabSum, selisih, rows, withRab, alokasiPct, semuaBerRab, cocok };
  })();

  const nextAction = (() => {
    switch (pkg.stage) {
      case "prospek":
        return {
          judul: "Naikkan ke Tender saat pemilihan dimulai",
          hint: "Prospek aktif. Tahap berikutnya dibuka ketika proses pemilihan benar-benar berjalan.",
          action: canProspect ? (
            <AdvanceStageButton packageId={pkg.id} toStage="tender" label="Naikkan ke Tender" />
          ) : null,
        };
      case "tender":
        return {
          judul: "Lengkapi administrasi pemilihan",
          hint: "Isi di tab Tender & Administrasi, lalu naikkan ke Penetapan saat pemenang ditetapkan.",
          action: canProspect ? (
            <AdvanceStageButton
              packageId={pkg.id}
              toStage="penetapan"
              label="Naikkan ke Penetapan"
            />
          ) : null,
        };
      case "penetapan":
        return {
          judul: "Input data kontrak",
          hint: "Pemenang sudah ditetapkan. Data kontrak yang mengonversi paket ini ke tahap Kontrak.",
          action: canContract ? (
            <ButtonLink href={`/paket/${pkg.id}/kontrak`} variant="primary" size="md">
              Input Kontrak
            </ButtonLink>
          ) : null,
        };
      case "kontrak":
        return {
          judul: "Mulai pelaksanaan",
          hint: "Kontrak tercatat. Memulai pelaksanaan mengaktifkan status Berjalan di semua lokasi.",
          action: canContract ? <StartPelaksanaanButton packageId={pkg.id} /> : null,
        };
      case "pelaksanaan":
        return {
          judul: "Pantau pelaksanaan sampai pekerjaan fisik 100%",
          hint: "Serah Terima baru dapat ditandai ketika progress agregat mencapai 100%.",
          action: canProspect ? (
            <AdvanceStageButton
              packageId={pkg.id}
              toStage="serah_terima"
              label="Tandai Serah Terima"
              variant="secondary"
              warn={
                aggregatePct < 99.95
                  ? `Progress agregat baru ${formatPct(aggregatePct)}. Serah terima hanya diizinkan saat 100% – tindakan ini akan ditolak sampai pekerjaan tuntas.`
                  : undefined
              }
            />
          ) : null,
        };
      case "serah_terima":
        return {
          judul: "Tandai Selesai setelah FHO tuntas",
          hint: "Serah terima berlangsung. Tahap Selesai ditandai setelah administrasi rampung.",
          action: canProspect ? (
            <AdvanceStageButton
              packageId={pkg.id}
              toStage="selesai"
              label="Tandai Selesai"
              variant="secondary"
            />
          ) : null,
        };
      case "selesai":
        return { judul: "Paket selesai", hint: "Tidak ada tahap berikutnya.", action: null };
      case "batal":
        return {
          judul: "Paket dibatalkan",
          hint: pkg.cancelReason ?? "Tanpa alasan tercatat.",
          action: null,
        };
    }
  })();

  // Tahap sebelumnya yang aman untuk dimundurkan (koreksi salah-klik), bila ada.
  const revertTo = revertTargetFor(pkg.stage);
  const lokasiAktif = pkg.locations.filter((l) => l.isActive).length;
  const adaKomunikasi =
    canWaConfigure || (canKirimLaporan && pkg.stage === "pelaksanaan");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Siklus paket"
          action={
            <span className="text-[13px] text-ink-muted">
              Tahap aktif:{" "}
              <span className="font-medium text-ink">{PACKAGE_STAGE_LABEL[pkg.stage]}</span>
            </span>
          }
        />
        <CardBody>
          <SiklusPanel current={pkg.stage} masuk={masukTahap} />
        </CardBody>
      </Card>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label="Nilai HPS" value={formatRupiahShort(pkg.hpsValue)} />
        <KpiCard
          label="Nilai kontrak berjalan"
          value={running !== null ? formatRupiahShort(running) : "–"}
          sub={contract ? `${contract.amendments.length} adendum` : "Belum berkontrak"}
        />
        <KpiCard
          // Angka ini mengikuti PENUGASAN, bukan isi paket seutuhnya — jadi
          // labelnya harus menyebutkan itu, bukan diam-diam terbaca sebagai
          // jumlah lokasi paket (DECISIONS 201).
          label={pkg.locationsHidden > 0 ? "Lokasi Anda di paket ini" : "Jumlah lokasi"}
          value={pkg.locations.length}
          href={`/paket/${pkg.id}/lokasi`}
          sub={
            [
              `${lokasiAktif} aktif`,
              pkg.locationsHidden > 0 ? `${pkg.locationsHidden} lokasi lain di luar penugasan` : null,
              // Lokasi yang dicabut adendum tetap terhitung sebagai baris paket,
              // tapi tidak lagi ikut angka mana pun – itu harus tertulis, bukan
              // ditebak dari selisih angka.
              lokasiDicabut.length > 0 ? `${lokasiDicabut.length} dicabut adendum` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          }
        />
        <KpiCard
          // Dihitung dari lokasi YANG TERLIHAT. Untuk user ber-scope sempit itu
          // BUKAN progres paket seutuhnya, jadi labelnya wajib menyebutkannya —
          // satu label untuk dua angka berbeda adalah persis yang dilarang
          // Calculation Integrity Protocol (DECISIONS 201).
          label={pkg.locationsHidden > 0 ? "Progress lokasi Anda" : "Progress agregat"}
          value={formatPct(aggregatePct)}
          sub={
            pkg.locationsHidden > 0
              ? "tertimbang RAB aktif · bukan progres seluruh paket"
              : "tertimbang RAB aktif"
          }
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Status paket & langkah berikutnya"
              subtitle="Ringkasan untuk keputusan. Pengaturan yang jarang disentuh ada di kolom kanan."
            />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary-200 bg-primary-50 px-3 py-2.5">
                <div className="min-w-[12rem] flex-1">
                  <p className="text-[11px] font-semibold tracking-wide text-primary uppercase">
                    Langkah berikutnya
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-ink">{nextAction.judul}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">
                    {nextAction.hint}
                  </p>
                </div>
                {nextAction.action ? <div className="min-w-0">{nextAction.action}</div> : null}
              </div>


              {contract ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <MiniStat
                    label="Mulai / SPMK"
                    value={contract.startDate ? formatTanggal(contract.startDate) : "belum terbit"}
                  />
                  <MiniStat
                    label="Selesai kontrak"
                    value={akhirBerjalan ? formatTanggal(akhirBerjalan) : "belum terbit"}
                  />
                  <MiniStat
                    label="Masa pelaksanaan"
                    value={contract.durationDays ? `${contract.durationDays} hari` : "–"}
                  />
                </div>
              ) : null}

              {canProspect && revertTo ? (
                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-[12px] text-ink-muted">
                    Salah menaikkan tahap? Mundurkan untuk koreksi (tercatat di histori).
                  </p>
                  <RevertStageButton
                    packageId={pkg.id}
                    fromLabel={PACKAGE_STAGE_LABEL[pkg.stage]}
                    toLabel={PACKAGE_STAGE_LABEL[revertTo]}
                  />
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* KURVA-S PAKET — rencana vs realisasi seluruh lokasi, ditimbang RAB.
          Keluhan user 2026-09-05: *"tidak ada informasi kurva S sama sekali
          yang bisa menjelaskan progress keseluruhan lokasi"*. Angka agregat
          sendirian tidak bisa menjawab telat atau tidak; yang menjawab adalah
          rencananya di sebelahnya. */}
      <Card>
        <CardHeader
          title="Kurva-S paket"
          subtitle={
            kurvaPaket.dihitung > 0
              ? `Rencana vs realisasi gabungan ${kurvaPaket.dihitung} dari ${kurvaPaket.totalLokasi} lokasi, ditimbang nilai RAB aktif – minggu ke-${kurvaPaket.currentWeek} dari ${kurvaPaket.totalWeeks}.`
              : "Belum ada lokasi yang punya baseline kurva-S sekaligus RAB aktif."
          }
          action={
            kurvaPaket.dihitung > 0 ? (
              <span className="text-sm">
                <span className="text-ink-muted">Rencana</span>{" "}
                <span className="tabular font-semibold text-ink">
                  {formatPct(kurvaPaket.planPct[kurvaPaket.currentWeek - 1] ?? 0)}
                </span>{" "}
                <span className="text-ink-muted">· Realisasi</span>{" "}
                <span className="tabular font-semibold text-ink">{formatPct(aggregatePct)}</span>
              </span>
            ) : null
          }
        />
        <CardBody className="space-y-2">
          {kurvaPaket.dihitung > 0 ? (
            <>
              <ScurveChart series={kurvaPaket} />
              {/* Lokasi yang belum punya baseline TIDAK dipaksa masuk sebagai
                  nol – itu akan menuduhnya tertinggal 100%. Yang tidak ikut
                  disebut jumlahnya, supaya kurva ini tidak terbaca "seluruh
                  paket" padahal bukan. */}
              {kurvaPaket.dihitung < kurvaPaket.totalLokasi ? (
                <p className="text-[13px] text-warning-700">
                  {kurvaPaket.totalLokasi - kurvaPaket.dihitung} lokasi belum punya baseline
                  kurva-S atau RAB aktif dan TIDAK ikut dihitung – kurva ini belum mewakili
                  seluruh paket.
                </p>
              ) : null}
              <p className="text-[13px] text-ink-muted">
                Rencana dari baseline aktif tiap lokasi; realisasi dari laporan harian yang
                dihitung. Lokasi yang jadwalnya lebih pendek diteruskan 100% sesudah minggu
                terakhirnya – itu yang dikatakan jadwalnya.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-ink-muted">
              Kurva-S paket muncul begitu ada lokasi yang RAB-nya aktif dan baselinenya
              terbentuk. Baseline dibuat otomatis saat RAB diimpor.
            </p>
          )}
        </CardBody>
      </Card>

      {/* LINGKUP LOKASI — adendum yang menambah atau mencabut lokasi.
          Kebutuhan user 2026-09-05. Kartunya selalu tampil bagi pemegang
          kontrak: tanpa pintu masuk, fiturnya sama saja dengan tidak ada. */}
      {canContract || perubahanLingkup.length > 0 ? (
        <Card>
          <CardHeader
            title="Lingkup lokasi kontrak"
            subtitle="Adendum bisa MENAMBAH atau MENCABUT lokasi. Yang dicabut tidak dihapus – laporan, foto, dan realisasinya tetap; yang berhenti hanya keikutsertaannya dalam angka paket sejak tanggal berlaku CCO."
            action={
              lokasiDicabut.length > 0 ? (
                <StatusPill tone="warning" label={`${lokasiDicabut.length} lokasi dicabut`} />
              ) : null
            }
          />
          <CardBody>
            <LingkupPanel
              packageId={pkg.id}
              bolehUbah={canContract}
              lokasi={pkg.locations.map((l) => ({ id: l.id, name: l.name }))}
              adendum={(contract?.amendments ?? []).map((a) => ({
                id: a.id,
                label: `${a.ccoNumber} – berlaku ${formatTanggal(a.effectiveDate)}`,
              }))}
              perubahan={perubahanLingkup.map((p) => ({
                id: p.id,
                locationName: p.locationName,
                kind: p.kind,
                effectiveDate: formatTanggal(p.effectiveDate),
                status: p.status,
                reason: p.reason,
                ccoNumber: p.ccoNumber,
                setuju: { lengkap: p.setuju.lengkap, kurang: p.setuju.kurang },
                suaraGugur: p.suaraGugur,
              }))}
            />
          </CardBody>
        </Card>
      ) : null}

      {/* ADENDUM BERJALAN — draft yang sedang diajukan di lokasi-lokasi paket.
          Keluhan user 2026-09-05: *"saat terjadi draft adendum, sama sekali
          tidak ada informasi atau apa pun yang bisa membantu menjelaskan"*.
          Draftnya hidup di halaman RAB tiap lokasi, sementara yang memutuskan
          bekerja dari sini. */}
      {adendum.draft.length > 0 ? (
        <Card>
          <CardHeader
            title={`${adendum.draft.length} draft adendum sedang berjalan`}
            subtitle="Belum masuk nilai kontrak, belum menggeser progres maupun kurva-S – baru berlaku setelah diaktifkan (empat mata: Program Director + AM/PM/SM)."
            action={
              <StatusPill
                tone={adendum.siapAktif > 0 ? "warning" : "info"}
                label={
                  adendum.siapAktif > 0
                    ? `${adendum.siapAktif} siap diaktifkan`
                    : "Menunggu persetujuan"
                }
              />
            }
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <MiniStat label="Lokasi terdampak" value={String(adendum.draft.length)} />
              <MiniStat
                label="Dampak nilai (pra-PPN)"
                value={formatRupiah(adendum.totalSelisih)}
              />
              <MiniStat
                label="Nilai kontrak bila aktif"
                value={
                  running != null
                    ? formatRupiah(running + adendum.totalSelisih)
                    : formatRupiah(adendum.totalSelisih)
                }
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                    <th className="py-1.5 pr-3">Lokasi</th>
                    <th className="py-1.5 pr-3 text-right">Berlaku</th>
                    <th className="py-1.5 pr-3 text-right">Draft</th>
                    <th className="py-1.5 pr-3 text-right">Selisih</th>
                    <th className="py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {adendum.draft.map((d) => (
                    <tr key={d.revisionId}>
                      <td className="py-1.5 pr-3">
                        <Link
                          href={`/lokasi/${d.locationSlug}/rab/adendum`}
                          className="font-medium text-primary hover:underline"
                        >
                          {d.locationName}
                        </Link>
                        <span className="block text-xs text-ink-faint">
                          Revisi #{d.revisionNo}
                          {d.ccoNumber ? ` · ${d.ccoNumber}` : " · belum bernomor CCO"}
                          {d.note ? ` · ${d.note}` : ""}
                        </span>
                      </td>
                      <td className="tabular py-1.5 pr-3 text-right">
                        {d.nilaiAktif != null ? formatRupiah(d.nilaiAktif) : "–"}
                      </td>
                      <td className="tabular py-1.5 pr-3 text-right">{formatRupiah(d.nilaiDraft)}</td>
                      <td
                        className={`tabular py-1.5 pr-3 text-right ${
                          d.selisih == null || d.selisih === 0n
                            ? ""
                            : d.selisih > 0n
                              ? "text-warning"
                              : "text-danger"
                        }`}
                      >
                        {d.selisih == null ? "–" : formatRupiah(d.selisih)}
                      </td>
                      <td className="py-1.5">
                        <StatusPill
                          tone={d.setuju.lengkap ? "success" : "info"}
                          label={d.setuju.lengkap ? "Siap diaktifkan" : "Menunggu persetujuan"}
                        />
                        {!d.setuju.lengkap ? (
                          <span className="block text-xs text-ink-faint">
                            Kurang: {d.setuju.kurang.join(" · ")}
                          </span>
                        ) : null}
                        {d.suaraGugur > 0 ? (
                          <span className="block text-xs text-warning-700">
                            {d.suaraGugur} persetujuan gugur karena draftnya diubah lagi
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[13px] text-ink-muted">
              Angka di atas nilai RAB pra-PPN. Nilai kontrak berjalan di kartu atas baru berubah
              setelah adendum diaktifkan DAN nomor CCO-nya dicatat di tab Kontrak.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {!recon && contract && pkg.locationsHidden > 0 ? (
            <Banner
              tone="info"
              title="Rekonsiliasi kontrak vs RAB tidak ditampilkan"
              description={`Perbandingan itu memerlukan RAB SELURUH lokasi paket, sementara ${pkg.locationsHidden} lokasi berada di luar penugasan Anda – angkanya tidak akan benar bila dihitung sebagian.`}
            />
          ) : null}

          {recon ? (
            /* id: sasaran tombol “Periksa masalah” pada banner selisih di layout. */
            <Card id="rekonsiliasi" className="scroll-mt-4">
              <CardHeader
                title="Rekonsiliasi: nilai kontrak (input) vs RAB semua lokasi"
                subtitle="“Nilai kontrak berjalan” adalah INPUT kamu (nilai kontrak + adendum), termasuk PPN – bukan jumlah lokasi. Di sini dibandingkan dengan jumlah RAB semua lokasi (pra-PPN) untuk verifikasi alokasi."
                action={
                  <StatusPill
                    tone={recon.cocok ? "success" : recon.semuaBerRab ? "warning" : "info"}
                    label={
                      recon.cocok
                        ? "Teralokasi penuh (±1%)"
                        : recon.semuaBerRab
                          ? "Ada selisih"
                          : "Belum semua lokasi ber-RAB"
                    }
                  />
                }
              />
              <CardBody className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat
                    label={`Kontrak (incl PPN ${recon.ppn}%)`}
                    value={formatRupiah(running!)}
                  />
                  <MiniStat
                    label="Nilai dasar (pra-PPN)"
                    value={formatRupiah(BigInt(Math.round(recon.basePraPpn)))}
                  />
                  <MiniStat
                    label="Σ RAB semua lokasi"
                    value={formatRupiah(BigInt(Math.round(recon.rabSum)))}
                  />
                  <MiniStat
                    label="Selisih (dasar − RAB)"
                    value={formatRupiah(BigInt(Math.round(recon.selisih)))}
                  />
                </div>

                <p className="text-[13px] text-ink-muted">
                  {recon.withRab}/{recon.rows.length} lokasi ber-RAB · alokasi{" "}
                  {formatPct(recon.alokasiPct)} dari nilai dasar. Selisih ini bukan otomatis
                  “kerugian” atau “sisa”; ia penanda data yang perlu direkonsiliasi. Sebabnya
                  biasanya belum semua lokasi impor RAB, atau nilai kontrak input belum sesuai
                  total RAB.
                </p>

                <div className="flex flex-wrap gap-2">
                  <ButtonLink href={`/paket/${pkg.id}/kontrak`}>
                    Periksa kontrak & adendum
                  </ButtonLink>
                  <ButtonLink href={`/paket/${pkg.id}/lokasi`}>Periksa RAB per lokasi</ButtonLink>
                </div>

                <details>
                  <summary className="cursor-pointer text-[13px] font-medium text-primary hover:underline">
                    Rincian per lokasi
                  </summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                          <th className="py-1.5 pr-3">Lokasi</th>
                          <th className="py-1.5 pr-3 text-right">RAB (pra-PPN)</th>
                          <th className="py-1.5 text-right">% thd nilai dasar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {recon.rows.map((r) => (
                          <tr key={r.name}>
                            <td className="py-1.5 pr-3">{r.name}</td>
                            <td className="tabular py-1.5 pr-3 text-right">
                              {r.rab > 0 ? (
                                formatRupiah(BigInt(Math.round(r.rab)))
                              ) : (
                                <span className="text-ink-faint">belum ada RAB</span>
                              )}
                            </td>
                            <td className="tabular py-1.5 text-right text-ink-muted">
                              {recon.basePraPpn > 0
                                ? formatPct((r.rab / recon.basePraPpn) * 100)
                                : "–"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Lokasi paket"
              subtitle="Kondisi tiap lokasi tanpa harus pindah tab."
              action={<ButtonLink href={`/paket/${pkg.id}/lokasi`}>Lihat semua</ButtonLink>}
            />
            <CardBody>
              {pkg.locations.length === 0 ? (
                <p className="text-sm text-ink-muted">Belum ada lokasi pada paket ini.</p>
              ) : (
                <ul className="space-y-2">
                  {pkg.locations.map((l) => {
                    const p = progressMap.get(l.id);
                    return (
                      <li key={l.id}>
                        <Link
                          href={`/lokasi/${l.slug}`}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 transition-colors hover:border-border-strong hover:bg-surface-muted"
                        >
                          <span className="min-w-[9rem] flex-1">
                            <span className="block text-[13px] font-medium text-primary">
                              {l.name}
                            </span>
                            <span className="block text-[12px] text-ink-muted">
                              {[l.village, l.regency, l.province].filter(Boolean).join(", ")}
                            </span>
                          </span>
                          <Badge
                            tone={LOCATION_STATUS_TONE[l.status]}
                            label={LOCATION_STATUS_LABEL[l.status]}
                          />
                          <span className="tabular text-[13px] font-semibold text-ink">
                            {p ? formatPct(p.realizedPct) : "–"}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {pkg.locationsHidden > 0 ? (
                <p className="mt-2 text-[12px] text-ink-muted">
                  {pkg.locationsHidden} lokasi lain di paket ini berada di luar penugasan Anda.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Aktivitas terakhir"
              subtitle="Transisi stage paket"
              action={<ButtonLink href={`/paket/${pkg.id}/aktivitas`}>Lihat semua</ButtonLink>}
            />
            <CardBody>
              {history.length === 0 ? (
                <p className="text-sm text-ink-muted">Belum ada aktivitas.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {history.slice(0, 5).map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <StatusPill
                        tone={PACKAGE_STAGE_TONE[h.toStage]}
                        label={PACKAGE_STAGE_LABEL[h.toStage]}
                      />
                      <span className="text-ink">
                        {h.fromStage === h.toStage
                          ? "koreksi data"
                          : h.fromStage
                            ? `dari ${PACKAGE_STAGE_LABEL[h.fromStage]}`
                            : "stage awal"}
                      </span>
                      {h.note ? <span className="text-ink-muted">– {h.note}</span> : null}
                      <span className="ml-auto text-xs text-ink-muted">
                        {h.changedByName} · {formatTanggalWaktu(h.changedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-4">
          {adaKomunikasi ? (
            <Card>
              <CardHeader
                title="Komunikasi paket"
                subtitle="Keadaannya terbaca di sini; formnya dibuka hanya saat perlu diubah."
              />
              <CardBody className="space-y-2">
                {canWaConfigure ? (
                  <BarisIntegrasi
                    nama="Grup WhatsApp paket"
                    keterangan={
                      pkg.waGroupId
                        ? `${pkg.waGroupName ?? "Grup tertaut"} · tujuan kiriman laporan & kegiatan semua lokasi paket ini`
                        : "Belum tertaut. Tanpa grup, laporan & kegiatan lapangan tidak punya tujuan kiriman."
                    }
                    status={pkg.waGroupId ? "Terpasang" : "Belum"}
                    statusTone={pkg.waGroupId ? "success" : "warning"}
                    aksi={
                      <Drawer
                        trigger={pkg.waGroupId ? "Kelola koneksi" : "Tautkan grup"}
                        title="Grup WhatsApp paket"
                        subtitle="Pilih dari daftar grup atau tempel ID grup (…@g.us)."
                      >
                        <WaGroupForm
                          packageId={pkg.id}
                          currentGroupId={pkg.waGroupId}
                          currentGroupName={pkg.waGroupName}
                          wahaConfigured={await isWahaConfigured()}
                        />
                      </Drawer>
                    }
                  />
                ) : null}

                {canKirimLaporan && pkg.stage === "pelaksanaan" ? (
                  <BarisIntegrasi
                    nama="Laporan progres mingguan"
                    keterangan="Semua lokasi paket ini dalam satu pesan. Otomatis pada hari terakhir tiap minggu kontrak bila sakelarnya menyala di Sistem."
                    status={pkg.waGroupId ? undefined : "Butuh grup"}
                    statusTone="warning"
                    aksi={
                      <Drawer
                        trigger="Kirim laporan"
                        triggerVariant="primary"
                        title="Laporan progres mingguan → grup WA"
                        subtitle="Pilih minggu, lalu kirim lewat kanal WhatsApp MARLIN."
                      >
                        <LaporanMingguanWa
                          packageId={pkg.id}
                          punyaGrup={Boolean(pkg.waGroupId)}
                          pilihanMinggu={pilihanMingguPaket(contract?.startDate ?? null, contract?.weekMode)}
                        />
                      </Drawer>
                    }
                  />
                ) : null}

                {canWaConfigure ? (
                  <BarisIntegrasi
                    nama="Folder Google Drive KKP"
                    keterangan={
                      pkg.driveFolderId
                        ? "Tertaut – tujuan arsip PDF/Excel laporan harian & mingguan lokasi paket ini."
                        : "Belum terhubung, jadi arsip Drive dan impor dokumen KKP belum bisa berjalan."
                    }
                    status={pkg.driveFolderId ? "Terpasang" : "Belum"}
                    statusTone={pkg.driveFolderId ? "success" : "warning"}
                    aksi={
                      <Drawer
                        trigger={pkg.driveFolderId ? "Kelola folder" : "Hubungkan folder"}
                        title="Folder Google Drive paket"
                        subtitle="Folder pemberian KKP – tujuan upload PDF/Excel laporan lokasi paket ini."
                      >
                        <div className="space-y-4">
                          <DriveFolderForm
                            packageId={pkg.id}
                            currentFolderId={pkg.driveFolderId}
                            driveConnected={(await getGDriveConfigDisplay()).connected}
                          />
                          {pkg.driveFolderId ? (
                            <div>
                              <h3 className="text-sm font-semibold text-ink">
                                Kelengkapan folder KKP
                              </h3>
                              <p className="mt-0.5 mb-2 text-[13px] text-ink-muted">
                                Sembilan folder standar KKP – apa yang MARLIN punya vs apa yang
                                sudah disetor.
                              </p>
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[26rem] text-sm">
                                  <thead>
                                    <tr className="border-b border-border text-left text-[12px] text-ink-muted">
                                      <th className="py-2 font-medium">Folder</th>
                                      <th className="py-2 text-right font-medium">Terupload</th>
                                      <th className="py-2 text-right font-medium">Terakhir</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(await getDriveCoverage(pkg.id)).map((r) => (
                                      <tr
                                        key={r.folder}
                                        className="border-b border-border last:border-0"
                                      >
                                        <td className="py-2 pr-3">
                                          <span className="block font-medium text-ink">
                                            {r.folder}
                                          </span>
                                          <span className="block text-[12px] text-ink-muted">
                                            {r.source}
                                          </span>
                                        </td>
                                        <td className="tabular py-2 pr-3 text-right">
                                          <span
                                            className={
                                              r.uploaded > 0 ? "text-success" : "text-ink-faint"
                                            }
                                          >
                                            {r.uploaded}
                                          </span>
                                          {r.expected != null ? (
                                            <span className="text-ink-faint"> / {r.expected}</span>
                                          ) : null}
                                          {r.failed > 0 ? (
                                            <span className="ml-1 text-danger">
                                              ({r.failed} gagal)
                                            </span>
                                          ) : null}
                                        </td>
                                        <td className="py-2 text-right text-[12px] text-ink-muted">
                                          {r.lastAt ? formatTanggalWaktu(r.lastAt) : "–"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <p className="mt-2 text-[12px] text-ink-muted">
                                Upload dilakukan per laporan/dokumen dari halamannya
                                masing-masing. Kolom “/ n” = jumlah yang layak disetor menurut data
                                MARLIN; laporan mingguan/bulanan tidak dihitung karena jumlah
                                periodenya mengikuti masa kontrak.
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </Drawer>
                    }
                  />
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {kepatuhan && kepatuhan.total > 0 ? (
            <Card>
              <CardHeader
                title="Dokumen & kepatuhan"
                subtitle="Ringkasan saja; pekerjaan detailnya di tab Dokumen."
              />
              <CardBody className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="tabular font-semibold text-ink">
                    {kepatuhan.done} / {kepatuhan.total} selesai
                  </span>
                  <span className="tabular text-[13px] text-ink-muted">
                    {formatPct(kepatuhan.completenessPct)}
                  </span>
                </div>
                <ProgressBar
                  value={kepatuhan.completenessPct}
                  tone={kepatuhan.late > 0 ? "warning" : "success"}
                  label="Kelengkapan dokumen paket"
                />
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <MiniStat label="Terlambat" value={String(kepatuhan.late)} />
                  <MiniStat label="Belum selesai" value={String(kepatuhan.total - kepatuhan.done)} />
                </div>
                <ButtonLink href={`/paket/${pkg.id}/dokumen`} className="w-full">
                  Buka kepatuhan dokumen
                </ButtonLink>
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
