import { redirect } from "next/navigation";

/**
 * Dashboard digabung ke Beranda (DECISIONS 026) — hindari dua halaman
 * overview yang membingungkan. Redirect biar link/bookmark lama tetap hidup.
 */
export default function DashboardPage() {
  redirect("/beranda");
}
