import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { ExecutiveDashboard } from "./executive-dashboard";

export const dynamic = "force-dynamic";

/** Rute alias Dashboard Eksekutif (juga jadi beranda peran manajemen di `/`). */
export default async function DashboardEksekutifPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "portfolio.view");
  return <ExecutiveDashboard user={user} />;
}
