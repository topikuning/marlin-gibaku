import type { Metadata } from "next";
import Link from "next/link";
import { Banner, Card, CardBody, CardHeader, KpiCard, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatRupiahShort } from "@/lib/format";
import { cn } from "@/lib/cn";
import { domain, masihSegar, USIA_KATALOG_HARI } from "@/lib/harga-wilayah/aturan";
import { KatalogGrid, type BarisKatalog } from "./katalog-grid";
import { RisetUlang } from "./riset-ulang";

export const metadata: Metadata = { title: "Katalog harga wilayah" };
export const dynamic = "force-dynamic";

/**
 * KATALOG HARGA WILAYAH (DECISIONS 806): harga sumber daya per kabupaten hasil
 * riset web (bersumber) atau estimasi AI, dipakai bersama oleh semua lokasi
 * sekabupaten. Rujukan, bukan harga resmi: yang masuk biaya hanya HSD lokasi.
 * Memuat rupiah → `rapl.view` (pelaksana tidak pernah melihatnya).
 */
export default async function KatalogHargaPage({ searchParams }: { searchParams: Promise<{ wilayah?: string }> }) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "rapl.view");
  const { wilayah } = await searchParams;

  const semua = await db.hargaWilayah.findMany({
    where: { orgId: user.orgId },
    orderBy: [{ provinsi: "asc" }, { kabupaten: "asc" }, { kategori: "asc" }, { nama: "asc" }],
  });
  const sekarang = new Date();
  const kelompok = new Map<string, { provinsi: string; kabupaten: string; jumlah: number; web: number; terbaru: Date }>();
  for (const h of semua) {
    const k = `${h.provinsi}|${h.kabupaten}`;
    const g = kelompok.get(k) ?? { provinsi: h.provinsi, kabupaten: h.kabupaten, jumlah: 0, web: 0, terbaru: h.diperbarui };
    g.jumlah++;
    if (h.metode === "web") g.web++;
    if (h.diperbarui > g.terbaru) g.terbaru = h.diperbarui;
    kelompok.set(k, g);
  }
  const dipilih = wilayah && kelompok.has(wilayah) ? kelompok.get(wilayah)! : null;
  const tampil = dipilih ? semua.filter((h) => h.provinsi === dipilih.provinsi && h.kabupaten === dipilih.kabupaten) : semua;
  const rows: BarisKatalog[] = tampil.map((h) => {
    const sumber = (Array.isArray(h.sumber) ? (h.sumber as { url?: unknown; judul?: unknown }[]) : [])
      .filter((s): s is { url: string; judul?: unknown } => typeof s?.url === "string")
      .map((s) => ({ url: s.url, judul: typeof s.judul === "string" ? s.judul : "", domain: domain(s.url) }));
    return {
      id: h.id,
      wilayah: `${h.kabupaten}, ${h.provinsi}`,
      kategori: h.kategori,
      nama: h.nama,
      satuan: h.satuan,
      harga: Number(h.harga),
      rentang: h.hargaMin != null && h.hargaMaks != null ? `${formatRupiahShort(h.hargaMin)} – ${formatRupiahShort(h.hargaMaks)}` : "",
      metode: h.metode,
      keyakinan: h.keyakinan,
      alasan: h.alasan,
      sumber,
      diperbarui: `${h.diperbarui.toISOString().slice(0, 10)}${masihSegar(h.diperbarui, sekarang) ? "" : " (usang)"}`,
    };
  });
  const web = tampil.filter((h) => h.metode === "web").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Katalog harga wilayah"
        description={`Harga sumber daya per kabupaten, dipakai bersama semua lokasi sekabupaten saat estimasi harga RAPL. Diriset ulang otomatis bila lebih tua dari ${USIA_KATALOG_HARI} hari.`}
      />
      <Banner
        tone="info"
        title="Rujukan, bukan harga resmi"
        description="Harga di sini hasil pencarian web lewat AI (alamat sumbernya bisa dibuka) atau estimasi AI bila sumber tidak ditemukan. Biaya RAPL hanya memakai harga yang sudah dipakai di tiap lokasi."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard label="Harga di katalog" value={String(tampil.length)} sub={dipilih ? `${dipilih.kabupaten}` : `${kelompok.size} kabupaten`} />
        <KpiCard label="Bersumber web" value={String(web)} sub={tampil.length > 0 ? `${Math.round((web / tampil.length) * 100)}% dari katalog` : "–"} />
        <KpiCard label="Estimasi AI" value={String(tampil.length - web)} sub="tanpa sumber web" />
      </div>
      <Card>
        <CardHeader title="Wilayah" subtitle="Pilih kabupaten untuk melihat harganya saja." />
        <CardBody className="space-y-3">
          {kelompok.size === 0 ? (
            <p className="text-[13px] text-ink-muted">
              Katalog masih kosong. Isinya muncul begitu harga diestimasi di tab RAPL sebuah lokasi, atau lewat tombol
              &ldquo;Estimasi harga semua lokasi&rdquo; di halaman paket.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Link
                href="/katalog-harga"
                className={cn("rounded-full border px-3 py-1 text-[13px]", !dipilih ? "border-primary bg-info-soft text-primary" : "border-border text-ink")}
              >
                Semua
              </Link>
              {[...kelompok.entries()].map(([k, g]) => (
                <Link
                  key={k}
                  href={`/katalog-harga?wilayah=${encodeURIComponent(k)}`}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[13px]",
                    dipilih === g ? "border-primary bg-info-soft text-primary" : "border-border text-ink",
                  )}
                >
                  {g.kabupaten} · {g.jumlah}
                </Link>
              ))}
            </div>
          )}
          {dipilih && can(user.role, "rapl.manage") ? (
            <RisetUlang provinsi={dipilih.provinsi} kabupaten={dipilih.kabupaten} jumlah={dipilih.jumlah} />
          ) : null}
        </CardBody>
      </Card>
      {rows.length > 0 ? <KatalogGrid rows={rows} tampilWilayah={!dipilih && kelompok.size > 1} /> : null}
    </div>
  );
}
