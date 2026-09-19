import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { totalWeeksFor } from "@/lib/rab/import";
import { requireLocationPage } from "../../get-location";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Impor RAB" };
export const dynamic = "force-dynamic";

export default async function RabImportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.manage");

  const active = await db.rabRevision.findFirst({
    where: { locationId: location.id, status: "aktif" },
    select: { revisionNo: true, totalValue: true, createdAt: true, source: true },
  });
  /*
   * Jumlah kolom minggu kontrak — dipakai HANYA untuk mencetak angka minggu
   * pertama profil "awal lambat" di panel pilihan. Penghitungnya yang SAMA
   * dengan yang dipakai generator baseline, supaya pratinjaunya bukan angka
   * lain yang kebetulan mirip.
   */
  const { totalWeeks } = await totalWeeksFor(location.id);

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader
          title="Impor HPS / Adendum"
          subtitle={
            active
              ? `Revisi aktif sekarang: #${active.revisionNo} (${active.source === "adendum" ? "adendum" : "HPS awal"}) – ${formatRupiah(active.totalValue)}, ${formatTanggal(active.createdAt)}. File baru akan jadi revisi berikutnya.`
              : "Belum ada revisi RAB – file akan jadi revisi #1. Bentuk kurva-S dipilih sesudah impor berhasil, tidak dibuat sendiri."
          }
          action={
            <ButtonLink href={`/lokasi/${slug}/rab`} variant="ghost" size="sm">
              <ArrowLeft aria-hidden className="size-3.5" />
              Kembali ke RAB
            </ButtonLink>
          }
        />
        <CardBody>
          <ImportForm
            locationId={location.id}
            slug={slug}
            adaAktif={active != null}
            totalWeeks={totalWeeks}
          />
        </CardBody>
      </Card>
    </div>
  );
}
