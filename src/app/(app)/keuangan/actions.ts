"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { hasLocationAccess } from "@/lib/access";
import { FINANCE_FIELDS, type FinanceField } from "@/lib/finance";

type State = { ok?: boolean; error?: string };

export async function setFinance(_prev: State | undefined, formData: FormData): Promise<State> {
  const session = await auth();
  if (!session?.user || !canManageUsers(session.user.role)) return { error: "Tidak berwenang." };

  const locationId = String(formData.get("locationId") ?? "");
  const field = String(formData.get("field") ?? "") as FinanceField;
  if (!FINANCE_FIELDS.includes(field)) return { error: "Field tidak valid." };
  if (!(await hasLocationAccess(session.user.id, session.user.role, locationId)))
    return { error: "Tidak punya akses." };

  const digits = String(formData.get("value") ?? "").replace(/[^\d]/g, "");
  const value = BigInt(digits || "0");

  await db.location.update({ where: { id: locationId }, data: { [field]: value } });
  revalidatePath("/keuangan");
  return { ok: true };
}
