import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { Badge, Banner, Card, CardBody, CardHeader, EmptyState, KpiCard, type BadgeTone } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatPct, formatRupiah, formatRupiahShort, formatTanggalWaktu } from "@/lib/format";
import { LABEL_STATUS_BUTIR, kelompokButir, namaButir, type StatusLangkah } from "@/lib/penagihan/katalog";
import { muatPenagihan } from "@/lib/penagihan/data";
import { persenSurat } from "@/lib/surat-penyedia/aturan";
import { BarisBerkas, type BarisKlien } from "./baris-berkas";

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
  const t = d.termin;
  const lolosAmbang = d.progresKonsultan ? d.progresKonsultan.progresPct >= t.ambangPct : null;

  const keKlien = (b: (typeof d.langkah)[number]["baris"][number]): BarisKlien => ({
    kode: b.butir.kode,
    nama: namaButir(b.butir),
    pemberi: b.butir.pemberi,
    folder: b.butir.jalur.join(" / "),
    status: b.status,
    statusLabel: LABEL_STATUS_BUTIR[b.status],
    lihat: b.rujukan,
    unggah: !bolehUnggah || b.status === "disiapkan_marlin"
      ? null
      : b.rujukan?.href.startsWith("/api/documents/")
        ? { label: "Unggah lagi", judul: "Ganti dengan berkas yang lebih baru" }
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
        : b.status === "disiapkan_marlin"
          ? "dibuat dari data MARLIN saat berkas termin disiapkan"
          : null,
  });

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
