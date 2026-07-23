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
  editContractAction,
  updateContractSignatories,
  type PackageActionState,
} from "@/lib/package/actions";

type VendorOption = { id: string; name: string };

const NEW_VENDOR = "__baru__";

export type ContractEditInitial = {
  packageName: string;
  workTitle: string;
  contractNumber: string;
  contractValue: string;
  ppnPercent: number;
  signedDate: string; // yyyy-mm-dd
  durationDays: number;
  startDate: string; // yyyy-mm-dd or ""
};

/**
 * Koreksi kontrak (khusus super_admin) — betulkan SEMUA field termasuk waktu.
 * Bila masa pelaksanaan / SPMK berubah, kurva-S di-hitung ulang otomatis di
 * server. Beda dari adendum (perubahan resmi).
 */
export function EditContractForm({
  packageId,
  initial,
}: {
  packageId: string;
  initial: ContractEditInitial;
}) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    editContractAction,
    undefined,
  );

  function confirmEdit(e: React.FormEvent) {
    const msg =
      "Simpan koreksi kontrak? Jika masa pelaksanaan / tanggal SPMK berubah, kurva-S semua lokasi akan dihitung ulang.";
    if (typeof window !== "undefined" && !window.confirm(msg)) e.preventDefault();
  }

  return (
    <form action={action} onSubmit={confirmEdit} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="packageId" value={packageId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ec-name" required>Nama paket (pendek)</Label>
          <Input id="ec-name" name="packageName" required minLength={3} maxLength={200} defaultValue={initial.packageName} />
        </div>
        <div>
          <Label htmlFor="ec-number" required>Nomor kontrak</Label>
          <Input id="ec-number" name="contractNumber" required minLength={3} maxLength={150} defaultValue={initial.contractNumber} />
        </div>
      </div>

      <div>
        <Label htmlFor="ec-worktitle">Nama pekerjaan resmi (untuk dokumen)</Label>
        <Input id="ec-worktitle" name="workTitle" maxLength={300} defaultValue={initial.workTitle} placeholder="Judul panjang sesuai kontrak" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ec-value" required>Nilai kontrak (Rp, inkl. PPN)</Label>
          <Input id="ec-value" name="contractValue" required inputMode="numeric" defaultValue={initial.contractValue} />
        </div>
        <div>
          <Label htmlFor="ec-ppn">PPN (%)</Label>
          <Input id="ec-ppn" name="ppnPercent" type="number" step="0.01" min={0} max={100} defaultValue={initial.ppnPercent} />
        </div>
        <div>
          <Label htmlFor="ec-signed" required>Tanggal TTD kontrak</Label>
          <Input id="ec-signed" name="signedDate" type="date" required defaultValue={initial.signedDate} />
        </div>
        <div>
          <Label htmlFor="ec-dur" required>Masa pelaksanaan (hari)</Label>
          <Input id="ec-dur" name="durationDays" type="number" min={1} max={3650} required defaultValue={initial.durationDays} />
        </div>
        <div>
          <Label htmlFor="ec-start">Tanggal mulai (SPMK)</Label>
          <Input id="ec-start" name="startDate" type="date" defaultValue={initial.startDate} />
          <HelpText>Kosongkan bila SPMK belum terbit. Selesai dihitung otomatis = SPMK + masa pelaksanaan.</HelpText>
        </div>
      </div>

      <Button type="submit" loading={pending}>Simpan koreksi</Button>
    </form>
  );
}

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

      <div>
        <Label htmlFor="cv-worktitle">Nama pekerjaan resmi (untuk dokumen, opsional)</Label>
        <Input id="cv-worktitle" name="workTitle" maxLength={300} placeholder="mis. Pekerjaan Konstruksi Pembangunan Kampung Nelayan Merah Putih di …" />
        <HelpText>Judul panjang sesuai kontrak; nama paket tetap dipakai di daftar.</HelpText>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cv-signed" required>
            Tanggal tanda tangan kontrak
          </Label>
          <Input id="cv-signed" name="signedDate" type="date" required />
        </div>
        <div>
          <Label htmlFor="cv-days" required>
            Masa pelaksanaan (hari kalender)
          </Label>
          <Input
            id="cv-days"
            name="durationDays"
            type="number"
            min={1}
            max={3650}
            inputMode="numeric"
            placeholder="mis. 150"
            required
          />
        </div>
      </div>
      <HelpText>
        Kontrak belum menetapkan tanggal mulai — pekerjaan baru berjalan saat <b>SPMK</b> terbit.
        Tanggal mulai &amp; selesai diisi nanti di langkah <b>Mulai Pelaksanaan</b> (selesai = SPMK +
        masa pelaksanaan).
      </HelpText>

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
