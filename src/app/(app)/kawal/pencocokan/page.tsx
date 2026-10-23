import type { Metadata } from "next";
import Link from "next/link";
import { Banner, Card, CardBody, CardHeader, KpiCard, PageHeader, StatusPill, type ComboOption } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { formatTanggalWaktu } from "@/lib/format";
import { dataPencocokanKawal, ringkasSinkronKawal, type KandidatTampil, type LokasiPilihan } from "@/lib/kawal/queries";
import { getAkunKawalTampil, getAmbangKawal } from "@/lib/kawal/setelan";
import { FormAmbang, FormPasangkan, TombolKembalikan, TombolSinkron, UmpanBalikKawal } from "./pencocokan-client";

export const metadata: Metadata = { title: "Kawal KNMP – Pencocokan Lokasi" };
export const dynamic = "force-dynamic";

const LABEL_HASIL: Record<string, { label: string; tone: "success" | "neutral" | "danger" | "warning" }> = {
  berhasil: { label: "Berhasil", tone: "success" },
  tidak_berubah: { label: "Tidak berubah", tone: "neutral" },
  gagal: { label: "Gagal", tone: "danger" },
  berjalan: { label: "Sedang berjalan", tone: "warning" },
};

function labelLokasi(l: LokasiPilihan): string {
  return `${l.nama} – ${l.paket} · ${l.kabupaten}`;
}

/** Petunjuk kandidat dalam bahasa orang: apa yang sama, apa yang beda. */
function petunjuk(k: KandidatTampil): string {
  const bagian: string[] = [];
  if (k.kontrakSama) bagian.push("nomor kontrak sama");
  if (k.desaSama) bagian.push("desa sama");
  else if (k.namaSama) bagian.push("nama sama");
  bagian.push(k.kabupatenSama ? "kabupaten sama" : "kabupaten beda");
  if (k.jarakKm != null) bagian.push(`${k.jarakKm.toLocaleString("id-ID", { maximumFractionDigits: 1 })} km`);
  return bagian.join(", ");
}

function opsiUntuk(kandidat: KandidatTampil[], bebas: LokasiPilihan[], tambahan?: LokasiPilihan): ComboOption[] {
  const usul = new Set(kandidat.map((k) => k.locationId));
  return [
    ...(tambahan ? [{ value: tambahan.id, label: `${labelLokasi(tambahan)} (pasangan sekarang)` }] : []),
    ...kandidat.map((k) => ({ value: k.locationId, label: `Usulan: ${labelLokasi(k.lokasi)} (${petunjuk(k)})` })),
    ...bebas.filter((l) => !usul.has(l.id)).map((l) => ({ value: l.id, label: labelLokasi(l) })),
  ];
}

function WilayahKawal({
  b,
}: {
  b: { desa: string | null; kecamatan: string | null; kabupaten: string; provinsi: string | null };
}) {
  return <>{[b.desa, b.kecamatan, b.kabupaten, b.provinsi].filter(Boolean).join(", ")}</>;
}

/**
 * Sinkron + pencocokan lokasi Kawal KNMP (DECISIONS 690) dan ambang selisihnya
 * (DECISIONS 694). Data Kawal di sini hanya untuk MEMASANGKAN lokasi.
 */
export default async function KawalPencocokanPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "kawal.manage");
  const [akun, ringkas, data, ambang] = await Promise.all([
    getAkunKawalTampil(),
    ringkasSinkronKawal(),
    dataPencocokanKawal(user.orgId),
    getAmbangKawal(),
  ]);
  const akunSiap = !!(akun.alamat && akun.akun && akun.adaSandi);
  const t = ringkas.terakhir;
  const hasil = t ? (LABEL_HASIL[t.outcome] ?? { label: t.outcome, tone: "neutral" as const }) : null;
  const otomatis = data.berpasangan.filter((p) => p.status === "otomatis").length;

  return (
    <UmpanBalikKawal>
      <div className="space-y-4">
        <PageHeader
          title="Kawal KNMP – Pencocokan Lokasi"
          description="Lokasi di Kawal dipasangkan dengan lokasi MARLIN supaya progresnya bisa dibandingkan. Data Kawal hanya pembanding, bukan angka resmi."
        />

        {!akunSiap ? (
          <Banner
            tone="warning"
            title="Akun Kawal belum diisi"
            description={
              can(user.role, "system.manage")
                ? "Isi alamat, nama akun, dan sandi Kawal di Sistem › Integrasi › Kawal KNMP."
                : "Minta Super Admin mengisi akun Kawal di Sistem › Integrasi › Kawal KNMP."
            }
          />
        ) : null}

        <Card>
          <CardHeader
            title="Sinkron"
            subtitle="Otomatis setiap pagi pukul 06.13 WIB. Tarikan yang isinya sama tidak disimpan ulang."
          />
          <CardBody className="space-y-3">
            {t && hasil ? (
              <div className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-muted">Tarikan terakhir</span>
                  <span className="text-ink">{formatTanggalWaktu(t.startedAt)}</span>
                  <StatusPill tone={hasil.tone} label={hasil.label} />
                  <span className="text-ink-muted">{t.trigger === "cron" ? "terjadwal" : "manual"}</span>
                </div>
                {t.rowCount != null && t.outcome !== "gagal" ? (
                  <p className="text-ink-muted">
                    {t.rowCount} lokasi diterima dari Kawal: {t.matchedCount} berpasangan, {t.queueCount} menunggu
                    konfirmasi, {t.discardedCount} dibuang karena bukan lokasi MARLIN.
                  </p>
                ) : null}
                {ringkas.snapshotTerakhir ? (
                  <p className="text-ink-muted">
                    Data Kawal terakhir berubah: {formatTanggalWaktu(ringkas.snapshotTerakhir)}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Belum pernah sinkron.</p>
            )}
            {t?.outcome === "gagal" && t.error ? (
              <Banner tone="error" title="Sinkron terakhir gagal" description={t.error} />
            ) : null}
            {t?.outcome !== "gagal" && t?.catatan ? (
              <Banner
                tone="warning"
                title="Sinkron berhasil, dengan catatan dari data Kawal"
                description={t.catatan}
              />
            ) : null}
            <TombolSinkron bisa={akunSiap} />
          </CardBody>
        </Card>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KpiCard
            label="Berpasangan"
            value={data.berpasangan.length}
            sub={`${otomatis} otomatis · ${data.berpasangan.length - otomatis} dikonfirmasi`}
            tone="success"
          />
          <KpiCard
            label="Menunggu konfirmasi"
            value={data.antrean.length}
            sub="petunjuknya tidak tunggal"
            tone={data.antrean.length ? "warning" : "default"}
          />
          <KpiCard label="Bukan lokasi MARLIN" value={data.bukanMarlin.length} sub="ditandai orang" />
          <KpiCard
            label="Lokasi MARLIN tanpa pasangan"
            value={data.lokasiBebas.length}
            sub="belum ada padanannya di Kawal"
          />
        </div>

        <Card>
          <CardHeader
            title={`Menunggu konfirmasi (${data.antrean.length})`}
            subtitle="Dipasangkan otomatis hanya bila buktinya tunggal. Yang ini punya petunjuk, tapi lebih dari satu kemungkinan atau kabupatennya berbeda."
          />
          <CardBody>
            {data.antrean.length === 0 ? (
              <p className="text-sm text-ink-muted">
                {data.snapshotAt ? "Tidak ada yang menunggu." : "Belum ada data Kawal. Tekan Sinkron sekarang."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.antrean.map(({ baris, kandidat }) => (
                  <li key={baris.kawalId} className="space-y-2 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium text-ink">{baris.namaKnmp}</p>
                      <p className="text-[13px] text-ink-muted">
                        <WilayahKawal b={baris} />
                        {baris.noKontrak ? ` · kontrak ${baris.noKontrak}` : ""}
                      </p>
                    </div>
                    <FormPasangkan
                      kawalId={baris.kawalId}
                      opsi={opsiUntuk(kandidat, data.lokasiBebas)}
                      awal={kandidat[0]?.locationId}
                      label={`Pasangkan ${baris.namaKnmp}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={`Sudah berpasangan (${data.berpasangan.length})`}
            subtitle="Pasangan yang salah diperbaiki dengan memilih lokasi lain lewat Ubah."
          />
          <CardBody>
            {data.berpasangan.length === 0 ? (
              <p className="text-sm text-ink-muted">Belum ada.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.berpasangan.map((p) => (
                  <li key={p.baris.kawalId} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <div className="min-w-0">
                        <p className="text-sm text-ink">
                          <Link href={`/lokasi/${p.lokasi.slug}`} className="font-medium">
                            {p.lokasi.nama}
                          </Link>{" "}
                          <span className="text-ink-muted">– {p.lokasi.paket}</span>
                        </p>
                        <p className="text-[13px] text-ink-muted">
                          Kawal: {p.baris.namaKnmp} · <WilayahKawal b={p.baris} />
                        </p>
                      </div>
                      <span className="text-[13px] text-ink-muted">
                        {p.status === "dikonfirmasi"
                          ? "dikonfirmasi orang"
                          : `otomatis – ${p.basis ?? "petunjuk tunggal"}`}
                      </span>
                    </div>
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[13px] text-primary">Ubah</summary>
                      <div className="mt-2">
                        <FormPasangkan
                          kawalId={p.baris.kawalId}
                          opsi={opsiUntuk([], data.lokasiBebas, p.lokasi)}
                          awal={p.lokasi.id}
                          label={`Pasangkan ulang ${p.baris.namaKnmp}`}
                        />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {data.bukanMarlin.length > 0 ? (
          <Card>
            <CardHeader
              title={`Bukan lokasi MARLIN (${data.bukanMarlin.length})`}
              subtitle="Baris ini dibuang di setiap tarikan. Kembalikan bila keputusan itu keliru."
            />
            <CardBody>
              <ul className="divide-y divide-border">
                {data.bukanMarlin.map((b) => (
                  <li
                    key={b.kawalId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm text-ink">{b.namaKnmp}</p>
                      <p className="text-[13px] text-ink-muted">
                        <WilayahKawal b={b} />
                      </p>
                    </div>
                    <TombolKembalikan kawalId={b.kawalId} />
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}

        {data.lokasiBebas.length > 0 && data.snapshotAt ? (
          <Card>
            <CardHeader
              title={`Lokasi MARLIN tanpa pasangan (${data.lokasiBebas.length})`}
              subtitle="Tidak ada baris Kawal yang menunjuk ke lokasi ini. Bisa karena namanya ditulis jauh berbeda, atau lokasinya memang tidak ada di Kawal."
            />
            <CardBody>
              <details>
                <summary className="cursor-pointer text-[13px] text-primary">Tampilkan daftar</summary>
                <ul className="mt-2 grid gap-x-6 gap-y-1 text-[13px] text-ink-muted sm:grid-cols-2">
                  {data.lokasiBebas.map((l) => (
                    <li key={l.id}>{labelLokasi(l)}</li>
                  ))}
                </ul>
              </details>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Ambang peringatan selisih"
            subtitle="Berlaku untuk halaman Kawal KNMP dan Perlu Tindakan. Selisih dihitung MARLIN − Kawal, dinilai dari besarnya ke arah mana pun."
          />
          <CardBody>
            <FormAmbang tinggiPp={ambang.tinggiPp} kritisPp={ambang.kritisPp} />
          </CardBody>
        </Card>
      </div>
    </UmpanBalikKawal>
  );
}
