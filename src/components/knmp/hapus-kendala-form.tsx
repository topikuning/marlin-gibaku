"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState } from "react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { hapusKendala, type IssueActionState } from "@/lib/issues";

/**
 * Menghapus kendala yang SALAH CATAT (DECISIONS 394).
 *
 * Dipakai bersama oleh tab Progress dan papan `/kendala` supaya kalimat
 * peringatannya hanya ditulis di satu tempat – kalimat destruktif yang ditulis
 * dua kali akan menyimpang, dan yang menyimpang adalah yang jarang dibaca.
 *
 * Dua langkah dengan sengaja: tombol "Hapus" hanya MEMBUKA konfirmasi, dan
 * konfirmasinya menuntut alasan. Tombol hapus satu ketukan pada layar ponsel
 * lapangan akan tertekan tanpa dimaksud.
 */
export function HapusKendalaForm({ issueId }: { issueId: string }) {
  const [buka, setBuka] = useState(false);
  const [state, action, pending] = useAksi<IssueActionState>(
    hapusKendala,
    undefined,
  );

  if (state?.success) return <Banner tone="success" title={state.success} />;

  if (!buka) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setBuka(true)}>
        Hapus – salah catat
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-2 rounded-md border border-danger p-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <input type="hidden" name="issueId" value={issueId} />
      <p className="text-sm font-medium text-ink">Hapus kendala ini permanen?</p>
      <p className="text-[12px] text-ink-muted">
        Hanya untuk kendala yang SALAH CATAT – salah lokasi, salah ketik, atau coba-coba. Kendala
        yang benar-benar terjadi harus ditutup dengan catatan, bukan dihapus, supaya riwayatnya
        tetap bisa dipertanggungjawabkan. Judul dan isinya tetap tersimpan di log audit.
      </p>
      <div>
        <Label htmlFor={`hp-${issueId}`} required>
          Alasan menghapus
        </Label>
        <Input
          id={`hp-${issueId}`}
          name="alasan"
          required
          minLength={3}
          maxLength={500}
          placeholder="mis. salah lokasi, seharusnya di Kedungrejo"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" type="submit" variant="danger" loading={pending}>
          Ya, hapus
        </Button>
        <Button size="sm" variant="secondary" type="button" onClick={() => setBuka(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}
