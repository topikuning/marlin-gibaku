import { notFound } from "next/navigation";
import { can, type Capability } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

/** Guard halaman: role tanpa capability → 404 (bukan 403, tidak membocorkan keberadaan halaman). */
export function requireCapabilityPage(role: UserRole, capability: Capability): void {
  if (!can(role, capability)) notFound();
}
