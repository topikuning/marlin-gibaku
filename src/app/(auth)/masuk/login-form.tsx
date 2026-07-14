"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/lib/auth/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);
  return (
    <form
      action={action}
      className="rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      {state?.error ? (
        <div role="alert" className="mb-4 rounded-md border-l-4 border-danger bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      ) : null}
      <label htmlFor="identifier" className="block text-sm font-medium text-ink">
        Username atau email
      </label>
      <input
        id="identifier"
        name="identifier"
        autoComplete="username"
        required
        className="mt-1 mb-4 w-full rounded-md border border-border px-3 py-2 focus-visible:outline-2 focus-visible:outline-primary"
      />
      <label htmlFor="password" className="block text-sm font-medium text-ink">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        className="mt-1 mb-6 w-full rounded-md border border-border px-3 py-2 focus-visible:outline-2 focus-visible:outline-primary"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-white hover:bg-primary-800 disabled:opacity-60"
      >
        {pending ? "Memeriksa…" : "Masuk"}
      </button>
    </form>
  );
}
