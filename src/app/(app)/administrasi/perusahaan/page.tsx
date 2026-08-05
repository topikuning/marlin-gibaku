import type { Metadata } from "next";
import { Card, CardBody, CardHeader, KpiCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { duplicateGroups, listVendorsWithUsage } from "@/lib/vendor/queries";
import { presignKeys } from "@/lib/photos";
import { VendorManager } from "./vendor-client";

export const metadata: Metadata = { title: "Master Perusahaan" };
export const dynamic = "force-dynamic";

function Ringkas({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="tabular text-lg font-semibold text-ink">{value.toLocaleString("id-ID")}</p>
    </div>
  );
}

export default async function VendorPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "contract.manage");

  const [vendors, org] = await Promise.all([
    listVendorsWithUsage(user.orgId),
    // Identitas organisasi + isinya. Semua dipagari `orgId` — halaman ini tidak
    // punya alasan melihat tenant lain.
    db.organization.findUnique({
      where: { id: user.orgId },
      select: {
        name: true,
        slug: true,
        _count: { select: { packages: true, users: true, vendors: true, masterLocations: true } },
      },
    }),
  ]);
  const imageUrls = await presignKeys(
    vendors.flatMap((v) => [v.logoKey, v.kopKey]).filter((k): k is string => !!k),
  );
  const groups = duplicateGroups(vendors);
  const dupCount = groups.reduce((s, g) => s + g.length, 0);
  const berkontrak = vendors.filter((v) => v.contractCount > 0).length;

  return (
    <div className="space-y-4">
      {/*
       * Halaman ini bernama "Perusahaan" tetapi selama ini hanya memuat VENDOR,
       * sehingga tidak pernah terjawab pertanyaan paling dasar di grup
       * Administrasi: organisasi mana yang sedang saya kelola. Kartu ini
       * menjawabnya sekaligus menegaskan pemisahannya — organisasi = pemakai
       * MARLIN, vendor = mitra yang dikontrak organisasi itu.
       */}
      <Card>
        <CardHeader
          title={org?.name ?? "Organisasi"}
          subtitle={
            org
              ? `Organisasi Anda · ${org.slug} — seluruh data di MARLIN dipagari organisasi ini; akun, paket, dan vendor organisasi lain tidak terlihat dari sini.`
              : "Organisasi tidak ditemukan."
          }
        />
        {org ? (
          <CardBody className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Ringkas label="Paket" value={org._count.packages} />
            <Ringkas label="Akun pengguna" value={org._count.users} />
            <Ringkas label="Vendor terdaftar" value={org._count.vendors} />
            <Ringkas label="Katalog lokasi" value={org._count.masterLocations} />
          </CardBody>
        ) : null}
      </Card>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total vendor" value={vendors.length} />
        <KpiCard label="Punya kontrak" value={berkontrak} sub="sisanya belum dipakai" />
        <KpiCard
          label="Kemungkinan duplikat"
          value={dupCount}
          sub={dupCount > 0 ? `dalam ${groups.length} grup — gabungkan` : "tidak ada"}
          tone={dupCount > 0 ? "warning" : "default"}
        />
        <KpiCard label="Grup duplikat" value={groups.length} />
      </section>

      <Card>
        <CardHeader
          title="Daftar perusahaan"
          subtitle="“Gabung ke” mengalihkan semua kontrak/komitmen ke vendor tujuan lalu menghapus entri ini. Hapus hanya untuk vendor tanpa pemakaian."
        />
        <CardBody>
          <VendorManager
            vendors={vendors.map((v) => ({
              id: v.id,
              name: v.name,
              npwp: v.npwp,
              contact: v.contact,
              address: v.address,
              phone: v.phone,
              email: v.email,
              logoUrl: v.logoKey ? (imageUrls.get(v.logoKey) ?? null) : null,
              kopUrl: v.kopKey ? (imageUrls.get(v.kopKey) ?? null) : null,
              contractCount: v.contractCount,
              commitmentCount: v.commitmentCount,
              normKey: v.normKey,
            }))}
            duplicateKeys={groups.map((g) => g[0].normKey)}
          />
        </CardBody>
      </Card>
    </div>
  );
}
