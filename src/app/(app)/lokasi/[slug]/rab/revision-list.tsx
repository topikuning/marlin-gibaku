"use client";

import { useAksi } from "@/lib/aksi-klien";


import { Banner, Button, StatusPill, type BadgeTone } from "@/components/ui";
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
            <p className="mt-1 text-success">Lengkap – draft siap diaktifkan.</p>
          )}
          {persetujuan.gugur.length > 0 ? (
            <p className="mt-1 text-warning">
              Gugur karena draft berubah setelah disetujui:{" "}
              {persetujuan.gugur.map((p) => `${p.nama} (${p.peran})`).join(", ")} – perlu menyetujui ulang.
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
              Peran Anda tidak berhak menandatangani aktivasi adendum.
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
                ? `Terkunci – masih menunggu ${persetujuan!.kurang.join(" + ")}`
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

export function RevisionList({
  revisions,
  canManage,
  persetujuan = null,
}: {
  revisions: RevisionRow[];
  canManage: boolean;
  /** Keadaan empat mata draft yang ada; `null` bila belum ada RAB aktif (HPS awal). */
  persetujuan?: PersetujuanRow | null;
}) {
  return (
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
            {canManage ? <th className="py-2 text-right">Aksi</th> : null}
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
              {canManage ? (
                <td className="py-2 text-right align-top">
                  {r.status === "draft" ? (
                    <DraftActions revisionId={r.id} persetujuan={persetujuan} />
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
