import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Banner, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { buildPhotoViews } from "@/lib/photos";
import { konteksFoto } from "@/lib/photo-restamp/service";
import { formatTanggalWaktu } from "@/lib/format";
import { RestampForm, type NilaiForm } from "./restamp-form";

export const metadata: Metadata = { title: "Perbaiki cap foto" };
export const dynamic = "force-dynamic";

/** "2026-07-31T09:15" dalam jam dinding Asia/Jakarta — untuk input datetime-local. */
function localInputValue(d: Date): string {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return p.replace(" ", "T");
}

/**
 * Perbaikan cap satu foto (DECISIONS 198). Halaman terpisah, bukan modal:
 * pengguna perlu melihat foto ber-cap yang SEKARANG berdampingan dengan nilai
 * usulan sebelum menimpanya, dan riwayat revisinya perlu muat.
 */
export default async function PerbaikiCapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  requireCapabilityPage(user.role, "photo.restamp");

  const k = await konteksFoto(id);
  if (!k) notFound();
  if (!k.locationId) notFound();
  await requireLocationAccess(user, k.locationId);

  const [view] = await buildPhotoViews([
    { id: k.photoId, r2Key: k.r2Key, thumbnailKey: k.thumbnailKey } as never,
  ]);
  const revisi = await db.photoStampRevision.findMany({
    where: { photoId: k.photoId },
    orderBy: { revision: "desc" },
    select: { revision: true, reason: true, manualFields: true, createdAt: true, changedById: true },
  });
  const pengubah = revisi.length
    ? await db.user.findMany({
        where: { id: { in: [...new Set(revisi.map((r) => r.changedById))] } },
        select: { id: true, fullName: true },
      })
    : [];
  const namaPengubah = new Map(pengubah.map((u) => [u.id, u.fullName]));

  // Nilai AWAL = apa yang tercap sekarang. Nilai USULAN = hasil ambil ulang
  // dari data terkini (lokasi/perusahaan/pelapor/kategori + titik proyek bila
  // fotonya memang memakai cadangan). Selisih keduanya = yang akan diperbaiki.
  const awal: NilaiForm = {
    takenAtLocal: localInputValue(k.saatIni.takenAt),
    jamDiketahui: k.saatIni.jamDiketahui,
    lat: k.saatIni.lat?.toString() ?? "",
    lng: k.saatIni.lng?.toString() ?? "",
    locationLabel: k.saatIni.locationLabel ?? "",
    companyName: k.saatIni.companyName ?? "",
    reporterName: k.saatIni.reporterName ?? "",
    categoryName: k.saatIni.categoryName ?? "",
  };
  const pakaiTitikProyek = k.saatIni.gpsSource === "project";
  const usulan: NilaiForm = {
    ...awal,
    lat: pakaiTitikProyek ? (k.projectLat?.toString() ?? "") : awal.lat,
    lng: pakaiTitikProyek ? (k.projectLng?.toString() ?? "") : awal.lng,
    locationLabel: k.locationName ?? awal.locationLabel,
    companyName: k.companyName ?? awal.companyName,
    reporterName: k.reporterName ?? awal.reporterName,
    categoryName: k.categoryName ?? awal.categoryName,
  };

  const bisaDiperbaiki = !!k.originalKey;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Perbaiki cap foto"
        description="Cap dirender ULANG dari berkas asli yang diarsipkan – bukan dicap ulang di atas gambar ber-cap."
        actions={
          <Link href="/foto" className="text-sm text-primary hover:underline">
            ← Galeri Foto
          </Link>
        }
      />

      {!bisaDiperbaiki ? (
        <Banner
          tone="error"
          title={
            k.originalPurgedAt
              ? "Arsip berkas asli foto ini sudah dihapus – capnya tidak bisa diperbaiki lagi."
              : "Foto ini diunggah sebelum arsip berkas asli aktif, jadi capnya tidak bisa diperbaiki."
          }
          description="Perbaikan cap selalu dimulai dari berkas asli. Tanpa arsipnya, cap lama sudah menyatu dengan pikselnya."
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader
            title="Cap yang berlaku sekarang"
            subtitle={k.stampRevision > 0 ? `Revisi ke-${k.stampRevision}` : "Cap asli dari unggahan"}
          />
          <CardBody className="space-y-2">
            {view?.fullUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL presigned R2 sementara
              <img src={view.fullUrl} alt="" className="w-full rounded-md" />
            ) : (
              <p className="text-sm text-ink-muted">Gambar tidak bisa dimuat.</p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-ink-muted">Sumber koordinat</dt>
              <dd>
                <Badge
                  tone={
                    k.saatIni.gpsSource === "exif" || k.saatIni.gpsSource === "device"
                      ? "success"
                      : "warning"
                  }
                  label={k.saatIni.gpsSource}
                />
              </dd>
              <dt className="text-ink-muted">Sumber waktu</dt>
              <dd>
                <Badge tone="neutral" label={k.saatIni.timeSource} />
              </dd>
              <dt className="text-ink-muted">Photo ID</dt>
              <dd className="tabular">{k.saatIni.photoId ?? "– (belum punya)"}</dd>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Nilai baru"
            subtitle="Sudah diisi hasil ambil-ulang dari data terkini. Ubah seperlunya."
          />
          <CardBody>
            {bisaDiperbaiki ? (
              <RestampForm photoId={k.photoId} awal={awal} usulan={usulan} />
            ) : (
              <p className="text-sm text-ink-muted">Form dinonaktifkan – arsip aslinya tidak ada.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Riwayat perbaikan" subtitle="Append-only – tidak bisa diubah atau dihapus." />
        <CardBody>
          {revisi.length === 0 ? (
            <p className="text-sm text-ink-muted">Cap foto ini belum pernah diperbaiki.</p>
          ) : (
            <ul className="divide-y divide-border-muted text-sm">
              {revisi.map((r) => (
                <li key={r.revision} className="py-2">
                  <div className="font-medium text-ink">
                    Revisi {r.revision} · {namaPengubah.get(r.changedById) ?? "–"}
                  </div>
                  <p className="text-xs text-ink-muted">
                    {formatTanggalWaktu(r.createdAt)} · diketik manual:{" "}
                    {r.manualFields.length ? r.manualFields.join(", ") : "–"}
                  </p>
                  <p className="mt-0.5 text-xs text-ink">{r.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
