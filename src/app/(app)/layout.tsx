import { PendaftarServiceWorker } from "@/components/pwa/pendaftar-sw";
import { AppShell } from "@/components/shell/app-shell";
import { filterNav, MOBILE_NAV } from "@/components/shell/nav-config";
import { Banner } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { logout } from "@/lib/auth/actions";
import { getBranding } from "@/lib/branding";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, brand] = await Promise.all([requireUser(), getBranding()]);

  // Peran ter-scope TANPA penugasan melihat nol data di mana-mana. Tanpa
  // penjelasan ini, halaman kosong terbaca "sistemnya rusak" atau "proyeknya
  // memang belum ada" — padahal cuma belum ditugaskan. Satu banner di shell
  // menutupi seluruh halaman sekaligus (DECISIONS 190).
  const scoped = await accessibleLocationIds(user);
  const tanpaPenugasan = scoped !== null && scoped.length === 0;

  return (
    <AppShell
      brand={brand}
      user={{ fullName: user.fullName, role: user.role }}
      nav={filterNav(user.role)}
      mobileNav={MOBILE_NAV(user.role)}
      logoutAction={async () => {
        "use server";
        await logout();
      }}
    >
      {/* Pemasang service worker (DECISIONS 392) + pengakuan halaman-dari-simpanan.
          Di layout supaya berlaku untuk seluruh aplikasi: yang memasangnya cuma
          perlu sekali terbuka di mana saja, dan pengakuannya harus muncul di
          halaman mana pun yang kelak disajikan luring. */}
      <PendaftarServiceWorker pemilik={user.id} siapkanFotoCepat={can(user.role, "photo.quick")} />
      {tanpaPenugasan ? (
        <Banner
          tone="warning"
          title="Akun Anda belum ditugaskan ke lokasi mana pun"
          description="Karena itu daftar paket, lokasi, progres, dan laporan tampil kosong – bukan karena datanya tidak ada. Minta admin menugaskan lokasi ke akun Anda."
          className="mb-4"
        />
      ) : null}
      {children}
    </AppShell>
  );
}
