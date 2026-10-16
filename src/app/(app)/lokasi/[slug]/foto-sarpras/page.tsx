import type { Metadata } from "next";
import Link from "next/link";
import { Download, Images } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader, EmptyState, ProgressBar } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { formatNumber, formatPct, formatTanggal } from "@/lib/format";
import { presignKeys } from "@/lib/photos";
import { susunDokumentasiSarpras, type FotoSarpras } from "@/lib/dokumentasi-sarpras/susun";
import { requireLocationPage } from "../get-location";

export const metadata: Metadata = { title: "Foto Sarana & Prasarana" };
export const dynamic = "force-dynamic";

const tgl = (t: string) => formatTanggal(new Date(`${t}T00:00:00Z`));

/**
 * DOKUMENTASI FOTO PER SARANA & PRASARANA (DECISIONS 683) – daftar sarana
 * lokasi ini dengan foto paling awal, foto terkini, dan progresnya.
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

  // Hanya foto awal & terkini tiap sarana yang ditampilkan di sini.
  const tampil = dok.sarpras.flatMap((s) => [s.foto[0], s.foto.at(-1)].filter((f): f is FotoSarpras => !!f));
  const url = await presignKeys(
    tampil.flatMap((f) => [f.thumbnailKey ?? f.r2Key]),
    3600,
  );
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {dok.sarpras.map((s) => {
          const awal = s.foto[0];
          const kini = s.foto.at(-1);
          const href = `/lokasi/${slug}/foto-sarpras/${encodeURIComponent(s.kunci)}`;
          return (
            <Card key={s.kunci} className="flex flex-col">
              <div className="space-y-2 p-3">
                <Link href={href} className="block font-semibold text-ink hover:underline">
                  {s.code}. {s.name}
                </Link>
                <div className="flex items-center gap-2 text-[13px] text-ink-muted">
                  <ProgressBar value={s.progresKini} label={`Progres ${s.name}`} className="flex-1" />
                  <span className="tabular shrink-0">{formatPct(s.progresKini, 2)}</span>
                </div>
              </div>
              {awal ? (
                <div className="grid grid-cols-2 gap-1 px-3">
                  {[
                    ["Awal", awal],
                    ["Terkini", kini!],
                  ].map(([label, f]) => {
                    const foto = f as FotoSarpras;
                    const src = url.get(foto.thumbnailKey ?? foto.r2Key);
                    return (
                      <Link key={label as string} href={href} className="block">
                        <div className="aspect-[4/3] overflow-hidden rounded-md bg-surface-inset">
                          {src ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={src} alt={`${label} – ${s.name}`} loading="lazy" className="size-full object-cover" />
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-ink-muted">
                          <span className="font-medium text-ink">{label as string}</span> · {tgl(foto.tanggal)} ·{" "}
                          {formatPct(foto.progres, 1)}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="px-3 text-[13px] text-ink-muted">Belum ada foto dari laporan harian.</p>
              )}
              <div className="mt-auto flex items-center justify-between gap-2 p-3">
                <span className="text-[13px] text-ink-muted">{formatNumber(s.foto.length)} foto</span>
                {s.foto.length > 0 ? (
                  <ButtonLink href={href} variant="secondary" size="sm">
                    Lihat urutan foto
                  </ButtonLink>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
