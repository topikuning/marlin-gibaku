import type { Metadata } from "next";
import { ArrowLeft, GitCompare } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader, Combobox, EmptyState, FormSaring, KpiCard, Label, TombolSaring } from "@/components/ui";
import { db } from "@/lib/db";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { diffRevisions } from "@/lib/rab/adendum";
import { pilihPasanganBawaan } from "@/lib/rab/pasangan-banding";
import { formatTanggal } from "@/lib/format";
import { requireLocationPage } from "../../get-location";
import { DiffCard } from "../diff-card";

export const metadata: Metadata = { title: "Bandingkan revisi RAB" };
export const dynamic = "force-dynamic";

const rupiah = new Intl.NumberFormat("id-ID");
const fmtDelta = (d: bigint) => `${d > 0n ? "+" : d < 0n ? "−" : ""}Rp ${rupiah.format(d < 0n ? -d : d)}`;
const STATUS = { aktif: "aktif", digantikan: "digantikan", draft: "draft" } as const;

/**
 * BANDINGKAN RAB AKTIF DENGAN RAB SEBELUMNYA (DECISIONS 637).
 *
 * Permintaan user yang *"sudah aku minta dari awal sampai sekarang belum ada"*:
 * membandingkan RAB aktif dengan RAB sebelumnya. Bawaannya persis itu – RAB
 * aktif (kanan) dengan revisi tepat sebelumnya (kiri) – dan dua revisi mana pun
 * yang pernah berlaku bisa dipilih. Pengaduannya `diffRevisions`, fungsi yang
 * sama dengan halaman draft adendum; total tiap sisi adalah `totalValue`
 * revisinya, angka yang sama dengan daftar riwayat revisi.
 *
 * Revisi yang keliru dihapus dulu lewat Riwayat revisi (DECISIONS 636) supaya
 * "sebelumnya" di sini benar-benar RAB yang pernah berlaku.
 */
export default async function BandingkanRevisiPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ dari?: string; ke?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");

  const revisi = await db.rabRevision.findMany({
    where: { locationId: location.id, status: { not: "draft" } },
    orderBy: { revisionNo: "desc" },
    select: { id: true, revisionNo: true, status: true, source: true, createdAt: true, totalValue: true },
  });
  const pasangan = pilihPasanganBawaan(revisi, { dari: sp.dari, ke: sp.ke });
  const byId = new Map(revisi.map((r) => [r.id, r]));
  const dari = pasangan ? byId.get(pasangan.dari)! : null;
  const ke = pasangan ? byId.get(pasangan.ke)! : null;
  const diff = pasangan ? await diffRevisions(pasangan.dari, pasangan.ke) : null;
  const label = (r: (typeof revisi)[number]) =>
    `#${r.revisionNo} · ${r.source === "hps_awal" ? "RAB kontrak" : "adendum"} · ${STATUS[r.status]} · ${formatTanggal(r.createdAt)}`;

  return (
    <div className="max-w-6xl space-y-4">
      <Card>
        <CardHeader
          title="Bandingkan revisi RAB"
          subtitle="Bawaan: RAB aktif dibandingkan dengan RAB yang berlaku tepat sebelumnya. Nilai pra-PPN."
          action={
            <ButtonLink href={`/lokasi/${slug}/rab?bagian=revisi`} size="sm" variant="secondary">
              <ArrowLeft aria-hidden className="size-3.5" />
              Riwayat revisi
            </ButtonLink>
          }
        />
        <CardBody>
          {revisi.length < 2 ? (
            <EmptyState
              icon={GitCompare}
              title="Belum ada yang bisa dibandingkan"
              description="Lokasi ini baru punya satu RAB yang pernah berlaku. Perbandingan muncul begitu ada adendum yang diaktifkan."
            />
          ) : (
            // Combobox tak-terkontrol menyimpan pilihannya sendiri: tanpa remount
            // tiap kali URL berubah ia terus menulis pilihan yang ditolak walau
            // hasilnya pasangan bawaan. `key` memuat pilihan DAN hasilnya.
            <FormSaring key={`${sp.dari}:${sp.ke}:${pasangan?.dari}:${pasangan?.ke}`} className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <Label htmlFor="banding-dari">Sebelumnya</Label>
                <Combobox id="banding-dari" name="dari" defaultValue={pasangan?.dari ?? ""}>
                  {revisi.map((r) => (
                    <option key={r.id} value={r.id}>
                      {label(r)}
                    </option>
                  ))}
                </Combobox>
              </div>
              <div className="w-72">
                <Label htmlFor="banding-ke">Dibandingkan dengan</Label>
                <Combobox id="banding-ke" name="ke" defaultValue={pasangan?.ke ?? ""}>
                  {revisi.map((r) => (
                    <option key={r.id} value={r.id}>
                      {label(r)}
                    </option>
                  ))}
                </Combobox>
              </div>
              <TombolSaring>Bandingkan</TombolSaring>
            </FormSaring>
          )}
        </CardBody>
      </Card>

      {pasangan?.pilihanDitolak && dari && ke ? (
        <Banner
          tone="warning"
          title={
            sp.dari && sp.dari === sp.ke
              ? "Revisi yang sama tidak bisa dibandingkan dengan dirinya sendiri"
              : "Pilihan revisi tidak dikenal"
          }
          description={`Yang ditampilkan: RAB #${dari.revisionNo} → RAB #${ke.revisionNo} (bawaan). Pilih dua revisi yang berbeda.`}
        />
      ) : null}

      {diff && dari && ke ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <KpiCard label={`RAB #${dari.revisionNo}`} value={`Rp ${rupiah.format(dari.totalValue)}`} sub="sebelumnya · pra-PPN" />
            <KpiCard label={`RAB #${ke.revisionNo}`} value={`Rp ${rupiah.format(ke.totalValue)}`} sub={`${STATUS[ke.status]} · pra-PPN`} />
            <KpiCard
              label="Selisih"
              value={fmtDelta(ke.totalValue - dari.totalValue)}
              sub={`tambah ${fmtDelta(diff.totalTambah)} · kurang ${fmtDelta(diff.totalKurang)}`}
              tone={ke.totalValue > dari.totalValue ? "success" : ke.totalValue < dari.totalValue ? "danger" : undefined}
            />
            <KpiCard
              label="Item berubah"
              value={String(diff.diubah.length + diff.ditambah.length + diff.dihapus.length)}
              sub={
                `${diff.diubah.length} diubah · ${diff.ditambah.length} baru · ${diff.dihapus.length} dihapus` +
                (diff.pembulatan.length > 0 ? ` · ${diff.pembulatan.length} selisih pembulatan tidak dihitung` : "")
              }
            />
          </div>
          <DiffCard
            diff={diff}
            judul={`RAB #${dari.revisionNo} → RAB #${ke.revisionNo}`}
            subjudul="Per item, dicocokkan lewat kode item yang sama di kedua revisi. Item yang tidak berubah tidak ditampilkan."
            kosong="Kedua revisi identik – tidak ada item yang berubah."
          />
        </>
      ) : null}
    </div>
  );
}
