"use client";

import { useActionState } from "react";
import { authenticate } from "./actions";

export function LoginForm() {
  const [errorMessage, formAction, isPending] = useActionState(
    authenticate,
    undefined
  );

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label
          htmlFor="identifier"
          className="block text-sm font-semibold text-[#1e3a8a] mb-1.5"
        >
          Username atau Email
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          autoFocus
          className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/15"
          placeholder="mis. admin"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-semibold text-[#1e3a8a] mb-1.5"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/15"
          placeholder="••••••••"
        />
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border-l-4 border-[#DC2626] bg-[#FEE2E2] px-3 py-2 text-sm text-[#DC2626]"
        >
          {errorMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-[#1e3a8a] px-4 py-2.5 text-[15px] font-semibold text-white transition hover:bg-[#172554] disabled:opacity-60"
      >
        {isPending ? "Memproses…" : "Masuk"}
      </button>
    </form>
  );
}
