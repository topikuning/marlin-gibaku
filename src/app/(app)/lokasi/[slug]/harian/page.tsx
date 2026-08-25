import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState, StatusPill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { can } from "@/lib/authz";
import { requireLocationPage } from "../get-location";
import {
  getBatasLaporan,
  getDaysInRange,
  getDetailHari,
  type DetailHari,
  type HariBerlaporan,
} from "@/lib/daily-report/queries";
import { jakartaDateKey, formatTanggal, formatTanggalWaktu } from "@/lib/format";
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE } from "@/lib/lifecycle";
import { bacaSaringHarian, type SaringHarian } from "@/lib/daily-report/hari-ini-ringkas";
import {
  bacaBulan,
  batasBulan,
  bulanDari,
  geserBulan,
  jepitBulan,
  judulBulan,
  jumlahHari,
  lolosSelSaring,
  ringkasKalender,
  susunDaftar,
  susunKalender,
  type SelKalender,
} from "@/lib/daily-report/kalender-harian";
import { Kalender } from "./kalender";
import { PanelHari } from "./panel-hari";
import { DaftarHarian, type BarisHarian } from "./daftar-harian";

export const dynamic = "force-dynamic";

/**
 * PELAKSANAAN HARIAN satu lokasi — KALENDER seluruh riwayat (DECISIONS 340).
 *
 * Sebelum ini halaman hanya menampilkan **14 hari terakhir**. Untuk kontrak 22
 * minggu itu berarti 90% riwayatnya tidak punya alamat: tanggal yang terlewat
 * bulan lalu tidak bisa ditemukan, tidak bisa ditambal, dan tidak bisa
 * dibuktikan pernah kosong. Permintaan user 2026-08-17, disertai konsep HTML:
 * kalender, *"tujuan utamanya, agar tidak hanya menampilkan 14 hari terakhir"*.
 *
 * ### Yang TIDAK diambil dari konsep, dan kenapa
 *
 * Konsepnya membuka dengan pita enam metrik proyek (nilai kontrak, periode,
 * rencana, realisasi, deviasi, minggu berjalan). Pita itu **sudah ada** di
 * `layout.tsx` lokasi, di atas seluruh tab. Memasangnya lagi di sini berarti
 * dua tempat yang harus sama selamanya — dan begitu salah satunya berubah,
 * pembacanya tidak punya cara tahu mana yang benar.
 *
 * ### Pembagian halaman tidak berubah
 *
 * `/hari-ini` untuk MENGERJAKAN (DECISIONS 337), halaman ini untuk MEMERIKSA
 * satu lokasi, `/laporan/status-harian` untuk memeriksa LINTAS lokasi
 * (DECISIONS 262). Yang berubah cuma jangkauan halaman tengah.
 *
 * ### Seluruh keadaan ada di ALAMAT
 *
 * `?bulan`, `?tgl`, `?saring`, `?tampilan` — tidak ada `useState` di jalur ini.
 * Alasannya sama dengan DECISIONS 279: layar yang sedang dilihat harus bisa
 * dikirim ke orang lain lewat WhatsApp, cara kerja tim ini sehari-hari.
 */
export default async function HarianIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    bulan?: string;
    tgl?: string;
    saring?: string;
    tampilan?: string;
    /** "1" = buka ringkasan tanggal sebagai pop-up (DECISIONS 414). */
    panel?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { user, location } = await requireLocationPage(slug);

  const hariIniKey = jakartaDateKey(new Date());
  const kontrak = location.package.contract;
  const mulaiKontrak = kontrak?.startDate ? jakartaDateKey(kontrak.startDate) : null;
  const akhirKontrak = kontrak?.endDate ? jakartaDateKey(kontrak.endDate) : null;

  const rentangLaporan = await getBatasLaporan(location.id);
  const batas = batasBulan({
    hariIniKey,
    mulaiKontrak,
    laporanPertama: rentangLaporan.pertama,
    laporanTerakhir: rentangLaporan.terakhir,
  });

  const saring = bacaSaringHarian(sp.saring);
  const daftarMode = sp.tampilan === "daftar";
  // Tanggal terpilih ikut menentukan bulan yang dibuka — supaya tautan
  // "?tgl=2026-03-04" saja tetap membuka Maret, bukan bulan berjalan.
  const bulanDariTgl = bacaBulan(sp.tgl ? bulanDari(sp.tgl) : undefined, bulanDari(hariIniKey));
  const bulan = jepitBulan(bacaBulan(sp.bulan, bulanDariTgl), batas);

  const dasar = { hariIniKey, mulaiKontrak, akhirKontrak };
  const akhirBulan = (b: string) => `${b}-${String(jumlahHari(b)).padStart(2, "0")}`;

  const [dataBulan, dataDaftar] = await Promise.all([
    getDaysInRange(location.id, `${bulan}-01`, akhirBulan(bulan)),
    daftarMode
      ? getDaysInRange(location.id, `${batas.min}-01`, akhirBulan(batas.max))
      : Promise.resolve(new Map<string, HariBerlaporan>()),
  ]);

  const sel = susunKalender({ ...dasar, bulan, data: dataBulan });
  const ringkas = ringkasKalender(sel);

  // Tanggal terpilih: yang diminta URL, kalau tidak hari ini (bila bulan ini
  // memang memuatnya), kalau tidak tanggal 1 — panel samping tidak boleh kosong.
  const diminta = sel.find((s) => s.bulanIni && s.dateKey === sp.tgl);
  const terpilih =
    diminta ??
    sel.find((s) => s.bulanIni && s.dateKey === hariIniKey) ??
    sel.find((s) => s.bulanIni)!;
  const detail = await getDetailHari(location.id, terpilih.dateKey);
  // Pop-up ringkasan tanggal hanya terbuka kalau petak tanggal yang memintanya
  // — bukan setiap kali halaman dibuka (DECISIONS 414).
  const bukaPanel = sp.panel === "1" && !!diminta;

  const taut = (ubah: {
    bulan?: string;
    tgl?: string;
    saring?: SaringHarian;
    tampilan?: "kalender" | "daftar";
    /** Minta ringkasan tanggal terbuka sebagai pop-up di layar sempit. */
    panel?: boolean;
  }) => {
    const q = new URLSearchParams();
    const b = ubah.bulan ?? bulan;
    // Bulan hanya ditulis kalau bukan bulan berjalan — URL yang bersih untuk
    // kasus yang paling sering dibagikan.
    if (b !== bulanDari(hariIniKey)) q.set("bulan", b);
    const t = ubah.tgl ?? (ubah.bulan ? undefined : terpilih.dateKey);
    if (t) q.set("tgl", t);
    const s = ubah.saring ?? saring;
    if (s !== "semua") q.set("saring", s);
    const tp = ubah.tampilan ?? (daftarMode ? "daftar" : "kalender");
    if (tp === "daftar") q.set("tampilan", "daftar");
    /*
     * `panel` SENGAJA tidak diwariskan dari URL sekarang (DECISIONS 414):
     * hanya petak tanggal yang memintanya. Kalau ia menempel, mengganti bulan
     * atau saringan akan ikut membuka pop-up yang tidak diminta siapa pun.
     */
    if (ubah.panel) q.set("panel", "1");
    const qs = q.toString();
    return qs ? `/lokasi/${slug}/harian?${qs}` : `/lokasi/${slug}/harian`;
  };

  const disorot = (s: SelKalender) => lolosSelSaring(s, saring);
  const diredupkan = sel.filter((s) => s.bulanIni && !disorot(s)).length;

  const daftar = daftarMode
    ? susunDaftar({ ...dasar, min: batas.min, max: batas.max, data: dataDaftar })
    : null;

  /**
   * Angka di chip mengikuti CAKUPAN yang sedang dilihat.
   *
   * Kalender menampilkan satu bulan, daftar menampilkan seluruh rentang. Kalau
   * chip-nya selalu menghitung bulan berjalan, mode daftar akan menawarkan
   * "Belum ada (12)" lalu menampilkan 60 baris — dan tidak ada cara membaca
   * mana yang benar.
   */
  const cakupan = daftar ? daftar.baris : sel.filter((s) => s.bulanIni);
  const cacah = ringkasKalender(cakupan);
  const barisDaftar: BarisHarian[] =
    daftar?.baris
      .filter((s) => lolosSelSaring(s, saring))
      .map((s) => {
        const d = new Date(`${s.dateKey}T00:00:00Z`);
        return {
          dateKey: s.dateKey,
          tanggal: formatTanggal(d, "d MMM yyyy"),
          hari: formatTanggal(d, "EEEE"),
          status: s.status ? REPORT_STATUS_LABEL[s.status] : s.kata,
          tone: s.status ? REPORT_STATUS_TONE[s.status] : "neutral",
          itemCount: s.itemCount,
          fotoCount: s.fotoCount,
          hariIni: s.hariIni,
          href: `/lokasi/${slug}/harian/${s.dateKey}`,
        };
      }) ?? [];

  return (
    <Card>
      <CardHeader
        title="Pelaksanaan Harian"
        subtitle={`Satu laporan per tanggal: volume, tenaga, material, alat, cuaca, foto, kendala. Riwayat penuh ${judulBulan(batas.min)} – ${judulBulan(batas.max)}.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {can(user.role, "daily_report.create") && (
              <Link
                href={`/lokasi/${slug}/harian/import`}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted"
              >
                Impor rekap Excel
              </Link>
            )}
            <Link
              href={`/lokasi/${slug}/harian/${hariIniKey}`}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800"
            >
              Buka hari ini
            </Link>
          </div>
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav className="flex flex-wrap items-center gap-1.5" aria-label="Saring status">
            <Chip href={taut({ saring: "semua" })} aktif={saring === "semua"} label="Semua" />
            <Chip
              href={taut({ saring: "belum" })}
              aktif={saring === "belum"}
              label={`Belum ada (${cacah.belumAda})`}
            />
            <Chip
              href={taut({ saring: "draft" })}
              aktif={saring === "draft"}
              label={`Draft (${cacah.draft})`}
            />
            <Chip
              href={taut({ saring: "koreksi" })}
              aktif={saring === "koreksi"}
              label={`Koreksi (${cacah.perluKoreksi})`}
            />
            <Chip
              href={taut({ saring: "selesai" })}
              aktif={saring === "selesai"}
              label={`Selesai (${cacah.dikirim + cacah.selesai})`}
            />
          </nav>
          <div className="flex items-center gap-1.5" role="group" aria-label="Bentuk tampilan">
            <Chip href={taut({ tampilan: "kalender" })} aktif={!daftarMode} label="Kalender" />
            <Chip href={taut({ tampilan: "daftar" })} aktif={daftarMode} label="Daftar" />
          </div>
        </div>

        {daftarMode ? (
          <section className="space-y-2">
            {barisDaftar.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="Tidak ada tanggal pada saringan ini"
                description='Pilih "Semua" untuk melihat seluruh riwayat.'
              />
            ) : (
              <DaftarHarian rows={barisDaftar} />
            )}
            {/* Daftar yang dipangkas diam-diam terbaca sebagai daftar lengkap. */}
            <p className="text-[12px] text-ink-muted">
              {barisDaftar.length} baris, {judulBulan(batas.min)} – {judulBulan(batas.max)}.
              {daftar && daftar.disembunyikan > 0
                ? ` ${daftar.disembunyikan} hari tidak didaftar karena belum tiba atau di luar masa kontrak.`
                : ""}
              {saring !== "semua"
                ? ` Saringan aktif – ${(daftar?.baris.length ?? 0) - barisDaftar.length} baris disembunyikan.`
                : ""}
            </p>
          </section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="space-y-3">
              <Kalender
                bulan={bulan}
                batas={batas}
                sel={sel}
                terpilih={terpilih.dateKey}
                disorot={disorot}
                taut={(u) => taut(u)}
                // Hari KOSONG melompat langsung ke formulirnya (DECISIONS 355):
                // di hari tanpa laporan, panel samping cuma memberi tahu bahwa
                // isinya kosong lalu menawarkan satu tombol.
                tautIsi={(tgl) => `/lokasi/${slug}/harian/${tgl}`}
              />

              {/* Angka SELALU membawa penyebutnya, dan penyebutnya JUJUR: hari
                  di luar kontrak & hari yang belum tiba tidak menagih laporan,
                  jadi tidak ikut. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Angka label="Belum ada" nilai={ringkas.belumAda} dari={ringkas.wajib} nada="warning" />
                <Angka label="Draft" nilai={ringkas.draft} dari={ringkas.wajib} nada="warning" />
                <Angka label="Perlu koreksi" nilai={ringkas.perluKoreksi} dari={ringkas.wajib} nada="danger" />
                <Angka
                  label="Dikirim / selesai"
                  nilai={ringkas.dikirim + ringkas.selesai}
                  dari={ringkas.wajib}
                  nada="success"
                />
              </div>

              <p className="text-[12px] text-ink-muted">
                Penyebut = {ringkas.wajib} hari yang dihitung di {judulBulan(bulan)} – dalam
                masa kontrak dan sudah lewat, atau sudah punya laporan.
                {ringkas.luarKontrak > 0
                  ? ` ${ringkas.luarKontrak} hari di luar masa kontrak (tidak dihitung).`
                  : ""}
                {ringkas.belumTiba > 0 ? ` ${ringkas.belumTiba} hari belum tiba.` : ""}
                {saring !== "semua" && diredupkan > 0
                  ? ` Saringan aktif – ${diredupkan} hari diredupkan, tidak dihapus.`
                  : ""}
              </p>
            </section>

            <PanelHari
              bukaPanel={bukaPanel}
              judul={formatTanggal(new Date(`${terpilih.dateKey}T00:00:00Z`), "EEEE, d MMMM yyyy")}
            >
              <PanelTanggal detail={detail} sel={terpilih} slug={slug} />
            </PanelHari>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function PanelTanggal({
  detail,
  sel,
  slug,
}: {
  detail: DetailHari | null;
  sel: SelKalender;
  slug: string;
}) {
  const tanggal = new Date(`${sel.dateKey}T00:00:00Z`);
  // Label aksi mengikuti KEADAAN, bukan sekadar ada/tidaknya laporan. Menawarkan
  // "Buat laporan" untuk tanggal di luar masa kontrak menjanjikan sesuatu yang
  // memang tidak ditagih; "Buka tanggal" tidak menjanjikan dan tidak melarang.
  const aksi =
    sel.status === null
      ? sel.keadaan === "kosong"
        ? "Buat laporan"
        : "Buka tanggal"
      : sel.status === "perlu_koreksi"
        ? "Perbaiki laporan"
        : sel.status === "draft"
          ? "Lanjutkan input"
          : "Buka laporan";

  return (
    <aside className="h-fit rounded-lg border border-border bg-surface-muted p-3 lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[15px] font-bold">{formatTanggal(tanggal, "EEEE, d MMMM yyyy")}</p>
          <p className="text-[11px] text-ink-muted">
            {sel.hariIni ? "Hari ini" : sel.keadaan === "belum_tiba" ? "Belum tiba" : "Riwayat"}
          </p>
        </div>
        <StatusPill
          tone={sel.status ? REPORT_STATUS_TONE[sel.status] : "neutral"}
          label={sel.status ? REPORT_STATUS_LABEL[sel.status] : sel.kata}
        />
      </div>

      {detail ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <Fakta label="Item pekerjaan" nilai={`${detail.itemCount} item`} />
            <Fakta label="Foto" nilai={`${detail.fotoCount} foto`} />
            <Fakta label="Kendala terbuka" nilai={String(detail.kendalaTerbuka)} />
            <Fakta label="Tenaga kerja" nilai={`${detail.pekerjaCount} baris`} />
          </dl>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface text-[12px]">
            <Cek label="Pekerjaan & volume" ok={detail.itemCount > 0} />
            <Cek label="Cuaca & jam kerja" ok={detail.adaCuaca && detail.adaJamKerja} />
            <Cek label="Tenaga kerja" ok={detail.pekerjaCount > 0} />
            <Cek label="Foto bukti" ok={detail.fotoCount > 0} />
          </ul>
          <p className="mt-2 text-[11px] text-ink-muted">
            Terakhir disimpan {formatTanggalWaktu(detail.updatedAt)}
          </p>
        </>
      ) : (
        <p className="mt-3 rounded-lg border border-border bg-surface p-3 text-[12px] text-ink-muted">
          {sel.keadaan === "luar_kontrak"
            ? "Tanggal ini di luar masa kontrak – tidak ada laporan yang ditagih."
            : sel.keadaan === "belum_tiba"
              ? "Tanggal ini belum tiba."
              : "Belum ada laporan untuk tanggal ini."}
        </p>
      )}

      <Link
        href={`/lokasi/${slug}/harian/${sel.dateKey}`}
        className="mt-3 block rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-white hover:bg-primary-800"
      >
        {aksi}
      </Link>
    </aside>
  );
}

function Fakta({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5">
      <dt className="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="tabular mt-0.5 text-[13px] font-semibold">{nilai}</dd>
    </div>
  );
}

/** Centang kelengkapan — status ditulis DENGAN KATA, bukan hanya ikon/warna. */
function Cek({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2 px-2.5 py-2">
      <span>{label}</span>
      <span className={cn("text-[11px] font-semibold", ok ? "text-success" : "text-ink-muted")}>
        {ok ? "Terisi" : "Belum"}
      </span>
    </li>
  );
}

function Angka({
  label,
  nilai,
  dari,
  nada,
}: {
  label: string;
  nilai: number;
  dari: number;
  nada: "danger" | "warning" | "success";
}) {
  const warna =
    nilai === 0
      ? "text-ink-muted"
      : nada === "danger"
        ? "text-danger"
        : nada === "warning"
          ? "text-warning"
          : "text-success";
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">{label}</p>
      <p className={`tabular mt-0.5 text-xl font-bold ${warna}`}>
        {nilai}
        <span className="text-[13px] font-normal text-ink-muted"> / {dari} hari</span>
      </p>
    </div>
  );
}

function Chip({ href, aktif, label }: { href: string; aktif: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={aktif ? "page" : undefined}
      className={
        aktif
          ? "rounded-full border border-primary bg-primary px-3 py-1.5 text-[13px] font-semibold text-white"
          : "rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-surface-muted"
      }
    >
      {label}
    </Link>
  );
}
