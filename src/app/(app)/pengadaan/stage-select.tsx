"use client";

import { useActionState, useRef } from "react";
import type { ProcurementStage } from "@prisma/client";
import { setStage } from "./actions";

export function StageSelect({
  locationId,
  stage,
  stages,
}: {
  locationId: string;
  stage: ProcurementStage;
  stages: { value: ProcurementStage; label: string }[];
}) {
  const [, action, pending] = useActionState(setStage, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="locationId" value={locationId} />
      <select
        name="stage"
        defaultValue={stage}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-xs font-medium outline-none focus:border-[#1e3a8a] disabled:opacity-60"
      >
        {stages.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </form>
  );
}
