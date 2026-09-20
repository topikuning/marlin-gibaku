import { bandStatus, pctID, ppID, type Slide } from "@/lib/paparan/susun";
import type { TemaDeck } from "@/lib/paparan/tema";
import { turunanTema, warnaChip } from "@/lib/pdf/warna";

/**
 * Preview satu slide (rasio 16:9) — komponen SERVER, tanpa state.
 *
 * Struktur slide dibaca dari `susunSlides` yang SAMA dengan renderer PDF;
 * tidak ada angka dihitung di sini. RUPA-nya mengikuti TEMA yang sama dengan
 * PDF (`lib/paparan/tema.ts` + warna turunan `lib/pdf/warna.ts`), sehingga
 * pratinjau bukan tebakan atas hasil unduhan melainkan gambaran bentuknya:
 * bentuk sampul, gaya judul, selang gelap/terang, dan sudut kartu ikut tema.
 *
 * Warna ditulis sebagai STYLE INLINE, bukan kelas Tailwind: kelas dinamis
 * (`bg-[${warna}]`) tidak pernah sampai ke bundle karena Tailwind memindai
 * sumber secara statis.
 */

/** Jenis slide yang gelap pada tema berselang — sama persis dengan renderer PDF. */
const JENIS_GELAP = new Set<Slide["jenis"]>(["sampul", "durasi", "foto_pekerjaan", "penutup"]);

type Gaya = {
  tema: TemaDeck;
  t: ReturnType<typeof turunanTema>;
  gelap: boolean;
};

function teksUtama(g: Gaya): string {
  return g.gelap ? g.tema.palet.putih : g.tema.palet.ink;
}
function teksRedup(g: Gaya): string {
  return g.gelap ? g.t.teksRedupGelap : g.tema.palet.inkMuted;
}
function teksSamar(g: Gaya): string {
  return g.gelap ? g.t.teksSamarGelap : g.tema.palet.inkFaint;
}
function garis(g: Gaya): string {
  return g.gelap ? g.t.garisGelap : g.tema.palet.garis;
}
function aksenTeks(g: Gaya): string {
  return g.gelap ? g.tema.palet.aksen : g.tema.palet.aksenTua;
}
function latarKartu(g: Gaya): string {
  return g.gelap ? g.tema.palet.gelapKartu : g.tema.palet.kartuTerang;
}
function trekBar(g: Gaya): string {
  return g.gelap ? g.tema.palet.gelapKartu : g.t.trekBar;
}

function warnaBand(g: Gaya, band: ReturnType<typeof bandStatus>): string {
  const p = g.tema.palet;
  return band === "tuntas" ? p.aksenTua : band === "maju" ? p.biru : band === "sedang" ? p.oranye : p.merah;
}

/** Judul slide — tiga gaya, sama dengan `judulSlide` di PDF. */
function Judul({ g, children }: { g: Gaya; children: React.ReactNode }) {
  const p = g.tema.palet;
  if (g.tema.judul === "blok") {
    return (
      <h3
        className="-mx-5 -mt-5 mb-3 px-5 py-2.5 text-base font-semibold"
        style={{
          background: g.gelap ? p.gelapKartu : p.primer,
          color: p.putih,
          borderBottom: `3px solid ${p.aksen}`,
        }}
      >
        {children}
      </h3>
    );
  }
  if (g.tema.judul === "pita_kiri") {
    return (
      <h3
        className="mb-1 pl-2.5 text-base font-semibold"
        style={{ color: teksUtama(g), borderLeft: `4px solid ${p.aksen}` }}
      >
        {children}
      </h3>
    );
  }
  return (
    <h3 className="mb-1 pb-1 text-base font-semibold" style={{ color: teksUtama(g), borderBottom: `2px solid ${p.aksen}` }}>
      {children}
    </h3>
  );
}

function Angka({ g, label, nilai, warna }: { g: Gaya; label: string; nilai: string; warna?: string }) {
  return (
    <div
      className="p-2.5"
      style={{
        background: latarKartu(g),
        border: g.gelap ? "none" : `1px solid ${g.tema.palet.garis}`,
        borderRadius: g.tema.sudutKartu,
      }}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: teksRedup(g) }}>
        {label}
      </p>
      <p className="text-xl font-bold" style={{ color: warna ?? aksenTeks(g) }}>
        {nilai}
      </p>
    </div>
  );
}

function Butir({ g, items }: { g: Gaya; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-sm" style={{ color: teksUtama(g) }}>
          <span
            aria-hidden
            className="mt-1.5 size-1.5 shrink-0 rounded-full"
            style={{ background: g.tema.palet.aksen }}
          />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function Chip({ g, teks, dasar }: { g: Gaya; teks: string; dasar?: string }) {
  const w = warnaChip(dasar ?? g.tema.palet.aksen, g.gelap);
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: w.latar, color: w.teks, borderRadius: g.tema.sudutKartu === 0 ? 2 : 999 }}
    >
      {teks}
    </span>
  );
}

function KepalaTabel({ g, kolom }: { g: Gaya; kolom: { label: string; kanan?: boolean }[] }) {
  return (
    <thead>
      <tr style={{ background: g.gelap ? g.tema.palet.gelapKartu : g.t.aksenSoft, color: aksenTeks(g) }}>
        {kolom.map((k) => (
          <th key={k.label} className={`px-2 py-1.5 font-semibold ${k.kanan ? "text-right" : "text-left"}`}>
            {k.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function SlidePreview({
  slide,
  nomor,
  total,
  thumbUrl,
  tema,
}: {
  slide: Slide;
  nomor: number;
  total: number;
  thumbUrl: Record<string, string>;
  /** WAJIB: page.tsx meneruskan `temaDeck(content.tema)`. */
  tema: TemaDeck;
}) {
  const gelap = tema.berselang && JENIS_GELAP.has(slide.jenis);
  const g: Gaya = { tema, t: turunanTema(tema), gelap };
  const p = tema.palet;
  // Motif tepi slide terang — sejalan dengan `motifTerang` di PDF.
  const motif =
    !gelap && tema.sampul === "pita_atas"
      ? { borderTop: `4px solid ${p.aksen}` }
      : !gelap && tema.sampul === "pusat"
        ? { borderTop: `4px solid ${p.aksen}`, borderBottom: `3px solid ${p.primer}` }
        : {};

  return (
    <div
      className="relative aspect-video overflow-hidden rounded-xl border border-border shadow-xs"
      style={{ background: gelap ? p.gelap : p.terang, color: teksUtama(g), ...motif }}
    >
      {"draf" in slide && slide.draf ? (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 -rotate-12 text-center text-3xl font-bold text-rose-500 opacity-20">
          DRAF – BELUM DISETUJUI
        </p>
      ) : null}
      {gelap ? <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: p.aksen }} /> : null}
      <div className="flex h-full flex-col p-5">
        <div className="min-h-0 flex-1 overflow-hidden">
          <Isi slide={slide} thumbUrl={thumbUrl} g={g} />
        </div>
        <p className="pt-2 text-right text-[10px]" style={{ color: gelap ? g.t.footerGelap : p.inkFaint }}>
          {nomor}/{total}
        </p>
      </div>
    </div>
  );
}

/* ── Sampul: empat bentuk, sama seperti PDF ─────────────────────────────── */

function Sampul({ slide, g }: { slide: Extract<Slide, { jenis: "sampul" }>; g: Gaya }) {
  const p = g.tema.palet;
  const dev = slide.meta.deviasiPp;
  const eyebrow = `Paparan Mingguan · Minggu ke-${slide.mingguKe}${slide.berjalan ? " · belum genap" : ""}`;
  const meta = (
    <>
      <span>
        Periode: <b style={{ color: g.gelap ? p.putih : p.ink }}>{slide.periodeLabel}</b>
      </span>
      <span style={{ color: g.gelap ? g.t.pemisahGelap : p.inkFaint }}>|</span>
      <span>
        Realisasi: <b style={{ color: g.gelap ? p.putih : p.ink }}>{pctID(slide.meta.realisasiPct)}</b>
      </span>
      <span style={{ color: g.gelap ? g.t.pemisahGelap : p.inkFaint }}>|</span>
      <span>
        Rencana: <b style={{ color: g.gelap ? p.putih : p.ink }}>{pctID(slide.meta.rencanaPct)}</b>
      </span>
      <Chip g={g} teks={`Deviasi: ${ppID(dev)}`} dasar={dev != null && dev < 0 ? p.merah : p.hijau} />
    </>
  );
  const barisBawah = `${slide.instansi} · ${slide.nomorKontrak} · ${slide.pelaksana}`;

  if (g.tema.sampul === "blok_kiri") {
    return (
      <div className="-m-5 flex h-[calc(100%+2.5rem)]">
        <div
          className="flex w-[38%] shrink-0 flex-col justify-between p-4"
          style={{ background: p.primer, borderRight: `3px solid ${p.aksen}` }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: p.aksen }}>
            {eyebrow}
          </p>
          <div className="space-y-2">
            <div>
              <p className="text-[9px] uppercase tracking-wider" style={{ color: g.t.teksRedupGelap }}>
                Realisasi
              </p>
              <p className="text-lg font-bold" style={{ color: p.putih }}>
                {pctID(slide.meta.realisasiPct)}
              </p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider" style={{ color: g.t.teksRedupGelap }}>
                Deviasi
              </p>
              <span
                className="inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold"
                style={{
                  background: warnaChip(dev != null && dev < 0 ? p.merah : p.hijau, true).latar,
                  color: warnaChip(dev != null && dev < 0 ? p.merah : p.hijau, true).teks,
                }}
              >
                {ppID(dev)}
              </span>
            </div>
          </div>
          <p className="text-[9px]" style={{ color: g.t.teksRedupGelap }}>
            {barisBawah}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-5">
          <span aria-hidden className="h-1 w-10" style={{ background: p.aksen }} />
          <h3 className="text-2xl font-bold leading-snug" style={{ color: p.primer }}>
            {slide.judulKerja}
          </h3>
          {slide.subJudul ? (
            <p className="text-sm" style={{ color: p.inkMuted }}>
              {slide.subJudul}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (g.tema.sampul === "pita_atas") {
    return (
      <div className="-m-5 flex h-[calc(100%+2.5rem)] flex-col">
        <div className="h-3 shrink-0" style={{ background: p.aksen, borderBottom: `3px solid ${p.primer}` }} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-10 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: p.aksenTua }}>
            {eyebrow}
          </p>
          <h3 className="text-2xl font-bold leading-snug" style={{ color: p.primer }}>
            {slide.judulKerja}
          </h3>
          {slide.subJudul ? (
            <p className="text-sm" style={{ color: p.inkMuted }}>
              {slide.subJudul}
            </p>
          ) : null}
          <p
            className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs"
            style={{ color: p.inkMuted }}
          >
            {meta}
          </p>
        </div>
        <div className="shrink-0 px-5 py-2.5 text-center text-[11px]" style={{ background: p.primer, color: p.putih }}>
          {barisBawah}
        </div>
      </div>
    );
  }

  if (g.tema.sampul === "pusat") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center" style={{ border: `2px solid ${p.primer}` }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em]" style={{ color: p.aksen }}>
          {eyebrow}
        </p>
        <h3 className="max-w-[85%] text-2xl font-bold leading-snug" style={{ color: p.primer }}>
          {slide.judulKerja}
        </h3>
        <span aria-hidden className="h-[3px] w-14" style={{ background: p.aksen }} />
        {slide.subJudul ? (
          <p className="text-sm" style={{ color: p.inkMuted }}>
            {slide.subJudul}
          </p>
        ) : null}
        <dl className="mt-2 grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-1 text-xs">
          <dt className="text-right" style={{ color: p.inkMuted }}>
            Realisasi
          </dt>
          <dd className="text-left font-semibold" style={{ color: p.ink }}>
            {pctID(slide.meta.realisasiPct)}
          </dd>
          <dt className="text-right" style={{ color: p.inkMuted }}>
            Rencana
          </dt>
          <dd className="text-left font-semibold" style={{ color: p.ink }}>
            {pctID(slide.meta.rencanaPct)}
          </dd>
          <dt className="text-right" style={{ color: p.inkMuted }}>
            Deviasi
          </dt>
          <dd className="text-left">
            <Chip g={g} teks={ppID(dev)} dasar={dev != null && dev < 0 ? p.merah : p.hijau} />
          </dd>
        </dl>
        <p className="mt-1 text-[10px]" style={{ color: p.inkFaint }}>
          {barisBawah}
        </p>
      </div>
    );
  }

  // strip_bawah — desain asli Mataram.
  return (
    <div className="flex h-full flex-col justify-center gap-2 pl-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: p.aksen }}>
        {eyebrow}
      </p>
      <h3 className="max-w-[80%] text-2xl font-bold leading-snug" style={{ color: p.putih }}>
        {slide.judulKerja}
      </h3>
      {slide.subJudul ? (
        <p className="text-sm" style={{ color: g.t.teksRedupGelap }}>
          {slide.subJudul}
        </p>
      ) : null}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: g.t.teksRedupGelap }}>
        {meta}
      </p>
      <p className="mt-2 text-[11px]" style={{ color: g.t.teksSamarGelap }}>
        {barisBawah}
      </p>
    </div>
  );
}

function Isi({ slide, thumbUrl, g }: { slide: Slide; thumbUrl: Record<string, string>; g: Gaya }) {
  const p = g.tema.palet;
  switch (slide.jenis) {
    case "sampul":
      return <Sampul slide={slide} g={g} />;
    case "kurva": {
      const k = slide.kurva;
      const W = 1000;
      const Hg = 300;
      const x = (m: number) => ((m - 1) / Math.max(1, k.totalMinggu - 1)) * W;
      const y = (pct: number) => Hg - (Math.min(pct, 100) / 100) * Hg;
      const plan = k.planPct.map((pp, i) => `${x(i + 1)},${y(pp)}`).join(" ");
      const real = k.jendela.map((t) => `${x(t.minggu)},${y(t.realisasiPct)}`).join(" ");
      const last = k.jendela[k.jendela.length - 1];
      return (
        <div className="space-y-2">
          <Judul g={g}>Diagram Progres S-Curve</Judul>
          <svg viewBox={`-8 -8 ${W + 16} ${Hg + 16}`} className="h-[62%] w-full">
            {[0, 20, 40, 60, 80, 100].map((pp) => (
              <line key={pp} x1={0} y1={y(pp)} x2={W} y2={y(pp)} stroke={garis(g)} strokeWidth={1} />
            ))}
            <polyline
              points={plan}
              fill="none"
              stroke={g.gelap ? g.t.teksSamarGelap : g.t.garisRencana}
              strokeWidth={2.5}
              strokeDasharray="7 5"
            />
            {k.jendela.length > 1 ? (
              <polygon
                points={`${real} ${x(last.minggu)},${Hg} ${x(k.jendela[0].minggu)},${Hg}`}
                fill={p.aksen}
                opacity={0.08}
              />
            ) : null}
            <polyline points={real} fill="none" stroke={p.aksen} strokeWidth={3.5} />
            {k.jendela.map((t) => (
              <circle key={t.minggu} cx={x(t.minggu)} cy={y(t.realisasiPct)} r={5} fill={p.aksen} />
            ))}
            {last ? (
              <line
                x1={x(last.minggu)}
                y1={0}
                x2={x(last.minggu)}
                y2={Hg}
                stroke={g.gelap ? g.t.garisGelap : g.t.garisPenanda}
                strokeWidth={1.5}
              />
            ) : null}
          </svg>
          <div className="grid grid-cols-3 gap-2">
            {k.jendela.map((t, i) => (
              <div
                key={t.minggu}
                className="flex items-center gap-2 px-2 py-1 text-xs"
                style={{
                  background: i === k.jendela.length - 1 ? (g.gelap ? p.gelapKartu : g.t.aksenSorot) : "transparent",
                  borderRadius: g.tema.sudutKartu,
                }}
              >
                <span style={{ color: teksRedup(g) }}>Minggu {t.minggu}</span>
                <b className="text-sm" style={{ color: teksUtama(g) }}>
                  {pctID(t.realisasiPct)}
                </b>
                {t.kenaikanPp != null ? (
                  <Chip
                    g={g}
                    teks={`${t.kenaikanPp >= 0 ? "+" : ""}${t.kenaikanPp.toFixed(2).replace(".", ",")}%`}
                    dasar={t.kenaikanPp >= 0 ? p.hijau : p.merah}
                  />
                ) : null}
              </div>
            ))}
          </div>
          {slide.deviasiPp != null ? (
            <p className="text-right text-xs">
              <Chip g={g} teks={`Deviasi ${ppID(slide.deviasiPp)}`} dasar={slide.deviasiPp < 0 ? p.merah : p.hijau} />
            </p>
          ) : null}
        </div>
      );
    }
    case "durasi": {
      const d = slide.d;
      return (
        <div className="flex h-full flex-col justify-center gap-4">
          <Judul g={g}>Durasi Pelaksanaan</Judul>
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
                className="p-4 text-center"
                style={{
                  background: sorot ? p.aksen : latarKartu(g),
                  border: g.gelap || sorot ? "none" : `1px solid ${p.garis}`,
                  borderRadius: g.tema.sudutKartu,
                }}
              >
                <p className="text-3xl font-bold" style={{ color: sorot ? p.putih : teksUtama(g) }}>
                  {nilai}
                </p>
                <p
                  className="mt-1 text-[10px] font-semibold tracking-[0.2em]"
                  style={{ color: sorot ? p.putih : teksRedup(g) }}
                >
                  {label}
                </p>
              </div>
            ))}
          </div>
          <div className="mx-auto w-4/5">
            <div className="h-2 overflow-hidden rounded-full" style={{ background: trekBar(g) }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(d.pctWaktu, 100)}%`, background: p.aksen }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px]" style={{ color: teksRedup(g) }}>
              <span>Mulai</span>
              <span className="font-semibold" style={{ color: aksenTeks(g) }}>
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
          <Judul g={g}>Ringkasan Eksekutif</Judul>
          <div className="grid grid-cols-4 gap-2">
            <Angka g={g} label="Rencana" nilai={pctID(slide.angka.rencana)} warna={teksUtama(g)} />
            <Angka g={g} label="Realisasi" nilai={pctID(slide.angka.realisasi)} />
            <Angka
              g={g}
              label="Deviasi"
              nilai={ppID(slide.angka.deviasi)}
              warna={slide.angka.deviasi != null && slide.angka.deviasi < 0 ? p.merah : p.hijau}
            />
            <Angka
              g={g}
              label="Laporan final"
              nilai={`${slide.angka.laporanFinal}/${slide.angka.laporanDiharapkan}`}
              warna={teksUtama(g)}
            />
          </div>
          <Butir g={g} items={slide.butir} />
        </div>
      );
    case "progres_lokasi":
      return (
        <div className="space-y-2">
          <Judul g={g}>
            Progres per Lokasi{slide.totalBagian > 1 ? ` (${slide.bagian}/${slide.totalBagian})` : ""}
          </Judul>
          <table className="w-full text-xs">
            <KepalaTabel
              g={g}
              kolom={[
                { label: "Lokasi" },
                { label: "Rencana", kanan: true },
                { label: "Realisasi", kanan: true },
                { label: "Deviasi", kanan: true },
                { label: "Status data" },
              ]}
            />
            <tbody>
              {slide.baris.map((b) => (
                <tr key={b.locationId} style={{ borderBottom: `1px solid ${garis(g)}` }}>
                  <td className="px-2 py-1.5" style={{ color: teksUtama(g) }}>
                    {b.name}
                  </td>
                  <td className="px-2 py-1.5 text-right" style={{ color: teksUtama(g) }}>
                    {b.targetPct == null ? "–" : pctID(b.targetPct)}
                  </td>
                  <td className="px-2 py-1.5 text-right" style={{ color: teksUtama(g) }}>
                    {pctID(b.realisasiPct)}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right"
                    style={{ color: b.deviasiPp != null && b.deviasiPp < 0 ? p.merah : teksUtama(g) }}
                  >
                    {b.deviasiPp == null ? "–" : ppID(b.deviasiPp)}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: teksRedup(g) }}>
                    {b.targetPct == null ? "belum ada kurva-S" : "lengkap"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "status_kategori":
      return (
        <div className="space-y-2">
          <Judul g={g}>
            {slide.lokasiNama ? `Status Pekerjaan – ${slide.lokasiNama}` : "Status Pekerjaan"}
            {slide.totalBagian > 1 ? ` (${slide.bagian}/${slide.totalBagian})` : ""}
          </Judul>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
            {slide.baris.map((b) => {
              const warna = warnaBand(g, bandStatus(b.realisasiPct));
              return (
                <div key={b.nama}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs" style={{ color: teksUtama(g) }}>
                      {b.nama}
                    </span>
                    <span className="text-xs font-bold" style={{ color: warna }}>
                      {pctID(b.realisasiPct)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: trekBar(g) }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(b.realisasiPct, 100)}%`, background: warna }}
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
          <Judul g={g}>Capaian Pekerjaan Minggu Ini</Judul>
          <Butir g={g} items={slide.butir.slice(0, 4)} />
          {slide.rincian.length > 0 ? (
            <table className="w-full text-xs">
              <tbody>
                {slide.rincian.map((c, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${garis(g)}` }}>
                    <td className="px-2 py-1" style={{ color: teksRedup(g) }}>
                      {c.lokasiNama}
                    </td>
                    <td className="px-2 py-1" style={{ color: teksUtama(g) }}>
                      {c.pekerjaan}
                    </td>
                    <td className="px-2 py-1 text-right font-medium" style={{ color: teksUtama(g) }}>
                      {String(c.volume).replace(".", ",")}
                      {c.unit ? ` ${c.unit}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : slide.butir.length === 0 ? (
            <p className="text-sm" style={{ color: teksRedup(g) }}>
              Tidak ada capaian pekerjaan terhitung pada minggu ini.
            </p>
          ) : null}
        </div>
      );
    case "kegiatan":
      return (
        <div className="space-y-2">
          <Judul g={g}>Kegiatan Lapangan</Judul>
          <Butir g={g} items={slide.butir.slice(0, 4)} />
          {slide.rincian.length > 0 ? (
            <table className="w-full text-xs">
              <tbody>
                {slide.rincian.map((k) => (
                  <tr key={k.id} style={{ borderBottom: `1px solid ${garis(g)}` }}>
                    <td className="px-2 py-1" style={{ color: teksRedup(g) }}>
                      {k.tanggalKey}
                    </td>
                    <td className="px-2 py-1" style={{ color: teksRedup(g) }}>
                      {k.jenis}
                    </td>
                    <td className="px-2 py-1" style={{ color: teksUtama(g) }}>
                      {k.judul}
                    </td>
                    <td className="px-2 py-1" style={{ color: teksRedup(g) }}>
                      {k.lokasiNama}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : slide.butir.length === 0 ? (
            <p className="text-sm" style={{ color: teksRedup(g) }}>
              Tidak ada kegiatan lapangan final pada minggu ini.
            </p>
          ) : null}
        </div>
      );
    case "foto_pekerjaan":
      return (
        <div className="flex h-full flex-col">
          <div className="flex items-baseline justify-between gap-3 pb-2" style={{ borderBottom: `1px solid ${garis(g)}` }}>
            <h3 className="truncate text-base font-semibold" style={{ color: teksUtama(g) }}>
              {slide.judul}
            </h3>
            {slide.pct != null ? (
              <span className="text-lg font-bold" style={{ color: aksenTeks(g) }}>
                {pctID(slide.pct)}
              </span>
            ) : null}
          </div>
          <div
            className="mt-3 flex min-h-0 flex-1 items-stretch justify-center gap-3 p-3"
            style={{ background: g.gelap ? p.putih : p.kartuTerang, borderRadius: g.tema.sudutKartu }}
          >
            {slide.foto.map((f) => (
              <figure key={f.id} className={`flex min-w-0 flex-col ${slide.foto.length === 1 ? "w-2/3" : "flex-1"}`}>
                {thumbUrl[f.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- presigned URL R2 sementara
                  <img
                    src={thumbUrl[f.id]}
                    alt={f.caption}
                    className="min-h-0 w-full flex-1 object-cover"
                    style={{ border: `1px solid ${p.garis}`, borderRadius: g.tema.sudutKartu }}
                  />
                ) : (
                  <div
                    className="flex min-h-0 flex-1 items-center justify-center text-[10px]"
                    style={{ background: p.terang, color: p.inkMuted, borderRadius: g.tema.sudutKartu }}
                  >
                    Foto tidak dapat dimuat
                  </div>
                )}
                <figcaption
                  className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug font-semibold"
                  style={{ color: p.ink }}
                >
                  <span aria-hidden className="mt-0.5 h-3 w-[3px] shrink-0 rounded-full" style={{ background: p.aksen }} />
                  <span className="line-clamp-2">{f.caption}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      );
    case "kendala":
      return (
        <div className="space-y-2">
          <Judul g={g}>Kendala Kontrak</Judul>
          <Butir g={g} items={slide.butir.slice(0, 3)} />
          {(
            [
              ["Kendala baru minggu ini", slide.baru],
              [slide.statusTerkini ? "Kendala aktif SAAT PAPARAN DIBUAT (status terkini)" : "Kendala aktif", slide.aktif],
            ] as const
          ).map(([judul, rows]) => (
            <div key={judul}>
              <p className="text-xs font-semibold" style={{ color: aksenTeks(g) }}>
                {judul}
              </p>
              {rows.length === 0 ? (
                <p className="text-xs" style={{ color: teksRedup(g) }}>
                  Tidak ada.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {rows.map((k) => (
                    <li key={k.id} className="text-xs" style={{ color: teksUtama(g) }}>
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
          <Judul g={g}>
            Recovery &amp; Tindak Lanjut{slide.totalBagian > 1 ? ` (${slide.bagian}/${slide.totalBagian})` : ""}
          </Judul>
          <table className="w-full text-xs">
            <KepalaTabel
              g={g}
              kolom={[{ label: "Kendala" }, { label: "Tindakan" }, { label: "PIC" }, { label: "Target" }, { label: "Status" }]}
            />
            <tbody>
              {slide.baris.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${garis(g)}` }}>
                  <td className="px-2 py-1" style={{ color: teksUtama(g) }}>
                    {r.judulKendala}
                  </td>
                  <td className="px-2 py-1" style={{ color: teksRedup(g) }}>
                    {r.tindakan}
                  </td>
                  <td className="px-2 py-1" style={{ color: r.pic ? teksRedup(g) : p.merah, fontWeight: r.pic ? 400 : 600 }}>
                    {r.pic ?? "BELUM ADA PIC"}
                  </td>
                  <td className="px-2 py-1" style={{ color: teksRedup(g) }}>
                    {r.targetKey ?? "–"}
                  </td>
                  <td
                    className="px-2 py-1"
                    style={{ color: r.overdue ? p.merah : teksRedup(g), fontWeight: r.overdue ? 600 : 400 }}
                  >
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
          <Judul g={g}>Action Plan</Judul>
          {slide.butir.map((b, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-2 shadow-xs"
              style={{
                background: g.gelap ? p.gelapKartu : p.putih,
                border: g.gelap ? "none" : `1px solid ${p.garis}`,
                borderLeft: `4px solid ${p.aksen}`,
                borderRadius: g.tema.sudutKartu,
              }}
            >
              <span className="text-base font-bold" style={{ color: p.aksen }}>
                0{i + 1}
              </span>
              <p className="text-sm" style={{ color: teksUtama(g) }}>
                {b}
              </p>
            </div>
          ))}
          {slide.dukungan.length > 0 ? (
            <>
              <p className="pt-1 text-xs font-semibold" style={{ color: aksenTeks(g) }}>
                Dukungan / keputusan yang dibutuhkan dari KKP
              </p>
              <Butir g={g} items={slide.dukungan} />
            </>
          ) : null}
        </div>
      );
    case "lampiran":
      return (
        <div className="space-y-2">
          <Judul g={g}>Lampiran – Kelengkapan Data &amp; Sumber</Judul>
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
              <div
                key={label}
                className="p-1.5"
                style={{
                  background: latarKartu(g),
                  border: g.gelap ? "none" : `1px solid ${p.garis}`,
                  borderRadius: g.tema.sudutKartu,
                }}
              >
                <p className="text-[9px] uppercase" style={{ color: teksRedup(g) }}>
                  {label}
                </p>
                <p className="text-sm font-bold" style={{ color: teksUtama(g) }}>
                  {v}
                </p>
              </div>
            ))}
          </div>
          {slide.kelengkapan.lokasiTanpaLaporan.length > 0 ? (
            <p className="text-xs" style={{ color: p.oranye }}>
              Lokasi tanpa laporan: {slide.kelengkapan.lokasiTanpaLaporan.join(", ")}
            </p>
          ) : null}
          <p className="text-[10px]" style={{ color: teksRedup(g) }}>
            Data per: {slide.dataAsOf ? slide.dataAsOf.slice(0, 16).replace("T", " ") : "tidak tersedia"} · seluruh
            angka dihitung MARLIN.
          </p>
          <ul className="space-y-0.5">
            {slide.limitations.map((l, i) => (
              <li key={i} className="text-[10px]" style={{ color: teksRedup(g) }}>
                • {l}
              </li>
            ))}
          </ul>
        </div>
      );
    case "penutup":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <h3 className="text-3xl font-bold" style={{ color: g.gelap ? p.putih : p.primer }}>
            Terima Kasih
          </h3>
          <p className="text-lg font-semibold" style={{ color: aksenTeks(g) }}>
            Tetap Semangat
          </p>
          <p className="mt-2 text-[11px]" style={{ color: teksSamar(g) }}>
            {slide.paket} · Minggu Ke-{slide.mingguKe} · {slide.periodeLabel}
          </p>
        </div>
      );
  }
}
