import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { formatTanggal, formatTanggalWaktu } from "@/lib/format";
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE } from "@/lib/lifecycle";
import {
  ANTREAN_META,
  getAntreanLaporan,
  isAntreanKind,
  type AntreanItem,
  type AntreanKind,
} from "@/lib/daily-report/antrean";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ antrean: string }>;
}): Promise<Metadata> {
  const { antrean } = await params;
  return { title: isAntreanKind(antrean) ? ANTREAN_META[antrean].title : "Laporan" };
}

/**
 * Antrean laporan yang menunggu tindakan (DECISIONS 204).
 *
 * Tujuan kartu "Perlu Koreksi" / "Menunggu Verifikasi" di dashboard eksekutif.
 * Sebelum ini keduanya menunjuk `/laporan` — halaman berisi daftar lokasi dan
 * laporan FINAL, sehingga angka di kartu tidak punya jalan ke barangnya.
 */
export default async function AntreanPage({
  params,
}: {
  params: Promise<{ antrean: string }>;
}) {
  const { antrean } = await params;
  if (!isAntreanKind(antrean)) notFound();

  const user = await requireUser();
  requireCapabilityPage(user.role, "report.export");
  const scoped = await accessibleLocationIds(user);
  const items = await getAntreanLaporan(user, scoped, antrean);
  const meta = ANTREAN_META[antrean];

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Laporan", href: "/laporan" }, { label: meta.title }]}
        title={meta.title}
        description={meta.description}
        actions={
          items.length > 0 ? (
            <StatusPill
              tone={antrean === "perlu-koreksi" ? "warning" : "info"}
              label={`${items.length} laporan`}
            />
          ) : null
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={meta.kosong} description={meta.kosongDetail} />
      ) : (
        <Card className="divide-y divide-border p-0">
          {items.map((r) => (
            <BarisAntrean key={r.id} item={r} kind={antrean} />
          ))}
        </Card>
      )}
    </div>
  );
}

function BarisAntrean({ item, kind }: { item: AntreanItem; kind: AntreanKind }) {
  const perluKoreksi = kind === "perlu-koreksi";
  const status = perluKoreksi ? "perlu_koreksi" : "dikirim";
  return (
    <Link
      href={`/lokasi/${item.locationSlug}/harian/${item.dateKey}`}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{item.locationName}</span>
          <StatusPill tone={REPORT_STATUS_TONE[status]} label={REPORT_STATUS_LABEL[status]} />
          <span className="text-[13px] text-ink-muted">{formatTanggal(item.reportDate)}</span>
          {/* Lama menunggu ditulis sebagai kalimat, bukan cuma tanggal: "3 hari"
              langsung terbaca sebagai antrean yang menumpuk. */}
          {!perluKoreksi && item.menungguHari !== null ? (
            <span
              className={
                item.menungguHari >= 3 ? "text-[13px] font-medium text-danger" : "text-[13px] text-ink-muted"
              }
            >
              menunggu {item.menungguHari === 0 ? "hari ini" : `${item.menungguHari} hari`}
            </span>
          ) : null}
        </div>

        {perluKoreksi ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">Alasan: </span>
            {item.reason ?? (
              // Alasan kosong itu fakta yang berguna: pelapor tidak tahu apa yang
              // harus diperbaiki. Menyembunyikannya membuat laporan itu macet.
              <span className="text-warning">tidak diisi oleh yang mengembalikan</span>
            )}
          </p>
        ) : null}

        <p className="mt-1 text-xs text-ink-faint">
          {perluKoreksi ? "Dikembalikan" : "Dikirim"} {item.olehNama ?? "–"}
          {item.olehPada ? ` · ${formatTanggalWaktu(item.olehPada)}` : ""}
          {perluKoreksi && item.pelaporNama ? ` · pelapor ${item.pelaporNama}` : ""}
          {` · ${item.itemCount} item`}
        </p>
      </div>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
    </Link>
  );
}
