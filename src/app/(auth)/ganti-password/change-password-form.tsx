"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Banner, Button, FieldError, Label, PasswordInput } from "@/components/ui";
import { cn } from "@/lib/cn";
import { changePassword, type ChangePasswordState } from "@/lib/auth/actions";

/**
 * Aturan password: server MEWAJIBKAN min 8 karakter (DECISIONS 052 — checklist
 * hanya panduan, tidak mengunci user lama). Checklist di bawah bersifat REKOMENDASI
 * kekuatan; hanya "min 8" yang wajib (native minLength + zod server).
 */
const RULES = [
  { key: "len", label: "Minimal 8 karakter", required: true, test: (p: string) => p.length >= 8 },
  { key: "upper", label: "Satu huruf besar (A–Z)", required: false, test: (p: string) => /[A-Z]/.test(p) },
  { key: "lower", label: "Satu huruf kecil (a–z)", required: false, test: (p: string) => /[a-z]/.test(p) },
  { key: "num", label: "Satu angka (0–9)", required: false, test: (p: string) => /\d/.test(p) },
  { key: "sym", label: "Satu simbol (mis. !@#$%)", required: false, test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

type FieldErrors = { currentPassword?: string; newPassword?: string; confirmPassword?: string };

export function ChangePasswordForm() {
  const [state, action, pending] = useAksi<ChangePasswordState>(changePassword, undefined);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const onInvalid = (name: keyof FieldErrors) => (e: React.FormEvent<HTMLInputElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    setErrors((prev) => ({
      ...prev,
      [name]: el.validity.tooShort ? "Minimal 8 karakter." : "Bagian ini wajib diisi.",
    }));
  };
  const clear = (name: keyof FieldErrors) => () =>
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));

  const matchState: "empty" | "match" | "mismatch" =
    confirm.length === 0 ? "empty" : confirm === pw ? "match" : "mismatch";

  return (
    <form action={action} className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      {state?.error ? (
        <Banner tone="error" title="Gagal mengganti password" description={state.error} className="mb-5" />
      ) : null}

      {/*
       * Jarak antar-kelompok ada di PEMBUNGKUS, bukan di <FieldError> yang
       * hilang saat tidak ada error — lihat catatan sama di login-form.tsx
       * (DECISIONS 431). Checklist kekuatan tetap satu kelompok dengan kolom
       * "Password baru" karena ia menerangkan kolom itu.
       */}
      <div className="space-y-4">
        <div>
          <Label htmlFor="currentPassword" required>
            Password sekarang
          </Label>
          <PasswordInput
            id="currentPassword"
            name="currentPassword"
            autoComplete="current-password"
            required
            invalid={!!errors.currentPassword}
            onInvalid={onInvalid("currentPassword")}
            onInput={clear("currentPassword")}
          />
          <FieldError>{errors.currentPassword}</FieldError>
        </div>

        <div>
          <Label htmlFor="newPassword" required>
            Password baru
          </Label>
          <PasswordInput
            id="newPassword"
            name="newPassword"
            autoComplete="new-password"
            required
            minLength={8}
            invalid={!!errors.newPassword}
            value={pw}
            onChange={(e) => setPw(e.currentTarget.value)}
            onInvalid={onInvalid("newPassword")}
            onInput={clear("newPassword")}
          />
          <FieldError>{errors.newPassword}</FieldError>

          {/* Checklist kekuatan (live) — panduan, hanya "min 8" yang wajib. */}
          <ul className="mt-2 space-y-1" aria-label="Rekomendasi kekuatan password">
        {RULES.map((r) => {
          const ok = r.test(pw);
          return (
            <li key={r.key} className="flex items-center gap-1.5 text-[13px]">
              {ok ? (
                <Check aria-hidden className="size-3.5 text-success" />
              ) : (
                <X aria-hidden className={cn("size-3.5", r.required ? "text-danger" : "text-ink-faint")} />
              )}
              <span className={cn(ok ? "text-ink" : "text-ink-muted")}>
                {r.label}
                {r.required ? <span className="ml-1 text-[11px] text-ink-faint">(wajib)</span> : null}
              </span>
            </li>
          );
            })}
          </ul>
        </div>

        <div>
          <Label htmlFor="confirmPassword" required>
            Ulangi password baru
          </Label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            required
            minLength={8}
            invalid={!!errors.confirmPassword || matchState === "mismatch"}
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
            onInvalid={onInvalid("confirmPassword")}
            onInput={clear("confirmPassword")}
          />
          {matchState === "mismatch" ? (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-danger">
              <X aria-hidden className="size-3.5" /> Password belum sama.
            </p>
          ) : matchState === "match" ? (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-success">
              <Check aria-hidden className="size-3.5" /> Password cocok.
            </p>
          ) : (
            <FieldError>{errors.confirmPassword}</FieldError>
          )}
        </div>
      </div>

      <Button type="submit" loading={pending} className="mt-6 w-full">
        {pending ? "Menyimpan…" : "Simpan password baru"}
      </Button>
    </form>
  );
}
