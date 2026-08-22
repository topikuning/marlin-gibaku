import { bandStatus, pctID, ppID, type Slide } from "@/lib/paparan/susun";

/**
 * Preview satu slide (rasio 16:9) — komponen SERVER, tanpa state.
 *
 * Gaya mengikuti contoh paparan Mataram: slide gelap navy ber-aksen cyan
 * berselang dengan slide terang. Struktur slide dibaca dari `susunSlides`
 * yang SAMA dengan renderer PDF; tidak ada angka dihitung di sini.
 */

const H2 = "border-b-2 border-cyan-500 pb-1 text-base font-semibold text-slate-800";
const GELAP = "bg-[#0e1726] text-white";

const WARNA_BAND: Record<ReturnType<typeof bandStatus>, string> = {
  tuntas: "text-cyan-600",
  maju: "text-blue-500",
  sedang: "text-amber-500",
  kritis: "text-rose-600",
};
const BAR_BAND: Record<ReturnType<typeof bandStatus>, string> = {
  tuntas: "bg-cyan-600",
  maju: "bg-blue-500",
  sedang: "bg-amber-500",
  kritis: "bg-rose-600",
};

function Angka({ label, nilai, merah }: { label: string; nilai: string; merah?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-white p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-xl font-bold ${merah ? "text-rose-600" : "text-cyan-700"}`}>{nilai}</p>
    </div>
  );
}

function Butir({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-sm text-ink">
          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-cyan-500" />
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
  const gelap =
    slide.jenis === "sampul" ||
    slide.jenis === "durasi" ||
    slide.jenis === "foto_pekerjaan" ||
    slide.jenis === "penutup";
  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-xl border border-border shadow-xs ${gelap ? GELAP : "bg-[#f4f6f9]"}`}
    >
      {"draf" in slide && slide.draf ? (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 -rotate-12 text-center text-3xl font-bold text-rose-500 opacity-20">
          DRAF – BELUM DISETUJUI
        </p>
      ) : null}
      {gelap ? <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-cyan-500" /> : null}
      <div className="flex h-full flex-col p-5">
        <div className="min-h-0 flex-1 overflow-hidden">
          <Isi slide={slide} thumbUrl={thumbUrl} />
        </div>
        <p className={`pt-2 text-right text-[10px] ${gelap ? "text-slate-500" : "text-ink-faint"}`}>
          {nomor}/{total}
        </p>
      </div>
    </div>
  );
}

function Isi({ slide, thumbUrl }: { slide: Slide; thumbUrl: Record<string, string> }) {
  switch (slide.jenis) {
    case "sampul": {
      const dev = slide.meta.deviasiPp;
      return (
        <div className="flex h-full flex-col justify-center gap-2 pl-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-400">
            Paparan Mingguan · Minggu ke-{slide.mingguKe}
            {slide.berjalan ? " · belum genap" : ""}
          </p>
          <h3 className="max-w-[80%] text-2xl font-bold leading-snug">{slide.judulKerja}</h3>
          {slide.subJudul ? <p className="text-sm text-slate-400">{slide.subJudul}</p> : null}
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
            <span>
              Periode: <b className="text-white">{slide.periodeLabel}</b>
            </span>
            <span className="text-slate-600">|</span>
            <span>
              Realisasi: <b className="text-white">{pctID(slide.meta.realisasiPct)}</b>
            </span>
            <span className="text-slate-600">|</span>
            <span>
              Rencana: <b className="text-white">{pctID(slide.meta.rencanaPct)}</b>
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${dev != null && dev < 0 ? "bg-rose-950 text-rose-300" : "bg-emerald-950 text-emerald-300"}`}
            >
              Deviasi: {ppID(dev)}
            </span>
          </p>
          <p className="mt-2 text-[11px] text-slate-500">
            {slide.instansi} · {slide.nomorKontrak} · {slide.pelaksana}
          </p>
        </div>
      );
    }
    case "kurva": {
      const k = slide.kurva;
      const W = 1000;
      const Hg = 300;
      const x = (m: number) => ((m - 1) / Math.max(1, k.totalMinggu - 1)) * W;
      const y = (p: number) => Hg - (Math.min(p, 100) / 100) * Hg;
      const plan = k.planPct.map((p, i) => `${x(i + 1)},${y(p)}`).join(" ");
      const real = k.jendela.map((t) => `${x(t.minggu)},${y(t.realisasiPct)}`).join(" ");
      const last = k.jendela[k.jendela.length - 1];
      return (
        <div className="space-y-2">
          <h3 className={H2}>Diagram Progres S-Curve</h3>
          <svg viewBox={`-8 -8 ${W + 16} ${Hg + 16}`} className="h-[62%] w-full">
            {[0, 20, 40, 60, 80, 100].map((p) => (
              <line key={p} x1={0} y1={y(p)} x2={W} y2={y(p)} stroke="#e3e7ee" strokeWidth={1} />
            ))}
            <polyline points={plan} fill="none" stroke="#b9c1cc" strokeWidth={2.5} strokeDasharray="7 5" />
            {k.jendela.length > 1 ? (
              <polygon
                points={`${real} ${x(last.minggu)},${Hg} ${x(k.jendela[0].minggu)},${Hg}`}
                fill="#0ec1ce"
                opacity={0.08}
              />
            ) : null}
            <polyline points={real} fill="none" stroke="#0ec1ce" strokeWidth={3.5} />
            {k.jendela.map((t) => (
              <circle key={t.minggu} cx={x(t.minggu)} cy={y(t.realisasiPct)} r={5} fill="#0ec1ce" />
            ))}
            {last ? (
              <line x1={x(last.minggu)} y1={0} x2={x(last.minggu)} y2={Hg} stroke="#bfeef1" strokeWidth={1.5} />
            ) : null}
          </svg>
          <div className="grid grid-cols-3 gap-2">
            {k.jendela.map((t, i) => (
              <div
                key={t.minggu}
                className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs ${i === k.jendela.length - 1 ? "bg-cyan-50" : ""}`}
              >
                <span className="text-ink-muted">Minggu {t.minggu}</span>
                <b className="text-sm text-ink">{pctID(t.realisasiPct)}</b>
                {t.kenaikanPp != null ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${t.kenaikanPp >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}
                  >
                    {t.kenaikanPp >= 0 ? "+" : ""}
                    {t.kenaikanPp.toFixed(2).replace(".", ",")}%
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          {slide.deviasiPp != null ? (
            <p className="text-right text-xs">
              <span
                className={`rounded-full px-2 py-0.5 font-semibold ${slide.deviasiPp < 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}
              >
                Deviasi {ppID(slide.deviasiPp)}
              </span>
            </p>
          ) : null}
        </div>
      );
    }
    case "durasi": {
      const d = slide.d;
      return (
        <div className="flex h-full flex-col justify-center gap-4">
          <h3 className="border-b-2 border-cyan-500 pb-1 text-base font-semibold text-white">Durasi Pelaksanaan</h3>
          <div className="mx-auto grid w-4/5 grid-cols-3 gap-4">
            {(
              [
                [d.totalHari, "TOTAL HARI", false],
                [d.hariBerjalan, "HARI BERJALAN", false],
                [d.sisaHari, "SISA WAKTU", true],
              ] as const
            ).map(([nilai, label, sorot]) => (
              <div
                key={label}
                className={`rounded-xl p-4 text-center ${sorot ? "bg-cyan-500 text-white" : "bg-[#162032] text-white"}`}
              >
                <p className="text-3xl font-bold">{nilai}</p>
                <p className={`mt-1 text-[10px] font-semibold tracking-[0.2em] ${sorot ? "text-cyan-50" : "text-slate-400"}`}>
                  {label}
                </p>
              </div>
            ))}
          </div>
          <div className="mx-auto w-4/5">
            <div className="h-2 overflow-hidden rounded-full bg-[#162032]">
              <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.min(d.pctWaktu, 100)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-400">
              <span>Mulai</span>
              <span className="font-semibold text-cyan-400">
                {d.pctWaktu.toFixed(2).replace(".", ",")}% waktu telah berjalan
              </span>
              <span>Selesai</span>
            </div>
          </div>
        </div>
      );
    }
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
    case "progres_lokasi":
      return (
        <div className="space-y-2">
          <h3 className={H2}>
            Progres per Lokasi{slide.totalBagian > 1 ? ` (${slide.bagian}/${slide.totalBagian})` : ""}
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-cyan-50 text-left text-cyan-800">
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
                  <td className={`px-2 py-1.5 text-right ${b.deviasiPp != null && b.deviasiPp < 0 ? "text-rose-600" : ""}`}>
                    {b.deviasiPp == null ? "–" : ppID(b.deviasiPp)}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted">{b.targetPct == null ? "belum ada kurva-S" : "lengkap"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "status_kategori":
      return (
        <div className="space-y-2">
          <h3 className={H2}>
            {slide.lokasiNama ? `Status Pekerjaan – ${slide.lokasiNama}` : "Status Pekerjaan"}
            {slide.totalBagian > 1 ? ` (${slide.bagian}/${slide.totalBagian})` : ""}
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
            {slide.baris.map((b) => {
              const band = bandStatus(b.realisasiPct);
              return (
                <div key={b.nama}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs text-ink">{b.nama}</span>
                    <span className={`text-xs font-bold ${WARNA_BAND[band]}`}>{pctID(b.realisasiPct)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${BAR_BAND[band]}`}
                      style={{ width: `${Math.min(b.realisasiPct, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
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
    case "foto_pekerjaan":
      return (
        <div className="flex h-full flex-col">
          <div className="flex items-baseline justify-between gap-3 border-b border-slate-700 pb-2">
            <h3 className="truncate text-base font-semibold text-white">{slide.judul}</h3>
            {slide.pct != null ? <span className="text-lg font-bold text-cyan-400">{pctID(slide.pct)}</span> : null}
          </div>
          <div className="mt-3 flex min-h-0 flex-1 items-stretch justify-center gap-3 rounded-lg bg-white p-3">
            {slide.foto.map((f) => (
              <figure key={f.id} className={`flex min-w-0 flex-col ${slide.foto.length === 1 ? "w-2/3" : "flex-1"}`}>
                {thumbUrl[f.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- presigned URL R2 sementara
                  <img
                    src={thumbUrl[f.id]}
                    alt={f.caption}
                    className="min-h-0 w-full flex-1 rounded-md border border-border object-cover"
                  />
                ) : (
                  <div className="flex min-h-0 flex-1 items-center justify-center rounded-md bg-slate-100 text-[10px] text-ink-muted">
                    Foto tidak dapat dimuat
                  </div>
                )}
                <figcaption className="truncate pt-1 text-[10px] text-ink-muted">{f.caption}</figcaption>
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
              <p className="text-xs font-semibold text-cyan-800">{judul}</p>
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
              <tr className="bg-cyan-50 text-left text-cyan-800">
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
                  <td className={`px-2 py-1 ${r.pic ? "text-ink-muted" : "font-semibold text-rose-600"}`}>
                    {r.pic ?? "BELUM ADA PIC"}
                  </td>
                  <td className="px-2 py-1 text-ink-muted">{r.targetKey ?? "–"}</td>
                  <td className={`px-2 py-1 ${r.overdue ? "font-semibold text-rose-600" : "text-ink-muted"}`}>
                    {r.overdue ? `${r.status} (LEWAT)` : r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "action_plan":
      return (
        <div className="space-y-2.5">
          <h3 className={H2}>Action Plan</h3>
          {slide.butir.map((b, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border-l-4 border-cyan-500 bg-white px-3 py-2 shadow-xs"
            >
              <span className="text-base font-bold text-cyan-600">0{i + 1}</span>
              <p className="text-sm text-ink">{b}</p>
            </div>
          ))}
          {slide.dukungan.length > 0 ? (
            <>
              <p className="pt-1 text-xs font-semibold text-cyan-800">Dukungan / keputusan yang dibutuhkan dari KKP</p>
              <Butir items={slide.dukungan} />
            </>
          ) : null}
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
              <div key={label} className="rounded-md border border-border bg-white p-1.5">
                <p className="text-[9px] uppercase text-ink-muted">{label}</p>
                <p className="text-sm font-bold text-ink">{v}</p>
              </div>
            ))}
          </div>
          {slide.kelengkapan.lokasiTanpaLaporan.length > 0 ? (
            <p className="text-xs text-amber-600">
              Lokasi tanpa laporan: {slide.kelengkapan.lokasiTanpaLaporan.join(", ")}
            </p>
          ) : null}
          <p className="text-[10px] text-ink-muted">
            Data per: {slide.dataAsOf ? slide.dataAsOf.slice(0, 16).replace("T", " ") : "tidak tersedia"} · seluruh
            angka dihitung MARLIN.
          </p>
          <ul className="space-y-0.5">
            {slide.limitations.map((l, i) => (
              <li key={i} className="text-[10px] text-ink-muted">
                • {l}
              </li>
            ))}
          </ul>
        </div>
      );
    case "penutup":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <h3 className="text-3xl font-bold text-white">Terima Kasih</h3>
          <p className="text-lg font-semibold text-cyan-400">Tetap Semangat</p>
          <p className="mt-2 text-[11px] text-slate-500">
            {slide.paket} · Minggu Ke-{slide.mingguKe} · {slide.periodeLabel}
          </p>
        </div>
      );
  }
}
