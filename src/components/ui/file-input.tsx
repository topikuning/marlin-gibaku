"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { FieldError } from "./field";
import { MAX_UPLOAD_BYTES } from "@/lib/documents-meta";

/**
 * Input file dengan validasi ukuran DI SISI KLIEN sebelum submit.
 *
 * Kenapa perlu: server action Next.js menolak body yang melewati
 * `serverActions.bodySizeLimit` SEBELUM kode kita jalan → halaman crash
 * ("server error"), bukan pesan rapi. Dengan memeriksa `file.size` saat dipilih,
 * file kegedean tak pernah dikirim: input dikosongkan + pesan jelas muncul.
 */
export function FileInput({
  id,
  name,
  accept,
  required,
  maxBytes = MAX_UPLOAD_BYTES,
  className,
}: {
  id?: string;
  name: string;
  accept?: string;
  required?: boolean;
  maxBytes?: number;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const maxMb = Math.round(maxBytes / 1024 / 1024);

  return (
    <>
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        aria-describedby={error && id ? `${id}-err` : undefined}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file && file.size > maxBytes) {
            setError(
              `Ukuran file ${(file.size / 1024 / 1024).toFixed(1)} MB melebihi batas ${maxMb} MB. ` +
                `Kompres dulu atau pilih file lebih kecil.`,
            );
            e.currentTarget.value = ""; // batalkan pilihan supaya tak terkirim
          } else {
            setError(null);
          }
        }}
        className={cn("mt-1 block w-full text-sm", className)}
      />
      <FieldError id={id ? `${id}-err` : undefined}>{error}</FieldError>
    </>
  );
}
