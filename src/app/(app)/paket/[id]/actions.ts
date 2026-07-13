"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageProspek } from "@/lib/prospek";

type Result = { ok?: string; error?: string };

function parseRupiahSigned(s: unknown): bigint {
  const str = String(s ?? "").trim();
  const neg = str.startsWith("-");
  const digits = str.replace(/[^0-9]/g, "");
  if (!digits) return 0n;
  return neg ? -BigInt(digits) : BigInt(digits);
}

/** Tambah adendum / CCO ke sebuah kontrak (paket). Append-only. */
export async function createAdendum(
  _prev: Result | undefined,
  formData: FormData
): Promise<Result> {
  const session = await auth();
  if (!session?.user || !canManageProspek(session.user.role))
    return { error: "Tidak berwenang." };

  const contractId = String(formData.get("contractId") ?? "");
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: { id: true },
  });
  if (!contract) return { error: "Kontrak tidak ditemukan." };

  const ccoNumber = String(formData.get("ccoNumber") ?? "").trim();
  if (!ccoNumber) return { error: "Nomor CCO/adendum wajib diisi." };
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Alasan adendum wajib diisi." };
  const effDate = String(formData.get("effectiveDate") ?? "").trim();
  if (!effDate) return { error: "Tanggal berlaku wajib diisi." };

  const valueDelta = parseRupiahSigned(formData.get("valueDelta"));
  const endDateDelta = Math.trunc(Number(formData.get("endDateDelta") ?? 0)) || 0;

  await db.contractAmendment.create({
    data: {
      contractId,
      ccoNumber,
      valueDelta,
      endDateDelta,
      effectiveDate: new Date(effDate),
      reason,
    },
  });

  revalidatePath(`/paket/${contractId}`);
  revalidatePath("/paket");
  return { ok: "Adendum tercatat." };
}
