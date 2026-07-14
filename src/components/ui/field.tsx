import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/*
 * Komponen form dasar untuk FormData + Server Actions.
 * A11y: selalu pasangkan <Label htmlFor> dengan id kontrol,
 * dan set `invalid` + aria-describedby ke id FieldError bila ada error.
 */

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Tandai wajib diisi (tampilkan tanda *). */
  required?: boolean;
}

export function Label({ required, className, children, ...rest }: LabelProps) {
  return (
    <label
      className={cn("mb-1 block text-[13px] font-medium text-ink", className)}
      {...rest}
    >
      {children}
      {required ? (
        <span aria-hidden className="ml-0.5 text-danger">
          *
        </span>
      ) : null}
    </label>
  );
}

const CONTROL_CLASS =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink " +
  "focus-visible:outline-2 focus-visible:outline-primary-600 " +
  "disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-faint";

const INVALID_CLASS = "border-danger";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_CLASS, "h-9", invalid && INVALID_CLASS, className)}
      {...rest}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_CLASS, "h-9", invalid && INVALID_CLASS, className)}
      {...rest}
    >
      {children}
    </select>
  );
}

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, rows = 3, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_CLASS, invalid && INVALID_CLASS, className)}
      {...rest}
    />
  );
}

/** Pesan error field. Beri `id` dan rujuk dari kontrol via aria-describedby. */
export function FieldError({
  id,
  children,
  className,
}: {
  id?: string;
  children?: ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p id={id} className={cn("mt-1 text-[13px] text-danger", className)}>
      {children}
    </p>
  );
}

export function HelpText({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p id={id} className={cn("mt-1 text-[13px] text-ink-muted", className)}>
      {children}
    </p>
  );
}
