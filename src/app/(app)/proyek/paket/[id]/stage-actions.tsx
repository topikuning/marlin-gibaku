"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Input, Label, Textarea, type ButtonVariant } from "@/components/ui";
import {
  advanceStage,
  revertStage,
  startPelaksanaan,
  type PackageActionState,
} from "@/lib/package/actions";
import { PACKAGE_STAGE_LABEL } from "@/lib/lifecycle";
import type { PackageStage } from "@/generated/prisma/enums";

function StateBanners({ state }: { state: PackageActionState }) {
  if (!state) return null;
  if (state.error) return <Banner tone="error" title={state.error} />;
  if (state.success) return <Banner tone="success" title={state.success} />;
  return null;
}

/**
 * Tombol transisi stage (prospek→tender, dst). Dua langkah: klik → konfirmasi,
 * supaya tidak jalan hanya karena salah satu klik. `warn` menampilkan peringatan
 * mencolok pada langkah konfirmasi (mis. progress belum 100% untuk serah terima).
 */
export function AdvanceStageButton({
  packageId,
  toStage,
  label,
  variant = "primary",
  confirmText,
  warn,
}: {
  packageId: string;
  toStage: PackageStage;
  label: string;
  variant?: ButtonVariant;
  /** Teks konfirmasi khusus (default: "Yakin ubah tahap ke …?"). */
  confirmText?: string;
  /** Peringatan mencolok saat konfirmasi (tidak menghalangi; server tetap gate). */
  warn?: string;
}) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    async () => advanceStage(packageId, toStage),
    undefined,
  );
  const [confirm, setConfirm] = useState(false);

  if (!confirm) {
    return (
      <div className="space-y-2">
        <StateBanners state={state} />
        <Button type="button" variant={variant} onClick={() => setConfirm(true)}>
          {label}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
      <StateBanners state={state} />
      <p className="text-sm font-medium text-ink">
        {confirmText ?? `Yakin ubah tahap paket ke ${PACKAGE_STAGE_LABEL[toStage]}?`}
      </p>
      {warn ? <Banner tone="warning" title={warn} /> : null}
      <form action={action} className="flex flex-wrap gap-2">
        <Button type="submit" variant={variant} loading={pending}>
          Ya, {label.toLowerCase()}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>
          Batal
        </Button>
      </form>
    </div>
  );
}

/**
 * Mundurkan stage satu langkah untuk koreksi salah-klik. Alasan wajib. Hanya
 * dirender bila server mengizinkan (revertTargetFor != null) — dihitung di page.
 */
export function RevertStageButton({
  packageId,
  fromLabel,
  toLabel,
}: {
  packageId: string;
  fromLabel: string;
  toLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    async (_prev, formData) => revertStage(packageId, String(formData.get("reason") ?? "")),
    undefined,
  );

  if (!open) {
    return (
      <div className="space-y-2">
        <StateBanners state={state} />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Mundurkan ke {toLabel}
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2 rounded-md border border-warning-border bg-warning-soft p-3">
      <StateBanners state={state} />
      <p className="text-sm text-ink">
        Mundurkan tahap dari <span className="font-medium">{fromLabel}</span> ke{" "}
        <span className="font-medium">{toLabel}</span> (koreksi). Tercatat di histori.
      </p>
      <div>
        <Label htmlFor={`revert-${packageId}`} required>
          Alasan
        </Label>
        <Textarea
          id={`revert-${packageId}`}
          name="reason"
          required
          minLength={5}
          placeholder="mis. Salah klik — pekerjaan belum serah terima"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" loading={pending}>
          Konfirmasi mundur
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Urungkan
        </Button>
      </div>
    </form>
  );
}

/**
 * Kontrak → pelaksanaan (sekaligus set lokasi Berjalan). Menetapkan tanggal
 * SPMK sebagai tanggal mulai; tanggal selesai dihitung = SPMK + masa pelaksanaan.
 */
export function StartPelaksanaanButton({ packageId }: { packageId: string }) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    async (_prev, formData) => startPelaksanaan(packageId, String(formData.get("spmkDate") ?? "")),
    undefined,
  );
  return (
    <div className="space-y-3">
      <StateBanners state={state} />
      <form action={action} className="space-y-3">
        <div>
          <Label htmlFor="sp-spmk" required>
            Tanggal SPMK (mulai kerja)
          </Label>
          <Input id="sp-spmk" name="spmkDate" type="date" required className="max-w-xs" />
          <p className="mt-1 text-xs text-ink-muted">
            Tanggal selesai kontrak akan dihitung otomatis = SPMK + masa pelaksanaan.
          </p>
        </div>
        <Button type="submit" loading={pending}>
          Mulai Pelaksanaan
        </Button>
      </form>
    </div>
  );
}

/** Batalkan paket — alasan wajib. */
export function CancelPackageForm({ packageId }: { packageId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    async (_prev, formData) =>
      advanceStage(packageId, "batal", String(formData.get("reason") ?? "")),
    undefined,
  );

  if (!open) {
    return (
      <div className="space-y-2">
        <StateBanners state={state} />
        <Button variant="danger" onClick={() => setOpen(true)}>
          Batalkan Paket
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-md border border-danger-border bg-danger-soft p-3">
      <StateBanners state={state} />
      <div>
        <Label htmlFor={`cancel-${packageId}`} required>
          Alasan pembatalan
        </Label>
        <Textarea
          id={`cancel-${packageId}`}
          name="reason"
          required
          minLength={5}
          placeholder="mis. Tidak menang tender / anggaran ditarik"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={pending}>
          Konfirmasi Pembatalan
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Urungkan
        </Button>
      </div>
    </form>
  );
}
