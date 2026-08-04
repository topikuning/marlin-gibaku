import { redirect, notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";

/**
 * `/administrasi` → tab pertama yang boleh diakses peran ini.
 *
 * Urutannya HARUS sama dengan urutan tab di `layout.tsx`; kalau berbeda,
 * pengguna mendarat di tab yang bukan tab pertama yang terlihat olehnya, dan
 * sorotan tab langsung terasa meleset begitu halaman terbuka.
 *
 * Sistem ikut didaftar (DECISIONS 251): sesudah `/sistem` pindah ke bawah
 * `/administrasi`, akun yang HANYA punya `system.manage` tidak lagi punya
 * tujuan di sini — dan tanpa baris itu ia jatuh ke `notFound()` padahal
 * jelas berhak atas satu halaman di grup ini.
 */
export default async function AdministrasiIndexPage() {
  const user = await requireUser();
  if (can(user.role, "contract.manage")) redirect("/administrasi/perusahaan");
  if (can(user.role, "wa.chat")) redirect("/administrasi/kontak");
  if (can(user.role, "user.create")) redirect("/administrasi/pengguna");
  if (can(user.role, "package.bypass")) redirect("/administrasi/lokasi-master");
  if (can(user.role, "system.manage")) redirect("/administrasi/sistem");
  notFound();
}
