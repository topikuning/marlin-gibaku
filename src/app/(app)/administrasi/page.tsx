import { redirect, notFound } from "next/navigation";
import { ADMINISTRASI_TABS } from "@/components/shell/nav-config";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";

/**
 * `/administrasi` → tab pertama yang boleh diakses peran ini.
 *
 * Urutannya DITURUNKAN dari `ADMINISTRASI_TABS`, daftar yang sama dengan deret
 * tab di `layout.tsx` dan butir menu di sidebar. Ketiganya dulu ditulis
 * terpisah, dan urutan yang berbeda di sini punya akibat yang halus tapi nyata:
 * pengguna mendarat di tab yang BUKAN tab pertama yang terlihat olehnya,
 * sehingga sorotan tab terasa meleset begitu halaman terbuka.
 *
 * Sistem ikut terdaftar (DECISIONS 252): sesudah `/sistem` pindah ke bawah
 * `/administrasi`, akun yang HANYA punya `system.manage` tidak lagi punya
 * tujuan di sini — dan tanpa entri itu ia jatuh ke `notFound()` padahal jelas
 * berhak atas satu halaman di grup ini.
 */
export default async function AdministrasiIndexPage() {
  const user = await requireUser();
  const pertama = ADMINISTRASI_TABS.find((t) => can(user.role, t.capability));
  if (!pertama) notFound();
  redirect(pertama.href);
}
