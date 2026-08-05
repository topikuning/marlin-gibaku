import { LinkTabs, PageHeader, type LinkTabItem } from "@/components/ui";
import { ADMINISTRASI_TABS } from "@/components/shell/nav-config";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { notFound } from "next/navigation";

/**
 * Grup ADMINISTRASI — data referensi, akun, dan konfigurasi sistem
 * (PRD §3.3: Perusahaan/Vendor · Master Lokasi · Pengguna & Penugasan ·
 * Sistem, Integrasi & Audit).
 *
 * Deret tabnya DITURUNKAN dari `ADMINISTRASI_TABS` — satu daftar yang juga
 * dipakai sidebar dan pemantul `/administrasi`, supaya ketiganya tidak bisa
 * berselisih urutan (lihat komentarnya di `nav-config.ts`).
 *
 * Dulu layout ini bernama "Master Data" dan hanya membungkus tiga halaman.
 * Sesudah `/sistem` dan `/paket/katalog` pindah ke bawah `/administrasi`
 * (DECISIONS 252), layout ini otomatis ikut membungkus keduanya — dan itu
 * MERUSAK dua hal sekaligus kalau dibiarkan apa adanya:
 *
 *   · judulnya berbohong — halaman Sistem tampil di bawah kepala "Master Data"
 *     dengan tab yang tidak memuat dirinya sendiri;
 *   · pagarnya salah — `notFound()` menyala kalau pengguna tidak punya SATU
 *     PUN capability master, sehingga akun ber-`system.manage` saja kehilangan
 *     akses ke halaman Sistem yang jelas-jelas haknya.
 *
 * Jadi tabnya diperluas mencakup seluruh grup, dan pagarnya dihitung dari
 * daftar tab yang sama — satu sumber, tidak bisa berselisih.
 */
export default async function AdministrasiLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const tabs: LinkTabItem[] = ADMINISTRASI_TABS.filter((t) => can(user.role, t.capability)).map(
    (t) => ({ label: t.tabLabel, href: t.href }),
  );

  // Tanpa satu pun hak di grup ini, grupnya memang tidak ada untuk pengguna.
  if (tabs.length === 0) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Administrasi"
        description="Data referensi, akun, dan konfigurasi: profil perusahaan (logo & kop surat), kontak WhatsApp, akun pengguna & penugasan, master lokasi, serta sistem, integrasi dan audit."
      />
      <LinkTabs items={tabs} />
      {children}
    </div>
  );
}
