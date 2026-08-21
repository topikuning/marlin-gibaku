"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Combobox, Input, Label } from "@/components/ui";
import { gabungkanKendala, type IssueActionState } from "@/lib/issues";
import { kemiripan } from "@/lib/kendala/duplikat";

/**
 * Menggabungkan kendala kembar dari PAPAN TERPUSAT (DECISIONS 393).
 *
 * Panel yang sama juga ada di tab Progress satu lokasi. Ia ikut ke sini karena
 * papan inilah tempat kembar paling mungkin KETAHUAN — di tab Progress orang
 * hanya melihat lokasinya sendiri, sedangkan di sini puluhan kendala berdiri
 * berdampingan dan judul yang berulang langsung terbaca.
 */
export type KandidatInduk = { id: string; title: string; status: string; createdAt: string };

export function GabungForm({
  issueId,
  judul,
  kandidat,
}: {
  issueId: string;
  judul: string;
  kandidat: KandidatInduk[];
}) {
  const [buka, setBuka] = useState(false);
  const [state, action, pending] = useActionState<IssueActionState, FormData>(
    gabungkanKendala,
    undefined,
  );

  if (state?.success) return <Banner tone="success" title={state.success} />;

  // Tombol yang membuka daftar kosong membuat orang mengira fiturnya rusak.
  if (kandidat.length === 0) return null;

  if (!buka) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setBuka(true)}>
        Gabungkan sebagai kembar
      </Button>
    );
  }

  // Diurutkan berdasar kemiripan judul, bukan tanggal: yang membuka panel ini
  // sudah tahu kendalanya kembar, dan yang dicarinya kembaran itu.
  const urut = [...kandidat].sort(
    (a, b) => kemiripan(judul, b.title) - kemiripan(judul, a.title),
  );

  return (
    <form action={action} className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <input type="hidden" name="duplikatId" value={issueId} />
      <div>
        <Label htmlFor={`gb-${issueId}`} required>
          Gabungkan ke kendala
        </Label>
        <Combobox id={`gb-${issueId}`} name="indukId" required>
          {urut.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Combobox>
      </div>
      <div>
        <Label htmlFor={`gb-cat-${issueId}`}>Alasan (opsional)</Label>
        <Input
          id={`gb-cat-${issueId}`}
          name="catatan"
          maxLength={2000}
          placeholder="mis. dilaporkan dua mandor berbeda"
        />
      </div>
      <p className="text-[12px] text-ink-muted">
        Kendala ini ditutup dan ditandai kembar – tidak dihapus. Aksi pemulihannya ikut pindah.
      </p>
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={pending}>
          Gabungkan
        </Button>
        <Button size="sm" variant="secondary" type="button" onClick={() => setBuka(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}
