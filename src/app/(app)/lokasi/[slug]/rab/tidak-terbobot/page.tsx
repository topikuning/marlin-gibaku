import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { formatNumber, formatTanggal } from "@/lib/format";
import { realisasiTidakTerbobot, type ItemTidakTerbobot } from "@/lib/rab/tidak-terbobot";
import { requireLocationPage } from "../../get-location";

export const metadata: Metadata = { title: "Realisasi tidak terbobot" };
export const dynamic = "force-dynamic";

/**
 * REALISASI YANG TIDAK TERBOBOT KARENA PERUBAHAN RAB.
 *
 * Permintaan user 2026-10-04: *"aku ingin ada halaman atau menu untuk melihat
 * item pekerjaan apa saja yang tidak terbobot karena perubahan RAB"*.
 *
 * Laporan hariannya tidak dihapus dan tetap tampil normal di laporan
 * tanggalnya. Yang hilang hanya bobotnya: progres menghitung item yang ada di
 * RAB aktif saja. Halaman ini satu-satunya tempat yang menyebut selisih itu.
 */
export default async function TidakTerbobotPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");

  const [items, aktif] = await Promise.all([
    realisasiTidakTerbobot(location.id),
    db.rabRevision.findFirst({ where: { locationId: location.id, status: "aktif" }, select: { revisionNo: true } }),
  ]);

  const perKategori = new Map<string, ItemTidakTerbobot[]>();
  for (const it of items) {
    const arr = perKategori.get(it.kategori) ?? [];
    arr.push(it);
    perKategori.set(it.kategori, arr);
  }
  const jumlahLaporan = items.reduce((t, it) => t + it.jumlahLaporan, 0);

  return (
    <div className="max-w-4xl space-y-4">
      <Card>
        <CardHeader
          title="Realisasi tidak terbobot"
          subtitle="Pekerjaan yang sudah dilaporkan, tapi itemnya sudah tidak ada di RAB aktif. Laporan hariannya tetap ada, hanya volumenya tidak ikut dihitung di progres."
          action={
            <ButtonLink href={`/lokasi/${slug}/rab`} variant="ghost" size="sm">
              <ArrowLeft aria-hidden className="size-3.5" />
              Kembali ke RAB
            </ButtonLink>
          }
        />
        <CardBody className="space-y-4">
          {!aktif ? (
            <Banner tone="info" title="Lokasi ini belum punya RAB aktif" />
          ) : items.length === 0 ? (
            <Banner
              tone="success"
              title="Semua pekerjaan yang dilaporkan ikut terbobot"
              description={`Setiap item yang pernah dilaporkan masih ada di RAB aktif (revisi #${aktif.revisionNo}).`}
            />
          ) : (
            <>
              <Banner
                tone="warning"
                title={`${items.length} item dari ${jumlahLaporan} laporan harian tidak ikut dihitung di progres`}
                description={`Dibandingkan dengan RAB aktif, revisi #${aktif.revisionNo}. Hanya laporan yang sudah dikirim, disetujui, atau final yang dihitung, sama seperti progres. Ketuk nama item untuk melihat tanggal-tanggal laporannya.`}
              />
              {[...perKategori].map(([kategori, daftar]) => (
                <section key={kategori} className="space-y-2">
                  <h3 className="text-sm font-semibold text-ink">
                    {kategori} <span className="font-normal text-ink-muted">· {daftar.length} item</span>
                  </h3>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {daftar.map((it) => (
                      <Baris key={it.lineageKey} slug={slug} it={it} />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Baris({ slug, it }: { slug: string; it: ItemTidakTerbobot }) {
  const satuan = it.unit ? ` ${it.unit}` : "";
  return (
    <li className="space-y-1 px-3 py-2.5 text-[13px]">
      <div>
        <Link
          href={`/lokasi/${slug}/rab/riwayat?item=${encodeURIComponent(it.lineageKey)}`}
          className="font-medium text-primary hover:underline"
        >
          {it.name}
        </Link>
        <span className="block text-[11px] text-ink-faint">{it.jalur}</span>
      </div>
      <p className="text-ink-muted">
        Sudah dikerjakan{" "}
        <span className="tabular font-semibold text-ink">
          {formatNumber(it.volume)}
          {satuan}
        </span>
        {it.volumeKontrakTerakhir != null ? ` dari volume kontrak lama ${formatNumber(it.volumeKontrakTerakhir)}${satuan}` : ""}
        {" · "}
        {it.jumlahLaporan} laporan
        {it.pertama && it.terakhir
          ? it.pertama.getTime() === it.terakhir.getTime()
            ? ` (${formatTanggal(it.pertama)})`
            : ` (${formatTanggal(it.pertama)} sampai ${formatTanggal(it.terakhir)})`
          : ""}
      </p>
      <p className="text-[12px] text-ink-muted">
        {it.terakhirDiRevisi != null
          ? `Terakhir ada di revisi #${it.terakhirDiRevisi}`
          : "Tidak pernah ada di revisi RAB yang berlaku"}
        {it.hilangDiRevisi != null
          ? `, hilang di revisi #${it.hilangDiRevisi}${it.hilangPada ? ` (${formatTanggal(it.hilangPada)})` : ""}`
          : ""}
        .
      </p>
    </li>
  );
}
