import { z } from "zod";

/** Input draft laporan harian: 1 item RAB + volume selesai (DECISIONS 005). */
export const submitDraftItemSchema = z.object({
  rabItemId: z.string().uuid("Item RAB tidak valid"),
  volumeDone: z.coerce
    .number({ message: "Volume harus angka" })
    .positive("Volume harus lebih dari 0"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type SubmitDraftItemInput = z.infer<typeof submitDraftItemSchema>;
