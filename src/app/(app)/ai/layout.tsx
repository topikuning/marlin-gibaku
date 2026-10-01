import { PageHeader, LinkTabs } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { AlarmAiBanner } from "@/components/knmp/alarm-ai-banner";

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
        title="Asisten Pengendalian"
        description="Tanyakan kondisi proyek, cari prioritas, lalu jadikan hasilnya laporan yang bisa diperiksa dan dikirim. Semua angka tetap dihitung MARLIN."
      />
      {/* Alarm kegagalan AI di SEMUA tab – gangguan 3 minggu dulu tidak terlihat di mana pun (DECISIONS 635). */}
      <AlarmAiBanner orgId={user.orgId} />
      <LinkTabs
        items={[
          { label: "Ringkasan", href: "/ai", exact: true },
          { label: "Tanya MARLIN", href: "/ai/ask" },
          { label: "Kronologi", href: "/ai/kronologi" },
          { label: "Buat Laporan", href: "/ai/reports" },
          { label: "Tindak Lanjut", href: "/ai/actions" },
          { label: "Paparan KKP", href: "/ai/paparan" },
          { label: "Riwayat", href: "/ai/history" },
        ]}
      />
      {children}
    </div>
  );
}
