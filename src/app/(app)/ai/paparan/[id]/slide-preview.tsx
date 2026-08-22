import { pctID, ppID, type Slide } from "@/lib/paparan/susun";

/**
 * Preview satu slide (rasio 16:9) — komponen SERVER, tanpa state.
 *
 * Membaca struktur slide yang SAMA dengan renderer PDF (`susunSlides`); tata
 * letaknya boleh berbeda dari PDF, angkanya mustahil berbeda karena tidak ada
 * yang dihitung di sini.
 */

const H2 = "border-b-2 border-primary-600 pb-1 text-base font-semibold text-primary";

function Angka({ label, nilai, merah }: { label: string; nilai: string; merah?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-xl font-bold ${merah ? "text-danger" : "text-primary"}`}>{nilai}</p>
    </div>
  );
}

function Butir({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-sm text-ink">
          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-600" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function SlidePreview({
  slide,
  nomor,
  total,
  thumbUrl,
}: {
  slide: Slide;
  nomor: number;
  total: number;
  thumbUrl: Record<string, string>;
}) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      {"draf" in slide && slide.draf ? (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 -rotate-12 text-center text-3xl font-bold text-danger opacity-15">
          DRAF – BELUM DISETUJUI
        </p>
      ) : null}
      <div className="flex h-full flex-col p-5">
        <div className="min-h-0 flex-1 overflow-hidden">
          <Isi slide={slide} thumbUrl={thumbUrl} />
        </div>
        <p className="pt-2 text-right text-[10px] text-ink-faint">Slide {nomor}/{total}</p>
      </div>
    </div>
  );
}

function Isi({ slide, thumbUrl }: { slide: Slide; thumbUrl: Record<string, string> }) {
  switch (slide.jenis) {
    case "sampul":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-xs uppercase tracking-widest text-ink-muted">{slide.instansi}</p>
          <h3 className="text-xl font-bold text-primary">{slide.judulKerja}</h3>
          <p className="text-sm font-semibold text-ink">
            Paparan Mingguan – Minggu ke-{slide.mingguKe}
            {slide.berjalan ? " (BELUM GENAP)" : ""}
          </p>
          <p className="text-xs text-ink-muted">Periode {slide.periodeLabel}</p>
          <p className="text-xs text-ink-muted">
            {slide.nomorKontrak} · {slide.pelaksana}
          </p>
        </div>
      );
    case "ringkasan":
      return (
        <div className="space-y-3">
          <h3 className={H2}>Ringkasan Eksekutif</h3>
          <div className="grid grid-cols-4 gap-2">
            <Angka label="Rencana" nilai={pctID(slide.angka.rencana)} />
            <Angka label="Realisasi" nilai={pctID(slide.angka.realisasi)} />
            <Angka
              label="Deviasi"
              nilai={ppID(slide.angka.deviasi)}
              merah={slide.angka.deviasi != null && slide.angka.deviasi < 0}
            />
            <Angka label="Laporan final" nilai={`${slide.angka.laporanFinal}/${slide.angka.laporanDiharapkan}`} />
          </div>
          <Butir items={slide.butir} />
        </div>
      );
    case "progres_paket":
      return (
        <div className="space-y-3">
          <h3 className={H2}>
            Progres Kontrak – Minggu ke-{slide.mingguKe} dari {slide.totalMinggu}
          </h3>
          <div className="grid grid-cols-4 gap-2">
            <Angka label="Rencana" nilai={pctID(slide.p.targetPct)} />
            <Angka label="Realisasi" nilai={pctID(slide.p.realisasiPct)} />
            <Angka label="Deviasi" nilai={ppID(slide.p.deviasiPp)} merah={slide.p.deviasiPp != null && slide.p.deviasiPp < 0} />
            <Angka label="Kenaikan minggu ini" nilai={ppID(slide.p.kenaikanPp)} />
          </div>
          {[
            { label: "Rencana", v: slide.p.targetPct, warna: "bg-primary-600" },
            { label: "Realisasi", v: slide.p.realisasiPct, warna: "bg-success" },
          ].map((b) => (
            <div key={b.label} className="flex items-center gap-2">
              <span className="w-20 text-xs text-ink-muted">{b.label}</span>
              <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <div className={`h-full rounded-full ${b.warna}`} style={{ width: `${Math.min(b.v ?? 0, 100)}%` }} />
              </div>
              <span className="w-14 text-right text-xs font-semibold text-ink">{pctID(b.v)}</span>
            </div>
          ))}
          {slide.p.lokasiTanpaKurva > 0 ? (
            <p className="text-xs text-warning">{slide.p.lokasiTanpaKurva} lokasi belum ada kurva-S – tidak ikut penyebut target.</p>
          ) : null}
        </div>
      );
    case "progres_lokasi":
      return (
        <div className="space-y-2">
          <h3 className={H2}>
            Progres per Lokasi{slide.totalBagian > 1 ? ` (${slide.bagian}/${slide.totalBagian})` : ""}
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-primary-50 text-left text-primary">
                <th className="px-2 py-1.5 font-semibold">Lokasi</th>
                <th className="px-2 py-1.5 text-right font-semibold">Rencana</th>
                <th className="px-2 py-1.5 text-right font-semibold">Realisasi</th>
                <th className="px-2 py-1.5 text-right font-semibold">Deviasi</th>
                <th className="px-2 py-1.5 font-semibold">Status data</th>
              </tr>
            </thead>
            <tbody>
              {slide.baris.map((b) => (
                <tr key={b.locationId} className="border-b border-border">
                  <td className="px-2 py-1.5 text-ink">{b.name}</td>
                  <td className="px-2 py-1.5 text-right">{b.targetPct == null ? "–" : pctID(b.targetPct)}</td>
                  <td className="px-2 py-1.5 text-right">{pctID(b.realisasiPct)}</td>
                  <td className={`px-2 py-1.5 text-right ${b.deviasiPp != null && b.deviasiPp < 0 ? "text-danger" : ""}`}>
                    {b.deviasiPp == null ? "–" : ppID(b.deviasiPp)}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted">{b.targetPct == null ? "belum ada kurva-S" : "lengkap"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "capaian":
      return (
        <div className="space-y-2">
          <h3 className={H2}>Capaian Pekerjaan Minggu Ini</h3>
          <Butir items={slide.butir.slice(0, 4)} />
          {slide.rincian.length > 0 ? (
            <table className="w-full text-xs">
              <tbody>
                {slide.rincian.map((c, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-2 py-1 text-ink-muted">{c.lokasiNama}</td>
                    <td className="px-2 py-1 text-ink">{c.pekerjaan}</td>
                    <td className="px-2 py-1 text-right font-medium text-ink">
                      {String(c.volume).replace(".", ",")}
                      {c.unit ? ` ${c.unit}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : slide.butir.length === 0 ? (
            <p className="text-sm text-ink-muted">Tidak ada capaian pekerjaan terhitung pada minggu ini.</p>
          ) : null}
        </div>
      );
    case "kegiatan":
      return (
        <div className="space-y-2">
          <h3 className={H2}>Kegiatan Lapangan</h3>
          <Butir items={slide.butir.slice(0, 4)} />
          {slide.rincian.length > 0 ? (
            <table className="w-full text-xs">
              <tbody>
                {slide.rincian.map((g) => (
                  <tr key={g.id} className="border-b border-border">
                    <td className="px-2 py-1 text-ink-muted">{g.tanggalKey}</td>
                    <td className="px-2 py-1 text-ink-muted">{g.jenis}</td>
                    <td className="px-2 py-1 text-ink">{g.judul}</td>
                    <td className="px-2 py-1 text-ink-muted">{g.lokasiNama}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : slide.butir.length === 0 ? (
            <p className="text-sm text-ink-muted">Tidak ada kegiatan lapangan final pada minggu ini.</p>
          ) : null}
        </div>
      );
    case "dokumentasi":
      return (
        <div className="space-y-2">
          <h3 className={H2}>Dokumentasi</h3>
          <div className={`grid gap-2 ${slide.foto.length <= 4 ? "grid-cols-2" : slide.foto.length <= 6 ? "grid-cols-3" : "grid-cols-4"}`}>
            {slide.foto.map((f) => (
              <figure key={f.id} className="overflow-hidden rounded-lg border border-border">
                {thumbUrl[f.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- presigned URL R2 sementara
                  <img src={thumbUrl[f.id]} alt={f.caption} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-surface-muted text-[10px] text-ink-muted">
                    Foto tidak dapat dimuat
                  </div>
                )}
                <figcaption className="truncate px-1.5 py-1 text-[10px] text-ink-muted">{f.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      );
    case "kendala":
      return (
        <div className="space-y-2">
          <h3 className={H2}>Kendala Kontrak</h3>
          <Butir items={slide.butir.slice(0, 3)} />
          {(
            [
              ["Kendala baru minggu ini", slide.baru],
              [slide.statusTerkini ? "Kendala aktif SAAT PAPARAN DIBUAT (status terkini)" : "Kendala aktif", slide.aktif],
            ] as const
          ).map(([judul, rows]) => (
            <div key={judul}>
              <p className="text-xs font-semibold text-primary">{judul}</p>
              {rows.length === 0 ? (
                <p className="text-xs text-ink-muted">Tidak ada.</p>
              ) : (
                <ul className="space-y-0.5">
                  {rows.map((k) => (
                    <li key={k.id} className="text-xs text-ink">
                      {k.judul} – {k.lokasiNama} ({k.severity}
                      {k.punyaRecovery ? ", ada recovery" : ", belum ada recovery"})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      );
    case "pemulihan":
      return (
        <div className="space-y-2">
          <h3 className={H2}>
            Recovery & Tindak Lanjut{slide.totalBagian > 1 ? ` (${slide.bagian}/${slide.totalBagian})` : ""}
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-primary-50 text-left text-primary">
                <th className="px-2 py-1.5 font-semibold">Kendala</th>
                <th className="px-2 py-1.5 font-semibold">Tindakan</th>
                <th className="px-2 py-1.5 font-semibold">PIC</th>
                <th className="px-2 py-1.5 font-semibold">Target</th>
                <th className="px-2 py-1.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {slide.baris.map((r, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="px-2 py-1 text-ink">{r.judulKendala}</td>
                  <td className="px-2 py-1 text-ink-muted">{r.tindakan}</td>
                  <td className={`px-2 py-1 ${r.pic ? "text-ink-muted" : "font-semibold text-danger"}`}>{r.pic ?? "BELUM ADA PIC"}</td>
                  <td className="px-2 py-1 text-ink-muted">{r.targetKey ?? "–"}</td>
                  <td className={`px-2 py-1 ${r.overdue ? "font-semibold text-danger" : "text-ink-muted"}`}>
                    {r.overdue ? `${r.status} (LEWAT)` : r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rencana":
      return (
        <div className="space-y-2">
          <h3 className={H2}>Rencana Minggu Berikutnya & Dukungan KKP</h3>
          {!slide.adaRencana && slide.butir.length === 0 ? (
            <p className="text-sm text-ink-muted">Rencana minggu berikutnya belum tersedia di MARLIN.</p>
          ) : (
            <Butir items={slide.butir} />
          )}
          <p className="pt-1 text-xs font-semibold text-primary">Dukungan / keputusan yang dibutuhkan</p>
          {slide.dukungan.length === 0 ? (
            <p className="text-xs text-ink-muted">Tidak ada permintaan dukungan khusus minggu ini.</p>
          ) : (
            <Butir items={slide.dukungan} />
          )}
        </div>
      );
    case "lampiran":
      return (
        <div className="space-y-2">
          <h3 className={H2}>Lampiran – Kelengkapan Data & Sumber</h3>
          <div className="grid grid-cols-6 gap-1.5 text-center">
            {(
              [
                ["Diharapkan", slide.kelengkapan.diharapkan],
                ["Final", slide.kelengkapan.final],
                ["Diproses", slide.kelengkapan.diproses],
                ["Draft", slide.kelengkapan.draft],
                ["Perlu koreksi", slide.kelengkapan.perluKoreksi],
                ["Hari nihil", slide.kelengkapan.hariNihil],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="rounded-md border border-border p-1.5">
                <p className="text-[9px] uppercase text-ink-muted">{label}</p>
                <p className="text-sm font-bold text-ink">{v}</p>
              </div>
            ))}
          </div>
          {slide.kelengkapan.lokasiTanpaLaporan.length > 0 ? (
            <p className="text-xs text-warning">Lokasi tanpa laporan: {slide.kelengkapan.lokasiTanpaLaporan.join(", ")}</p>
          ) : null}
          <p className="text-[10px] text-ink-muted">
            Data per: {slide.dataAsOf ? slide.dataAsOf.slice(0, 16).replace("T", " ") : "tidak tersedia"} · seluruh angka dihitung MARLIN.
          </p>
          <ul className="space-y-0.5">
            {slide.limitations.map((l, i) => (
              <li key={i} className="text-[10px] text-ink-muted">• {l}</li>
            ))}
          </ul>
        </div>
      );
  }
}
