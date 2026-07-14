"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "@/lib/auth/actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePassword, undefined);
  const field = "mt-1 mb-4 w-full rounded-md border border-border px-3 py-2 focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <form action={action} className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      {state?.error ? (
        <div role="alert" className="mb-4 rounded-md border-l-4 border-danger bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      ) : null}
      <label htmlFor="currentPassword" className="block text-sm font-medium text-ink">
        Password sekarang
      </label>
      <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className={field} />
      <label htmlFor="newPassword" className="block text-sm font-medium text-ink">
        Password baru (min 8 karakter)
      </label>
      <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={8} className={field} />
      <label htmlFor="confirmPassword" className="block text-sm font-medium text-ink">
        Ulangi password baru
      </label>
      <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} className={field} />
      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-full rounded-md bg-primary px-4 py-2.5 font-medium text-white hover:bg-primary-800 disabled:opacity-60"
      >
        {pending ? "Menyimpan…" : "Simpan password baru"}
      </button>
    </form>
  );
}
