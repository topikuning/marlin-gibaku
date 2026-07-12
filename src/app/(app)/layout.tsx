import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { navForRole } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/roles";
import { AppNav } from "@/components/knmp/app-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");

  const { name, role } = session.user;
  const items = navForRole(role);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#0F766E] to-[#115E59] text-sm font-bold text-white shadow-sm">
              M
            </span>
            <div className="leading-tight">
              <div className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight text-slate-900">
                MARLIN
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
              </div>
              <div className="text-[10px] font-medium text-slate-500">Monitoring KNMP</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-semibold text-slate-900">{name}</div>
              <div className="text-[11px] text-slate-500">{ROLE_LABEL[role]}</div>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/masuk" });
              }}
            >
              <button
                type="submit"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
              >
                Keluar
              </button>
            </form>
          </div>
        </div>

        {/* Nav: scroll horizontal di HP, tetap satu baris */}
        <div className="mx-auto max-w-6xl overflow-x-auto px-4 pb-2 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <AppNav items={items} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 pt-2 text-[11px] text-slate-400 sm:px-6">
        MARLIN · build {buildRef()}
      </footer>
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
