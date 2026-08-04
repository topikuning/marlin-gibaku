import { LinkTabs, PageHeader, type LinkTabItem } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { notFound } from "next/navigation";

/**
 * Menu Master Data — satu rumah untuk data referensi lintas modul
 * (DECISIONS 135): Perusahaan (profil + logo + kop), Kontak, Pengguna.
 * Tab difilter capability; tanpa akses satu pun → 404.
 */
export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const tabs: LinkTabItem[] = [];
  if (can(user.role, "contract.manage")) tabs.push({ label: "Perusahaan", href: "/administrasi/perusahaan" });
  if (can(user.role, "wa.chat")) tabs.push({ label: "Kontak", href: "/administrasi/kontak" });
  if (can(user.role, "user.create")) tabs.push({ label: "Pengguna", href: "/administrasi/pengguna" });
  if (tabs.length === 0) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Master Data"
        description="Data referensi lintas modul: profil perusahaan (logo & kop surat), kontak WhatsApp (tujuan kirim + nama pengirim grup), dan akun pengguna."
      />
      <LinkTabs items={tabs} />
      {children}
    </div>
  );
}
