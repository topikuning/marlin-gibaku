import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Banner, ButtonLink, LinkTabs, StatusPill, type LinkTabItem } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { cn } from "@/lib/cn";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_TONE } from "@/lib/lifecycle";
import { formatPct, formatRupiah, formatTanggal } from "@/lib/format";
import { getLocationProgress, getProgresDraftAdendum } from "@/lib/progress";
import { BarisDraftAdendum } from "./baris-draft-adendum";
import { can } from "@/lib/authz";
import { alasanLokasiTertutup } from "@/lib/package/lingkup-lokasi";
import { kawalUntukLokasi } from "@/lib/kawal/queries";
import { getSiblingLocations, requireLocationPage } from "./get-location";
import { EditableLocationName } from "./edit-name";
import { LocationSwitcher } from "./location-switcher";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;

// Helper di luar komponen — aturan purity render melarang Date.now() langsung di body.
function remainingDaysUntil(endDate: Date): number {
  return Math.ceil((endDate.getTime() - Date.now()) / DAY_MS);
}

function tabItems(slug: string, bolehKeuangan: boolean, bolehDokumen: boolean): LinkTabItem[] {
  const base = `/lokasi/${slug}`;
  return [
    { label: "Ringkasan", href: base, exact: true },
    { label: "Rencana & RAB", href: `${base}/rab` },
    // Progress dan RAPL BERTUKAR tempat (permintaan user 2026-08-18): Progress
    // dibaca hampir tiap hari, RAPL jauh lebih jarang — jadi yang sering duduk
    // dekat "Rencana & RAB", dan yang jarang pindah ke belakang.
    { label: "Progress", href: `${base}/progress` },
    // Foto laporan harian dipilah per sarana & prasarana, urut tanggal
    // (DECISIONS 683) – seperti kawal-knmp KKP.
    { label: "Foto Sarpras", href: `${base}/foto-sarpras` },
    // Pembanding dari Kawal KNMP (DECISIONS 691) – rujukan, bukan angka resmi.
    { label: "Kawal KNMP", href: `${base}/kawal` },
    // Tab milik slice lain — link saja, halamannya dibangun terpisah.
    { label: "Pelaksanaan Harian", href: `${base}/harian` },
    { label: "Kegiatan Lapangan", href: `${base}/kegiatan` },
    { label: "RAPL", href: `${base}/rapl` },
    // Keuangan DITAHAN sementara (DECISIONS 411): halamannya sendiri sudah
    // dijaga `finance.view`, jadi tab yang tetap tampil hanya akan menuntun
    // orang ke layar "tidak punya izin".
    ...(bolehKeuangan ? [{ label: "Keuangan", href: `${base}/keuangan` }] : []),
    // Pelaksana tidak membuka dokumen (DECISIONS 736) – halamannya juga dijaga.
    ...(bolehDokumen ? [{ label: "Dokumen & Kepatuhan", href: `${base}/dokumen` }] : []),
    { label: "Laporan", href: `${base}/laporan-lokasi` },
    // Laporan menyeluruh satu lokasi (DECISIONS 426 + permintaan user
    // 2026-09-19): kesimpulan, progres, kendala, temuan, administrasi dalam
    // satu halaman, plus PDF/deck dan kiriman WhatsApp.
    { label: "Laporan Lengkap", href: `${base}/laporan-lengkap` },
  ];
}

export default async function LokasiLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  // Pensil ganti nama: super_admin + Program Director saja (DECISIONS 686).
  // Server action-nya memeriksa kapabilitas yang sama.
  const canRename = can(user.role, "location.rename");
  // Halaman paket dijaga `package.view`; Pelaksana tidak memegangnya, jadi
  // baginya nama paket ditulis biasa, bukan tautan ke layar "tidak punya izin".
  const bolehPaket = can(user.role, "package.view");
  // Pelaksana tidak melihat rupiah, termasuk nilai kontrak (DECISIONS 735).
  const lihatUang = can(user.role, "money.view");
  const [progress, { siblings, hiddenCount }, tertutup, kawalPer] = await Promise.all([
    getLocationProgress(location.id),
    getSiblingLocations(user, location.package.id),
    // Dicabut dari kontrak: dikatakan di SETIAP tab, sebelum orang mengisi
    // apa pun lalu ditolak (DECISIONS 616).
    alasanLokasiTertutup(location.id),
    // Angka Kawal di samping angka MARLIN (DECISIONS 691) – hanya bila lokasi
    // ini sudah berpasangan; tanpa pasangan sel-selnya tetap seperti dulu.
    can(user.role, "kawal.view") ? kawalUntukLokasi([location.id]) : Promise.resolve(null),
  ]);
  const kawal = kawalPer?.get(location.id) ?? null;
  // Bobot menurut DRAFT adendum (DECISIONS 732) – pantauan, bukan angka resmi.
  const draftProg = await getProgresDraftAdendum(location.id, undefined, {
    realizedValueResmi: progress.realizedValue,
  });
  const contract = location.package.contract;
  const current = siblings.find((l) => l.slug === location.slug) ?? {
    slug: location.slug,
    name: location.name,
    regency: location.regency,
    status: location.status,
    deviationPct: null,
  };

  const remainingDays = contract?.endDate ? remainingDaysUntil(contract.endDate) : null;

  return (
    <div className="space-y-4">
      {/* Header proyek terstruktur (audit UI #5): identitas + stat berlabel dalam
          kartu, bukan satu baris teks datar — informasi lebih cepat dipindai. */}
      {/* DI PONSEL header ini DISEMBUNYIKAN (permintaan user 2026-08-02: "untuk
          tampilan mobile pada halaman input pekerjaan … informasi di atas
          inputan seperti progress dll, di hide saja").

          Alasannya nyata: identitas + alamat + paket + enam sel statistik
          memakan ~600px sebelum kolom pertama yang harus diisi mandor —
          di layar 812px itu berarti menggulir dua kali hanya untuk mulai
          bekerja. Angkanya tidak hilang, cuma tidak dipaksakan di layar input:
          semuanya ada di tab Ringkasan, lengkap dengan kartu KPI-nya sendiri.
          Yang tetap tampil di ponsel: nama lokasi, status, dan deviasi — tiga
          hal yang menjawab "saya sedang di lokasi mana, dan sedang seberapa
          tertinggal". */}
      <header className="space-y-3 max-sm:hidden">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Nama lokasi merangkap pemicu pemilih lokasi sepaket — pindah
                  lokasi tanpa memutar lewat halaman paket (DECISIONS 204). */}
              <EditableLocationName
                locationId={location.id}
                name={location.name}
                canEdit={canRename}
                nameSlot={
                  <LocationSwitcher
                    current={current}
                    siblings={siblings}
                    hiddenCount={hiddenCount}
                    packageName={location.package.name}
                  />
                }
              />
              <StatusPill
                tone={LOCATION_STATUS_TONE[location.status]}
                label={LOCATION_STATUS_LABEL[location.status]}
              />
              {tertutup ? <StatusPill tone="warning" label="Dicabut dari kontrak" /> : null}
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">
              {location.village}, {location.regency} – {location.province}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 text-right text-[13px]">
            {bolehPaket ? (
              <Link href={`/paket/${location.package.id}`} className="font-medium text-primary hover:underline">
                {location.package.name}
              </Link>
            ) : (
              <span className="font-medium text-ink">{location.package.name}</span>
            )}
            {contract ? <p className="text-ink-muted">{contract.vendor.name}</p> : null}
            {/*
              Presentasi SATU lokasi (DECISIONS 420). Tautannya membawa
              ?lokasi= sehingga formulirnya terbuka dengan lingkup lokasi ini
              sudah terpilih — bukan lingkup paket yang harus diganti sendiri.
            */}
            {can(user.role, "ai.generate") && contract?.startDate && location.isActive ? (
              <ButtonLink
                href={`/ai/paparan?paket=${location.package.id}&lokasi=${location.id}`}
                size="sm"
              >
                Buat Presentasi
              </ButtonLink>
            ) : null}
          </div>
        </div>

        {/* Sel berpasangan MARLIN | Kawal butuh ruang dua angka: enam kolom baru
            dipakai mulai xl, supaya di 1024 px lencana deviasi tidak menabrak
            garis pemisahnya. */}
        <dl
          className={cn(
            "grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3",
            lihatUang ? (kawal ? "xl:grid-cols-6" : "lg:grid-cols-6") : kawal ? "xl:grid-cols-5" : "lg:grid-cols-5",
          )}
        >
          {lihatUang ? (
            <StatCell label="Nilai kontrak">
              {contract ? (
                <span className="tabular">{formatRupiah(contract.contractValue)}</span>
              ) : (
                <span className="text-ink-faint">–</span>
              )}
              {contract ? <span className="ml-1 text-[11px] font-normal text-ink-faint">inkl. PPN</span> : null}
            </StatCell>
          ) : null}
          <StatCell label="Periode kontrak">
            {contract?.startDate && contract.endDate ? (
              <span className="tabular text-[13px]">
                {formatTanggal(contract.startDate)} – {formatTanggal(contract.endDate)}
              </span>
            ) : contract ? (
              <span className="text-[13px] text-ink-faint">{contract.durationDays} hari – menunggu SPMK</span>
            ) : (
              <span className="text-ink-faint">Belum ada</span>
            )}
            {remainingDays != null ? (
              <span
                className={cn(
                  "ml-1 text-[11px] font-normal",
                  remainingDays >= 0 ? "text-ink-faint" : "text-danger",
                )}
              >
                {remainingDays >= 0 ? `sisa ${remainingDays} hari` : `lewat ${-remainingDays} hari`}
              </span>
            ) : null}
          </StatCell>
          {/* Bila lokasi ini berpasangan dengan Kawal KNMP, tiga sel ini
              memuat DUA angka: MARLIN (resmi) dan Kawal (rujukan pengawas,
              apa adanya) – permintaan user 2026-10-19, DECISIONS 691. */}
          <StatCell label="Rencana">
            {kawal ? (
              <PasanganAngka
                slug={slug}
                marlin={formatPct(progress.planPct)}
                kawal={kawal.targetPct != null ? formatPct(kawal.targetPct) : "–"}
              />
            ) : (
              <span className="tabular">{formatPct(progress.planPct)}</span>
            )}
          </StatCell>
          <StatCell label="Realisasi">
            {kawal ? (
              <PasanganAngka
                slug={slug}
                marlin={formatPct(progress.realizedPct)}
                kawal={kawal.actualPct != null ? formatPct(kawal.actualPct) : "–"}
              />
            ) : (
              <span className="tabular">{formatPct(progress.realizedPct)}</span>
            )}
            {draftProg ? <BarisDraftAdendum slug={slug} draft={draftProg} /> : null}
          </StatCell>
          <StatCell label="Deviasi">
            {kawal ? (
              <PasanganAngka
                slug={slug}
                marlin={<DeltaBadge value={progress.deviationPct} />}
                kawal={kawal.deviasiPct != null ? <DeltaBadge value={kawal.deviasiPct} /> : "–"}
              />
            ) : (
              <DeltaBadge value={progress.deviationPct} />
            )}
          </StatCell>
          {/* Angka yang DIBACA, jadi `weekNumberElapsed` — bukan `weekNumber`
              yang di-clamp untuk mencari rencana%. Sel ini pernah menulis
              "22/22" untuk lokasi yang kontraknya sudah lewat seminggu dengan
              realisasi 0%, sementara laporan lengkap di layar yang sama menulis
              "ke-23". DECISIONS 593. */}
          <StatCell label="Minggu berjalan">
            <span className="tabular">
              {progress.weekNumberElapsed}
              <span className="text-ink-faint">/{progress.totalWeeks}</span>
              {progress.totalWeeks > 0 && progress.weekNumberElapsed > progress.totalWeeks ? (
                <span className="ml-1 text-[11px] font-medium text-danger">
                  lewat {progress.weekNumberElapsed - progress.totalWeeks}
                </span>
              ) : null}
            </span>
          </StatCell>
        </dl>
      </header>

      {/* Baris ringkas pengganti header di ponsel — satu baris, bukan blok.

          Nama lokasinya IKUT merangkap pemilih lokasi sepaket, sama seperti di
          desktop (permintaan user 2026-08-13). Sebelumnya baris ini cuma teks
          mati, jadi di ponsel satu-satunya jalan pindah lokasi adalah kembali
          ke daftar dan mencari dari awal — padahal justru di ponsel, di mana
          tab-tab-nya digulir mendatar, kehilangan konteks itu paling mahal. */}
      <div className="space-y-1 sm:hidden">
        {/* Jalan kembali ke paket, DECISIONS 687 (keluhan user 2026-10-17: *"di HP, saat masuk
            lokasi, sulit untuk kembali ke halaman paket"*). Tautan paket di
            desktop ada di header yang di ponsel disembunyikan, jadi di sini
            tidak ada jalan ke atas sama sekali. */}
        {bolehPaket ? (
          <Link
            href={`/paket/${location.package.id}`}
            title={`Kembali ke ${location.package.name}`}
            className="-ml-1 inline-flex min-h-8 max-w-full items-center gap-0.5 rounded-md pr-1.5 text-[13px] font-medium text-primary pointer-coarse:min-h-11 hover:underline"
          >
            <ChevronLeft aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{location.package.name}</span>
          </Link>
        ) : null}
        <div className="flex items-center gap-2">
          <LocationSwitcher
            compact
            current={current}
            siblings={siblings}
            hiddenCount={hiddenCount}
            packageName={location.package.name}
          />
          {tertutup ? (
            <StatusPill tone="warning" label="Dicabut" />
          ) : (
            <StatusPill
              tone={LOCATION_STATUS_TONE[location.status]}
              label={LOCATION_STATUS_LABEL[location.status]}
            />
          )}
          <span className="ms-auto shrink-0">
            <DeltaBadge value={progress.deviationPct} />
          </span>
        </div>
      </div>

      <LinkTabs items={tabItems(location.slug, can(user.role, "finance.view"), can(user.role, "document.view"))} />

      {tertutup ? <Banner tone="warning" title={tertutup} /> : null}
      {children}
    </div>
  );
}

/** Sel stat berlabel untuk header lokasi. */
/**
 * Dua angka dalam satu sel, DIPISAH GARIS DIAGONAL merah – bentuk yang
 * digambar user 2026-10-19 – dan dibedakan warnanya: MARLIN (resmi) biru tua,
 * Kawal (rujukan pengawas) abu-abu. Label "Kawal" menuju tab pembandingnya.
 */
function PasanganAngka({ slug, marlin, kawal }: { slug: string; marlin: ReactNode; kawal: ReactNode }) {
  return (
    <span className="relative grid grid-cols-2 items-center gap-x-6">
      <span className="tabular text-primary">{marlin}</span>
      <span className="tabular text-ink-muted">{kawal}</span>
      <span className="text-[10px] font-semibold tracking-wide text-primary uppercase">MARLIN</span>
      <Link
        href={`/lokasi/${slug}/kawal`}
        className="text-[10px] font-semibold tracking-wide text-ink-muted uppercase hover:text-ink hover:underline"
      >
        Kawal
      </Link>
      <svg
        aria-hidden
        viewBox="0 0 10 40"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-y-0 left-1/2 h-full w-4 -translate-x-1/2 text-brand-red"
      >
        <line x1="1" y1="40" x2="9" y2="0" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

function StatCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface px-3 py-2">
      <dt className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{children}</dd>
    </div>
  );
}
