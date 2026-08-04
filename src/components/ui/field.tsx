import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  Ref,
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

/*
 * `text-base sm:text-sm` — 16px di ponsel, 14px mulai ≥640px.
 *
 * INI BUKAN PILIHAN RASA. Safari iOS MEMPERBESAR halaman begitu fokus masuk ke
 * kontrol form ber-font di bawah 16px, dan zoom itu TIDAK dikembalikan setelah
 * fokus lepas — ia ikut terbawa ke halaman berikutnya. Itulah kenapa layar
 * sesudah login tampil terpotong dan harus di-zoom out manual: yang memicunya
 * ketukan ke kolom username di /masuk, bukan halaman tujuannya.
 *
 * `globals.css` sudah punya aturan 16px untuk `input/select/textarea` di layar
 * kecil, TAPI aturan itu ada di `@layer base` sementara `text-sm` adalah
 * utility — di Tailwind 4 utility selalu menang atas base. Jadi pagar itu tidak
 * pernah berlaku untuk komponen ini; ukurannya harus disetel di utility juga.
 * DECISIONS 246.
 */
const CONTROL_CLASS =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-base sm:text-sm text-ink " +
  "focus-visible:outline-2 focus-visible:outline-primary-600 " +
  "disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-faint";

const INVALID_CLASS = "border-danger";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /**
   * React 19 mengoper `ref` sebagai prop biasa ke komponen fungsi, tetapi
   * `InputHTMLAttributes` tidak memuatnya — jadi harus disebut di sini supaya
   * pemanggil bisa memindahkan fokus (mis. alur isi cepat laporan harian).
   */
  ref?: Ref<HTMLInputElement>;
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
