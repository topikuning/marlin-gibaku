"use client";

import { useState, useTransition } from "react";
import { Banner, Button, Input, Label, StatusPill } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import {
  jalankanPindahBerkasAction,
  setLenovoLangsungAction,
  setPindahBerkasAction,
  type PindahBerkasState,
} from "@/lib/system/actions";

/**
 * PEMINDAHAN BERKAS R2 → LENOVO (DECISIONS 645).
 *
 * Pertanyaan pertama orang dijawab paling atas: R2 sekarang berapa, dari batas
 * berapa. Rinciannya – apa saja yang sudah di Lenovo – di bawahnya.
 */
export function PindahBerkasPanel({
  aktif,
  batasGb,
  umurHari,
  terkonfigurasi,
  ukuranR2,
  perKategori,
  gagalTerus,
  galatTerakhir,
  latar,
  langsung,
}: {
  aktif: boolean;
  batasGb: number;
  umurHari: number;
  terkonfigurasi: boolean;
  ukuranR2: { bytes: number; pada: string } | null;
  perKategori: { kategori: string; label: string; berkas: number; bytes: number }[];
  gagalTerus: number;
  galatTerakhir: string | null;
  /** Lenovo melayani peramban langsung (DECISIONS 768). */
  langsung: boolean;
  latar: {
    berjalanSejak: string | null;
    terakhir: { selesai: string; dipindah: number; bytesDipindah: number; gagal: number; galat: string[]; alasan: string } | null;
  };
}) {
  const [state, aksi, pending] = useAksi<PindahBerkasState>(setPindahBerkasAction, undefined);
  const [pesanJalan, setPesanJalan] = useState<string | null>(null);
  const [jalan, mulai] = useTransition();
  const batasBytes = batasGb * 1_000_000_000;
  const diAtas = ukuranR2 ? ukuranR2.bytes > batasBytes : false;
  const totalLenovo = perKategori.reduce((t, k) => t + k.bytes, 0);
  const berkasLenovo = perKategori.reduce((t, k) => t + k.berkas, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Foto, dokumen, surat, dan lampiran yang sudah lebih dari {umurHari} hari dipindah ke server Lenovo,
        mulai dari yang paling lama. Semua link tetap sama dan tetap bisa dibuka seperti biasa, hanya
        sedikit lebih lambat. Logo, kop, stempel, tanda tangan, dan gambar kecil pratinjau tetap di R2.
      </p>

      {!terkonfigurasi ? (
        <Banner
          tone="info"
          title="Server Lenovo belum disambungkan"
          description="Pemindahan memakai sambungan yang sama dengan arsip berkas asli foto (ORIGINAL_ARCHIVE_URL dan ORIGINAL_ARCHIVE_TOKEN di Railway). Selama belum diisi, tidak ada berkas yang dipindah."
        />
      ) : null}

      <div className="flex flex-wrap gap-4 text-sm">
        <Angka
          label="R2 terpakai"
          nilai={ukuranR2 ? ukuran(ukuranR2.bytes) : "–"}
          sub={
            ukuranR2
              ? `batas ${batasGb} GB · diukur ${new Date(ukuranR2.pada).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`
              : `batas ${batasGb} GB · belum pernah diukur`
          }
          tone={diAtas ? "danger" : ukuranR2 ? "success" : undefined}
        />
        <Angka
          label="Sudah di Lenovo"
          nilai={ukuran(totalLenovo)}
          sub={`${berkasLenovo.toLocaleString("id-ID")} berkas`}
          tone={berkasLenovo > 0 ? "success" : undefined}
        />
        {gagalTerus > 0 ? (
          <Angka label="Gagal dipindah" nilai={String(gagalTerus)} sub="tetap aman di R2" tone="danger" />
        ) : null}
      </div>

      {perKategori.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-ink-muted">
          {perKategori.map((k) => (
            <li key={k.kategori}>
              {k.label}: <span className="tabular-nums text-ink">{k.berkas.toLocaleString("id-ID")}</span> berkas ·{" "}
              <span className="tabular-nums text-ink">{ukuran(k.bytes)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {diAtas && ukuranR2 ? (
        <Banner
          tone="warning"
          title={`R2 sudah melewati ${batasGb} GB`}
          description={`Selama pemindahan aktif, berkas yang umurnya 3 hari ke atas ikut dipindah sampai R2 turun di bawah ${(batasGb * 0.9).toLocaleString("id-ID")} GB. Kalau masih di atas, sisanya berkas yang masih terlalu baru atau lebih besar dari 30 MB.`}
        />
      ) : null}
      {gagalTerus > 0 && galatTerakhir ? (
        <Banner
          tone="warning"
          title={`${gagalTerus} berkas gagal dipindah`}
          description={`Penyebab terakhir: ${galatTerakhir}. Berkasnya tetap aman di R2 dan akan dicoba lagi otomatis 6 jam kemudian.`}
        />
      ) : null}

      {state?.error ? <Banner tone="error" title="Gagal menyimpan" description={state.error} /> : null}
      {state?.success ? <Banner tone="success" title="Tersimpan" description={state.success} /> : null}
      {pesanJalan ? <Banner tone="info" title="Pemindahan berkas" description={pesanJalan} /> : null}

      <form action={aksi} className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="aktif" defaultChecked={aktif} className="size-4" />
          <span>Aktifkan pemindahan</span>
        </label>
        <div>
          <Label htmlFor="batasGb">Batas R2 (GB)</Label>
          <Input id="batasGb" name="batasGb" type="number" min={1} max={1000} step="0.5" defaultValue={batasGb} className="w-28" />
        </div>
        <div>
          <Label htmlFor="umurHari">Pindahkan setelah (hari)</Label>
          <Input id="umurHari" name="umurHari" type="number" min={3} max={3650} defaultValue={umurHari} className="w-28" />
        </div>
        <Button type="submit" loading={pending} variant="secondary">
          Simpan
        </Button>
        <StatusPill tone={aktif ? "success" : "neutral"} label={aktif ? "Aktif" : "Mati"} />
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          loading={jalan}
          onClick={() =>
            mulai(async () => {
              const r = await jalankanPindahBerkasAction();
              setPesanJalan(r?.success ?? r?.error ?? null);
            })
          }
        >
          {latar.berjalanSejak ? "Sedang berjalan" : "Jalankan pemindahan sekarang"}
        </Button>
        {latar.berjalanSejak ? (
          <StatusPill
            tone="info"
            label={`Berjalan sejak ${new Date(latar.berjalanSejak).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })}`}
          />
        ) : latar.terakhir ? (
          <span className="text-xs text-ink-muted">
            {latar.terakhir.alasan === "lenovo-hampir-penuh"
              ? "Pemindahan terakhir berhenti: sisa disk Lenovo di bawah 20 GB."
              : `Pemindahan terakhir: ${latar.terakhir.dipindah} berkas (${ukuran(latar.terakhir.bytesDipindah)}) dipindah`}
            {latar.terakhir.gagal > 0 ? ` · ${latar.terakhir.gagal} gagal (${latar.terakhir.galat.join("; ")})` : ""}
          </span>
        ) : null}
      </div>

      <p className="text-xs text-ink-muted">
        Berjalan otomatis tiap jam. Kalau server Lenovo mati atau internet rumah putus, berkas yang sudah
        dipindah tidak bisa dibuka sampai tersambung lagi. Berkas baru tidak terpengaruh.
      </p>

      {terkonfigurasi ? <LenovoLangsung aktif={langsung} /> : null}
    </div>
  );
}

/**
 * Sakelar Lenovo melayani peramban langsung (DECISIONS 768). Menyalakan selalu
 * diuji dulu di server; pesan galatnya menyebut apa yang belum beres di Lenovo.
 */
function LenovoLangsung({ aktif }: { aktif: boolean }) {
  const [state, aksi, pending] = useAksi<PindahBerkasState>(setLenovoLangsungAction, undefined);
  return (
    <div className="space-y-2 border-t border-border pt-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div
        className={
          aktif
            ? "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-success-border bg-success-soft px-4 py-3"
            : "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3"
        }
      >
        <div className="min-w-0 flex-1 basis-56 text-sm">
          <p className="font-medium text-ink">Foto lama dibuka langsung dari Lenovo: {aktif ? "NYALA" : "MATI"}</p>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {aktif
              ? "Foto lama diambil langsung dari Lenovo, tidak lewat Railway."
              : "Foto lama masih dikirim lewat MARLIN dan memakai kuota data Railway."}
          </p>
        </div>
        <form action={aksi} className="shrink-0">
          <input type="hidden" name="aktif" value={aktif ? "0" : "1"} />
          <Button type="submit" variant="secondary" size="sm" loading={pending}>
            {aktif ? "Matikan" : "Uji & nyalakan"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function ukuran(b: number): string {
  if (b >= 1_000_000_000) return `${(b / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} GB`;
  if (b >= 1_000_000) return `${(b / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
  return `${Math.round(b / 1000).toLocaleString("id-ID")} KB`;
}

function Angka({ label, nilai, sub, tone }: { label: string; nilai: string; sub: string; tone?: "danger" | "success" }) {
  return (
    <div className="rounded border border-border px-3 py-2">
      <p className="text-xs uppercase text-ink-muted">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-ink"
        }`}
      >
        {nilai}
      </p>
      <p className="text-xs text-ink-muted">{sub}</p>
    </div>
  );
}
