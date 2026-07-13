"use client";

import { useActionState } from "react";
import type { UserRole } from "@prisma/client";
import { createUser } from "./actions";
import { ROLE_LABEL } from "@/lib/roles";

type LocationOption = { id: string; name: string; province: string };

const inputClass =
  "w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/15";
const labelClass = "block text-xs font-semibold text-[#1e3a8a] mb-1";

export function UserForm({
  roles,
  locations,
}: {
  roles: UserRole[];
  locations: LocationOption[];
}) {
  const [state, formAction, isPending] = useActionState(createUser, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="username" className={labelClass}>
            Username *
          </label>
          <input id="username" name="username" required className={inputClass} placeholder="mis. sm-tengket" />
        </div>
        <div>
          <label htmlFor="fullName" className={labelClass}>
            Nama Lengkap *
          </label>
          <input id="fullName" name="fullName" required className={inputClass} />
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>
            Email (opsional)
          </label>
          <input id="email" name="email" type="email" className={inputClass} />
        </div>
        <div>
          <label htmlFor="phoneE164" className={labelClass}>
            No. HP (opsional)
          </label>
          <input id="phoneE164" name="phoneE164" className={inputClass} placeholder="+62812..." />
        </div>
        <div>
          <label htmlFor="role" className={labelClass}>
            Role *
          </label>
          <select id="role" name="role" required defaultValue="site_manager" className={inputClass}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>
            Password awal *
          </label>
          <input id="password" name="password" type="text" required minLength={8} className={inputClass} placeholder="min. 8 karakter" />
        </div>
      </div>

      <div>
        <div className={labelClass}>Lokasi (untuk role scoped)</div>
        <div className="max-h-40 overflow-y-auto rounded-md border border-[#E2E8F0] bg-white p-2">
          {locations.length === 0 ? (
            <p className="text-xs text-[#64748B]">Belum ada lokasi.</p>
          ) : (
            locations.map((loc) => (
              <label key={loc.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-[#FFFFFF]">
                <input type="checkbox" name="locationIds" value={loc.id} className="accent-[#1e3a8a]" />
                <span className="text-[#0F172A]">{loc.name}</span>
                <span className="text-xs text-[#64748B]">· {loc.province}</span>
              </label>
            ))
          )}
        </div>
      </div>

      {state?.error && (
        <div role="alert" className="rounded-md border-l-4 border-[#DC2626] bg-[#FEE2E2] px-3 py-2 text-sm text-[#DC2626]">
          {state.error}
        </div>
      )}
      {state?.ok && (
        <div role="status" className="rounded-md border-l-4 border-[#16A34A] bg-[#DCFCE7] px-3 py-2 text-sm text-[#16A34A]">
          {state.ok}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#172554] disabled:opacity-60"
      >
        {isPending ? "Menyimpan…" : "Buat User"}
      </button>
    </form>
  );
}
