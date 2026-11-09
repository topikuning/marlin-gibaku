import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getLocationsProgress } from "@/lib/progress";
import { idLokasiDiarsipkan, lingkupLokasi } from "@/lib/package/lingkup-lokasi";
import { alasanTertutup, saringLokasiTertutup, sebutTertutup } from "@/lib/lokasi/tertutup";
import { LokasiGrid, type LokasiRow } from "./lokasi-grid";

export const metadata: Metadata = { title: "Lokasi" };
export const dynamic = "force-dynamic";

/**
 * Daftar lokasi (scoped by penugasan) — progress dihitung BATCH, bukan N+1.
 *
 * Lokasi yang DICABUT adendum atau DIBATALKAN (status lokasi / paket Batal)
 * tidak ditampilkan kecuali diminta lewat `?tampil=semua` (permintaan user
 * 2026-11-08, DECISIONS 750). Jumlahnya selalu disebut di atas tabel.
 */
export default async function LokasiListPage({
  searchParams,
}: {
  searchParams: Promise<{ tampil?: string }>;
}) {
  const tampilSemua = (await searchParams).tampil === "semua";
  const user = await requireUser();
  requireCapabilityPage(user.role, "location.view");
  // Pelaksana tidak melihat rupiah (DECISIONS 735): nilai RAB tidak dikirim.
  const lihatUang = can(user.role, "money.view");
  const locIds = await accessibleLocationIds(user);

  const locations = await db.location.findMany({
    where: locationScopeWhere(user, locIds),
    select: {
      id: true,
      name: true,
      slug: true,
      village: true,
      regency: true,
      province: true,
      gpsLat: true,
      gpsLng: true,
      status: true,
      package: {
        select: {
          name: true,
          stage: true,
          // Perusahaan PELAKSANA = vendor di KONTRAK. Bukan `candidateVendorName`
          // (calon pemenang tender): yang belum berkontrak belum mengerjakan
          // apa pun, dan menampilkannya di kolom yang sama akan terbaca sebagai
          // pelaksana yang sudah pasti.
          contract: { select: { vendor: { select: { name: true } } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  const semuaId = locations.map((l) => l.id);
  const [lingkup, arsip] = await Promise.all([
    lingkupLokasi(semuaId),
    // Pencabutan yang DIARSIPKAN tidak muncul dan tidak dihitung bagi yang tak
    // berwenang melihat arsipnya – aturan yang sama dengan pemilih lokasi dan
    // halaman lokasi itu sendiri (ketetapan user 2026-09-06).
    can(user.role, "location_scope.archive") ? Promise.resolve(new Set<string>()) : idLokasiDiarsipkan(semuaId),
  ]);
  const { tampil, tertutup } = saringLokasiTertutup(
    locations
      .filter((l) => !arsip.has(l.id))
      .map((l) => ({
        l,
        tertutup: alasanTertutup({
          status: l.status,
          paketBatal: l.package.stage === "batal",
          dicabut: lingkup.dicabut.has(l.id),
        }),
      })),
    tampilSemua,
  );
  const progress = await getLocationsProgress(tampil.map((x) => x.l.id));

  const rows: LokasiRow[] = tampil.map(({ l, tertutup }) => {
    const p = progress.get(l.id)!;
    return {
      tertutup,
      id: l.id,
      slug: l.slug,
      name: l.name,
      wilayah: `${l.regency}, ${l.province}`,
      gpsLat: l.gpsLat?.toString() ?? null,
      gpsLng: l.gpsLng?.toString() ?? null,
      paket: l.package.name,
      perusahaan: l.package.contract?.vendor.name ?? null,
      status: l.status,
      realizedPct: p.realizedPct,
      deviationPct: p.deviationPct,
      rabValue: lihatUang ? Number(p.grandTotal) : null,
    };
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lokasi"
        description={
          tertutup.total === 0 ? (
            `${rows.length} lokasi yang bisa Anda lihat.`
          ) : tampilSemua ? (
            <>
              {rows.length} lokasi, termasuk {sebutTertutup(tertutup)}.{" "}
              <Link href="/lokasi" className="font-medium text-primary hover:underline">
                Sembunyikan yang dicabut &amp; dibatalkan
              </Link>
            </>
          ) : (
            <>
              {rows.length} lokasi. {tertutup.total} lokasi lain tidak ditampilkan ({sebutTertutup(tertutup)}).{" "}
              <Link href="/lokasi?tampil=semua" className="font-medium text-primary hover:underline">
                Tampilkan semua
              </Link>
            </>
          )
        }
      />
      <LokasiGrid rows={rows} tanpaUang={!lihatUang} />
    </div>
  );
}
