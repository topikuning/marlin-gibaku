import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getRecapLeaves } from "@/lib/daily-report/recap-import";
import { RecapImportClient } from "./recap-import-client";

export const metadata: Metadata = { title: "Impor Rekap Harian" };
export const dynamic = "force-dynamic";

/**
 * Impor rekap laporan harian dari Excel — untuk backfill saat lapangan lupa
 * lapor. Membuat laporan harian per tanggal (status "dikirim" → menunggu
 * verifikasi); progress ikut naik otomatis setelah diverifikasi.
 */
export default async function ImporRekapHarianPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  requireCapabilityPage(user.role, "daily_report.create");
  const location = await db.location.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const leaves = await getRecapLeaves(location.id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Impor Rekap Laporan Harian"
        description={`${location.name} — unggah rekap Excel untuk merekonstruksi laporan harian yang terlewat.`}
      />

      <Link href={`/lokasi/${slug}/harian`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Kembali ke Pelaksanaan Harian
      </Link>

      <Card>
        <CardHeader title="Cara pakai" />
        <CardBody className="space-y-2 text-sm text-ink-muted">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Unduh{" "}
              <Link href={`/lokasi/${slug}/harian/import/template`} className="font-medium text-primary hover:underline">
                template Excel
              </Link>{" "}
              — sudah berisi daftar {leaves.length} item pekerjaan RAB (kode, uraian, satuan, sisa volume).
            </li>
            <li>Isi kolom <span className="font-medium">Tanggal</span> (mis. 2026-07-12) dan <span className="font-medium">Volume Terpasang</span> per baris. Satu pekerjaan boleh muncul di beberapa tanggal.</li>
            <li>Unggah kembali di sini, cek pratinjau, lalu simpan.</li>
          </ol>
          <p className="rounded-md bg-surface-muted px-3 py-2 text-xs">
            Laporan hasil impor masuk berstatus <span className="font-medium">Dikirim (menunggu verifikasi)</span> —
            baru dihitung ke progres setelah disetujui manajemen. Volume yang melebihi sisa RAB otomatis ditandai &amp; dilewati.
          </p>
        </CardBody>
      </Card>

      <RecapImportClient locationId={location.id} slug={slug} hasRab={leaves.length > 0} />
    </div>
  );
}
