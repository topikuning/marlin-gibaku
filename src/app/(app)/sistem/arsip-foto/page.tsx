import type { Metadata } from "next";
import { Card, CardBody, CardHeader, KpiCard, PageHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { whereArsip } from "@/lib/photo-restamp/service";
import { PurgeForm } from "./purge-form";

export const metadata: Metadata = { title: "Arsip Foto Asli" };
export const dynamic = "force-dynamic";

function mb(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const v = bytes / 1024 / 1024;
  return v >= 1024 ? `${(v / 1024).toFixed(2)} GB` : `${v.toFixed(1)} MB`;
}

/**
 * Arsip berkas asli foto: berapa yang tersimpan, berapa besar, dan tempat
 * MENGHAPUSNYA atas permintaan sendiri (DECISIONS 198).
 *
 * Halaman ini sengaja menyajikan angka pemakaian penyimpanan lebih dulu —
 * keputusan menghapus arsip bukti hanya masuk akal kalau alasannya (ruang)
 * terlihat, bukan ditebak.
 */
export default async function ArsipFotoPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "photo.archive_purge");
  const scope = await accessibleLocationIds(user);

  const whereSemua = whereArsip({}, scope);
  const [agg, jumlahFoto, terhapus, perPaket, packages, locations] = await Promise.all([
    db.photo.aggregate({ where: whereSemua, _count: { _all: true }, _sum: { originalBytes: true } }),
    db.photo.count({ where: scope === null ? {} : { locationId: { in: scope } } }),
    db.photo.count({
      where:
        scope === null
          ? { originalPurgedAt: { not: null } }
          : { AND: [{ locationId: { in: scope } }, { originalPurgedAt: { not: null } }] },
    }),
    db.photo.groupBy({
      by: ["locationId"],
      where: whereSemua,
      _count: { _all: true },
      _sum: { originalBytes: true },
    }),
    db.package.findMany({
      where: { orgId: user.orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.location.findMany({
      where: scope === null ? { package: { orgId: user.orgId } } : { id: { in: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const namaLokasi = new Map(locations.map((l) => [l.id, l.name]));
  const baris = perPaket
    .map((r) => ({
      nama: r.locationId ? (namaLokasi.get(r.locationId) ?? "–") : "Tanpa lokasi",
      jumlah: r._count._all,
      bytes: r._sum.originalBytes ?? 0,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 25);

  const totalBytes = agg._sum.originalBytes ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Arsip Foto Asli"
        description="Berkas asli tanpa cap – dipakai bila cap foto perlu diperbaiki. Tidak pernah dihapus otomatis."
      />

      <div className="grid gap-2 sm:grid-cols-3">
        <KpiCard label="Foto ber-arsip asli" value={agg._count._all.toLocaleString("id-ID")} sub={`dari ${jumlahFoto.toLocaleString("id-ID")} foto`} />
        <KpiCard label="Ukuran arsip" value={mb(totalBytes)} sub="di luar versi ber-cap & thumbnail" tone="warning" />
        <KpiCard
          label="Arsip sudah dihapus"
          value={terhapus.toLocaleString("id-ID")}
          sub="capnya tidak bisa diperbaiki lagi"
        />
      </div>

      <Card>
        <CardHeader
          title="Hapus arsip asli"
          subtitle="Pilih cakupannya, lalu konfirmasi. Versi ber-cap dan thumbnail TIDAK ikut terhapus."
        />
        <CardBody>
          <PurgeForm packages={packages} locations={locations} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Pemakaian terbesar per lokasi" subtitle="25 teratas" />
        <CardBody>
          {baris.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Belum ada arsip berkas asli. Foto yang diunggah sebelum fitur ini aktif memang tidak punya.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="py-1.5 pr-3">Lokasi</th>
                    <th className="py-1.5 pr-3 text-right">Foto</th>
                    <th className="py-1.5 text-right">Ukuran</th>
                  </tr>
                </thead>
                <tbody>
                  {baris.map((b) => (
                    <tr key={b.nama} className="border-b border-border-muted">
                      <td className="py-1.5 pr-3">{b.nama}</td>
                      <td className="py-1.5 pr-3 text-right tabular">{b.jumlah.toLocaleString("id-ID")}</td>
                      <td className="py-1.5 text-right tabular">{mb(b.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
