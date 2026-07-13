"use client";

import { useActionState, useRef } from "react";
import type { FinanceField } from "@/lib/finance";
import { setFinance } from "./actions";

const grp = new Intl.NumberFormat("id-ID");

export function MoneyCell({
  locationId,
  field,
  value,
}: {
  locationId: string;
  field: FinanceField;
  value: number;
}) {
  const [, action, pending] = useActionState(setFinance, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action} className="text-right">
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="field" value={field} />
      <input
        name="value"
        defaultValue={value ? grp.format(value) : ""}
        inputMode="numeric"
        disabled={pending}
        placeholder="0"
        onFocus={(e) => {
          e.target.value = String(value || "");
        }}
        onBlur={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, "");
          e.target.value = digits ? grp.format(Number(digits)) : "";
          formRef.current?.requestSubmit();
        }}
        className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-[#0F766E] disabled:opacity-60"
      />
    </form>
  );
}
