"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Input password dengan tombol show/hide (ikon mata). Best practice: user bisa
 * mengecek ulang password yang diketik. Mendukung `invalid` (border merah) dan
 * semua atribut input biasa (name, required, minLength, dst) → tetap kompatibel
 * FormData + Server Action.
 */
export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  invalid?: boolean;
}

const CONTROL_CLASS =
  "h-9 w-full rounded-md border border-border bg-surface pr-10 pl-3 py-2 text-sm text-ink " +
  "focus-visible:outline-2 focus-visible:outline-primary-600 " +
  "disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-faint";

export function PasswordInput({ invalid, className, ...rest }: PasswordInputProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        aria-invalid={invalid || undefined}
        className={cn(CONTROL_CLASS, invalid && "border-danger", className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        tabIndex={-1}
        aria-label={show ? "Sembunyikan password" : "Tampilkan password"}
        aria-pressed={show}
        className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-ink-faint transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  );
}
