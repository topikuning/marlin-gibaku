import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, KpiCard, PageHeader, StatusPill } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { papanTemuan } from "@/lib/findings/queries";
import { formatTanggal } from "@/lib/format";
import { FINDING_CATEGORY_LABEL, FINDING_STATUS_LABEL, FINDING_STATUS_TONE, ISSUE_SEVERITY_LABEL, ISSUE_SEVERITY_TONE } from "@/lib/lifecycle";
import { SaringTemuan } from "./saring";

export const metadata: Metadata = { title: "Temuan" };
export const dynamic = "force-dynamic";


export default async function TemuanPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tingkat?: string; kategori?: string; lokasi?: string; cari?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "finding.view");
  const sp = await searchParams;
  const bolehCatat = can(user.role, "finding.create");
  const bolehEkspor = can(user.role, "report.export");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) qs.set(k, v);
  const hrefXlsx = `/api/temuan/xlsx${qs.size ? `?${qs.toString()}` : ""}`;
  const hrefPdf = `/api/temuan/pdf${qs.size ? `?${qs.toString()}` : ""}`;

  const { baris, ringkas } = await papanTemuan(user, {
    status: sp.status,
    severity: sp.tingkat,
    kategori: sp.kategori,
    lokasi: sp.lokasi,
    cari: sp.cari,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Temuan"
        description="Ketidaksesuaian yang dicatat pihak pemeriksa – hanya selesai setelah verifikator menutupnya."
        actions={
          bolehCatat || bolehEkspor ? (
            <span className="flex flex-wrap gap-2">
              {bolehEkspor ? (
                <>
                  <ButtonLink href={hrefPdf} variant="secondary" unduhan labelSibuk="Menyiapkan…">
                    Unduh register (.pdf)
                  </ButtonLink>
                  <ButtonLink href={hrefXlsx} variant="secondary" unduhan labelSibuk="Menyiapkan…">
                    Unduh register (.xlsx)
                  </ButtonLink>
                </>
              ) : null}
              {bolehCatat ? <ButtonLink href="/temuan/baru">Catat temuan</ButtonLink> : null}
            </span>
          ) : undefined
        }
      />

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KpiCard label="Terbuka" value={ringkas.terbuka} href="/temuan?status=terbuka" />
        <KpiCard
          label="Kritis terbuka"
          value={ringkas.kritisTerbuka}
          tone={ringkas.kritisTerbuka > 0 ? "danger" : "default"}
          href="/temuan?status=terbuka&tingkat=kritis"
        />
        <KpiCard
          label="Lewat tenggat"
          value={ringkas.lewatTenggat}
          tone={ringkas.lewatTenggat > 0 ? "danger" : "default"}
          href="/temuan?status=lewat_tenggat"
        />
        <KpiCard label="Menunggu verifikasi" value={ringkas.menungguVerifikasi} tone={ringkas.menungguVerifikasi > 0 ? "warning" : "default"} href="/temuan?status=menunggu_verifikasi" />
        <KpiCard label="Dibuka kembali" value={ringkas.dibukaKembali} tone={ringkas.dibukaKembali > 0 ? "warning" : "default"} href="/temuan?status=dibuka_kembali" />
      </section>

      <Card>
        <CardHeader
          title={`${baris.length} temuan`}
          subtitle="Urutan: lewat tenggat – keparahan – terbaru"
          action={<SaringTemuan nilai={{ status: sp.status, tingkat: sp.tingkat, kategori: sp.kategori, cari: sp.cari }} />}
        />
        <CardBody>
          {baris.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Tidak ada temuan yang cocok"
              description={
                sp.status || sp.tingkat || sp.kategori || sp.cari
                  ? "Coba longgarkan saringan di atas."
                  : "Belum ada temuan di lokasi yang bisa Anda lihat."
              }
            />
          ) : (
            <ul className="space-y-2">
              {baris.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/temuan/${t.id}`}
                    className="block rounded-lg border border-border bg-surface p-3 hover:bg-surface-muted"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={FINDING_STATUS_TONE[t.status]} label={FINDING_STATUS_LABEL[t.status]} />
                      <Badge tone={ISSUE_SEVERITY_TONE[t.severity]} label={ISSUE_SEVERITY_LABEL[t.severity]} />
                      <Badge tone="neutral" label={FINDING_CATEGORY_LABEL[t.category]} />
                      {t.lewatTenggat ? <Badge tone="danger" label="Lewat tenggat" /> : null}
                      {t.reopenCount > 0 ? <Badge tone="warning" label={`Dibuka ulang ${t.reopenCount}×`} /> : null}
                    </div>
                    <div className="mt-1 text-sm font-medium text-ink">{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-muted">
                      <span>{t.locationName}</span>
                      <span>{formatTanggal(t.findingDate)}</span>
                      {t.dueDate ? <span>tenggat {formatTanggal(t.dueDate)}</span> : <span>tanpa tenggat</span>}
                      <span>PIC: {t.assignedName ?? "belum ditetapkan"}</span>
                      <span>{t.buktiCount} bukti</span>
                      <span>oleh {t.raisedByName}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
