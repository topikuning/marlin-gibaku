import type { Metadata } from "next";
import { Banner, Card, CardBody, KpiCard, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import type { RingkasanRincian } from "@/lib/rab/rincian/baca";
import { keadaanLatarRincian } from "@/lib/rab/rincian/arsip";
import { AksiMassal, TabelRincian, type BarisRincian } from "./rincian-client";

export const metadata: Metadata = { title: "Backup Volume & Analisa RAB" };
export const dynamic = "force-dynamic";

/**
 * MELENGKAPI BACKUP VOLUME & ANALISA DARI BERKAS ARSIP (DECISIONS baru 2026-10-06).
 *
 * Teguran user: *"data awal yang aku berikan sudah ada sheet backup volume,
 * tapi sama sekali tidak diproses"*. Revisi yang sudah ada di produksi
 * dilengkapi dari berkas aslinya yang diarsipkan saat impor – PERIKSA dulu
 * (tidak menyimpan apa pun), SIMPAN sesudah laporannya dibaca.
 */
export default async function RincianRabPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "system.manage");

  const revisi = await db.rabRevision.findMany({
    where: { location: { package: { orgId: user.orgId } } },
    select: {
      id: true,
      revisionNo: true,
      status: true,
      source: true,
      createdAt: true,
      location: { select: { name: true, slug: true } },
      sourceDocument: { select: { fileName: true } },
      rincian: { select: { asal: true, dibuatAt: true, ringkasan: true } },
      rincianPeriksa: true,
      _count: { select: { nodes: { where: { kind: "item" } } } },
    },
    orderBy: [{ location: { name: "asc" } }, { revisionNo: "desc" }],
  });

  const baris: BarisRincian[] = revisi.map((r) => ({
    id: r.id,
    lokasi: r.location.name,
    slug: r.location.slug,
    revisionNo: r.revisionNo,
    status: r.status,
    sumber: r.source,
    dibuat: r.createdAt.toISOString(),
    berkas: r.sourceDocument?.fileName ?? null,
    item: r._count.nodes,
    tersimpan: r.rincian
      ? {
          asal: r.rincian.asal,
          pada: r.rincian.dibuatAt.toISOString(),
          ringkasan: r.rincian.ringkasan as unknown as RingkasanRincian,
        }
      : null,
    periksa: r.rincianPeriksa
      ? {
          status: r.rincianPeriksa.status,
          pesan: r.rincianPeriksa.pesan,
          itemRevisi: r.rincianPeriksa.itemRevisi,
          itemCocok: r.rincianPeriksa.itemCocok,
          ringkasan: (r.rincianPeriksa.ringkasan as unknown as RingkasanRincian | null) ?? null,
          tersembunyiDibaca: r.rincianPeriksa.tersembunyiDibaca,
          pada: r.rincianPeriksa.diperiksaAt.toISOString(),
        }
      : null,
  }));

  const tersimpan = baris.filter((b) => b.tersimpan).length;
  const siap = baris.filter((b) => !b.tersimpan && (b.periksa?.status === "siap" || b.periksa?.status === "sebagian")).length;
  const belum = baris.filter((b) => !b.tersimpan && !b.periksa).length;
  const masalah = baris.filter(
    (b) => !b.tersimpan && b.periksa && b.periksa.status !== "siap" && b.periksa.status !== "sebagian",
  ).length;
  const latar = keadaanLatarRincian();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Backup volume & analisa RAB"
        breadcrumb={[{ label: "Sistem", href: "/sistem" }, { label: "Backup volume & analisa" }]}
        description="Lengkapi revisi RAB yang sudah ada dari berkas aslinya, tanpa unggah ulang."
      />

      <Banner
        tone="info"
        title="Periksa dulu, simpan belakangan"
        description={
          <span className="space-y-1">
            <span className="block">
              Berkas asli tiap impor RAB sejak 14 Juli tersimpan utuh. Dari berkas itu MARLIN membaca sheet backup volume,
              Resume Analisa, ANALISA, dan Bahan & Upah lewat rumus yang ditulis penyusunnya.
            </span>
            <span className="block">
              <strong>Periksa</strong> hanya membaca dan menulis laporan di tabel ini. <strong>Simpan</strong> baru
              menyimpan rinciannya. Volume, harga, nilai kontrak, progres, dan laporan tidak berubah sama sekali.
            </span>
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label="Sudah berincian" value={tersimpan} sub={`dari ${baris.length} revisi`} />
        <KpiCard label="Siap disimpan" value={siap} sub="sudah diperiksa" />
        <KpiCard label="Perlu dilihat" value={masalah} sub="tanpa berkas, gagal, tidak cocok" />
        <KpiCard label="Belum diperiksa" value={belum} sub="revisi" />
      </div>

      <Card>
        <CardBody className="space-y-3">
          <AksiMassal
            berjalan={latar.berjalan ? { jenis: latar.berjalan.jenis, selesai: latar.berjalan.selesai, total: latar.berjalan.total } : null}
            terakhir={
              latar.terakhir
                ? { ...latar.terakhir, selesai: latar.terakhir.selesai.toISOString() }
                : null
            }
            adaSiap={siap > 0}
            adaBelum={belum > 0}
          />
          <TabelRincian baris={baris} />
        </CardBody>
      </Card>
    </div>
  );
}
