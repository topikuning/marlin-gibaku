"use server";

import { auth } from "@/auth";
import { canManageUsers } from "@/lib/roles";
import { r2SelfTest, type R2TestResult } from "@/lib/r2";

export async function runR2Test(
  _prev: R2TestResult | undefined,
  _formData: FormData
): Promise<R2TestResult | undefined> {
  const session = await auth();
  if (!session?.user || !canManageUsers(session.user.role)) return undefined;
  return r2SelfTest();
}
