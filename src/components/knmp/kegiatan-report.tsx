import { formatTanggal, formatTanggalWaktu } from "@/lib/format";
import { formatCoordinate } from "@/lib/photo-stamp/format";

/**
 * Laporan Kegiatan Lapangan format A4 — untuk dicetak / disimpan sebagai PDF
 * (browser print). Menyusun teks (narasi, peserta, kendala, solusi) + galeri
 * foto berlabel jadi dokumen rapi & profesional. DECISIONS 123.
 */

export type KegiatanReportPhoto = {
  id: string;
  url: string;
  takenAt: Date | null;
  lat: number | null;
  lng: number | null;
};

export type KegiatanReportData = {
  brandingName: string;
  kindLabel: string;
  title: string;
  activityDate: Date;
  statusLabel: string;
  notes: string | null;
  participants: string | null;
  kendala: string | null;
  solusi: string | null;
  locationName: string;
  province: string;
  packageName: string;
  creatorName: string | null;
  photos: KegiatanReportPhoto[];
  generatedAt: Date;
};

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1 text-[13px]">
      <span className="w-28 shrink-0 font-medium text-ink-muted">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="mb-1.5 border-b-2 border-primary/60 pb-1 text-[13px] font-bold tracking-wide text-primary uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function KegiatanReport({ d }: { d: KegiatanReportData }) {
  return (
    <article className="text-ink">
      {/* Kop */}
      <header className="flex items-start justify-between gap-4 border-b-4 border-primary pb-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-ink-muted uppercase">{d.brandingName}</p>
          <p className="text-[11px] text-ink-muted">Pengendalian Proyek Kampung Nelayan Merah Putih (KNMP)</p>
        </div>
        <h1 className="text-right text-lg font-extrabold tracking-tight text-primary">
          LAPORAN
          <br />
          KEGIATAN LAPANGAN
        </h1>
      </header>

      {/* Identitas */}
      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-primary-50 px-2 py-0.5 text-[12px] font-semibold text-primary">
            {d.kindLabel}
          </span>
          <span className="text-[12px] text-ink-muted">{d.statusLabel}</span>
        </div>
        <h2 className="mt-1 text-xl font-bold text-ink">{d.title}</h2>
        <p className="text-[13px] text-ink-muted">
          {d.locationName} · {d.packageName} · {d.province}
        </p>
      </div>

      {/* Rincian */}
      <div className="mt-4 rounded-lg border border-border p-3">
        <MetaRow label="Jenis kegiatan" value={d.kindLabel} />
        <MetaRow label="Tanggal" value={formatTanggal(d.activityDate, "EEEE, d MMMM yyyy")} />
        <MetaRow label="Lokasi" value={`${d.locationName} (${d.province})`} />
        <MetaRow label="Paket" value={d.packageName} />
        {d.creatorName ? <MetaRow label="Pelapor" value={d.creatorName} /> : null}
        {d.participants ? <MetaRow label="Peserta / hadir" value={d.participants} /> : null}
      </div>

      {/* Narasi */}
      {d.notes ? (
        <Section title="Uraian Kegiatan">
          <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink">{d.notes}</p>
        </Section>
      ) : null}

      {d.kendala ? (
        <Section title="Kendala">
          <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink">{d.kendala}</p>
        </Section>
      ) : null}

      {d.solusi ? (
        <Section title="Solusi / Tindak Lanjut">
          <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink">{d.solusi}</p>
        </Section>
      ) : null}

      {/* Dokumentasi foto */}
      <Section title={`Dokumentasi Foto (${d.photos.length})`}>
        {d.photos.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Tidak ada foto terlampir.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {d.photos.map((p, i) => {
              const koord = formatCoordinate(p.lat, p.lng);
              return (
                <figure key={p.id} className="break-inside-avoid overflow-hidden rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element -- presigned R2, dicetak */}
                  <img src={p.url} alt={`Foto ${i + 1}`} className="h-48 w-full bg-surface-inset object-cover" />
                  <figcaption className="px-2 py-1.5 text-[11px] text-ink-muted">
                    <span className="font-semibold text-ink">Foto {i + 1}</span>
                    {p.takenAt ? ` · ${formatTanggalWaktu(p.takenAt)}` : ""}
                    {koord ? <span className="block">{koord}</span> : null}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </Section>

      {/* Kaki */}
      <footer className="mt-6 border-t border-border pt-2 text-[10px] text-ink-faint">
        Dokumen dibuat otomatis via {d.brandingName} · {formatTanggalWaktu(d.generatedAt)}
      </footer>
    </article>
  );
}
