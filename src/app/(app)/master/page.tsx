import { redirect, notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";

/** /master → tab pertama yang boleh diakses. */
export default async function MasterIndexPage() {
  const user = await requireUser();
  if (can(user.role, "contract.manage")) redirect("/master/perusahaan");
  if (can(user.role, "wa.chat")) redirect("/master/kontak");
  if (can(user.role, "user.create")) redirect("/master/pengguna");
  notFound();
}
