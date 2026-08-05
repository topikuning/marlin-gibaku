import { AppShell } from "@/components/shell/app-shell";
import { filterNav, filterNavGroups, MOBILE_NAV } from "@/components/shell/nav-config";
import { Banner } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { can } from "@/lib/authz";
import { getBranding } from "@/lib/branding";
import { getAntreanTindakan } from "@/lib/tindakan";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, brand] = await Promise.all([requireUser(), getBranding()]);

  // Peran ter-scope TANPA penugasan melihat nol data di mana-mana. Tanpa
  // penjelasan ini, halaman kosong terbaca "sistemnya rusak" atau "proyeknya
  // memang belum ada" — padahal cuma belum ditugaskan. Satu banner di shell
  // menutupi seluruh halaman sekaligus (DECISIONS 190).
  const scoped = await accessibleLocationIds(user);
  const tanpaPenugasan = scoped !== null && scoped.length === 0;

  // Lencana lonceng. Akun tanpa penugasan pasti berantrean kosong, jadi
  // query-nya dilewati — bukan dijalankan untuk memastikan hasilnya nol.
  const bolehLihatAntrean = can(user.role, "location.view") && !tanpaPenugasan;
  const jumlahTindakan = bolehLihatAntrean ? (await getAntreanTindakan(user)).length : null;

  return (
    <AppShell
      brand={brand}
      user={{ fullName: user.fullName, role: user.role }}
      navGroups={filterNavGroups(user.role)}
      nav={filterNav(user.role)}
      mobileNav={MOBILE_NAV(user.role)}
      jumlahTindakan={jumlahTindakan}
      logoutAction={async () => {
        "use server";
        await logout();
      }}
    >
      {tanpaPenugasan ? (
        <Banner
          tone="warning"
          title="Akun Anda belum ditugaskan ke lokasi mana pun"
          description="Karena itu daftar paket, lokasi, progres, dan laporan tampil kosong — bukan karena datanya tidak ada. Minta admin menugaskan lokasi ke akun Anda."
          className="mb-4"
        />
      ) : null}
      {children}
    </AppShell>
  );
}
