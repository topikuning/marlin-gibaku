"use client";

import { useState, useTransition } from "react";
import { Banner, Button, Input, Label, StatusPill } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import {
  jalankanArsipAsliAction,
  setArsipAsliAction,
  type ArsipAsliState,
} from "@/lib/system/actions";
import type { RingkasArsip } from "@/lib/arsip-asli/antrean";

/**
 * ARSIP DINGIN BERKAS ASLI — seluruh kendalinya di satu kartu.
 *
 * Foto ber-cap dan thumbnail yang dilihat orang sehari-hari TIDAK ikut pindah:
 * keduanya tetap di R2. Yang dipindahkan hanya berkas asli — besar, nyaris tak
 * pernah dibuka, dan hanya diperlukan saat cap diperbaiki atau keaslian foto
 * dipersoalkan.
 *
 * Yang sengaja ditampilkan apa adanya: berapa yang masih menunggu beserta
 * ukurannya, berapa yang sedang dalam masa tenggang (ada di dua tempat), dan
 * berapa yang berhenti dicoba karena gagal terus. Angka terakhir itu yang paling
 * mudah disembunyikan dan paling perlu dilihat.
 */
export function ArsipAsliPanel({
  aktif,
  tenggang,
  terkonfigurasi,
  ringkas,
}: {
  aktif: boolean;
  tenggang: number;
  /** ORIGINAL_ARCHIVE_URL + _TOKEN sudah diisi di lingkungan ini? */
  terkonfigurasi: boolean;
  ringkas: RingkasArsip;
}) {
  const [state, aksi, pending] = useAksi<ArsipAsliState>(setArsipAsliAction, undefined);
  const [pesanJalan, setPesanJalan] = useState<string | null>(null);
  const [jalan, mulai] = useTransition();

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Memindahkan <span className="font-medium text-ink">berkas asli</span> foto ke penyimpanan sendiri.
        Foto ber-cap dan thumbnail tetap di R2 – yang dilihat orang sehari-hari tidak berubah sama sekali.
      </p>

      {!terkonfigurasi ? (
        <Banner
          tone="info"
          title="Alamat arsip belum diisi"
          description="Isi ORIGINAL_ARCHIVE_URL dan ORIGINAL_ARCHIVE_TOKEN di Railway (plus sepasang CF Access bila mesinnya di balik Cloudflare Access). Sakelar di bawah tetap bisa disimpan, tapi tidak ada yang dipindahkan sampai alamatnya ada."
        />
      ) : null}

      <div className="flex flex-wrap gap-4 text-sm">
        <Angka label="Menunggu dipindahkan" nilai={String(ringkas.menunggu)} sub={ukuran(ringkas.bytesMenunggu)} />
        <Angka
          label="Masa tenggang"
          nilai={String(ringkas.masaTenggang)}
          sub="ada di arsip DAN di R2"
        />
        <Angka label="Selesai pindah" nilai={String(ringkas.terarsip)} sub="salinan R2 sudah dibuang" />
        {ringkas.gagalTerus > 0 ? (
          <Angka label="Berhenti dicoba" nilai={String(ringkas.gagalTerus)} sub="gagal berulang" tone="danger" />
        ) : null}
      </div>

      {ringkas.gagalTerus > 0 && ringkas.galatTerakhir ? (
        <Banner
          tone="warning"
          title={`${ringkas.gagalTerus} berkas berhenti dicoba`}
          description={`Sebab terakhir: ${ringkas.galatTerakhir}. Berkasnya tetap aman di R2 – yang berhenti hanya pemindahannya, supaya satu berkas bermasalah tidak menyumbat antrean.`}
        />
      ) : null}

      {state?.error ? <Banner tone="error" title="Gagal menyimpan" description={state.error} /> : null}
      {state?.success ? <Banner tone="success" title="Tersimpan" description={state.success} /> : null}
      {pesanJalan ? <Banner tone="info" title="Putaran arsip" description={pesanJalan} /> : null}

      <form action={aksi} className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="aktif" defaultChecked={aktif} className="size-4" />
          <span>Aktifkan pemindahan</span>
        </label>
        <div>
          <Label htmlFor="tenggang">Masa tenggang (hari)</Label>
          <Input id="tenggang" name="tenggang" type="number" min={0} max={365} defaultValue={tenggang} className="w-28" />
        </div>
        <Button type="submit" loading={pending} variant="secondary">
          Simpan
        </Button>
        <StatusPill tone={aktif ? "success" : "neutral"} label={aktif ? "Aktif" : "Mati"} />
      </form>

      <p className="text-xs text-ink-muted">
        Selama masa tenggang berkasnya ada di dua tempat sekaligus – itu jaring pengaman kalau arsipnya
        ternyata bermasalah. Karena itu pemakaian R2 baru mulai turun setelah tenggangnya lewat, bukan
        seketika. Isi 0 kalau ingin salinan R2 dibuang segera.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          loading={jalan}
          onClick={() =>
            mulai(async () => {
              const r = await jalankanArsipAsliAction();
              setPesanJalan(r?.success ?? r?.error ?? null);
            })
          }
        >
          Jalankan satu putaran sekarang
        </Button>
        {ringkas.terakhirBerhasil ? (
          <span className="text-xs text-ink-muted">
            Terakhir berhasil: {new Date(ringkas.terakhirBerhasil).toLocaleString("id-ID")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Angka({
  label,
  nilai,
  sub,
  tone,
}: {
  label: string;
  nilai: string;
  sub: string;
  tone?: "danger";
}) {
  return (
    <div className="rounded border border-border px-3 py-2">
      <p className="text-xs uppercase text-ink-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-danger" : "text-ink"}`}>
        {nilai}
      </p>
      <p className="text-xs text-ink-muted">{sub}</p>
    </div>
  );
}

function ukuran(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}
