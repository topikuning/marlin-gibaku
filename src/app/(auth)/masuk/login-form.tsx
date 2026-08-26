"use client";

import { useActionState, useState } from "react";
import { Banner, Button, FieldError, Input, Label, PasswordInput } from "@/components/ui";
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
        <Banner tone="error" title="Gagal masuk" description={state.error} className="mb-5" />
      ) : null}

      {/*
       * Jarak antar-kelompok ditaruh di PEMBUNGKUS yang selalu ada, bukan di
       * <FieldError>: komponen itu mengembalikan null saat tidak ada error,
       * sehingga margin yang menempel padanya lenyap justru pada keadaan
       * normal — tombol berakhir menempel ke kolom password. DECISIONS 431.
       *
       * Irama menaik: 4px label→kolom · 16px antar-kelompok · 24px kolom→aksi,
       * sama dengan padding kartu, jadi tombol tidak terbaca sebagai bagian
       * dari kolom terakhir.
       */}
      <div className="space-y-4">
        <div>
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
          />
          <FieldError id="identifier-err">{errors.identifier}</FieldError>
        </div>

        <div>
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
          />
          <FieldError id="password-err">{errors.password}</FieldError>
        </div>
      </div>

      <Button type="submit" loading={pending} className="mt-6 w-full">
        {pending ? "Memeriksa…" : "Masuk"}
      </Button>
    </form>
  );
}
