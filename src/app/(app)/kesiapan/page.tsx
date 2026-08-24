import type { Metadata } from "next";
import Link from "next/link";
import { Gauge } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { formatPct } from "@/lib/format";
import { kesiapanPortofolio } from "@/lib/kesiapan/builder";
import { KESIAPAN_VERDICT_LABEL, KESIAPAN_VERDICT_TONE } from "@/lib/kesiapan/rules";
import { PACKAGE_STAGE_LABEL, PACKAGE_STAGE_TONE } from "@/lib/lifecycle";

export const metadata: Metadata = { title: "Kesiapan" };
export const dynamic = "force-dynamic";

const SYARAT_ICON = { lolos: "✓", peringatan: "⚠", gagal: "✗" } as const;
const SYARAT_CLASS = {
  lolos: "text-success",
  peringatan: "text-warning",
  gagal: "text-danger",
} as const;

export default async function KesiapanPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const paket = await kesiapanPortofolio(user);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kesiapan"
        description="Kesiapan termin, PHO, FHO, dan close-out per paket – dari mesin aturan, bukan perkiraan. Progress terverifikasi = laporan disetujui + final."
      />

      {paket.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={Gauge}
              title="Belum ada paket dalam pelaksanaan"
              description="Kesiapan dihitung untuk paket berstatus pelaksanaan, serah terima, atau selesai di lingkup Anda."
            />
          </CardBody>
        </Card>
      ) : (
        paket.map((p) => (
          <Card key={p.packageId}>
            <CardHeader
              title={
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Link href={`/paket/${p.packageId}`} className="hover:underline">
                    {p.packageName}
                  </Link>
                  <StatusPill
                    tone={PACKAGE_STAGE_TONE[p.stage as keyof typeof PACKAGE_STAGE_TONE]}
                    label={PACKAGE_STAGE_LABEL[p.stage as keyof typeof PACKAGE_STAGE_LABEL]}
                  />
                </span>
              }
              subtitle={`Progress dilaporkan ${formatPct(p.progressDilaporkanPct)} · terverifikasi ${formatPct(p.progressTerverifikasiPct)} · ${p.lokasi.length} lokasi`}
            />
            <CardBody>
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                {p.kartu.map((k) => (
                  <div key={k.jenis} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{k.judul}</span>
                      <StatusPill tone={KESIAPAN_VERDICT_TONE[k.verdict]} label={KESIAPAN_VERDICT_LABEL[k.verdict]} />
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {k.syarat.map((s) => (
                        <li key={s.key} className="text-xs">
                          <span className={`font-semibold ${SYARAT_CLASS[s.status]}`}>{SYARAT_ICON[s.status]}</span>{" "}
                          <span className="font-medium text-ink">{s.label}</span>
                          <div className="ml-4 text-ink-muted">
                            {s.href ? (
                              <Link href={s.href} className="hover:underline">
                                {s.detail}
                              </Link>
                            ) : (
                              s.detail
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
