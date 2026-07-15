"use client";

import { useActionState, useState } from "react";
import { Banner, FieldError, Input, Label, PasswordInput } from "@/components/ui";
import { login, type LoginState } from "@/lib/auth/actions";

type FieldErrors = { identifier?: string; password?: string };

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Tangkap validasi native (required kosong) → tampilkan highlight merah +
  // pesan sendiri, BUKAN bubble bawaan browser (audit UI #1).
  const onInvalid = (name: keyof FieldErrors) => (e: React.FormEvent<HTMLInputElement>) => {
    e.preventDefault();
    setErrors((prev) => ({ ...prev, [name]: "Bagian ini wajib diisi." }));
  };
  const clear = (name: keyof FieldErrors) => () =>
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));

  return (
    <form action={action} className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      {/* Error server (username/password salah) — konsisten dgn desain Banner (audit #2) */}
      {state?.error ? (
        <Banner tone="error" title="Gagal masuk" description={state.error} className="mb-4" />
      ) : null}

      <Label htmlFor="identifier" required>
        Username atau email
      </Label>
      <Input
        id="identifier"
        name="identifier"
        autoComplete="username"
        required
        invalid={!!errors.identifier}
        aria-describedby={errors.identifier ? "identifier-err" : undefined}
        onInvalid={onInvalid("identifier")}
        onInput={clear("identifier")}
        className="mb-1"
      />
      <FieldError id="identifier-err" className="mb-3">
        {errors.identifier}
      </FieldError>

      <Label htmlFor="password" required>
        Password
      </Label>
      <PasswordInput
        id="password"
        name="password"
        autoComplete="current-password"
        required
        invalid={!!errors.password}
        aria-describedby={errors.password ? "password-err" : undefined}
        onInvalid={onInvalid("password")}
        onInput={clear("password")}
        className="mb-1"
      />
      <FieldError id="password-err" className="mb-4">
        {errors.password}
      </FieldError>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-800 active:bg-primary-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Memeriksa…" : "Masuk"}
      </button>
    </form>
  );
}
