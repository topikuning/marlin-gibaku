"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { createContractorSchema, createContractSchema } from "@/lib/schemas/contract";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
type ActionState = { ok?: string; error?: string };

/** Kontrak = master data; batasi ke admin (sama seperti Pengguna). */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !canManageUsers(session.user.role)) return false;
  return true;
}

export async function createContractor(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  if (!(await requireAdmin())) return { error: "Tidak berwenang." };

  const parsed = createContractorSchema.safeParse({
    name: formData.get("name"),
    npwp: formData.get("npwp"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };

  try {
    await db.contractor.create({
      data: { orgId: DEFAULT_ORG_ID, name: parsed.data.name, npwp: parsed.data.npwp || null },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "Nama kontraktor sudah ada." };
    }
    return { error: "Gagal menyimpan kontraktor." };
  }
  revalidatePath("/kontrak");
  return { ok: `Kontraktor "${parsed.data.name}" ditambahkan.` };
}

export async function createContract(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  if (!(await requireAdmin())) return { error: "Tidak berwenang." };

  const parsed = createContractSchema.safeParse({
    contractorId: formData.get("contractorId"),
    contractNumber: formData.get("contractNumber"),
    contractValue: formData.get("contractValue"),
    signedDate: formData.get("signedDate"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  const d = parsed.data;
  if (d.endDate < d.startDate) return { error: "Tanggal selesai sebelum tanggal mulai." };

  try {
    await db.contract.create({
      data: {
        orgId: DEFAULT_ORG_ID,
        contractorId: d.contractorId,
        contractNumber: d.contractNumber,
        contractValue: BigInt(Math.round(d.contractValue)),
        signedDate: d.signedDate,
        startDate: d.startDate,
        endDate: d.endDate,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "Nomor SPK sudah ada." };
    }
    return { error: "Gagal menyimpan kontrak." };
  }
  revalidatePath("/kontrak");
  return { ok: `Kontrak "${d.contractNumber}" ditambahkan.` };
}
