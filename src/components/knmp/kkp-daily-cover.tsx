import { terbilang } from "@/lib/daily-report/kkp-lampiran-susun";
import type { KkpDailyData } from "./kkp-daily-report";

/**
 * SAMPUL laporan harian KKP — versi HTML dari `lib/pdf/harian-kkp-lampiran.ts`.
 *
 * Pertanyaan user 2026-08-07: *"kenapa pratinjau dan cetak laporan kkp di
 * halaman harian masih satu halaman blanko saja?"* — karena format resminya
 * baru dipasang di jalur PDF, sementara `/cetak/harian` (yang di-Ctrl+P dari
 * layar) adalah tumpukan render yang berbeda dan masih memuat blanko saja.
 * Dokumen yang sama tidak boleh berbeda tergantung tombol mana yang ditekan.
 *
 * Susunannya SENGAJA menirukan modul PDF blok demi blok: kop pemilik (pita
 * terang, teks gelap, alamat apa adanya) → judul → MINGGU KE-n (terbilang) →
 * identitas kontrak → dua kop pihak berlogo dengan garis paraf sejajar.
 * Terbilangnya diambil dari modul murni yang sama, bukan disalin.
 */
export function KkpDailyCover({
  d,
  logoVendorUrl,
}: {
  d: KkpDailyData;
  /** Logo pelaksana (presigned) — kotak kop kanan. Null = kotak tanpa logo. */
  logoVendorUrl?: string | null;
}) {
  const barisAlamat = (d.ownerAddress ?? "")
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  const bilangan = d.weekNo != null ? terbilang(d.weekNo) : null;

  return (
    <section className="flex min-h-[247mm] flex-col border border-slate-500 p-4 text-slate-900">
      {/* ── Kop pemilik pekerjaan ─────────────────────────────────────────
          Pita TERANG dengan teks gelap: lambang instansi umumnya gelap/emas
          dan hilang di atas latar pekat (teguran user 2026-08-07). */}
      <div className="flex items-center gap-4 border border-border bg-primary-50 px-3 py-2">
        {d.ownerLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.ownerLogoUrl} alt="" className="h-13 w-13 shrink-0 object-contain" />
        ) : null}
        <div className="min-w-0 flex-1 text-center">
          <div className="text-[15px] leading-tight font-bold uppercase">{d.ownerName ?? ""}</div>
          {d.ownerSubtitle ? (
            <div className="text-[11px] leading-tight uppercase">{d.ownerSubtitle}</div>
          ) : null}
          {barisAlamat.map((t) => (
            <div key={t} className="text-[9px] leading-snug text-ink-muted uppercase">
              {t}
            </div>
          ))}
        </div>
      </div>

      {/* ── Judul ──────────────────────────────────────────────────────── */}
      <div className="mt-14 text-center">
        <div className="text-[26px] leading-tight font-bold tracking-wide">LAPORAN HARIAN</div>
        {d.weekNo != null ? (
          <div className="mt-3 text-[18px] font-bold">
            MINGGU KE-{d.weekNo}
            {bilangan ? ` (${bilangan})` : ""}
          </div>
        ) : null}
      </div>

      {/* ── Identitas kontrak ──────────────────────────────────────────── */}
      <dl className="mt-10 space-y-2 text-[12px]">
        <Baris label="PERIODE" isi={d.periodStart && d.periodEnd ? `${d.periodStart}  s/d  ${d.periodEnd}` : null} />
        <Baris label="NOMOR KONTRAK" isi={d.contractNumber} />
        <Baris label="TANGGAL KONTRAK" isi={d.contractDate} />
        <div className="h-2" />
        <Baris label="PEKERJAAN" isi={d.pekerjaan} />
        <Baris label="LOKASI" isi={`${d.locationName} – ${d.regency}, ${d.province}`} />
        <Baris label="TAHUN ANGGARAN" isi={String(d.tahunAnggaran)} />
      </dl>

      {/* ── Dua pihak di kaki halaman ─────────────────────────────────────
          Tiap pihak tampil sebagai KOP PERUSAHAAN (logo kiri, nama + alamat
          kanan), lalu garis paraf di bawahnya pada ketinggian yang sama. */}
      <div className="mt-auto grid grid-cols-2 gap-6 pt-16">
        {/*
          Logo pengawas SEMPAT hilang di sini padahal ada di jalur PDF: kotak
          kiri tidak pernah diberi logoUrl (laporan user 2026-08-26). Dokumen
          yang sama tidak boleh berbeda tergantung tombol mana yang ditekan.
        */}
        <KopPihak
          judul="KONSULTAN PENGAWAS"
          firma={d.supervisorFirm ?? d.supervisorSub}
          logoUrl={d.supervisorLogoUrl}
        />
        <KopPihak
          judul="KONTRAKTOR PELAKSANA"
          firma={d.contractorFirm}
          alamat={d.contractorAddress}
          logoUrl={logoVendorUrl ?? d.vendorLogoUrl}
        />
      </div>
    </section>
  );
}

/** Baris label rata kanan · isi rata kiri — sejajar pada dua sumbu tetap. */
function Baris({ label, isi }: { label: string; isi?: string | null }) {
  if (!isi) return null;
  return (
    <div className="flex gap-3">
      <dt className="w-[34%] shrink-0 text-right text-ink-muted">{label}</dt>
      <dd className="flex-1 font-semibold">: {isi}</dd>
    </div>
  );
}

function KopPihak({
  judul,
  firma,
  alamat,
  logoUrl,
}: {
  judul: string;
  firma?: string | null;
  alamat?: string | null;
  logoUrl?: string | null;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-center text-[11px] font-bold">{judul}</div>
      {/*
        Isi kotak dipusatkan pada DUA sumbu (permintaan user 2026-08-26):
        `justify-center` + `items-center`, dan teksnya `text-center`. Sebelumnya
        isinya menempel kiri, jadi kotak pengawas yang hanya berisi titik-titik
        terlihat menggantung di pojok.
      */}
      <div className="mt-2 flex min-h-[52px] items-center justify-center gap-2 border border-slate-500 px-2 py-1.5">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-10 w-10 shrink-0 object-contain" />
        ) : null}
        <div className="min-w-0 text-center">
          <div className="text-[9px] leading-tight font-bold uppercase">
            {firma || "……………………………………"}
          </div>
          {alamat ? <div className="text-[7px] leading-tight text-ink-muted">{alamat}</div> : null}
        </div>
      </div>
      <div className="mx-auto mt-14 w-[70%] border-t border-slate-500" />
    </div>
  );
}
