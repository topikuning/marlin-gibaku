import Link from "next/link";
import { Camera, ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { PageHeader, KpiCard, Card, EmptyState } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getPhotoGallery, type GalleryFilters } from "@/lib/photos-gallery";
import { PHOTO_VERIF_LABEL, ALL_VERIFICATIONS } from "@/lib/photo-verif";
import type { PhotoVerification } from "@/generated/prisma/enums";
import { GalleryGrid } from "./gallery-grid";

export const dynamic = "force-dynamic";

const SELECT = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:border-border-strong focus:outline-none";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Galeri Foto Lapangan — semua bukti visual proyek dalam satu tempat. */
export default async function FotoLapanganPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "location.view");
  const locIds = await accessibleLocationIds(user);
  const sp = await searchParams;

  const status = one(sp.status);
  const filters: GalleryFilters = {
    locationId: one(sp.lokasi) || undefined,
    verification: ALL_VERIFICATIONS.includes(status as PhotoVerification) ? (status as PhotoVerification) : undefined,
    source: one(sp.sumber) === "laporan" ? "laporan" : one(sp.sumber) === "kegiatan" ? "kegiatan" : undefined,
    q: one(sp.q) || undefined,
    page: Number(one(sp.page)) || 1,
  };
  const data = await getPhotoGallery(locIds, filters);

  // Query string helper untuk chip & paginasi (pertahankan filter lain).
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      lokasi: filters.locationId,
      status: filters.verification,
      sumber: filters.source,
      q: filters.q,
    };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `/foto?${s}` : "/foto";
  };

  const chips: { label: string; href: string; active: boolean }[] = [
    { label: "Semua Foto", href: qs({ status: undefined, sumber: undefined, page: undefined }), active: !filters.verification && !filters.source },
    { label: "Menunggu Review", href: qs({ status: "pending", page: undefined }), active: filters.verification === "pending" },
    { label: "Terverifikasi", href: qs({ status: "passed", page: undefined }), active: filters.verification === "passed" },
    { label: "Tanpa GPS", href: qs({ status: "flagged_gps", page: undefined }), active: filters.verification === "flagged_gps" },
    { label: "Laporan Harian", href: qs({ sumber: "laporan", page: undefined }), active: filters.source === "laporan" },
    { label: "Kegiatan Lapangan", href: qs({ sumber: "kegiatan", page: undefined }), active: filters.source === "kegiatan" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Foto & Galeri Lapangan"
        description="Semua bukti visual proyek dalam satu tempat — terhubung ke lokasi, laporan/item pekerjaan atau kegiatan, pelapor, GPS, dan status verifikasi."
      />

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Foto Hari Ini" value={data.kpi.total.toLocaleString("id-ID")} sub="Diunggah hari ini" />
        <KpiCard label="Terverifikasi" value={data.kpi.verified.toLocaleString("id-ID")} sub="Hari ini" tone="success" />
        <KpiCard label="Menunggu Review" value={data.kpi.pending.toLocaleString("id-ID")} sub="Hari ini" tone="warning" />
        <KpiCard label="Terkait Kendala" value={data.kpi.issue.toLocaleString("id-ID")} sub="Kegiatan berkendala" tone="danger" />
        <KpiCard label="Tanpa GPS" value={data.kpi.noGps.toLocaleString("id-ID")} sub="Perlu pemeriksaan" tone="warning" />
      </div>

      {/* Filter */}
      <form method="get" action="/foto" className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-sm">
        <select name="lokasi" defaultValue={filters.locationId ?? ""} className={SELECT}>
          <option value="">Semua Lokasi</option>
          {data.locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <select name="status" defaultValue={filters.verification ?? ""} className={SELECT}>
          <option value="">Semua Status Verifikasi</option>
          {ALL_VERIFICATIONS.map((v) => (
            <option key={v} value={v}>{PHOTO_VERIF_LABEL[v]}</option>
          ))}
        </select>
        <select name="sumber" defaultValue={filters.source ?? ""} className={SELECT}>
          <option value="">Semua Sumber</option>
          <option value="laporan">Laporan Harian</option>
          <option value="kegiatan">Kegiatan Lapangan</option>
        </select>
        <input name="q" defaultValue={filters.q ?? ""} placeholder="Cari caption / lokasi / pelapor…" className={`${SELECT} min-w-52 flex-1`} />
        <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">Terapkan</button>
      </form>

      {/* Chip cepat */}
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              c.active ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink-muted hover:bg-surface-muted"
            }`}
          >
            {c.label}
          </Link>
        ))}
        <span className="ml-auto self-center text-xs text-ink-muted">{data.count.toLocaleString("id-ID")} foto</span>
      </div>

      {/* Galeri */}
      {data.groups.length === 0 ? (
        <Card className="p-0">
          <EmptyState icon={ImageOff} title="Tidak ada foto" description="Belum ada foto yang cocok dengan filter ini." />
        </Card>
      ) : (
        <GalleryGrid groups={data.groups} />
      )}

      {/* Paginasi */}
      {(data.page > 1 || data.hasMore) && data.groups.length > 0 ? (
        <div className="flex items-center justify-center gap-3">
          {data.page > 1 ? (
            <Link href={qs({ page: data.page - 1 })} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-muted">
              <ChevronLeft aria-hidden className="size-4" /> Sebelumnya
            </Link>
          ) : null}
          <span className="text-sm text-ink-muted">Halaman {data.page}</span>
          {data.hasMore ? (
            <Link href={qs({ page: data.page + 1 })} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-muted">
              Berikutnya <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : null}
        </div>
      ) : null}

      <p className="flex items-center gap-1 text-xs text-ink-faint">
        <Camera aria-hidden className="size-3.5" /> Foto diunggah lewat Laporan Harian & Kegiatan Lapangan; klik foto untuk memperbesar.
      </p>
    </div>
  );
}
