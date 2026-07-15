import { AppShell } from "@/components/shell/app-shell";
import { filterNav, MOBILE_NAV } from "@/components/shell/nav-config";
import { requireUser } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { getBranding } from "@/lib/branding";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, brand] = await Promise.all([requireUser(), getBranding()]);
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
      {children}
    </AppShell>
  );
}
