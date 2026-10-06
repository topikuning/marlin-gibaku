"use client";

import Link from "next/link";
import { Banner, Button, StatusPill } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { RincianBerkasRingkas } from "@/components/knmp/rincian-berkas-ringkas";
import { useAksi } from "@/lib/aksi-klien";
import { formatTanggalWaktu } from "@/lib/format";
import type { RingkasanRincian } from "@/lib/rab/rincian/baca";
import {
  lengkapiRevisiAction,
  lengkapiSemuaSiapAction,
  periksaRevisiAction,
  periksaSemuaAction,
  type RincianActionState,
} from "@/lib/rab/rincian/actions";

export type BarisRincian = {
  id: string;
  lokasi: string;
  slug: string;
  revisionNo: number;
  status: "draft" | "aktif" | "digantikan";
  sumber: string;
  dibuat: string;
  berkas: string | null;
  item: number;
  tersimpan: { asal: string; pada: string; ringkasan: RingkasanRincian } | null;
  periksa: {
    status: string;
    pesan: string | null;
    itemRevisi: number;
    itemCocok: number;
    ringkasan: RingkasanRincian | null;
    tersembunyiDibaca: string[];
    pada: string;
  } | null;
};

const STATUS_PERIKSA: Record<string, { label: string; tone: BadgeTone }> = {
  siap: { label: "Siap disimpan", tone: "success" },
  sebagian: { label: "Sebagian cocok", tone: "warning" },
  tanpa_berkas: { label: "Tanpa berkas", tone: "neutral" },
  berkas_hilang: { label: "Berkas tidak terambil", tone: "danger" },
  template_adendum: { label: "Template adendum", tone: "neutral" },
  perlu_pilihan: { label: "Perlu pilih kolom", tone: "warning" },
  tidak_cocok: { label: "Tidak cocok", tone: "danger" },
  gagal: { label: "Gagal dibaca", tone: "danger" },
};

const STATUS_REVISI: Record<BarisRincian["status"], { label: string; tone: BadgeTone }> = {
  aktif: { label: "Aktif", tone: "success" },
  draft: { label: "Draft", tone: "info" },
  digantikan: { label: "Digantikan", tone: "neutral" },
};

export function AksiMassal({
  berjalan,
  terakhir,
  adaSiap,
  adaBelum,
}: {
  berjalan: { jenis: "periksa" | "lengkapi"; selesai: number; total: number } | null;
  terakhir: { jenis: "periksa" | "lengkapi"; selesai: string; diproses: number; gagal: number } | null;
  adaSiap: boolean;
  adaBelum: boolean;
}) {
  const [sPeriksa, aksiPeriksa, pPeriksa] = useAksi<RincianActionState>(periksaSemuaAction, undefined);
  const [sLengkapi, aksiLengkapi, pLengkapi] = useAksi<RincianActionState>(lengkapiSemuaSiapAction, undefined);
  const pesan = sLengkapi ?? sPeriksa;
  return (
    <div className="space-y-2">
      {pesan?.error ? <Banner tone="error" title={pesan.error} /> : null}
      {pesan?.success ? <Banner tone="success" title={pesan.success} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <form action={aksiPeriksa}>
          <Button type="submit" size="sm" loading={pPeriksa} disabled={!!berjalan || !adaBelum}>
            Periksa yang belum diperiksa
          </Button>
        </form>
        <form action={aksiPeriksa}>
          <input type="hidden" name="ulang" value="1" />
          <Button type="submit" size="sm" variant="secondary" loading={pPeriksa} disabled={!!berjalan}>
            Periksa ulang semua
          </Button>
        </form>
        <form action={aksiLengkapi}>
          <Button type="submit" size="sm" variant="secondary" loading={pLengkapi} disabled={!!berjalan || !adaSiap}>
            Simpan semua yang siap
          </Button>
        </form>
      </div>
      <p className="text-xs text-ink-muted">
        {berjalan
          ? `Sedang ${berjalan.jenis === "periksa" ? "memeriksa" : "menyimpan"}: ${berjalan.selesai} dari ${berjalan.total} revisi. Muat ulang halaman untuk melihat kemajuannya.`
          : terakhir
            ? `Putaran ${terakhir.jenis === "periksa" ? "periksa" : "simpan"} terakhir selesai ${formatTanggalWaktu(new Date(terakhir.selesai))}: ${terakhir.diproses} revisi${terakhir.gagal > 0 ? `, ${terakhir.gagal} gagal` : ""}.`
            : "Pemeriksaan berjalan di latar, satu revisi demi satu. Satu berkas butuh beberapa detik."}
      </p>
    </div>
  );
}

function AksiBaris({ b }: { b: BarisRincian }) {
  const [sP, aksiP, pP] = useAksi<RincianActionState>(periksaRevisiAction, undefined);
  const [sL, aksiL, pL] = useAksi<RincianActionState>(lengkapiRevisiAction, undefined);
  const bisaSimpan = b.periksa?.status === "siap" || b.periksa?.status === "sebagian";
  const pesan = sL ?? sP;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        <form action={aksiP}>
          <input type="hidden" name="revisionId" value={b.id} />
          <Button type="submit" size="sm" variant="secondary" loading={pP} disabled={!b.berkas}>
            Periksa
          </Button>
        </form>
        <form action={aksiL}>
          <input type="hidden" name="revisionId" value={b.id} />
          <Button type="submit" size="sm" variant="secondary" loading={pL} disabled={!bisaSimpan}>
            {b.tersimpan ? "Simpan ulang" : "Simpan"}
          </Button>
        </form>
      </div>
      {pesan?.error ? <p className="text-xs text-danger">{pesan.error}</p> : null}
      {pesan?.success ? <p className="text-xs text-success">{pesan.success}</p> : null}
    </div>
  );
}

export function TabelRincian({ baris }: { baris: BarisRincian[] }) {
  if (baris.length === 0) return <p className="text-sm text-ink-muted">Belum ada revisi RAB.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
            <th className="py-2 pr-3">Lokasi · revisi</th>
            <th className="py-2 pr-3">Berkas sumber</th>
            <th className="py-2 pr-3">Hasil periksa</th>
            <th className="py-2 pr-3">Tersimpan</th>
            <th className="py-2">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border align-top">
          {baris.map((b) => {
            const sp = b.periksa ? (STATUS_PERIKSA[b.periksa.status] ?? { label: b.periksa.status, tone: "neutral" as const }) : null;
            const sr = STATUS_REVISI[b.status];
            return (
              <tr key={b.id}>
                <td className="py-2 pr-3">
                  <Link href={`/lokasi/${b.slug}/rab`} className="font-medium text-primary hover:underline">
                    {b.lokasi}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                    <span>Revisi #{b.revisionNo}</span>
                    <StatusPill tone={sr.tone} label={sr.label} />
                    <span>{b.item} item</span>
                  </div>
                </td>
                <td className="max-w-56 py-2 pr-3 text-xs">
                  {b.berkas ? <span className="break-all">{b.berkas}</span> : <span className="text-ink-muted">Tidak ada</span>}
                </td>
                <td className="py-2 pr-3">
                  {b.periksa && sp ? (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill tone={sp.tone} label={sp.label} />
                        {b.periksa.ringkasan ? (
                          <span className="text-xs text-ink-muted">
                            {b.periksa.itemCocok}/{b.periksa.itemRevisi} item berpasangan · backup{" "}
                            {b.periksa.ringkasan.volumeTertaut} · analisa{" "}
                            {b.periksa.ringkasan.analisaRumus + b.periksa.ringkasan.analisaCocokHarga}
                          </span>
                        ) : null}
                      </div>
                      {b.periksa.pesan ? <p className="text-xs text-ink-muted">{b.periksa.pesan}</p> : null}
                      {b.periksa.ringkasan ? (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-primary">Rincian hasil periksa</summary>
                          <div className="mt-1">
                            <RincianBerkasRingkas r={b.periksa.ringkasan} tersembunyiDibaca={b.periksa.tersembunyiDibaca} />
                          </div>
                        </details>
                      ) : null}
                      <p className="text-[11px] text-ink-faint">Diperiksa {formatTanggalWaktu(new Date(b.periksa.pada))}</p>
                    </div>
                  ) : (
                    <span className="text-xs text-ink-muted">Belum diperiksa</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs">
                  {b.tersimpan ? (
                    <span>
                      {b.tersimpan.asal === "impor" ? "Saat impor" : "Dari arsip"},{" "}
                      {formatTanggalWaktu(new Date(b.tersimpan.pada))}
                      <span className="block text-ink-muted">
                        backup {b.tersimpan.ringkasan.volumeTertaut} · analisa{" "}
                        {b.tersimpan.ringkasan.analisaRumus + b.tersimpan.ringkasan.analisaCocokHarga}
                      </span>
                    </span>
                  ) : (
                    <span className="text-ink-muted">Belum</span>
                  )}
                </td>
                <td className="py-2">
                  <AksiBaris b={b} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
