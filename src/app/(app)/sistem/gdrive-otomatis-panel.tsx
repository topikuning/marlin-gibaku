"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { CloudUpload, CloudOff, AlertTriangle } from "lucide-react";
import { Banner, Button, ConfirmSubmit } from "@/components/ui";
import {
  jalankanAntreanDriveAction,
  setGDriveOtomatisAktifAction,
  ulangiAntreanDriveAction,
  type GDriveActionState,
} from "@/lib/gdrive/actions";
import type { RingkasAntrean } from "@/lib/gdrive/antrean";

/**
 * SAKELAR + keadaan antrean unggah otomatis ke Drive KKP (DECISIONS 313).
 *
 * Angka antrean ditampilkan apa adanya, termasuk yang MENYERAH. Unggahan yang
 * gagal diam-diam adalah kegagalan paling berbahaya di fitur ini: semua orang
 * mengira laporan sudah ada di folder pemberi kerja, padahal tidak — dan tidak
 * ada satu pun layar yang akan memberi tahu. Karena itu yang macet punya
 * tempatnya sendiri di sini, beserta penyebabnya.
 */
export function GDriveOtomatisPanel({
  aktif,
  terhubung,
  antrean,
}: {
  aktif: boolean;
  terhubung: boolean;
  antrean: RingkasAntrean;
}) {
  const [state, aksi] = useActionState<GDriveActionState, FormData>(
    setGDriveOtomatisAktifAction,
    undefined,
  );
  const [opMsg, setOpMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, startOp] = useTransition();

  const runOp = (op: () => Promise<GDriveActionState>) => {
    setOpMsg(null);
    startOp(async () => {
      const r = await op();
      if (r?.error) setOpMsg({ tone: "error", text: r.error });
      else if (r?.success) setOpMsg({ tone: "success", text: r.success });
    });
  };

  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {opMsg ? <Banner tone={opMsg.tone} title={opMsg.text} /> : null}

      <div
        className={
          aktif
            ? "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-success-border bg-success-soft px-4 py-3"
            : "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-warning-border bg-warning-soft px-4 py-3"
        }
      >
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {aktif ? (
            <CloudUpload aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          )}
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink">
              Unggah otomatis ke Drive KKP: {aktif ? "NYALA" : "MATI"}
            </p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {aktif
                ? "Laporan harian yang difinalisasi naik sendiri (PDF blanko KKP + fotonya), begitu juga laporan mingguan tiap lokasi setelah minggu kontraknya tuntas. Dicicil dengan jeda – bukan diguyur – supaya akun Google tidak diblok."
                : "Penjadwal tidak menaikkan apa pun. Tombol unggah manual di papan status harian & halaman laporan lokasi TETAP bekerja."}
            </p>
          </div>
        </div>
        <form action={aksi} className="shrink-0">
          <input type="hidden" name="aktif" value={aktif ? "0" : "1"} />
          <TombolSakelar aktif={aktif} />
        </form>
      </div>

      {aktif && !terhubung ? (
        <Banner
          tone="warning"
          title="Akun Google belum terhubung"
          description="Sakelarnya nyala tapi tidak ada yang bisa naik. Hubungkan akun di kartu Google Drive di atas – antrean tidak dihanguskan, ia menunggu."
        />
      ) : null}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Angka label="Menunggu" nilai={antrean.menunggu} />
        <Angka label="Sudah naik" nilai={antrean.sukses} />
        <Angka label="Macet" nilai={antrean.menyerah} tone={antrean.menyerah > 0 ? "danger" : undefined} />
        <Angka label="Batal" nilai={antrean.batal} />
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() => runOp(jalankanAntreanDriveAction)}
        >
          Jalankan satu putaran sekarang
        </Button>
        {antrean.menyerah > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => runOp(ulangiAntreanDriveAction)}
          >
            Coba lagi yang macet ({antrean.menyerah})
          </Button>
        ) : null}
      </div>

      {antrean.macet.length > 0 ? (
        <div className="rounded-lg border border-danger-border bg-danger-soft px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <AlertTriangle aria-hidden className="size-4 shrink-0 text-danger" />
            Berhenti dicoba – perlu diperiksa
          </p>
          <ul className="mt-2 space-y-1.5 text-[13px] text-ink-muted">
            {antrean.macet.map((m, i) => (
              <li key={`${m.lokasi}-${m.kind}-${m.periode}-${i}`}>
                <span className="font-medium text-ink">{m.lokasi}</span>{" "}
                {m.kind === "laporan_harian" ? `harian ${m.periode}` : `mingguan ke-${m.periode}`} –{" "}
                {m.error ?? "penyebab tidak tercatat"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Angka({
  label,
  nilai,
  tone,
}: {
  label: string;
  nilai: number;
  tone?: "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-inset px-3 py-2">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={tone === "danger" ? "text-lg font-semibold text-danger" : "text-lg font-semibold text-ink"}>
        {nilai}
      </dd>
    </div>
  );
}

function TombolSakelar({ aktif }: { aktif: boolean }) {
  const { pending } = useFormStatus();
  // Yang dikonfirmasi adalah MENYALAKAN, sama seperti laporan mingguan WA:
  // folder tujuannya milik pemberi kerja, dan berkas yang sudah mendarat di
  // sana tidak bisa ditarik diam-diam. Mematikannya cuma membuat MARLIN diam.
  if (!aktif) {
    return (
      <ConfirmSubmit
        label="Nyalakan"
        title="Nyalakan unggah otomatis ke Drive KKP?"
        description="MARLIN akan menaikkan sendiri laporan harian yang final (PDF + foto) dan laporan mingguan tiap lokasi ke folder Drive milik KKP – termasuk yang sudah terlanjur menumpuk, dicicil sedikit demi sedikit tiap putaran. Berkas bernama sama akan diperbarui sebagai versi baru, bukan digandakan."
        confirmLabel="Ya, nyalakan"
        loading={pending}
      />
    );
  }
  return (
    <Button type="submit" variant="secondary" size="sm" loading={pending}>
      Matikan
    </Button>
  );
}
