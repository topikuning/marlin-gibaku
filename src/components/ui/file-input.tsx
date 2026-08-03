"use client";

import { useId, useRef, useState } from "react";
import { FileUp, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClass } from "./button";
import { FieldError } from "./field";
import { MAX_UPLOAD_BYTES } from "@/lib/documents-meta";

/**
 * Pemilih berkas — TAMPILAN SENDIRI, bukan kontrol bawaan peramban.
 *
 * Sebelumnya komponen ini cuma `<input type="file">` telanjang dengan
 * `block w-full text-sm`, jadi yang muncul tulisan bawaan peramban
 * "Browse… No file selected." di tengah form yang seluruh kontrol lainnya
 * bergaya token. Laporan user 2026-08-03: *"browse file juga begini, tidak
 * layak"*. Kontrol bawaan itu memang tidak bisa digaya (teks dan tombolnya
 * dirender peramban, di luar jangkauan CSS), jadi satu-satunya jalan adalah
 * menyembunyikan input aslinya dan menggambar pemicunya sendiri.
 *
 * Input aslinya TETAP ADA dan tetap membawa `name`/`accept`/`required` — dipakai
 * `sr-only`, bukan `hidden`, supaya masih bisa difokus keyboard dan validasi
 * bawaan peramban tetap jalan. FormData server action tidak berubah sama sekali.
 *
 * Validasi ukuran DI SISI KLIEN dipertahankan: server action Next.js menolak
 * body yang melewati `serverActions.bodySizeLimit` SEBELUM kode kita jalan →
 * halaman crash, bukan pesan rapi. Diperiksa saat dipilih, jadi berkas kegedean
 * tak pernah terkirim.
 */
export function FileInput({
  id,
  name,
  accept,
  required,
  multiple,
  maxBytes = MAX_UPLOAD_BYTES,
  className,
  petunjuk,
  onPilih,
}: {
  id?: string;
  name: string;
  accept?: string;
  required?: boolean;
  multiple?: boolean;
  maxBytes?: number;
  className?: string;
  /** Keterangan kecil di bawah kotak, mis. "PDF/DOCX, maks 15 MB". */
  petunjuk?: string;
  /**
   * Dipanggil tiap pilihan berubah (kosong = dibatalkan / ditolak ukuran).
   * Diperlukan form yang menyusun `FormData` sendiri alih-alih menyerahkannya
   * ke `action` — mis. impor HPS, yang perlu menahan berkasnya untuk langkah
   * pratinjau sebelum benar-benar menyimpan.
   */
  onPilih?: (files: File[]) => void;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [terpilih, setTerpilih] = useState<{ nama: string; ukuran: number }[]>([]);
  const [seret, setSeret] = useState(false);
  const maxMb = Math.round(maxBytes / 1024 / 1024);

  const periksa = (files: FileList | null) => {
    const daftar = Array.from(files ?? []);
    const kegedean = daftar.find((f) => f.size > maxBytes);
    if (kegedean) {
      setError(
        `Ukuran berkas ${(kegedean.size / 1024 / 1024).toFixed(1)} MB melebihi batas ${maxMb} MB. ` +
          `Kompres dulu atau pilih berkas lebih kecil.`,
      );
      if (inputRef.current) inputRef.current.value = ""; // batalkan supaya tak terkirim
      setTerpilih([]);
      onPilih?.([]);
      return;
    }
    setError(null);
    setTerpilih(daftar.map((f) => ({ nama: f.name, ukuran: f.size })));
    onPilih?.(daftar);
  };

  const kosongkan = () => {
    if (inputRef.current) inputRef.current.value = "";
    setTerpilih([]);
    setError(null);
    onPilih?.([]);
  };

  const ada = terpilih.length > 0;

  return (
    <div className={cn("mt-1", className)}>
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="file"
        accept={accept}
        required={required}
        multiple={multiple}
        aria-describedby={error ? `${inputId}-err` : petunjuk ? `${inputId}-hint` : undefined}
        onChange={(e) => periksa(e.currentTarget.files)}
        className="sr-only"
      />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setSeret(true);
        }}
        onDragLeave={() => setSeret(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSeret(false);
          if (!inputRef.current || !e.dataTransfer.files.length) return;
          // Menyalin ke input aslinya, bukan menyimpan di state: FormData
          // membaca dari input, jadi berkas yang diseret harus mendarat di sana.
          inputRef.current.files = e.dataTransfer.files;
          periksa(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed px-3 py-2.5 transition-colors",
          seret ? "border-primary bg-primary/5" : "border-line bg-surface-inset/40",
          error && "border-danger",
        )}
      >
        <label htmlFor={inputId} className={buttonClass("secondary", "sm", "cursor-pointer gap-1.5")}>
          <FileUp aria-hidden className="size-3.5" />
          {ada ? "Ganti berkas" : "Pilih berkas"}
        </label>

        {ada ? (
          <ul className="flex min-w-0 flex-1 flex-col gap-0.5">
            {terpilih.map((f) => (
              <li key={f.nama} className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink">
                <Paperclip aria-hidden className="size-3 shrink-0 text-ink-muted" />
                <span className="truncate font-medium">{f.nama}</span>
                <span className="shrink-0 text-ink-muted">{ukuranTeks(f.ukuran)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="min-w-0 flex-1 text-[13px] text-ink-muted">
            Belum ada berkas dipilih
            <span className="hidden sm:inline"> — atau seret ke sini</span>
          </span>
        )}

        {ada ? (
          <button
            type="button"
            onClick={kosongkan}
            className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface hover:text-ink"
            aria-label="Kosongkan pilihan berkas"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </div>

      {petunjuk && !error ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-ink-muted">
          {petunjuk}
        </p>
      ) : null}
      <FieldError id={`${inputId}-err`}>{error}</FieldError>
    </div>
  );
}

function ukuranTeks(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
