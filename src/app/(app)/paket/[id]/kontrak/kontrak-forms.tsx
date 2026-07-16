"use client";

import { useActionState, useState } from "react";
import {
  Banner,
  Button,
  HelpText,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import {
  addAmendment,
  convertToContract,
  updateContractSignatories,
  type PackageActionState,
} from "@/lib/package/actions";

type VendorOption = { id: string; name: string };

const NEW_VENDOR = "__baru__";

export type Signatories = {
  ppkName: string | null;
  ppkNip: string | null;
  supervisorName: string | null;
  supervisorFirm: string | null;
  contractorSignerName: string | null;
  contractorSignerTitle: string | null;
};

/** Field penanda tangan KKP (dipakai form konversi & form edit). Semua opsional. */
function SignatoryFields({ v }: { v?: Signatories }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="sg-ppk">Nama PPK</Label>
        <Input id="sg-ppk" name="ppkName" defaultValue={v?.ppkName ?? ""} placeholder="mis. Ir. Budi Santoso" />
      </div>
      <div>
        <Label htmlFor="sg-ppk-nip">NIP PPK</Label>
        <Input id="sg-ppk-nip" name="ppkNip" defaultValue={v?.ppkNip ?? ""} placeholder="mis. 19700101 ..." />
      </div>
      <div>
        <Label htmlFor="sg-sup">Nama Konsultan Pengawas</Label>
        <Input id="sg-sup" name="supervisorName" defaultValue={v?.supervisorName ?? ""} placeholder="mis. Agus Prasetyo" />
      </div>
      <div>
        <Label htmlFor="sg-sup-firm">Konsultan / Instansi Pengawas</Label>
        <Input id="sg-sup-firm" name="supervisorFirm" defaultValue={v?.supervisorFirm ?? ""} placeholder="mis. CV Konsultan Nusantara" />
      </div>
      <div>
        <Label htmlFor="sg-ctr">Nama Penanda Tangan Penyedia</Label>
        <Input id="sg-ctr" name="contractorSignerName" defaultValue={v?.contractorSignerName ?? ""} placeholder="mis. Andi Wijaya" />
      </div>
      <div>
        <Label htmlFor="sg-ctr-title">Jabatan Penyedia</Label>
        <Input id="sg-ctr-title" name="contractorSignerTitle" defaultValue={v?.contractorSignerTitle ?? ""} placeholder="mis. Direktur" />
      </div>
    </div>
  );
}

/** Form konversi paket → kontrak. Vendor: pilih existing atau nama baru. */
export function ConvertContractForm({
  packageId,
  vendors,
  defaultVendorName,
}: {
  packageId: string;
  vendors: VendorOption[];
  defaultVendorName: string;
}) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    convertToContract,
    undefined,
  );
  const [vendorChoice, setVendorChoice] = useState<string>(
    vendors.length > 0 ? vendors[0].id : NEW_VENDOR,
  );
  const newVendor = vendorChoice === NEW_VENDOR;

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="packageId" value={packageId} />
      {!newVendor ? <input type="hidden" name="vendorId" value={vendorChoice} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cv-vendor" required>
            Vendor
          </Label>
          <Select
            id="cv-vendor"
            value={vendorChoice}
            onChange={(e) => setVendorChoice(e.target.value)}
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            <option value={NEW_VENDOR}>+ Vendor baru…</option>
          </Select>
        </div>
        {newVendor ? (
          <div>
            <Label htmlFor="cv-vendor-name" required>
              Nama vendor baru
            </Label>
            <Input
              id="cv-vendor-name"
              name="vendorName"
              required
              minLength={3}
              defaultValue={defaultVendorName}
              placeholder="PT ..."
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cv-number" required>
            Nomor kontrak
          </Label>
          <Input id="cv-number" name="contractNumber" required minLength={3} />
        </div>
        <div>
          <Label htmlFor="cv-value" required>
            Nilai kontrak (Rp, inkl. PPN)
          </Label>
          <Input id="cv-value" name="contractValue" required inputMode="numeric" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="cv-ppn" required>
            PPN (%)
          </Label>
          <Input
            id="cv-ppn"
            name="ppnPercent"
            type="number"
            step="0.01"
            min={0}
            max={100}
            defaultValue={11}
            required
          />
        </div>
        <div>
          <Label htmlFor="cv-advance">Uang muka (%)</Label>
          <Input id="cv-advance" name="advancePercent" type="number" step="0.01" min={0} max={100} />
        </div>
        <div>
          <Label htmlFor="cv-retention">Retensi (%)</Label>
          <Input
            id="cv-retention"
            name="retentionPercent"
            type="number"
            step="0.01"
            min={0}
            max={100}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="cv-signed" required>
            Tanggal tanda tangan
          </Label>
          <Input id="cv-signed" name="signedDate" type="date" required />
        </div>
        <div>
          <Label htmlFor="cv-start" required>
            Tanggal mulai
          </Label>
          <Input id="cv-start" name="startDate" type="date" required />
        </div>
        <div>
          <Label htmlFor="cv-end" required>
            Tanggal selesai
          </Label>
          <Input id="cv-end" name="endDate" type="date" required />
        </div>
      </div>

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium text-ink">Penanda tangan dokumen KKP (opsional)</legend>
        <p className="mb-3 text-xs text-ink-muted">
          Nama yang tercetak di blok tanda tangan laporan (kurva-S, mingguan, bulanan, harian). Bisa
          diubah kapan saja bila ada pergantian personel.
        </p>
        <SignatoryFields />
      </fieldset>

      <HelpText>
        Konversi menaikkan stage Penetapan → Kontrak dan mengaktifkan semua lokasi target. Aksi
        aman diulang — kontrak tidak akan terduplikasi.
      </HelpText>

      <Button type="submit" loading={pending}>
        Konversi ke Kontrak
      </Button>
    </form>
  );
}

/** Form edit penanda tangan kontrak (pergantian personel setelah kontrak berjalan). */
export function SignatoriesForm({
  contractId,
  value,
}: {
  contractId: string;
  value: Signatories;
}) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    updateContractSignatories,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="contractId" value={contractId} />
      <SignatoryFields v={value} />
      <p className="text-xs text-ink-muted">
        Kosongkan field untuk menghapus nama dari blok tanda tangan.
      </p>
      <Button type="submit" loading={pending}>
        Simpan penanda tangan
      </Button>
    </form>
  );
}

/** Form tambah adendum/CCO (append-only). */
export function AmendmentForm({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    addAmendment,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="contractId" value={contractId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="am-cco" required>
            Nomor CCO/adendum
          </Label>
          <Input id="am-cco" name="ccoNumber" required placeholder="mis. CCO-01" />
        </div>
        <div>
          <Label htmlFor="am-effective" required>
            Tanggal berlaku
          </Label>
          <Input id="am-effective" name="effectiveDate" type="date" required />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="am-value" required>
            Perubahan nilai (Rp)
          </Label>
          <Input id="am-value" name="valueDelta" required placeholder="mis. -150.000.000" />
          <HelpText>Gunakan tanda minus untuk pengurangan nilai. Isi 0 bila hanya waktu.</HelpText>
        </div>
        <div>
          <Label htmlFor="am-days" required>
            Perubahan waktu (hari)
          </Label>
          <Input id="am-days" name="endDateDelta" type="number" step={1} defaultValue={0} required />
        </div>
      </div>

      <div>
        <Label htmlFor="am-reason" required>
          Alasan
        </Label>
        <Textarea id="am-reason" name="reason" required minLength={5} />
      </div>

      <Button type="submit" loading={pending}>
        Catat Adendum
      </Button>
    </form>
  );
}
