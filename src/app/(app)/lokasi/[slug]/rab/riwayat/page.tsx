import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader, StatusPill } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { formatNumber, formatRupiah, formatTanggal } from "@/lib/format";
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE } from "@/lib/lifecycle";
import { cariItemBerealisasi, riwayatInputItem } from "@/lib/rab/riwayat-item";
import { requireLocationPage } from "../../get-location";
import { FormCari } from "./form-cari";

export const metadata: Metadata = { title: "Riwayat input item" };
export const dynamic = "force-dynamic";

/**
 * RIWAYAT INPUT PER ITEM PEKERJAAN.
 *
 * **Permintaan user 2026-09-21**, saat pratinjau adendum melaporkan *"7 item
 * volumenya turun DI BAWAH yang sudah dikerjakan"*:
 *
 *   *"bagaimana user tau kapan pekerjaan itu diinput? akan konyol kalau harus
 *   cek hari per hari. kamu seharusnya ada fitur cari item pekerjaan diinputnya
 *   kapan saja"*
 *
 * Halaman ini digerakkan URL (`?q=` dan `?item=`) supaya bisa DITAUTKAN: daftar
 * peringatan di pratinjau impor menunjuk langsung ke item yang dipersoalkan,
 * tanpa menyuruh orang mengetik ulang kodenya di layar lain.
 */
export default async function RiwayatItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; item?: string }>;
}) {
  const { slug } = await params;
  const { q = "", item = "" } = await searchParams;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "progress.view");

  const terpilih = item ? await riwayatInputItem(location.id, item) : null;
  const hasil = terpilih ? [] : await cariItemBerealisasi(location.id, q);

  return (
    <div className="max-w-4xl space-y-4">
      <Card>
        <CardHeader
          title="Riwayat input item pekerjaan"
          subtitle="Cari satu item, lihat semua tanggal pekerjaan itu dilaporkan – tanpa membuka laporan hari per hari."
          action={
            <ButtonLink href={`/lokasi/${slug}/rab`} variant="ghost" size="sm">
              <ArrowLeft aria-hidden className="size-3.5" />
              Kembali ke RAB
            </ButtonLink>
          }
        />
        <CardBody className="space-y-4">
          <FormCari slug={slug} q={q} />

          {terpilih ? (
            <RiwayatSatuItem slug={slug} data={terpilih} />
          ) : (
            <DaftarHasil slug={slug} q={q} hasil={hasil} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function DaftarHasil({
  slug,
  q,
  hasil,
}: {
  slug: string;
  q: string;
  hasil: Awaited<ReturnType<typeof cariItemBerealisasi>>;
}) {
  if (hasil.length === 0) {
    return (
      <Banner
        tone="info"
        title={q ? `Tidak ada item berealisasi yang cocok dengan "${q}"` : "Belum ada item yang pernah dilaporkan"}
        description={
          q
            ? "Yang dicari di sini hanya item yang SUDAH pernah dilaporkan – item kontrak yang belum dikerjakan memang tidak punya riwayat input."
            : "Riwayat baru terisi setelah ada laporan harian yang dikirim."
        }
      />
    );
  }

  return (
    <div>
      <p className="mb-2 text-[13px] text-ink-muted">
        {q
          ? `${hasil.length} item cocok dengan "${q}" – urut laporan terakhir.`
          : `${hasil.length} item yang pernah dilaporkan – urut laporan terakhir. Ketik untuk mempersempit.`}
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted">
            <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-1.5">Item</th>
              <th className="px-2 py-1.5 text-right">Realisasi</th>
              <th className="px-2 py-1.5 text-right">Jumlah input</th>
              <th className="px-2 py-1.5">Terakhir dilaporkan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {hasil.map((h) => (
              <tr key={h.lineageKey}>
                <td className="px-2 py-1.5">
                  <Link
                    href={`/lokasi/${slug}/rab/riwayat?item=${encodeURIComponent(h.lineageKey)}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {h.name}
                  </Link>
                  <span className="block text-[11px] text-ink-faint">{h.jalur}</span>
                </td>
                <td className="tabular px-2 py-1.5 text-right">
                  {formatNumber(h.total)} {h.unit ?? ""}
                </td>
                <td className="tabular px-2 py-1.5 text-right text-ink-muted">{h.jumlahInput}×</td>
                <td className="px-2 py-1.5 text-ink-muted">
                  {h.terakhir ? formatTanggal(h.terakhir) : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RiwayatSatuItem({
  slug,
  data,
}: {
  slug: string;
  data: NonNullable<Awaited<ReturnType<typeof riwayatInputItem>>>;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-surface-muted p-3">
        <p className="font-medium text-ink">{data.name}</p>
        <p className="text-[12px] text-ink-faint">{data.jalur}</p>
        <p className="mt-1 text-[13px] text-ink-muted">
          Realisasi tercatat{" "}
          <span className="font-semibold text-ink">
            {formatNumber(data.total)} {data.unit ?? ""}
          </span>
          {data.volumeKontrak != null
            ? ` dari volume kontrak ${formatNumber(data.volumeKontrak)} ${data.unit ?? ""}`
            : ""}{" "}
          · {data.input.length} kali input
        </p>
      </div>

      {data.input.length === 0 ? (
        <Banner
          tone="info"
          title="Item ini belum pernah dilaporkan"
          description="Ada di RAB kontrak, tapi belum ada satu pun laporan harian yang menyebutnya."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted">
              <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                <th className="px-2 py-1.5">Tanggal kerja</th>
                <th className="px-2 py-1.5 text-right">Volume</th>
                <th className="px-2 py-1.5 text-right">Nilai</th>
                <th className="px-2 py-1.5">Diinput</th>
                <th className="px-2 py-1.5">Pelapor</th>
                <th className="px-2 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.input.map((b, i) => {
                /*
                 * TANGGAL KERJA vs KAPAN DIINPUT — justru selisihnya yang
                 * dicari. Baris bertanggal minggu lalu yang baru diketik hari
                 * ini adalah jawaban paling sering dari "kok angkanya segitu",
                 * dan itu tidak terlihat kalau hanya tanggal kerja yang tampil.
                 */
                const selisihHari = Math.round(
                  (b.diinputPada.getTime() - b.tanggal.getTime()) / 86_400_000,
                );
                /* Laporan harian dibuka lewat TANGGAL (`harian/[date]`), bukan
                   id laporannya – itu bentuk rutenya. */
                const kunciTanggal = b.tanggal.toISOString().slice(0, 10);
                return (
                  <tr key={`${b.reportId}-${i}`}>
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/lokasi/${slug}/harian/${kunciTanggal}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {formatTanggal(b.tanggal)}
                      </Link>
                      {b.basis !== "aktif" ? (
                        <span className="block text-[11px] text-warning">draft adendum – di luar angka resmi</span>
                      ) : null}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">{formatNumber(b.volume)}</td>
                    <td className="tabular px-2 py-1.5 text-right text-ink-muted">{formatRupiah(b.nilai)}</td>
                    <td className="px-2 py-1.5 text-ink-muted">
                      {formatTanggal(b.diinputPada)}
                      {selisihHari >= 2 ? (
                        <span className="block text-[11px] text-warning">
                          {selisihHari} hari sesudah tanggal kerjanya
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 text-ink-muted">{b.pelapor ?? "–"}</td>
                    <td className="px-2 py-1.5">
                      <StatusPill tone={REPORT_STATUS_TONE[b.status]} label={REPORT_STATUS_LABEL[b.status]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ButtonLink href={`/lokasi/${slug}/rab/riwayat`} variant="ghost" size="sm">
        <Search aria-hidden className="size-3.5" />
        Cari item lain
      </ButtonLink>
    </div>
  );
}
