import type { Metadata } from "next";
import { Download, Images } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { UbinSarpras } from "@/components/knmp/ubin-sarpras";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { formatNumber } from "@/lib/format";
import { susunDokumentasiSarpras } from "@/lib/dokumentasi-sarpras/susun";
import { ubinSarpras } from "@/lib/dokumentasi-sarpras/ubin";
import { requireLocationPage } from "../get-location";

export const metadata: Metadata = { title: "Foto Sarana & Prasarana" };
export const dynamic = "force-dynamic";

/**
 * DOKUMENTASI FOTO PER SARANA & PRASARANA (DECISIONS 683) – ubin per sarana
 * (foto terkini, nama, progres) seperti kawal-knmp KKP; ketuk untuk slide.
 */
export default async function FotoSarprasPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "progress.view");

  const dok = await susunDokumentasiSarpras(location.id);
  if (!dok) {
    return (
      <EmptyState
        icon={Images}
        title="Belum ada RAB aktif"
        description="Sarana dan prasarana diambil dari kategori RAB aktif. Impor RAB lokasi ini dulu."
      />
    );
  }

  const jumlahFoto = dok.sarpras.reduce((t, s) => t + s.foto.length, 0);
  const t = dok.tanpaSarana;
  const tanpa = t.material + t.alat + t.umum + t.tanpaKategori;
  const rincianTanpa = [
    t.material ? `${formatNumber(t.material)} foto material` : null,
    t.alat ? `${formatNumber(t.alat)} foto alat` : null,
    t.umum ? `${formatNumber(t.umum)} foto umum laporan` : null,
    t.tanpaKategori ? `${formatNumber(t.tanpaKategori)} foto pekerjaan yang tidak ada lagi di RAB aktif` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Foto Sarana & Prasarana"
          subtitle={
            `Foto laporan harian dipilah per sarana dan prasarana (kategori RAB revisi #${dok.revisionNo}), ` +
            `diurutkan dari tanggal awal sampai terkini. ${formatNumber(jumlahFoto)} foto dari laporan yang sudah dikirim, disetujui, atau final.`
          }
          action={
            can(user.role, "report.export") ? (
              <ButtonLink
                href={`/api/laporan/foto-sarpras/${slug}/pdf`}
                unduhan
                labelSibuk="Menyiapkan PDF…"
                variant="secondary"
                size="sm"
              >
                <Download aria-hidden className="size-3.5" />
                PDF 0% – 50% – 100%
              </ButtonLink>
            ) : null
          }
        />
        {tanpa > 0 || !dok.adaSpmk ? (
          <CardBody className="space-y-2">
            {tanpa > 0 ? (
              <Banner
                tone="info"
                title={`${formatNumber(tanpa)} foto tidak masuk sarana mana pun`}
                description={`${rincianTanpa.join(", ")}. Foto itu tidak menempel ke pekerjaan RAB, jadi tidak bisa dipilah per sarana.`}
              />
            ) : null}
            {!dok.adaSpmk ? (
              <Banner tone="info" title="SPMK belum terbit" description="Nomor minggu belum bisa disebut. Foto tetap urut tanggal." />
            ) : null}
          </CardBody>
        ) : null}
      </Card>

      <section className="space-y-2">
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-ink">
          Sarana &amp; Prasarana
          <span className="font-normal text-ink-muted">
            {dok.sarpras.length} item · {dok.sarpras.filter((s) => s.progresKini >= 100).length} tuntas
          </span>
        </h2>
        <UbinSarpras items={await ubinSarpras(dok, slug)} />
      </section>
    </div>
  );
}
