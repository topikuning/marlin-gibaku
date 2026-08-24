import type { Metadata } from "next";
import Link from "next/link";
import { Siren } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { bangunEws } from "@/lib/ews/builder";
import { EWS_KATEGORI_LABEL, EWS_SEVERITY_LABEL, type EwsSeverity, type EwsWarning } from "@/lib/ews/rules";

export const metadata: Metadata = { title: "Perlu Tindakan" };
export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<EwsSeverity, "danger" | "warning" | "info"> = {
  kritis: "danger",
  tinggi: "warning",
  sedang: "info",
};

function KartuWarning({ w }: { w: EwsWarning }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[w.severity]} label={EWS_SEVERITY_LABEL[w.severity]} />
        <Badge tone="neutral" label={EWS_KATEGORI_LABEL[w.kategori]} />
        <span className="text-sm font-semibold text-ink">{w.objek}</span>
      </div>
      <p className="mt-1 text-sm text-ink">{w.alasan}</p>
      <p className="mt-0.5 text-xs text-ink-muted">Saran: {w.tindakan}</p>
      <p className="mt-1">
        <Link href={w.href} className="text-xs font-medium text-primary underline">
          Buka objeknya
        </Link>
      </p>
    </li>
  );
}

export default async function PerluTindakanPage({
  searchParams,
}: {
  searchParams: Promise<{ tingkat?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "portfolio.view");
  const sp = await searchParams;

  const semua = await bangunEws(user);
  const kritis = semua.filter((w) => w.severity === "kritis");
  const tinggi = semua.filter((w) => w.severity === "tinggi");
  const sedang = semua.filter((w) => w.severity === "sedang");

  const kolom: { key: EwsSeverity; judul: string; isi: EwsWarning[] }[] = [
    { key: "kritis", judul: "Kritis", isi: kritis },
    { key: "tinggi", judul: "Tinggi", isi: tinggi },
    { key: "sedang", judul: "Sedang", isi: sedang },
  ].filter((k) => !sp.tingkat || k.key === sp.tingkat) as { key: EwsSeverity; judul: string; isi: EwsWarning[] }[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Perlu Tindakan"
        description="Peringatan dini berbasis aturan – progress, kontrak, laporan, temuan, kendala, dokumen. Semua angka dari calculation layer; tidak ada AI di halaman ini."
      />

      <section className="grid grid-cols-3 gap-2">
        <KpiCard label="Kritis" value={kritis.length} tone={kritis.length > 0 ? "danger" : "default"} href="/perlu-tindakan?tingkat=kritis" />
        <KpiCard label="Tinggi" value={tinggi.length} tone={tinggi.length > 0 ? "warning" : "default"} href="/perlu-tindakan?tingkat=tinggi" />
        <KpiCard label="Sedang" value={sedang.length} href="/perlu-tindakan?tingkat=sedang" />
      </section>

      {semua.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={Siren}
              title="Tidak ada peringatan"
              description="Tidak ada aturan yang terpicu di lingkup Anda – atau belum ada penugasan lokasi."
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {kolom.map((k) => (
            <Card key={k.key} className={sp.tingkat ? "lg:col-span-3" : undefined}>
              <CardHeader title={`${k.judul} (${k.isi.length})`} />
              <CardBody>
                {k.isi.length === 0 ? (
                  <p className="text-sm text-ink-muted">Tidak ada.</p>
                ) : (
                  <ul className="space-y-2">
                    {k.isi.map((w, i) => (
                      <KartuWarning key={`${w.ruleId}-${w.objek}-${i}`} w={w} />
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
