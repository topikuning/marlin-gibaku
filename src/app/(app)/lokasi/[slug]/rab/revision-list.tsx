"use client";

import { useState } from "react";
import Link from "next/link";
import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Input, StatusPill, type BadgeTone } from "@/components/ui";
import { hapusRevisiKeliruAction, type HapusRevisiState } from "@/lib/rab/hapus-revisi-actions";
import { formatRupiah, formatTanggal } from "@/lib/format";
import {
  activateDraftAction,
  approveRevisionAction,
  discardDraftAction,
  type RabActionState,
} from "./actions";
import type { RabRevisionSource, RevisionStatus } from "@/generated/prisma/enums";

/**
 * Keadaan empat mata sebuah draft, dilihat dari mata pengguna yang sedang
 * membuka layar (DECISIONS 234).
 *
 * Ada di SINI, bukan hanya di halaman draft adendum, karena di sinilah tombol
 * "Aktifkan" berada. Dilaporkan user 2026-09-12: Program Director menekannya
 * dan hanya mendapat spanduk merah "butuh persetujuan DUA orang" — tanpa satu
 * pun penanda siapa yang sudah menyetujui, dan tanpa jalan untuk menyetujui.
 * Gerbang yang tidak menunjukkan keadaannya membuat orang menekan berulang
 * kali, lalu menyimpulkan sistemnya rusak.
 */
export type PersetujuanRow = {
  lengkap: boolean;
  kurang: string[];
  berlaku: { nama: string; peran: string; waktu: string }[];
  gugur: { nama: string; peran: string }[];
  bolehTtd: boolean;
  sudahTtd: boolean;
};

export type RevisionRow = {
  id: string;
  revisionNo: number;
  source: RabRevisionSource;
  status: RevisionStatus;
  /** Rupiah string (BigInt serialized). */
  totalValue: string;
  createdAt: string;
  note: string | null;
};

const SOURCE_LABEL: Record<RabRevisionSource, string> = {
  hps_awal: "HPS awal",
  adendum: "Adendum",
};

const STATUS_LABEL: Record<RevisionStatus, string> = {
  draft: "Draft",
  aktif: "Aktif",
  digantikan: "Digantikan",
};

const STATUS_TONE: Record<RevisionStatus, BadgeTone> = {
  draft: "warning",
  aktif: "success",
  digantikan: "neutral",
};

function DraftActions({
  revisionId,
  persetujuan,
}: {
  revisionId: string;
  persetujuan: PersetujuanRow | null;
}) {
  const [activateState, activate, activating] = useAksi<RabActionState>(
    activateDraftAction,
    undefined,
  );
  const [discardState, discard, discarding] = useAksi<RabActionState>(
    discardDraftAction,
    undefined,
  );
  const [approveState, approve, approving] = useAksi<RabActionState>(
    approveRevisionAction,
    undefined,
  );
  const state = approveState ?? activateState ?? discardState;
  const terkunci = persetujuan != null && !persetujuan.lengkap;
  return (
    <div className="space-y-1.5">
      {persetujuan ? (
        <div className="rounded-md border border-border bg-surface-muted p-2 text-left text-xs">
          <p className="font-medium">Persetujuan aktivasi (perlu dua orang berbeda)</p>
          {persetujuan.berlaku.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-ink-muted">
              {persetujuan.berlaku.map((p) => (
                <li key={`${p.nama}-${p.waktu}`}>
                  ✓ {p.nama} – {p.peran} · {p.waktu}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-ink-muted">Belum ada yang menyetujui.</p>
          )}
          {persetujuan.kurang.length > 0 ? (
            <p className="mt-1 text-warning">Masih menunggu: {persetujuan.kurang.join(" + ")}.</p>
          ) : (
            <p className="mt-1 text-success">Persetujuan lengkap. Draft siap diaktifkan.</p>
          )}
          {persetujuan.gugur.length > 0 ? (
            <p className="mt-1 text-warning">
              Persetujuan batal karena draft berubah setelah disetujui:{" "}
              {persetujuan.gugur.map((p) => `${p.nama} (${p.peran})`).join(", ")}. Perlu disetujui ulang.
            </p>
          ) : null}
          {persetujuan.bolehTtd ? (
            <form action={approve} className="mt-2">
              <input type="hidden" name="revisionId" value={revisionId} />
              {persetujuan.sudahTtd ? <input type="hidden" name="cabut" value="1" /> : null}
              <Button
                size="sm"
                type="submit"
                variant={persetujuan.sudahTtd ? "secondary" : "primary"}
                loading={approving}
                disabled={activating || discarding}
              >
                {persetujuan.sudahTtd ? "Cabut persetujuan saya" : "Setujui aktivasi"}
              </Button>
            </form>
          ) : (
            <p className="mt-1 text-ink-faint">
              Peran Anda tidak termasuk yang boleh menyetujui aktivasi adendum.
            </p>
          )}
        </div>
      ) : null}
      <div className="flex justify-end gap-1.5">
        <form action={activate}>
          <input type="hidden" name="revisionId" value={revisionId} />
          <Button
            size="sm"
            type="submit"
            loading={activating}
            disabled={discarding || approving || terkunci}
            title={
              terkunci
                ? `Belum bisa diaktifkan. Masih menunggu ${persetujuan!.kurang.join(" + ")}`
                : undefined
            }
          >
            Aktifkan
          </Button>
        </form>
        <form action={discard}>
          <input type="hidden" name="revisionId" value={revisionId} />
          <Button size="sm" variant="danger" type="submit" loading={discarding} disabled={activating}>
            Buang
          </Button>
        </form>
      </div>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
    </div>
  );
}

/** Dampak penghapusan satu revisi keliru – dihitung server, hanya untuk super admin utama (DECISIONS 636). */
export type HapusRevisiView = {
  pengganti: number | null;
  laporanDipindah: number;
  rencanaDipindah: number;
  kurvaS: number;
  pemulihan: { tanggal: string; item: string; sekarang: number; kembaliKe: number }[];
  pemulihanDilewati: number;
  alasanTolak: string[];
};

function HapusRevisi({
  revisionId,
  revisionNo,
  v,
  onBerhasil,
}: {
  revisionId: string;
  revisionNo: number;
  v: HapusRevisiView;
  /** Pesan berhasil dinaikkan ke daftar: baris ini sendiri hilang begitu revisinya terhapus. */
  onBerhasil: (pesan: string) => void;
}) {
  const [buka, setBuka] = useState(false);
  const [ketik, setKetik] = useState("");
  const [state, action, pending] = useAksi<HapusRevisiState>(async (prev: HapusRevisiState, fd: FormData) => {
    const r = await hapusRevisiKeliruAction(prev, fd);
    if (r?.success) onBerhasil(r.success);
    return r;
  }, undefined);
  const wajib = `HAPUS #${revisionNo}`;
  if (!buka) {
    return (
      <Button size="sm" variant="secondary" type="button" onClick={() => setBuka(true)}>
        Hapus (keliru)…
      </Button>
    );
  }
  return (
    <div className="ml-auto max-w-md space-y-2 rounded-md border border-danger-border bg-danger-soft p-3 text-left text-[13px]">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {v.alasanTolak.length > 0 ? (
        <>
          <p className="font-semibold text-ink">Revisi #{revisionNo} belum bisa dihapus:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-ink">
            {v.alasanTolak.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <Button type="button" size="sm" variant="ghost" onClick={() => setBuka(false)}>
            Tutup
          </Button>
        </>
      ) : (
        <>
          <p className="font-semibold text-ink">Hapus permanen revisi #{revisionNo}:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-ink">
            <li>
              {v.laporanDipindah} baris laporan harian
              {v.rencanaDipindah > 0 ? ` + ${v.rencanaDipindah} baris rencana mingguan` : ""} dipindah ke item berkode sama
              di revisi #{v.pengganti} – volumenya tidak berubah
            </li>
            <li>
              {v.pemulihan.length} volume yang dulu dipangkas revisi ini dikembalikan, lalu dicek ulang terhadap RAB aktif
              {v.pemulihanDilewati > 0 ? ` (${v.pemulihanDilewati} dilewati: sudah diubah orang sesudahnya)` : ""}
            </li>
            <li>{v.kurvaS} kurva-S yang dibuat dari revisi ini ikut dihapus</li>
          </ul>
          {v.pemulihan.length > 0 ? (
            <details className="text-ink-muted">
              <summary className="cursor-pointer">Volume yang dikembalikan</summary>
              <ul className="mt-1 space-y-0.5">
                {v.pemulihan.map((p) => (
                  <li key={`${p.tanggal}-${p.item}`} className="tabular">
                    {formatTanggal(new Date(`${p.tanggal}T00:00:00Z`))} · {p.item}: {p.sekarang} → {p.kembaliKe}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <form action={action} className="space-y-2">
            <input type="hidden" name="revisionId" value={revisionId} />
            <label className="block text-ink" htmlFor={`hapus-${revisionId}`}>
              Ketik <span className="font-semibold">{wajib}</span> untuk konfirmasi
            </label>
            <Input
              id={`hapus-${revisionId}`}
              name="konfirmasi"
              autoComplete="off"
              value={ketik}
              onChange={(e) => setKetik(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                variant="danger"
                loading={pending}
                disabled={ketik.trim().toUpperCase() !== wajib}
              >
                Hapus revisi #{revisionNo}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setBuka(false)}>
                Batal
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

export function RevisionList({
  revisions,
  canManage,
  persetujuan = null,
  hapus = {},
  slug,
}: {
  revisions: RevisionRow[];
  /** Untuk tautan backup volume & analisa per revisi (DECISIONS baru 2026-10-07). */
  slug?: string;
  canManage: boolean;
  /** Keadaan empat mata draft yang ada; `null` bila belum ada RAB aktif (HPS awal). */
  persetujuan?: PersetujuanRow | null;
  /** Revisi keliru yang boleh dinilai untuk dihapus – hanya terisi untuk super admin utama. */
  hapus?: Record<string, HapusRevisiView>;
}) {
  const adaAksi = canManage || Object.keys(hapus).length > 0;
  const [pesanHapus, setPesanHapus] = useState<string | null>(null);
  return (
    <div className="space-y-2">
    {pesanHapus ? <Banner tone="success" title={pesanHapus} /> : null}
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
            <th className="py-2 pr-3">No</th>
            <th className="py-2 pr-3">Sumber</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3 text-right">Total (pra-PPN)</th>
            <th className="py-2 pr-3">Tanggal</th>
            <th className="py-2 pr-3">Catatan</th>
            {slug ? <th className="py-2 pr-3">Backup &amp; analisa</th> : null}
            {adaAksi ? <th className="py-2 text-right">Aksi</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {revisions.map((r) => (
            <tr key={r.id}>
              <td className="tabular py-2 pr-3">#{r.revisionNo}</td>
              <td className="py-2 pr-3">{SOURCE_LABEL[r.source]}</td>
              <td className="py-2 pr-3">
                <StatusPill tone={STATUS_TONE[r.status]} label={STATUS_LABEL[r.status]} />
              </td>
              <td className="tabular py-2 pr-3 text-right">{formatRupiah(Number(r.totalValue))}</td>
              <td className="tabular py-2 pr-3">{formatTanggal(new Date(r.createdAt))}</td>
              <td className="max-w-60 truncate py-2 pr-3 text-ink-muted" title={r.note ?? undefined}>
                {r.note ?? "–"}
              </td>
              {slug ? (
                <td className="py-2 pr-3">
                  <Link
                    href={`/lokasi/${slug}/rab/backup-analisa${r.status === "aktif" ? "" : `?rev=${r.id}`}`}
                    className="text-primary hover:underline"
                  >
                    Lihat
                  </Link>
                </td>
              ) : null}
              {adaAksi ? (
                <td className="py-2 text-right align-top">
                  {canManage && r.status === "draft" ? (
                    <DraftActions revisionId={r.id} persetujuan={persetujuan} />
                  ) : null}
                  {hapus[r.id] ? (
                    <HapusRevisi revisionId={r.id} revisionNo={r.revisionNo} v={hapus[r.id]} onBerhasil={setPesanHapus} />
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}
