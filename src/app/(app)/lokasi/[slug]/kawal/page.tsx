import type { Metadata } from "next";
import { ArrowLeftRight } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader, EmptyState, KpiCard, StatusPill } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { formatPct, formatRupiahShort, formatTanggal, formatTanggalWaktu } from "@/lib/format";
import { getLocationsProgress } from "@/lib/progress";
import { kunciKontrak } from "@/lib/kawal/cocok";
import {
  bandingkanProgres,
  formatSelisihPp,
  LABEL_ARAH,
  LABEL_TINGKAT,
  SARAN_ARAH,
  TONE_TINGKAT,
} from "@/lib/kawal/compare";
import { kawalUntukLokasi, ringkasSinkronKawal } from "@/lib/kawal/queries";
import { requireLocationPage } from "../get-location";

export const metadata: Metadata = { title: "Kawal KNMP" };
export const dynamic = "force-dynamic";

const kunciTanggal = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** "sama" / "beda" untuk satu data administrasi; null bila salah satu kosong. */
function cocok(a: string | null, b: string | null): boolean | null {
  return a && b ? a === b : null;
}

/**
 * PEMBANDING KAWAL KNMP untuk satu lokasi (DECISIONS 691). Progres MARLIN
 * saat ini (calculation layer) dibandingkan dengan progres Kawal dari tarikan
 * terbaru. Data Kawal = rujukan dari aplikasi pengawas KKP, bukan angka resmi.
 */
export default async function KawalLokasiPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "kawal.view");

  const [kawalPer, progresPer, sinkron] = await Promise.all([
    kawalUntukLokasi([location.id]),
    getLocationsProgress([location.id]),
    ringkasSinkronKawal(),
  ]);
  const k = kawalPer.get(location.id);
  const progres = progresPer.get(location.id);
  const bolehAtur = can(user.role, "kawal.manage");

  if (!k) {
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title="Lokasi ini belum berpasangan dengan Kawal KNMP"
        description={
          bolehAtur
            ? "Pasangkan lokasi ini dengan baris Kawal-nya di halaman pencocokan. Setelah itu angkanya tampil di sini."
            : "Program Director atau Super Admin perlu memasangkannya dulu di halaman pencocokan Kawal."
        }
        action={
          bolehAtur ? (
            <ButtonLink href="/kawal/pencocokan" variant="secondary">
              Buka pencocokan
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }

  const banding = bandingkanProgres(progres?.realizedPct ?? null, k.actualPct, k.weekNo);
  const kontrak = location.package.contract;
  const kontrakSama = cocok(kunciKontrak(k.noKontrak) || null, kunciKontrak(kontrak?.contractNumber) || null);
  const spmkSama = cocok(kunciTanggal(k.mulai), kunciTanggal(kontrak?.startDate ?? null));
  const catatan = [
    { judul: "Kondisi umum", isi: k.remarkKondisiUmum },
    { judul: "Hambatan", isi: k.remarkHambatan },
    { judul: "Saran / instruksi pengawas", isi: k.remarkSaranInstruksi },
  ].filter((c) => c.isi);

  return (
    <div className="space-y-4">
      <Banner
        tone="info"
        title="Pembanding dari Kawal KNMP – bukan angka resmi"
        description={
          `Angka Kawal diisi pengawas KKP di aplikasinya sendiri dan dibandingkan apa adanya. ` +
          `Tarikan terakhir ${sinkron.berhasilTerakhir ? formatTanggalWaktu(sinkron.berhasilTerakhir) : "–"}; ` +
          `angka lokasi ini terakhir berubah di Kawal ${formatTanggalWaktu(k.snapshotAt)}.`
        }
      />

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard
          label="Progres MARLIN"
          value={progres ? formatPct(progres.realizedPct, 2) : "–"}
          sub="laporan harian terkirim s/d hari ini"
        />
        <KpiCard
          label="Progres Kawal (pengawas)"
          value={k.actualPct != null ? formatPct(k.actualPct, 2) : "–"}
          sub={
            k.weekNo != null
              ? `minggu ke-${k.weekNo}${k.lastActualWeek != null ? ` · terakhir diisi minggu ke-${k.lastActualWeek}` : ""}`
              : "minggu belum terbaca"
          }
        />
        <KpiCard
          label="Selisih"
          value={banding.selisihPp != null ? formatSelisihPp(banding.selisihPp) : "–"}
          sub={banding.arah ? LABEL_ARAH[banding.arah] : "tidak bisa dihitung"}
          tone={banding.tingkat === "kritis" ? "danger" : banding.tingkat === "tinggi" ? "warning" : "default"}
        />
        <KpiCard
          label="Laporan kontraktor di Kawal"
          value={k.pelaksanaPct != null ? formatPct(k.pelaksanaPct, 2) : "–"}
          sub="diisi kontraktor sendiri di Kawal"
        />
      </section>

      <Card>
        <CardHeader
          title="Artinya"
          action={<StatusPill tone={TONE_TINGKAT[banding.tingkat]} label={LABEL_TINGKAT[banding.tingkat]} />}
        />
        <CardBody className="space-y-2 text-sm">
          {banding.tingkat === "tidak_dinilai" ? (
            <p className="text-ink-muted">
              Selisih belum dinilai:{" "}
              {k.weekNo == null || k.weekNo < 1 ? "menurut Kawal pekerjaan belum mulai" : "salah satu angka kosong"}.
            </p>
          ) : banding.arah ? (
            <p className="text-ink">{SARAN_ARAH[banding.arah]}</p>
          ) : null}
          <p className="text-ink-muted">
            Rencana minggu ini: MARLIN {progres ? formatPct(progres.planPct, 2) : "–"}, Kawal{" "}
            {k.targetPct != null ? formatPct(k.targetPct, 2) : "–"}.
          </p>
          <p className="text-ink-muted">
            Selisih tidak selalu berarti salah lapor. Kawal membobot per sarana dengan daftar dan nilai sarananya
            sendiri, MARLIN membobot per item RAB – bobot yang berbeda membuat persen yang berbeda untuk pekerjaan yang
            sama. Periksa per sarana di bawah sebelum menyimpulkan.
          </p>
          <p className="text-ink-muted">
            <span className="text-ink">Relatif (Wakil Sah / Penyuluh)</span> belum ditampilkan: di data Kawal tidak ada
            angka yang bernama relatif, dan angka mana yang dipakai layar Kawal untuk jalur itu belum terbukti. Begitu
            terbukti dari data, angkanya muncul di sini.
          </p>
          {bolehAtur ? (
            /* DECISIONS 693: dua angka Kawal yang tidak cocok dengan angka lain
               mana pun di 96 baris – calon terkuat jalur Relatif. Dicocokkan
               dengan layar Kawal oleh orang yang bisa membukanya. */
            <div className="rounded-md border border-dashed border-border-strong bg-surface-muted p-3 text-[13px]">
              <p className="font-medium text-ink">Bantu tetapkan jalur Relatif</p>
              <p className="mt-0.5 text-ink-muted">
                Dua angka Kawal lokasi ini belum terjelaskan dari data. Buka lokasi ini di layar Kawal: bila angka
                Relatif di sana sama dengan salah satunya, kabari – angka itulah yang dipasang sebagai Relatif.
              </p>
              <dl className="mt-2 grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-0.5">
                <dt className="text-ink-muted">Angka A (realisasi_pengawas)</dt>
                <dd className="tabular text-ink">
                  {k.realisasiPengawasPct != null ? formatPct(k.realisasiPengawasPct, 2) : "–"}
                </dd>
                <dt className="text-ink-muted">Angka B (realisasi_pelaksana)</dt>
                <dd className="tabular text-ink">
                  {k.realisasiPelaksanaPct != null ? formatPct(k.realisasiPelaksanaPct, 2) : "–"}
                </dd>
              </dl>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Sarana menurut Kawal"
            subtitle="Bobot dan progres per sarana yang diisi pengawas – belum dipasangkan dengan kelompok RAB MARLIN."
          />
          <CardBody>
            {k.sarana.length === 0 ? (
              <p className="text-sm text-ink-muted">Kawal belum mencatat sarana untuk lokasi ini.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {k.sarana.map((s, i) => (
                  <li key={`${s.nama}-${i}`} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="text-ink">{s.nama}</span>
                      {s.bobot != null ? (
                        <span className="ml-1.5 text-xs text-ink-muted">bobot {formatPct(s.bobot, 2)}</span>
                      ) : null}
                    </span>
                    <span className="tabular shrink-0 text-ink">
                      {s.progresPct != null ? formatPct(s.progresPct, 1) : "–"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Catatan pengawas di Kawal" subtitle="Ditulis pengawas KKP, apa adanya." />
          <CardBody>
            {catatan.length === 0 ? (
              <p className="text-sm text-ink-muted">Tidak ada catatan.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {catatan.map((c) => (
                  <div key={c.judul}>
                    <dt className="text-xs font-medium text-ink-muted">{c.judul}</dt>
                    <dd className="whitespace-pre-line text-ink">{c.isi}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Data kontrak di Kawal" subtitle="Dibandingkan dengan data kontrak paket ini di MARLIN." />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-ink-muted">Nomor kontrak</dt>
              <dd className="flex flex-wrap items-center gap-2 text-ink">
                {k.noKontrak ?? "–"}
                {kontrakSama === false ? <StatusPill tone="warning" label="beda dengan MARLIN" /> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-muted">Tanggal SPMK (mulai)</dt>
              <dd className="flex flex-wrap items-center gap-2 text-ink">
                {k.mulai ? formatTanggal(k.mulai) : "–"}
                {spmkSama === false ? <StatusPill tone="warning" label="beda dengan MARLIN" /> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-muted">Selesai menurut Kawal</dt>
              <dd className="text-ink">{k.selesai ? formatTanggal(k.selesai) : "–"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-muted">Nilai lokasi di Kawal</dt>
              <dd className="text-ink">{k.nilaiLokasi != null ? formatRupiahShort(k.nilaiLokasi) : "–"}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
