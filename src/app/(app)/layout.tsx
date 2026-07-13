import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { navForRole } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/roles";
import { AppNav } from "@/components/knmp/app-nav";
import { SideNav } from "@/components/knmp/side-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");

  const { name, role } = session.user;
  const items = navForRole(role);

  const logout = (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/masuk" });
      }}
    >
      <button
        type="submit"
        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
      >
        Keluar
      </button>
    </form>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] lg:flex">
      {/* Sidebar (desktop) — fixed saat scroll */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <span className="grid h-8 w-8 place-items-center rounded-md border-b-2 border-[#d21f2a] bg-[#1e3a8a] text-sm font-bold text-white">
            M
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight text-slate-900">MARLIN</div>
            <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">
              Monitoring · Analysis · Reporting · Learning
            </div>
          </div>
        </div>
        <div className="px-3 py-2">
          <SideNav items={items} />
        </div>
        <div className="mt-auto border-t border-slate-200 px-5 py-3 text-[11px] text-slate-400">
          build {buildRef()}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
            {/* brand on mobile */}
            <div className="flex items-center gap-2 lg:hidden">
              <span className="grid h-8 w-8 place-items-center rounded-md border-b-2 border-[#d21f2a] bg-[#1e3a8a] text-sm font-bold text-white">
                M
              </span>
              <span className="text-[15px] font-bold tracking-tight text-slate-900">MARLIN</span>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-sm font-semibold text-slate-900">{name}</div>
                <div className="text-[11px] text-slate-500">{ROLE_LABEL[role]}</div>
              </div>
              {logout}
            </div>
          </div>
          {/* Nav horizontal (mobile only) */}
          <div className="overflow-x-auto border-t border-slate-100 px-4 py-2 sm:px-6 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <AppNav items={items} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Commit yang sedang live — biar gampang tahu versi mana yang ter-deploy. */
function buildRef(): string {
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    "";
  return sha ? sha.slice(0, 7) : "dev";
}
