"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Input, Label, Textarea, type ButtonVariant } from "@/components/ui";
import {
  advanceStage,
  startPelaksanaan,
  type PackageActionState,
} from "@/lib/package/actions";
import type { PackageStage } from "@/generated/prisma/enums";

function StateBanners({ state }: { state: PackageActionState }) {
  if (!state) return null;
  if (state.error) return <Banner tone="error" title={state.error} />;
  if (state.success) return <Banner tone="success" title={state.success} />;
  return null;
}

/** Tombol transisi stage (prospek→tender, tender→penetapan, dst). */
export function AdvanceStageButton({
  packageId,
  toStage,
  label,
  variant = "primary",
}: {
  packageId: string;
  toStage: PackageStage;
  label: string;
  variant?: ButtonVariant;
}) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    async () => advanceStage(packageId, toStage),
    undefined,
  );
  return (
    <div className="space-y-2">
      <StateBanners state={state} />
      <form action={action}>
        <Button type="submit" variant={variant} loading={pending}>
          {label}
        </Button>
      </form>
    </div>
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
