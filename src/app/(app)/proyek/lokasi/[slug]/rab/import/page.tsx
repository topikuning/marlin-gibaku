import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { formatRupiah, formatTanggal } from "@/lib/format";
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

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader
          title="Impor HPS / Adendum"
          subtitle={
            active
              ? `Revisi aktif sekarang: #${active.revisionNo} (${active.source === "adendum" ? "adendum" : "HPS awal"}) — ${formatRupiah(active.totalValue)}, ${formatTanggal(active.createdAt)}. File baru akan jadi revisi berikutnya.`
              : "Belum ada revisi RAB — file akan jadi revisi #1 dan baseline kurva-S dibuat otomatis."
          }
          action={
            <ButtonLink href={`/proyek/lokasi/${slug}/rab`} variant="ghost" size="sm">
              <ArrowLeft aria-hidden className="size-3.5" />
              Kembali ke RAB
            </ButtonLink>
          }
        />
        <CardBody>
          <ImportForm locationId={location.id} adaAktif={active != null} />
        </CardBody>
      </Card>
    </div>
  );
}
