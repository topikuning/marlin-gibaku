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
    <div className="min-h-screen">
      <header className="border-b border-[#EAE2D2] bg-[#FDFBF6]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <div className="font-[Fraunces] text-lg font-semibold text-[#1f2b38]">
            MARLIN
          </div>
          <div className="order-3 w-full sm:order-none sm:w-auto sm:flex-1">
            <AppNav items={items} />
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold text-[#1f2b38]">{name}</div>
              <div className="text-[11px] text-[#8a9199]">
                {ROLE_LABEL[role]}
              </div>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/masuk" });
              }}
            >
              <button
                type="submit"
                className="rounded-md border border-[#EAE2D2] bg-white px-3 py-1.5 text-sm font-semibold text-[#3A4E63] transition hover:bg-[#f4efe4]"
              >
                Keluar
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">{children}</div>
    </div>
  );
}
