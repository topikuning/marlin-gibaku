"use client";

import { useActionState, useState } from "react";
import { Button, Card, CardBody, Combobox, Input, Label, Textarea } from "@/components/ui";
import { Plus } from "lucide-react";
import { catatSuratAction, type SuratState } from "@/lib/surat/actions";

const PIHAK = [
  { value: "penyedia", label: "Penyedia" },
  { value: "wakil_ppk", label: "Wakil PPK" },
  { value: "ppk", label: "PPK" },
  { value: "konsultan", label: "Konsultan pengawas" },
  { value: "dinas", label: "Dinas/instansi" },
  { value: "internal", label: "Internal" },
  { value: "lainnya", label: "Lainnya" },
];

const KATEGORI = [
  { value: "administrasi", label: "Administrasi" },
  { value: "mutu", label: "Mutu" },
  { value: "jadwal", label: "Jadwal" },
  { value: "pembayaran", label: "Pembayaran" },
  { value: "koordinasi", label: "Koordinasi" },
  { value: "k3", label: "K3" },
  { value: "lainnya", label: "Lainnya" },
];

/**
 * Catat surat yang TIDAK lewat grup WA (diantar langsung, email, pos). Nomor
 * agenda dibuat sistem — orang lapangan tidak perlu mengingat urutannya.
 */
export function CatatSurat({ paket }: { paket: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<SuratState, FormData>(catatSuratAction, undefined);
  const [buka, setBuka] = useState(false);
  const [butuhJawaban, setButuhJawaban] = useState(false);
  const hariIni = new Date().toISOString().slice(0, 10);

  if (!buka) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => setBuka(true)}>
          <Plus aria-hidden className="size-4" />
          Catat surat
        </Button>
        {state?.success ? <span className="text-sm text-success">{state.success}</span> : null}
      </div>
    );
  }

  return (
    <Card>
      <CardBody>
        <form action={action} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="cs-arah" required>
                Arah
              </Label>
              <Combobox
                id="cs-arah"
                name="direction"
                defaultValue="masuk"
                options={[
                  { value: "masuk", label: "Surat masuk" },
                  { value: "keluar", label: "Surat keluar" },
                ]}
              />
            </div>
            <div>
              <Label htmlFor="cs-pihak" required>
                Pihak
              </Label>
              <Combobox id="cs-pihak" name="party" defaultValue="penyedia" options={PIHAK} />
            </div>
            <div>
              <Label htmlFor="cs-nama">Nama pihak</Label>
              <Input id="cs-nama" name="partyName" placeholder="mis. CV SAKHA" />
            </div>
          </div>

          <div>
            <Label htmlFor="cs-perihal" required>
              Perihal
            </Label>
            <Input id="cs-perihal" name="subject" required placeholder="mis. Permohonan perpanjangan waktu" />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="cs-nomor">Nomor surat</Label>
              <Input id="cs-nomor" name="letterNumber" />
            </div>
            <div>
              <Label htmlFor="cs-tglsurat">Tanggal surat</Label>
              <Input id="cs-tglsurat" name="letterDate" type="date" />
            </div>
            <div>
              <Label htmlFor="cs-tgltangani" required>
                Diterima/dikirim
              </Label>
              <Input id="cs-tgltangani" name="handledDate" type="date" defaultValue={hariIni} required />
            </div>
            <div>
              <Label htmlFor="cs-kategori" required>
                Perihal soal
              </Label>
              <Combobox id="cs-kategori" name="category" defaultValue="administrasi" options={KATEGORI} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="cs-paket">Paket terkait</Label>
              <Combobox
                id="cs-paket"
                name="packageId"
                defaultValue=""
                options={[{ value: "", label: "– tidak terkait paket –" }, ...paket.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </div>
            <div>
              <Label htmlFor="cs-jawab">Menuntut jawaban?</Label>
              <Combobox
                id="cs-jawab"
                name="needsReply"
                defaultValue="tidak"
                onChange={(v) => setButuhJawaban(v === "ya")}
                options={[
                  { value: "tidak", label: "Tidak" },
                  { value: "ya", label: "Ya – pasang tenggat" },
                ]}
              />
            </div>
            {butuhJawaban ? (
              <div>
                <Label htmlFor="cs-tenggat">Tenggat jawaban</Label>
                <Input id="cs-tenggat" name="replyDueDate" type="date" />
              </div>
            ) : null}
          </div>

          <div>
            <Label htmlFor="cs-ringkas">Ringkasan isi (opsional)</Label>
            <Textarea id="cs-ringkas" name="summary" rows={3} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending} loading={pending}>
              Simpan surat
            </Button>
            <Button type="button" variant="ghost" onClick={() => setBuka(false)}>
              Batal
            </Button>
            {state?.error ? <span className="text-sm text-danger">{state.error}</span> : null}
            {state?.success ? <span className="text-sm text-success">{state.success}</span> : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
