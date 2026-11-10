"use client";

import { useState } from "react";
import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Card, CardBody, CardHeader, Combobox } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { lepasPadananDraftAction, pasangkanItemDraftAction, type PadananActionState } from "./padanan-actions";

/**
 * PEMETAAN ITEM TERLAPOR KE ITEM DRAFT (DECISIONS 754).
 *
 * Permintaan user 2026-11-10: *"intinya sebelum aktif item yang sudah
 * terlaporkan, harus bisa dipetakan dengan pekerjaan yang ada di draft
 * adendum"*. Sampai sini pemetaan hanya ada di layar pratinjau impor.
 *
 * Tiap baris punya formulir dan status prosesnya sendiri: menekan satu
 * tombol tidak boleh membuat seluruh daftar berputar (pelajaran DECISIONS 751).
 */

export type BelumDipetakanView = {
  lineageKey: string;
  /** `dinolkan` = masih ada di draft dengan volume 0 (DECISIONS 756). */
  sebab: "hilang" | "dinolkan";
  jalur: string;
  name: string;
  unit: string | null;
  realisasi: number;
  jumlahLaporan: number;
  pertama: string | null;
  terakhir: string | null;
  calon: { nodeId: string; label: string }[];
};

export type SudahDipasangkanView = {
  nodeId: string;
  jalur: string;
  name: string;
  namaLama: string;
  unit: string | null;
  volume: number | null;
  realisasi: number;
};

export function PanelPadananDraft({
  slug,
  revisionId,
  belum,
  sudah,
}: {
  slug: string;
  revisionId: string;
  belum: BelumDipetakanView[];
  sudah: SudahDipasangkanView[];
}) {
  if (belum.length === 0 && sudah.length === 0) return null;
  const nHilang = belum.filter((b) => b.sebab === "hilang").length;
  const nNol = belum.length - nHilang;
  const rincian = [nHilang > 0 ? `${nHilang} tidak ada lagi di draft` : null, nNol > 0 ? `${nNol} volumenya 0 di draft` : null]
    .filter(Boolean)
    .join(", ");
  const akibat = [
    nHilang > 0 ? "yang tidak ada lagi di draft, realisasinya tidak dihitung di progres" : null,
    nNol > 0 ? "yang volumenya 0, laporan hariannya diturunkan menjadi 0" : null,
  ]
    .filter(Boolean)
    .join("; ");
  return (
    <Card id="pemetaan">
      <CardHeader
        title="Pekerjaan yang sudah dilaporkan tapi tidak ada atau dinolkan di draft ini"
        subtitle={
          belum.length > 0
            ? `${belum.length} item kontrak sudah punya laporan harian (${rincian}). Kalau pekerjaannya pindah ke item lain di draft (ganti nama, dipecah, atau pindah kelompok), pasangkan di sini sebelum diaktifkan. Laporan dan fotonya ikut ke item draft itu, tanpa ada laporan yang diubah. Kalau tidak dipasangkan, sesudah aktivasi ${akibat}.`
            : "Semua item yang sudah dilaporkan sudah ada di draft atau sudah dipasangkan."
        }
      />
      <CardBody className="space-y-4">
        {belum.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {belum.map((b) => (
              <BarisBelum key={b.lineageKey} slug={slug} revisionId={revisionId} b={b} />
            ))}
          </ul>
        ) : null}
        {sudah.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-ink">Sudah dipasangkan di draft ini</p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {sudah.map((s) => (
                <BarisSudah key={s.nodeId} slug={slug} revisionId={revisionId} s={s} />
              ))}
            </ul>
            <p className="text-xs text-ink-muted">
              Item draft yang sudah dipasangkan diperlakukan seperti item kontrak lama: nama, satuan, dan harga satuannya
              terkunci. Lepas pasangannya dulu kalau perlu mengubahnya.
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

const sat = (u: string | null) => (u ? ` ${u}` : "");

function BarisBelum({ slug, revisionId, b }: { slug: string; revisionId: string; b: BelumDipetakanView }) {
  const [pilih, setPilih] = useState("");
  const [state, action, pending] = useAksi<PadananActionState>(pasangkanItemDraftAction, undefined);
  return (
    <li className="space-y-2 px-3 py-3 text-[13px]">
      <div>
        {b.jalur ? <span className="block text-xs text-ink-muted">{b.jalur}</span> : null}
        <span className="font-medium text-ink">{b.name}</span>{" "}
        <span className="text-ink-muted">
          {b.sebab === "dinolkan" ? "– volumenya 0 di draft, " : "– "}sudah dilaporkan {formatNumber(b.realisasi)}
          {sat(b.unit)} di {b.jumlahLaporan} laporan
          {b.pertama ? ` (${b.pertama === b.terakhir ? b.pertama : `${b.pertama} – ${b.terakhir}`})` : ""}
        </span>
      </div>
      {b.calon.length > 0 ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="revisionId" value={revisionId} />
          <input type="hidden" name="lineageLama" value={b.lineageKey} />
          <input type="hidden" name="nodeIdDraft" value={pilih} />
          <div className="min-w-64 flex-1">
            <Combobox
              value={pilih}
              onChange={setPilih}
              options={b.calon.map((c) => ({ value: c.nodeId, label: c.label }))}
              placeholder="Pilih item draft pasangannya…"
              disabled={pending}
            />
          </div>
          <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={!pilih}>
            Pasangkan
          </Button>
        </form>
      ) : (
        <p className="text-xs text-warning">
          Belum ada item baru di draft dengan kategori dan satuan yang sama. Tambahkan dulu itemnya di editor di bawah,
          lalu pasangkan di sini.
        </p>
      )}
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
    </li>
  );
}

function BarisSudah({ slug, revisionId, s }: { slug: string; revisionId: string; s: SudahDipasangkanView }) {
  const [state, action, pending] = useAksi<PadananActionState>(lepasPadananDraftAction, undefined);
  const kurang = s.volume != null && s.volume + 1e-6 < s.realisasi;
  return (
    <li className="space-y-1.5 px-3 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {s.jalur ? <span className="block text-xs text-ink-muted">{s.jalur}</span> : null}
          <span className="font-medium text-ink">{s.name}</span>{" "}
          <span className="text-ink-muted">
            ← {s.namaLama}, sudah dilaporkan {formatNumber(s.realisasi)}
            {sat(s.unit)}
          </span>
        </div>
        <form action={action}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="revisionId" value={revisionId} />
          <input type="hidden" name="nodeIdDraft" value={s.nodeId} />
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            Lepas
          </Button>
        </form>
      </div>
      {kurang ? (
        <p className="text-xs text-warning">
          Volume draft {formatNumber(s.volume!)}
          {sat(s.unit)} di bawah yang sudah dilaporkan. Kelebihannya {formatNumber(s.realisasi - s.volume!)}
          {sat(s.unit)} diturunkan saat aktivasi, dan disebut di layar.
        </p>
      ) : null}
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
    </li>
  );
}
