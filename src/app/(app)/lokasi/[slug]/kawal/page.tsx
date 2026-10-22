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
  labelTingkat,
  SARAN_ARAH,
  TONE_TINGKAT,
} from "@/lib/kawal/compare";
import { kawalUntukLokasi, ringkasSinkronKawal } from "@/lib/kawal/queries";
import { perSaranaKawal } from "@/lib/kawal/sarana";
import { LABEL_ASAL, type BarisSarana, type KelompokMarlin } from "@/lib/kawal/sarana-cocok";
import { getAmbangKawal } from "@/lib/kawal/setelan";
import { requireLocationPage } from "../get-location";
import { FormSarana } from "./sarana-client";

export const metadata: Metadata = { title: "Kawal KNMP" };
export const dynamic = "force-dynamic";

const kunciTanggal = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** "sama" / "beda" untuk satu data administrasi; null bila salah satu kosong. */
function cocok(a: string | null, b: string | null): boolean | null {
  return a && b ? a === b : null;
}

const labelKelompok = (k: KelompokMarlin) => [k.code, k.name].filter(Boolean).join(" ");

/** Satu sarana Kawal: angka Kawal apa adanya lawan kelompok RAB yang dipasangkan. */
function BarisPerSarana({
  b,
  kelompok,
  locationId,
  bolehAtur,
}: {
  b: BarisSarana;
  kelompok: KelompokMarlin[];
  locationId: string;
  bolehAtur: boolean;
}) {
  const s = b.sarana;
  const opsi = kelompok.map((k) => ({
    value: k.kunci,
    label: b.asal === "usulan" && b.kelompok?.kunci === k.kunci ? `${labelKelompok(k)} (usulan)` : labelKelompok(k),
  }));
  const ringkasAsal = b.kelompokHilang ? "kelompok yang dipilih tidak ada lagi di RAB aktif" : LABEL_ASAL[b.asal];
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      {/* Di ponsel angkanya turun ke baris sendiri – di samping nama, nama sarana terjepit. */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-x-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink">
            {s.nama}
            {s.bobot != null ? (
              <span className="ml-1.5 text-xs text-ink-muted">bobot Kawal {formatPct(s.bobot, 2)}</span>
            ) : null}
          </p>
          <p className="text-[13px] text-ink-muted">
            RAB:{" "}
            {b.kelompok ? (
              <>
                <span className="text-ink">{labelKelompok(b.kelompok)}</span> · {ringkasAsal}
              </>
            ) : (
              ringkasAsal
            )}
          </p>
        </div>
        <dl className="grid w-fit shrink-0 grid-cols-[4.5rem_4.5rem_5.5rem] gap-x-3 text-sm sm:text-right">
          <div>
            <dt className="text-[10px] font-semibold tracking-wide text-primary uppercase">MARLIN</dt>
            <dd className="tabular text-primary">{b.kelompok ? formatPct(b.kelompok.progresPct, 1) : "–"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Kawal</dt>
            <dd className="tabular text-ink-muted">{s.progresPct != null ? formatPct(s.progresPct, 1) : "–"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Selisih</dt>
            <dd className="tabular text-ink">{b.selisihPp != null ? formatSelisihPp(b.selisihPp) : "–"}</dd>
          </div>
        </dl>
      </div>
      {bolehAtur && kelompok.length > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[13px] text-primary">
            {b.asal === "usulan" ? "Konfirmasi atau ubah" : b.asal === "belum" ? "Pasangkan" : "Ubah"}
          </summary>
          <div className="mt-2">
            <FormSarana
              locationId={locationId}
              kawalItemId={s.kawalItemId}
              opsi={opsi}
              awal={b.kelompok?.kunci}
              sudahDiputuskan={b.asal === "dikonfirmasi" || b.asal === "tidak_ada" || b.kelompokHilang}
              nama={s.nama}
            />
          </div>
        </details>
      ) : null}
    </li>
  );
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

  const [kawalPer, progresPer, sinkron, ambang] = await Promise.all([
    kawalUntukLokasi([location.id]),
    getLocationsProgress([location.id]),
    ringkasSinkronKawal(),
    getAmbangKawal(),
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

  const perSarana = await perSaranaKawal(location.id, k.sarana);
  const banding = bandingkanProgres(progres?.realizedPct ?? null, k.actualPct, k.weekNo, ambang);
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
          action={<StatusPill tone={TONE_TINGKAT[banding.tingkat]} label={labelTingkat(banding.tingkat, ambang)} />}
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

      <Card>
        <CardHeader
          title="Per sarana: Kawal lawan kelompok RAB MARLIN"
          subtitle="Tiap sarana Kawal dipasangkan dengan kelompok RAB (kategori tingkat 1). Usulan dibuat dari kemiripan nama dan baru pasti setelah dikonfirmasi."
        />
        <CardBody className="space-y-3">
          {k.sarana.length === 0 ? (
            <p className="text-sm text-ink-muted">Kawal belum mencatat sarana untuk lokasi ini.</p>
          ) : (
            <ul className="divide-y divide-border">
              {perSarana.baris.map((b) => (
                <BarisPerSarana
                  key={b.sarana.kawalItemId}
                  b={b}
                  kelompok={perSarana.kelompok}
                  locationId={location.id}
                  bolehAtur={bolehAtur}
                />
              ))}
            </ul>
          )}
          {perSarana.kelompok.length === 0 ? (
            <p className="text-[13px] text-ink-muted">
              Lokasi ini belum punya RAB aktif, jadi progres per kelompok MARLIN belum bisa dihitung.
            </p>
          ) : perSarana.kelompokTanpaPasangan.length > 0 && k.sarana.length > 0 ? (
            <p className="text-[13px] text-ink-muted">
              Kelompok RAB tanpa padanan di Kawal ({perSarana.kelompokTanpaPasangan.length}):{" "}
              {perSarana.kelompokTanpaPasangan.map(labelKelompok).join(", ")}.
            </p>
          ) : null}
          <p className="text-[13px] text-ink-muted">
            <span className="text-primary">MARLIN</span> = progres kelompok dari laporan harian terkirim s/d hari ini,
            rumus yang sama dengan Progres per Kategori di laporan mingguan.{" "}
            <span className="text-ink">Kawal</span> = progres sarana yang diisi pengawas, apa adanya. Selisih per sarana
            menunjukkan di mana bedanya terletak. Ia belum bisa dijumlahkan menjadi selisih total, karena hubungan angka
            sarana Kawal dengan progres totalnya belum terbukti dari data.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
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
    </div>
  );
}
