import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { Badge, Banner, ButtonLink, Card, CardBody, CardHeader, EmptyState, KpiCard, type BadgeTone } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatPct, formatRupiah, formatRupiahShort, formatTanggalWaktu, jakartaDateKey } from "@/lib/format";
import { LABEL_STATUS_BUTIR, kelompokButir, namaButir, type StatusLangkah } from "@/lib/penagihan/katalog";
import { muatPenagihan } from "@/lib/penagihan/data";
import { ringkasBerkasTermin } from "@/lib/penagihan/berkas-termin";
import { rentangMingguTermin, tanggalSuratAwal } from "@/lib/penagihan/berkas-termin-aturan";
import { persenSurat } from "@/lib/surat-penyedia/aturan";
import { BarisBerkas, type BarisKlien } from "./baris-berkas";
import { SiapkanBerkasTermin, type SuratTerminKlien } from "./siapkan-berkas";

export const metadata: Metadata = { title: "Penagihan" };
export const dynamic = "force-dynamic";

const LABEL_LANGKAH: Record<StatusLangkah, string> = { selesai: "Selesai", berjalan: "Berjalan", belum: "Belum" };
const TONE_LANGKAH: Record<StatusLangkah, BadgeTone> = { selesai: "success", berjalan: "info", belum: "neutral" };

/** Butir satu langkah dipecah menurut folder induknya di Drive, urutan katalog tetap. */
function kelompokkan<T extends { butir: Parameters<typeof kelompokButir>[0] }>(baris: T[]): [string, T[]][] {
  const peta = new Map<string, T[]>();
  for (const b of baris) {
    const k = kelompokButir(b.butir);
    peta.set(k, [...(peta.get(k) ?? []), b]);
  }
  return [...peta];
}

/**
 * PENAGIHAN per termin (DECISIONS 720): langkah 0–8 dari syarat sampai cair,
 * dan daftar periksa 42 berkas folder TERMIN Drive KKP – masing-masing dengan
 * asal, pemberi, status, dan aksinya. Semua status diturunkan dari dokumen,
 * surat, dan jadwal termin; tidak ada yang dicentang tangan.
 */
export default async function PenagihanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ termin?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;
  const diminta = Number((await searchParams).termin) || undefined;

  const d = await muatPenagihan(id, user, diminta);
  if (!d) {
    return (
      <EmptyState
        icon={Wallet}
        title="Belum ada kontrak"
        description="Penagihan baru bisa disusun setelah paket ini punya kontrak."
      />
    );
  }
  const bolehUnggah = can(user.role, "document.upload");
  const n = d.terminKe;
  const berkasDrive = await ringkasBerkasTermin(id, n);
  const rentang = rentangMingguTermin(n, d.mingguPrestasi);
  // Lima surat penyedia termin ini (DECISIONS 724): yang sudah ada disebut,
  // yang belum diberi tanggal awal H/H+1/H+2. H = tanggal permohonan
  // pemeriksaan bila sudah dibuat, selain itu hari ini.
  const pemeriksaan = d.tanggalSurat.permohonan_pemeriksaan;
  const hariIni = pemeriksaan ? jakartaDateKey(pemeriksaan) : jakartaDateKey(new Date());
  const suratTermin: SuratTerminKlien[] = d.langkah
    .flatMap((l) => l.baris)
    .filter((b) => b.butir.surat)
    .map((b): SuratTerminKlien => {
      const nama = namaButir(b.butir);
      return b.status === "ada"
        ? { jenis: b.butir.surat!, nama, ada: true, keterangan: b.rujukan?.judul ?? "sudah ada" }
        : { jenis: b.butir.surat!, nama, ada: false, tanggalAwal: tanggalSuratAwal(b.butir.surat!, hariIni) };
    });
  const t = d.termin;
  const lolosAmbang = d.progresKonsultan ? d.progresKonsultan.progresPct >= t.ambangPct : null;

  const namaLokasi = new Map(d.kontrak.package.locations.map((l) => [l.id, l.name]));
  const butirUtama = new Map(d.langkah.flatMap((l) => l.baris).map((b) => [b.butir.kode, namaButir(b.butir)]));
  const keKlien = (b: (typeof d.langkah)[number]["baris"][number]): BarisKlien => {
    const lihat = (x: { judul: string; href: string }) => ({ judul: x.judul, href: x.href });
    const perLokasi = b.lokasi;
    const dilengkapiLokasi = perLokasi?.filter((l) => l.status === "ada").length ?? 0;
    return {
      kode: b.butir.kode,
      nama: namaButir(b.butir),
      pemberi: b.butir.pemberi,
      folder: b.butir.jalur.length ? b.butir.jalur.join(" / ") : "langsung di folder termin",
      status: b.status,
      statusLabel:
        b.status === "sebagian" && perLokasi
          ? `${dilengkapiLokasi} dari ${perLokasi.length} lokasi`
          : LABEL_STATUS_BUTIR[b.status],
      berkas: b.berkas.map((x) => ({ ...lihat(x), lokasi: x.locationId ? (namaLokasi.get(x.locationId) ?? null) : null })),
      lokasi: perLokasi
        ? perLokasi.map((l) => ({
            locationId: l.locationId,
            nama: l.nama,
            status: l.status,
            statusLabel: LABEL_STATUS_BUTIR[l.status],
            berkas: l.berkas.map(lihat),
          }))
        : null,
      berkasPaket: perLokasi ? b.berkas.filter((x) => x.locationId === null).map(lihat) : [],
      // MARLIN membantu, tidak memaksa (DECISIONS 722): SEMUA butir bisa diisi
      // versi sendiri – laporan yang dicetak, diteken, lalu dipindai.
      unggah: !bolehUnggah
        ? null
        : b.butir.laporan
          ? {
              label: "Unggah versi sendiri",
              judul: "Unggah versi yang sudah dicetak, ditandatangani, dan dipindai. MARLIN lalu tidak membuat versinya untuk lokasi itu.",
            }
          : b.berkas.some((x) => "dokumenId" in x.sumber)
            ? { label: "Unggah lagi", judul: "Tambah berkas" }
            : b.butir.surat
              ? { label: "Unggah scan", judul: "Unggah surat yang sudah ditandatangani, atau yang dibuat di luar MARLIN" }
              : { label: "Unggah", judul: null },
      buatHref:
        b.status === "belum_dibuat" && b.butir.surat && can(user.role, "contract.manage")
          ? `/paket/${id}/termin?termin=${n}&surat=${b.butir.surat}#buat-surat`
          : null,
      catatan:
        b.butir.sumber === "tetap"
          ? b.butir.tetapDi === "perusahaan"
            ? "sekali unggah, berlaku di semua paket perusahaan ini"
            : "sekali unggah, berlaku untuk semua termin"
          : b.butir.laporan
            ? "MARLIN membuatnya per lokasi saat berkas termin disiapkan, kecuali lokasi yang sudah diisi versi sendiri"
            : b.butir.kode === "12"
              ? "RAB tiap lokasi diambil dari berkas Excel revisi RAB aktif lokasi itu"
              : null,
      cukupDi: b.butir.cukupDi ? { kode: b.butir.cukupDi, nama: butirUtama.get(b.butir.cukupDi) ?? b.butir.cukupDi } : null,
    };
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Penagihan Termin ${n}`}
          subtitle={`Dari syarat sampai cair, dengan daftar berkas yang sama persis dengan folder TERMIN di Drive KKP. ${d.jadwalBawaan ? "Jadwal bawaan KKP." : "Jadwal termin kontrak ini."}`}
        />
        <CardBody className="space-y-3">
          <nav aria-label="Pilih termin" className="flex flex-wrap gap-2">
            {d.daftarTermin.map((x) => (
              <Link
                key={x.terminKe}
                href={`/paket/${id}/penagihan?termin=${x.terminKe}`}
                aria-current={x.terminKe === n ? "page" : undefined}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm",
                  x.terminKe === n ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink hover:bg-surface-muted",
                )}
              >
                Termin {x.terminKe} ({persenSurat(x.ambangPct)})
              </Link>
            ))}
          </nav>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 [&>*]:min-w-0">
            <KpiCard label="Ditagih saat progres" value={persenSurat(t.ambangPct)} sub={`Nilai termin ${persenSurat(t.bayarPct)} kontrak`} />
            <KpiCard
              label="Progres konsultan"
              value={d.progresKonsultan ? formatPct(d.progresKonsultan.progresPct) : "Belum diisi"}
              tone={lolosAmbang === null ? "default" : lolosAmbang ? "success" : "danger"}
              href={`/paket/${id}/termin?termin=${n}#progres-konsultan`}
              sub={d.progresKonsultan ? `minggu ke-${d.progresKonsultan.mingguKe}` : "isi dari laporan konsultan"}
            />
            <KpiCard
              label="Progres MARLIN"
              value={d.progresMarlin === null ? "–" : formatPct(d.progresMarlin)}
              sub="tertimbang RAB, laporan yang dikirim"
            />
            <KpiCard
              label="Dibayar"
              value={formatRupiahShort(t.dibayar)}
              sub={t.retensi > 0n ? `${formatRupiah(t.dibayar)}, sesudah retensi ${formatRupiahShort(t.retensi)}` : formatRupiah(t.dibayar)}
            />
          </div>
          <p className="text-[13px] text-ink-muted">
            Berkas: <strong className="text-ink">{d.ringkas.ada}</strong> ada · {d.ringkas.disiapkan} disiapkan MARLIN ·{" "}
            {d.ringkas.menunggu} menunggu pihak lain · {d.ringkas.kurang} perlu dibuat/diunggah, dari {d.ringkas.total} berkas.
          </p>
          {lolosAmbang === false ? (
            <Banner
              tone="warning"
              title={`Progres konsultan belum mencapai ambang termin ${n}`}
              description={`Tercatat ${formatPct(d.progresKonsultan!.progresPct)}, ambangnya ${persenSurat(t.ambangPct)}. Surat permohonan pemeriksaan dan BA pembahasan belum bisa dibuat.`}
            />
          ) : null}
        </CardBody>
      </Card>

      <Card id="berkas-drive" className="scroll-mt-20">
        <CardHeader
          title={`Berkas Termin ${n} di Drive`}
          subtitle={`Sekali tekan: semua berkas yang sudah ada disalin ke folder 7. BERKAS TERMIN / TERMIN ${n} dengan susunan folder KKP. Kurva S, laporan mingguan, harian, bulanan, dan dokumentasi dibuat MARLIN untuk folder yang belum Anda isi versi sendiri.`}
        />
        <CardBody className="space-y-3">
          {rentang.ok ? (
            <p className="text-[13px] text-ink-muted">
              Laporan yang ikut: minggu ke-{rentang.rentang.awal} s.d. ke-{rentang.rentang.akhir}
              {n === 1
                ? ", sampai minggu prestasi termin 1 menurut laporan konsultan."
                : `, sesudah prestasi termin ${n - 1} sampai prestasi termin ${n} menurut laporan konsultan.`}
            </p>
          ) : (
            <Banner
              tone="warning"
              title="Periode laporan termin ini belum diketahui"
              description={rentang.alasan}
              action={
                <ButtonLink href={`/paket/${id}/termin?termin=${rentang.terminKe}#progres-konsultan`} variant="secondary" size="sm">
                  Isi progres termin {rentang.terminKe}
                </ButtonLink>
              }
            />
          )}
          {berkasDrive.total > 0 ? (
            <div className="space-y-1.5 text-[13px]">
              <p className="text-ink">
                <strong>{berkasDrive.sukses}</strong> dari {berkasDrive.total} berkas sudah di Drive
                {berkasDrive.menunggu ? ` · ${berkasDrive.menunggu} masih diproses` : ""}
                {berkasDrive.gagal ? ` · ${berkasDrive.gagal} gagal` : ""}
                {berkasDrive.batal ? ` · ${berkasDrive.batal} tidak bisa disusun` : ""}
                {berkasDrive.berkasDibuang
                  ? ` · ${berkasDrive.berkasDibuang} berkas versi MARLIN dipindah ke Sampah Drive karena diganti versi Anda`
                  : ""}
                {berkasDrive.terakhir ? ` · terakhir ${formatTanggalWaktu(berkasDrive.terakhir)}` : ""}
              </p>
              {berkasDrive.masalah.length ? (
                <ul className="space-y-1 text-ink-muted">
                  {berkasDrive.masalah.slice(0, 6).map((m, i) => (
                    <li key={i} className={m.menyerah ? "text-danger" : undefined}>
                      {m.label}
                      {m.lokasi ? ` (${m.lokasi})` : ""}: {m.pesan}
                    </li>
                  ))}
                  {berkasDrive.masalah.length > 6 ? <li>dan {berkasDrive.masalah.length - 6} lainnya.</li> : null}
                </ul>
              ) : null}
            </div>
          ) : null}
          {bolehUnggah && rentang.ok ? (
            <SiapkanBerkasTermin
              packageId={id}
              terminKe={n}
              ulang={berkasDrive.total > 0}
              folderDrive={berkasDrive.folderDrive}
              surat={suratTermin}
              bolehBuatSurat={can(user.role, "contract.manage")}
            />
          ) : null}
        </CardBody>
      </Card>

      {d.langkah.map((l) => (
        <Card key={l.ke} id={`langkah-${l.ke}`} className="scroll-mt-20">
          <CardHeader
            title={`Langkah ${l.ke} · ${l.judul}`}
            subtitle={l.pemberi}
            action={<Badge tone={TONE_LANGKAH[l.status]}>{LABEL_LANGKAH[l.status]}</Badge>}
          />
          <CardBody className="space-y-2">
            {l.ke === 0 ? (
              <p className="text-[13px] text-ink-muted">
                Syarat: progres konsultan ≥ {persenSurat(t.ambangPct)} (
                {d.progresKonsultan ? (lolosAmbang ? "terpenuhi" : "belum terpenuhi") : "belum diisi"}
                {d.progresKonsultan ? `, diperbarui ${formatTanggalWaktu(d.progresKonsultan.diubah)}` : ""}). Berkas
                pendukung di bawah dikumpulkan sebelum pengajuan.
              </p>
            ) : null}
            {l.ke === 8 ? (
              <p className="text-sm text-ink-muted">
                Setelah dana masuk, catat pencairannya di{" "}
                <Link href="/keuangan" className="font-medium text-primary underline underline-offset-2">
                  Keuangan
                </Link>
                .
              </p>
            ) : (
              kelompokkan(l.baris).map(([kelompok, isi], i, semua) => (
                <div key={kelompok} className={cn("space-y-2", i > 0 && "pt-2")}>
                  {semua.length > 1 ? (
                    <h3 className="text-[12px] font-semibold tracking-wide text-ink-muted uppercase">{kelompok}</h3>
                  ) : null}
                  <ul className="space-y-2">
                    {isi.map((b) => (
                      <BarisBerkas key={b.butir.kode} baris={keKlien(b)} packageId={id} terminKe={n} />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
