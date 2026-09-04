"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState } from "react";
import { Banner, Button, Combobox, Input, Label } from "@/components/ui";
import { setPemilikKendala, type IssueActionState } from "@/lib/issues";

/**
 * Tetapkan PEMILIK & TENGGAT kendala langsung dari papan (DECISIONS 392).
 *
 * Ditaruh di baris kendalanya sendiri, bukan di halaman terpisah: keberatan
 * user adalah *"setelah dicatat tidak ada tindak lanjut"*, dan menambah dua
 * klik untuk menetapkan pemilik adalah cara paling pasti membuat tindak lanjut
 * itu tetap tidak terjadi.
 *
 * Dua bentuk PIC (keputusan user 2026-08-20): pengguna MARLIN yang bisa
 * dikirimi pengingat, atau nama bebas untuk pihak ketiga (PLN, pemilik lahan,
 * dinas). Yang kedua tetap pemilik sah – kenyataan lapangan memang begitu –
 * tapi layar mengatakan bahwa ia tidak akan menerima pengingat, supaya tidak
 * ada yang mengira sistem sudah menagihnya.
 */
export function PemilikForm({
  issueId,
  picUserId,
  picName,
  dueDate,
  pengguna,
}: {
  issueId: string;
  picUserId: string | null;
  picName: string | null;
  dueDate: string;
  pengguna: { id: string; nama: string }[];
}) {
  const [state, action, pending] = useAksi<IssueActionState>(
    setPemilikKendala,
    undefined,
  );
  // "luar" = PIC di luar MARLIN. Dipilih eksplisit, bukan disimpulkan dari
  // kolom mana yang kebetulan terisi — dua kolom yang saling menimpa diam-diam
  // adalah cara termudah membuat "siapa yang ditagih" punya dua jawaban.
  const [luar, setLuar] = useState(!picUserId && !!picName);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="issueId" value={issueId} />

      <div>
        <Label htmlFor={`pic-jenis-${issueId}`}>PIC</Label>
        <Combobox
          id={`pic-jenis-${issueId}`}
          value={luar ? "luar" : "marlin"}
          onChange={(v) => setLuar(v === "luar")}
          options={[
            { value: "marlin", label: "Pengguna MARLIN" },
            { value: "luar", label: "Pihak luar" },
          ]}
        />
      </div>

      {luar ? (
        <div>
          <Label htmlFor={`pic-nama-${issueId}`}>Nama pihak luar</Label>
          <Input
            id={`pic-nama-${issueId}`}
            name="picName"
            defaultValue={picName ?? ""}
            placeholder="mis. PLN Rayon, pemilik lahan"
            maxLength={120}
            className="w-52"
          />
        </div>
      ) : (
        <div>
          <Label htmlFor={`pic-user-${issueId}`}>Pengguna</Label>
          <Combobox
            id={`pic-user-${issueId}`}
            name="picUserId"
            defaultValue={picUserId ?? ""}
            options={[
              { value: "", label: "– belum ditetapkan –" },
              ...pengguna.map((p) => ({ value: p.id, label: p.nama })),
            ]}
          />
        </div>
      )}

      <div>
        <Label htmlFor={`due-${issueId}`}>Tenggat</Label>
        <Input id={`due-${issueId}`} name="dueDate" type="date" defaultValue={dueDate} />
      </div>

      <Button type="submit" size="sm" loading={pending}>
        Simpan
      </Button>

      {luar ? (
        <p className="w-full text-[11px] text-warning">
          PIC di luar MARLIN tidak menerima pengingat otomatis – penagihannya manual.
        </p>
      ) : null}

      {state?.error ? <Banner tone="error" title={state.error} className="w-full" /> : null}
      {state?.success ? <Banner tone="success" title={state.success} className="w-full" /> : null}
    </form>
  );
}
