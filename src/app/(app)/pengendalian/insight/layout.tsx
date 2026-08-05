import { PageHeader, LinkTabs } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";

/**
 * AI Intelligence Hub — menu GLOBAL mandiri (bukan duplikat per lokasi).
 * Halaman lokasi hanya punya tombol deep-link ke sini dgn scope preset.
 * Semua tab guard `ai.view`; aksi masing-masing guard capability sendiri.
 * DECISIONS 133.
 */
export default async function AiHubLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.view");
  return (
    <div className="space-y-4">
      <PageHeader
        title="AI Intelligence"
        description="Pusat analisis lintas lokasi. Angka selalu dari sistem MARLIN; AI hanya menjelaskan, memprioritaskan, dan menyusun draf — keputusan tetap di manusia."
      />
      <LinkTabs
        items={[
          { label: "Portfolio Pulse", href: "/pengendalian/insight", exact: true },
          { label: "Perlu Tindakan", href: "/pengendalian/insight/actions" },
          { label: "Report Studio", href: "/pengendalian/insight/reports" },
          { label: "Ask MARLIN", href: "/pengendalian/insight/ask" },
          { label: "Riwayat & Audit", href: "/pengendalian/insight/history" },
        ]}
      />
      {children}
    </div>
  );
}
