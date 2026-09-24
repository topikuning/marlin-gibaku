import type { Metadata } from "next";
import Link from "next/link";
import {
  Badge,
  Banner,
  Card,
  CardBody,
  CardHeader,
  KpiCard,
  StatusPill,
  TautanUnduh,
} from "@/components/ui";
import { ScurveChart } from "@/components/knmp/scurve-chart";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatPct, formatRupiah, formatTanggal, parseDateKey } from "@/lib/format";
import { EWS_KATEGORI_LABEL, EWS_SEVERITY_LABEL } from "@/lib/ews/rules";
import { ISSUE_SEVERITY_LABEL, ISSUE_SEVERITY_TONE } from "@/lib/lifecycle";
import { kartuMinggu } from "@/lib/lokasi-lengkap/kesimpulan";
import { buatLaporanLokasiLengkap } from "@/lib/lokasi-lengkap/snapshot";
import { isWahaConfigured } from "@/lib/waha/client";
import { grupUntukLokasi } from "@/lib/waha/grup";
import { requireLocationPage } from "../get-location";
import { AksiLaporanLengkap } from "./aksi";

export const metadata: Metadata = { title: "Laporan Lengkap Lokasi" };
export const dynamic = "force-dynamic";

/**
 * LAPORAN LENGKAP SATU LOKASI (permintaan user 2026-09-19).
 *
 * Satu halaman yang menjawab "bagaimana keadaan lokasi ini" tanpa memaksa orang
 * membuka tujuh tab: kesimpulan, progres, kurva-S, perkembangan mingguan,
 * kategori RAB, kelengkapan harian, kendala, kronologi, kegiatan, temuan,
 * administrasi, peringatan dini, rencana minggu depan.
 *
 * Seluruh angkanya datang dari SATU snapshot (`buatLaporanLokasiLengkap`) yang
 * juga dipakai PDF, deck, dan balasan WhatsApp — jadi ketiganya tidak bisa
 * berbeda. Halaman ini hanya memformat; tidak ada rumus di sini.
 */
export default async function LaporanLengkapLokasiPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "location.view");
  await requireLocationAccess(user, location.id);

  const l = await buatLaporanLokasiLengkap(location.id);
  if (!l) {
    return (
      <Card>
        <CardBody className="py-6 text-sm text-ink-muted">
          Laporan lengkap belum bisa disusun untuk lokasi ini.
        </CardBody>
      </Card>
    );
  }

  const bolehEkspor = can(user.role, "report.export");
  const wahaOn = bolehEkspor && (await isWahaConfigured());
  // Tujuan ditanyakan ke resolver: lokasi bisa punya grup KABUPATEN sendiri,
  // dan paketnya belum tentu punya grup (DECISIONS 609).
  const grup = wahaOn ? await grupUntukLokasi(location.id) : null;

  const tgl = (key: string | null | undefined) => {
    if (!key) return "–";
    const d = parseDateKey(key);
    return d ? formatTanggal(d) : key;
  };
  const pp = (v: number | null) =>
    v == null ? "–" : `${v > 0 ? "+" : ""}${v.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;

  const p = l.progres;
  const mg = kartuMinggu(p.mingguKe, p.totalMinggu, !!l.identitas.kontrak);

  return (
    <div className="space-y-4">
      {/* Kepala: kesimpulan + tombol berkas */}
      <Card>
        <CardHeader
          title="Laporan lengkap lokasi"
          subtitle={`Seluruh keadaan ${l.identitas.nama} pada posisi ${tgl(l.asOfKey)} – kesimpulan, progres, kendala, temuan, dan administrasi dari satu sumber angka.`}
        />
        <CardBody className="space-y-4">
          <div className="rounded-lg border-l-4 border-primary bg-primary-50 p-3">
            <p className="text-[11px] font-bold tracking-wide text-primary uppercase">Kesimpulan</p>
            <div className="mt-1 space-y-1">
              {l.kesimpulan.map((k, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-ink">
                  {k}
                </p>
              ))}
            </div>
          </div>

          {bolehEkspor ? (
            <AksiLaporanLengkap
              slug={slug}
              locationId={l.identitas.locationId}
              wahaOn={wahaOn}
              hasGroup={!!grup}
              groupName={grup?.nama ?? grup?.label ?? null}
            />
          ) : (
            <Banner
              tone="info"
              title="Anda dapat melihat laporan ini, tetapi tidak mengunduh atau mengirimnya"
              description="Mengunduh dan mengirim dokumen butuh kapabilitas ekspor laporan (report.export)."
            />
          )}
        </CardBody>
      </Card>

      {/* Identitas ringkas */}
      <Card>
        <CardHeader title="Identitas" />
        <CardBody className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Lokasi">
            {l.identitas.nama} <StatusPill tone="info" label={l.identitas.statusLabel} />
          </Info>
          <Info label="Wilayah">
            {[l.identitas.desa, l.identitas.kecamatan, l.identitas.kabupaten, l.identitas.provinsi]
              .filter(Boolean)
              .join(", ")}
          </Info>
          <Info label="Paket">
            <Link href={`/paket/${l.identitas.paket.id}`} className="font-medium text-primary hover:underline">
              {l.identitas.paket.nama}
            </Link>
          </Info>
          {l.identitas.kontrak ? (
            <>
              <Info label="Kontrak">{l.identitas.kontrak.nomor}</Info>
              <Info label="Penyedia">{l.identitas.kontrak.vendor}</Info>
              <Info label="Nilai kontrak">{formatRupiah(BigInt(l.identitas.kontrak.nilai))}</Info>
              <Info label="Masa kontrak">
                {tgl(l.identitas.kontrak.mulaiKey)} – {tgl(l.identitas.kontrak.akhirKey)} (
                {l.identitas.kontrak.durasiHari} hari)
              </Info>
            </>
          ) : (
            <Info label="Kontrak">Belum berkontrak / SPMK belum terbit</Info>
          )}
          {l.identitas.pelaksana ? (
            <Info label="Pelaksana">
              {l.identitas.pelaksana.nama}
              {l.identitas.pelaksana.jabatan ? ` (${l.identitas.pelaksana.jabatan})` : ""}
            </Info>
          ) : null}
        </CardBody>
      </Card>

      {/* Angka utama */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Rencana" value={p.punyaKurva ? formatPct(p.rencanaPct ?? 0) : "belum ada kurva-S"} />
        <KpiCard label="Realisasi" value={p.punyaRab ? formatPct(p.realisasiPct) : "belum ada RAB"} />
        <KpiCard
          label="Deviasi"
          value={p.punyaKurva ? pp(p.deviasiPp) : "–"}
          tone={p.deviasiPp == null ? "default" : p.deviasiPp < 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Terverifikasi"
          value={p.punyaRab ? formatPct(p.terverifikasiPct) : "–"}
          sub="disetujui + final"
        />
        <KpiCard label="Minggu kontrak" value={mg.nilai} sub={mg.sub} />
        <KpiCard
          label="Durasi"
          value={l.durasi ? `${l.durasi.hariBerjalan} / ${l.durasi.totalHari} hari` : "–"}
          sub={l.durasi ? `sisa ${l.durasi.sisaHari} hari` : undefined}
        />
        <KpiCard label="Nilai RAB" value={p.punyaRab ? formatRupiah(BigInt(p.nilaiRab)) : "–"} />
        <KpiCard label="Nilai terpasang" value={p.punyaRab ? formatRupiah(BigInt(p.nilaiTerpasang)) : "–"} />
      </div>

      {/* Kurva-S */}
      <Card>
        <CardHeader title="Kurva-S" subtitle="Rencana vs realisasi kumulatif per minggu kontrak." />
        <CardBody>
          {l.kurva ? (
            <ScurveChart
              series={{
                totalWeeks: l.kurva.totalMinggu,
                currentWeek: l.kurva.mingguBerjalan,
                planPct: l.kurva.planPct,
                actualPct: l.kurva.actualPct,
              }}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              Lokasi ini belum punya kurva-S (baseline) aktif, jadi rencana dan deviasinya belum bisa digambar.
            </p>
          )}
        </CardBody>
      </Card>

      {/* Perkembangan mingguan */}
      <Card>
        <CardHeader title="Perkembangan mingguan" subtitle="Posisi pada akhir tiap minggu kontrak." />
        <CardBody className="overflow-x-auto">
          {l.mingguan.length === 0 ? (
            <p className="text-sm text-ink-muted">Kontrak belum berjalan, jadi belum ada minggu yang bisa dirinci.</p>
          ) : (
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-ink-muted">
                  <Th>Minggu</Th>
                  <Th>Periode</Th>
                  <Th align="right">Rencana</Th>
                  <Th align="right">Realisasi</Th>
                  <Th align="right">Kenaikan</Th>
                  <Th align="right">Deviasi</Th>
                  <Th align="right">Laporan</Th>
                </tr>
              </thead>
              <tbody>
                {l.mingguan.map((m) => (
                  <tr key={m.minggu} className="border-b border-border/60">
                    <Td>ke-{m.minggu}</Td>
                    <Td>
                      {tgl(m.mulaiKey)} – {tgl(m.akhirKey)}
                    </Td>
                    <Td align="right">{m.rencanaPct == null ? "–" : formatPct(m.rencanaPct)}</Td>
                    <Td align="right">{m.realisasiPct == null ? "–" : formatPct(m.realisasiPct)}</Td>
                    <Td align="right">{pp(m.kenaikanPp)}</Td>
                    <Td align="right">
                      <span className={m.deviasiPp != null && m.deviasiPp < 0 ? "text-danger" : "text-ink"}>
                        {pp(m.deviasiPp)}
                      </span>
                    </Td>
                    <Td align="right">{m.laporanTerhitung}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Kategori RAB */}
      <Card>
        <CardHeader
          title="Status pekerjaan per kategori RAB"
          subtitle="Realisasi tiap kategori terhadap nilai kategorinya; bobot terhadap total RAB lokasi."
        />
        <CardBody className="space-y-2">
          {l.kategori.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada RAB aktif untuk lokasi ini.</p>
          ) : (
            l.kategori.map((k) => (
              <div key={k.lineageKey} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-[12px] text-ink" title={k.nama}>
                  {k.lineageKey} {k.nama}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-inset">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(0, Math.min(100, k.realisasiPct))}%` }}
                  />
                </span>
                <span className="tabular w-14 shrink-0 text-right text-[12px] font-semibold text-ink">
                  {formatPct(k.realisasiPct)}
                </span>
                <span className="tabular w-20 shrink-0 text-right text-[11px] text-ink-muted">
                  bobot {formatPct(k.bobotPct)}
                </span>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {/* Kelengkapan harian */}
      <Card>
        <CardHeader title="Kelengkapan laporan harian" subtitle="Sejak SPMK sampai posisi laporan." />
        <CardBody>
          {l.kelengkapan ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Hari diharapkan" value={String(l.kelengkapan.hariDiharapkan)} />
              <KpiCard label="Final" value={String(l.kelengkapan.final)} />
              <KpiCard
                label="Disetujui / dikirim"
                value={`${l.kelengkapan.disetujui} / ${l.kelengkapan.dikirim}`}
              />
              <KpiCard
                label="Draft / perlu koreksi"
                value={`${l.kelengkapan.draft} / ${l.kelengkapan.perluKoreksi}`}
                tone={l.kelengkapan.perluKoreksi > 0 ? "warning" : "default"}
              />
              <KpiCard label="Hari nihil" value={String(l.kelengkapan.hariNihil)} sub="dinyatakan tidak ada kegiatan" />
              <KpiCard
                label="Hari tanpa laporan"
                value={String(l.kelengkapan.hariTanpaLaporan)}
                tone={l.kelengkapan.hariTanpaLaporan > 0 ? "danger" : "success"}
              />
              <KpiCard label="Laporan terakhir" value={tgl(l.kelengkapan.laporanTerakhirKey)} />
              <KpiCard
                label="Sejak laporan terakhir"
                value={
                  l.kelengkapan.hariSejakLaporanTerakhir == null
                    ? "–"
                    : l.kelengkapan.hariSejakLaporanTerakhir === 0
                      ? "hari ini"
                      : `${l.kelengkapan.hariSejakLaporanTerakhir} hari`
                }
              />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Kelengkapan belum bisa dihitung: kontrak belum berjalan (SPMK belum terbit).
            </p>
          )}
        </CardBody>
      </Card>

      {/* Kendala */}
      <Card>
        <CardHeader
          title="Kendala"
          subtitle={`${l.kendala.ringkas.terbuka} terbuka · ${l.kendala.ringkas.lewatTenggat} lewat tenggat · ${l.kendala.ringkas.selesai} selesai`}
        />
        <CardBody className="overflow-x-auto">
          {l.kendala.terbuka.length === 0 ? (
            <p className="text-sm text-ink-muted">Tidak ada kendala terbuka.</p>
          ) : (
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-ink-muted">
                  <Th>Kendala</Th>
                  <Th>Tingkat</Th>
                  <Th>Status</Th>
                  <Th>Dibuka</Th>
                  <Th align="right">Umur</Th>
                  <Th>PIC</Th>
                  <Th>Tenggat</Th>
                </tr>
              </thead>
              <tbody>
                {l.kendala.terbuka.map((k) => (
                  <tr key={k.id} className="border-b border-border/60">
                    <Td>{k.judul}</Td>
                    <Td>
                      <Badge tone={ISSUE_SEVERITY_TONE[k.tingkat]}>{ISSUE_SEVERITY_LABEL[k.tingkat]}</Badge>
                    </Td>
                    <Td>{k.status}</Td>
                    <Td>{tgl(k.dibukaKey)}</Td>
                    <Td align="right">{k.umurHari} hr</Td>
                    <Td>{k.pic ?? "–"}</Td>
                    <Td>
                      <span className={k.lewatTenggat ? "text-danger" : "text-ink"}>
                        {k.tenggatKey ? `${tgl(k.tenggatKey)}${k.lewatTenggat ? " (lewat)" : ""}` : "–"}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Kronologi per babak bulan */}
      <Card>
        <CardHeader
          title="Kronologi"
          subtitle={`${tgl(l.kronologi.sejakKey)} s.d. ${tgl(l.asOfKey)} · ${l.kronologi.totalPeristiwa} peristiwa, terbaru dulu`}
        />
        <CardBody className="space-y-4">
          {l.kronologi.babak.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada kendala maupun kegiatan lapangan yang tercatat.</p>
          ) : (
            l.kronologi.babak.map((b) => (
              <div key={b.bulanKey}>
                <p className="text-[12px] font-semibold text-primary">{b.label}</p>
                <ul className="mt-1 space-y-1.5">
                  {b.peristiwa.map((e) => (
                    <li key={e.kunci} className="flex gap-2 text-[12px]">
                      <span className="tabular w-20 shrink-0 text-ink-faint">{e.tanggal}</span>
                      <span className="text-ink">
                        {e.judul}
                        {e.berjalan ? <span className="text-warning"> (masih berjalan)</span> : null}
                        {e.lewatTenggat ? <span className="text-danger"> (lewat tenggat)</span> : null}
                        {e.rincian.length > 0 ? (
                          <span className="text-ink-muted"> – {e.rincian.join("; ")}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {/* Kegiatan & temuan */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Kegiatan lapangan" subtitle={`${l.kegiatan.total} kegiatan tercatat`} />
          <CardBody>
            {l.kegiatan.terakhir.length === 0 ? (
              <p className="text-sm text-ink-muted">Belum ada kegiatan lapangan.</p>
            ) : (
              <ul className="space-y-1.5 text-[12px]">
                {l.kegiatan.terakhir.map((g) => (
                  <li key={g.id} className="flex gap-2">
                    <span className="tabular w-20 shrink-0 text-ink-faint">{g.tanggalKey}</span>
                    <span className="text-ink">
                      {g.jenis}: {g.judul}
                      <span className="text-ink-muted">
                        {" "}
                        ({g.status === "final" ? "final" : "draft"}, {g.jumlahFoto} foto)
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Temuan & inspeksi"
            subtitle={`${l.temuan.ringkas.terbuka} dari ${l.temuan.ringkas.total} temuan terbuka · ${l.temuan.ringkas.inspeksi} inspeksi`}
          />
          <CardBody>
            {l.temuan.terbuka.length === 0 ? (
              <p className="text-sm text-ink-muted">Tidak ada temuan terbuka.</p>
            ) : (
              <ul className="space-y-1.5 text-[12px]">
                {l.temuan.terbuka.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={ISSUE_SEVERITY_TONE[t.tingkat]}>{ISSUE_SEVERITY_LABEL[t.tingkat]}</Badge>
                    <span className="text-ink">{t.judul}</span>
                    <span className="text-ink-muted">
                      ({t.kategori} · {t.statusLabel}
                      {t.tenggatKey ? ` · tenggat ${tgl(t.tenggatKey)}` : ""}
                      {t.lewatTenggat ? " · lewat" : ""})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Administrasi */}
      <Card>
        <CardHeader
          title="Administrasi"
          subtitle="Milestone, dokumen, dan surat – termasuk yang berlaku di tingkat paket."
        />
        <CardBody className="grid gap-4 lg:grid-cols-3">
          <div>
            <p className="text-[12px] font-semibold text-ink">Milestone per fase</p>
            {l.administrasi.milestone.length === 0 ? (
              <p className="mt-1 text-[12px] text-ink-muted">Belum ada milestone.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-[12px]">
                {l.administrasi.milestone.map((m) => (
                  <li key={m.fase} className="flex justify-between gap-2">
                    <span className="text-ink">{m.label}</span>
                    <span className="tabular text-ink-muted">
                      {m.selesai}/{m.total}
                      {m.terlambat > 0 ? <span className="text-danger"> · {m.terlambat} telat</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[12px] font-semibold text-ink">Dokumen</p>
            <ul className="mt-1 space-y-1 text-[12px]">
              <li className="flex justify-between gap-2">
                <span className="text-ink">Aktif</span>
                <span className="tabular text-ink-muted">{l.administrasi.dokumen.total}</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-ink">Kedaluwarsa</span>
                <span className={`tabular ${l.administrasi.dokumen.kedaluwarsa > 0 ? "text-danger" : "text-ink-muted"}`}>
                  {l.administrasi.dokumen.kedaluwarsa}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-ink">Segera kedaluwarsa</span>
                <span className={`tabular ${l.administrasi.dokumen.segeraKedaluwarsa > 0 ? "text-warning" : "text-ink-muted"}`}>
                  {l.administrasi.dokumen.segeraKedaluwarsa}
                </span>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-ink">Surat</p>
            <ul className="mt-1 space-y-1 text-[12px]">
              <li className="flex justify-between gap-2">
                <span className="text-ink">Masuk / keluar</span>
                <span className="tabular text-ink-muted">
                  {l.administrasi.surat.masuk} / {l.administrasi.surat.keluar}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-ink">Perlu balas</span>
                <span className={`tabular ${l.administrasi.surat.perluBalas > 0 ? "text-warning" : "text-ink-muted"}`}>
                  {l.administrasi.surat.perluBalas}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-ink">Lewat tenggat balas</span>
                <span className={`tabular ${l.administrasi.surat.lewatTenggatBalas > 0 ? "text-danger" : "text-ink-muted"}`}>
                  {l.administrasi.surat.lewatTenggatBalas}
                </span>
              </li>
            </ul>
          </div>
        </CardBody>
      </Card>

      {/* Perhatian EWS */}
      <Card>
        <CardHeader title="Perhatian" subtitle="Peringatan dini dari aturan yang sama dengan halaman Perlu Tindakan." />
        <CardBody className="space-y-2">
          {l.perhatian.length === 0 ? (
            <p className="text-sm text-ink-muted">Tidak ada peringatan dini yang terpicu.</p>
          ) : (
            l.perhatian.map((w, i) => (
              <div key={`${w.ruleId}-${i}`} className="rounded-lg border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={w.severity === "kritis" ? "danger" : w.severity === "tinggi" ? "warning" : "info"}>
                    {EWS_SEVERITY_LABEL[w.severity]}
                  </Badge>
                  <span className="text-[11px] text-ink-muted">{EWS_KATEGORI_LABEL[w.kategori]}</span>
                  <span className="text-[12px] font-medium text-ink">{w.objek}</span>
                </div>
                <p className="mt-1 text-[12px] text-ink">{w.alasan}</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">Tindakan: {w.tindakan}</p>
                <Link href={w.href} className="mt-1 inline-block text-[12px] font-medium text-primary hover:underline">
                  Buka
                </Link>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {/* Rencana minggu depan */}
      <Card>
        <CardHeader title="Rencana minggu depan" />
        <CardBody>
          {l.rencanaMingguDepan ? (
            <>
              <p className="text-[12px] text-ink-muted">
                Minggu ke-{l.rencanaMingguDepan.mingguKe}
                {l.rencanaMingguDepan.catatan ? ` · ${l.rencanaMingguDepan.catatan}` : ""}
              </p>
              <ul className="mt-2 space-y-1 text-[12px]">
                {l.rencanaMingguDepan.item.map((it, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-ink">{it.nama}</span>
                    <span className="tabular text-ink-muted">
                      {it.targetVolume.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {it.unit ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-ink-muted">Rencana minggu berikutnya belum diisi di MARLIN.</p>
          )}
        </CardBody>
      </Card>

      {/* Keterbatasan & sumber */}
      <Card>
        <CardHeader
          title="Keterbatasan data & sumber"
          subtitle="Apa yang TIDAK dijamin laporan ini, dan dari mana angkanya diambil."
        />
        <CardBody className="space-y-3">
          {l.limitations.length === 0 ? (
            <p className="text-[12px] text-ink-muted">Tidak ada keterbatasan yang perlu dicatat.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-[12px] text-ink">
              {l.limitations.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
          <div className="space-y-1">
            {l.sumber.map((r) => (
              <p key={r.id} className="text-[11px] text-ink-muted">
                {r.href ? (
                  <Link href={r.href} className="font-medium text-primary hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{r.label}</span>
                )}
                {r.value ? <span> – {r.value}</span> : null}
              </p>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-ink">{children}</dd>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return <th className={`px-2 py-1.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return <td className={`px-2 py-1.5 ${align === "right" ? "tabular text-right" : "text-left"}`}>{children}</td>;
}
