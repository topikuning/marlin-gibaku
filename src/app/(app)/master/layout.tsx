import { LinkTabs, PageHeader, type LinkTabItem } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { notFound } from "next/navigation";

/**
 * Menu Master Data — satu rumah untuk data referensi lintas modul
 * (DECISIONS 135): Perusahaan (profil + logo + kop), Katalog Lokasi, Kontak,
 * Pengguna. Tab difilter capability; tanpa akses satu pun → 404.
 *
 * Katalog Lokasi pindah ke sini dari `/paket/katalog` (DECISIONS 368): ia data
 * induk yang DIPAKAI paket, bukan milik satu paket, dan selama ia bersarang di
 * bawah `/paket` orang tidak menemukannya di tempat semua master lain berada.
 */
export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const tabs: LinkTabItem[] = [];
  if (can(user.role, "contract.manage")) tabs.push({ label: "Perusahaan", href: "/master/perusahaan" });
  if (can(user.role, "package.bypass")) tabs.push({ label: "Katalog Lokasi", href: "/master/lokasi" });
  if (can(user.role, "wa.chat")) tabs.push({ label: "Kontak", href: "/master/kontak" });
  if (can(user.role, "user.create")) tabs.push({ label: "Pengguna", href: "/master/pengguna" });
  if (tabs.length === 0) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Master Data"
        description="Data referensi lintas modul: profil perusahaan (logo & kop surat), katalog lokasi, kontak WhatsApp (tujuan kirim + nama pengirim grup), dan akun pengguna."
      />
      <LinkTabs items={tabs} />
      {children}
    </div>
  );
}
