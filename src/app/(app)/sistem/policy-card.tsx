"use client";

import { useActionState } from "react";
import { Banner, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { savePolicyAction, type PolicyState } from "@/lib/system/actions";
import { POLICY_META, type Policy } from "@/lib/policy";

/**
 * Saklar kebijakan pengendalian — permintaan user 2026-08-02: pagar pemisahan
 * tugas harus "dimaintain dengan setingan … kalau nanti dibutuhkan, tinggal
 * klik di seting saja".
 *
 * Tiap saklar menyebut DAMPAKNYA, bukan cuma namanya. Kebijakan yang
 * konsekuensinya baru ketahuan setelah dinyalakan akan dimatikan lagi dengan
 * panik di tengah jam kerja — dan itu lebih buruk daripada tidak pernah
 * dinyalakan. DECISIONS 218.
 */
export function PolicyCard({ nilai }: { nilai: Policy }) {
  const [state, action, pending] = useActionState<PolicyState, FormData>(savePolicyAction, undefined);
  const kunci = Object.keys(POLICY_META) as (keyof Policy)[];

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Kebijakan pengendalian"
        subtitle="Pagar yang bisa dinyalakan saat organisasi sudah siap. Perubahannya tercatat di audit."
      />
      <CardBody>
        <form action={action} className="space-y-3">
          {state?.error ? <Banner tone="error" title={state.error} /> : null}
          {state?.success ? <Banner tone="success" title={state.success} /> : null}

          {kunci.map((k) => {
            const m = POLICY_META[k];
            return (
              <label
                key={k}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-muted px-3 py-2.5"
              >
                <input
                  type="checkbox"
                  name={k}
                  defaultChecked={nilai[k]}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{m.label}</span>
                  <span className="mt-0.5 block text-[13px] text-ink-muted">{m.deskripsi}</span>
                  <span className="mt-1 block text-[13px] text-warning">Dampak: {m.dampak}</span>
                </span>
              </label>
            );
          })}

          <div className="flex justify-end">
            <Button type="submit" loading={pending}>
              Simpan kebijakan
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
