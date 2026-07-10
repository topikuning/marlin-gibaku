import { z } from "zod";

export const createContractorSchema = z.object({
  name: z.string().trim().min(3, "Nama kontraktor minimal 3 karakter").max(120),
  npwp: z.string().trim().max(30).optional().or(z.literal("")),
});

export const createContractSchema = z.object({
  contractorId: z.string().uuid("Kontraktor tidak valid"),
  contractNumber: z.string().trim().min(3, "Nomor SPK minimal 3 karakter").max(80),
  contractValue: z.coerce
    .number({ message: "Nilai kontrak harus angka" })
    .positive("Nilai kontrak harus > 0"),
  signedDate: z.coerce.date({ message: "Tanggal tanda tangan tidak valid" }),
  startDate: z.coerce.date({ message: "Tanggal mulai tidak valid" }),
  endDate: z.coerce.date({ message: "Tanggal selesai tidak valid" }),
});

export type CreateContractorInput = z.infer<typeof createContractorSchema>;
export type CreateContractInput = z.infer<typeof createContractSchema>;
