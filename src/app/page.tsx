import { db } from "@/lib/db";

async function getStats() {
  try {
    const [locations, users, rabItems] = await Promise.all([
      db.location.count(),
      db.user.count(),
      db.rabItem.count(),
    ]);
    return { locations, users, rabItems, error: null };
  } catch (err) {
    return {
      locations: 0,
      users: 0,
      rabItems: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function HomePage() {
  const stats = await getStats();

  return (
    <main className="max-w-2xl mx-auto px-6 py-16">
      <div className="mb-2 text-[10px] uppercase tracking-widest font-semibold text-[#3A4E63]">
        KNMP Monitor · v0.1 scaffold
      </div>
      <h1 className="font-[Fraunces] text-5xl font-semibold leading-tight mb-6">
        Foundation OK.
      </h1>
      <p className="text-[#3A4E63] mb-10 leading-relaxed">
        Kalau kamu lihat ini, Next.js 15 + Prisma + Postgres jalan. Sesi
        berikutnya: auth flow, RAB tree view, submit report. Lihat{" "}
        <code className="font-mono text-sm bg-white border border-[#EAE2D2] px-1.5 py-0.5 rounded">
          PROJECT.md
        </code>{" "}
        untuk roadmap lengkap.
      </p>

      {stats.error ? (
        <div className="border-l-4 border-[#C1442E] bg-[#FCE8E4] p-4 rounded-r-md">
          <div className="font-semibold text-[#C1442E] mb-1">
            Database tidak terhubung
          </div>
          <code className="text-xs text-[#C1442E] font-mono">{stats.error}</code>
          <div className="mt-3 text-xs text-[#3A4E63]">
            Cek <code>.env.local</code> → <code>DATABASE_URL</code> · Lalu jalan:{" "}
            <code>pnpm db:migrate</code> + <code>pnpm db:seed</code>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div className="border border-[#EAE2D2] bg-[#FDFBF6] rounded p-4">
            <div className="text-[10px] uppercase tracking-widest font-semibold text-[#3A4E63]">
              Lokasi
            </div>
            <div className="font-[Fraunces] text-4xl mt-1">{stats.locations}</div>
          </div>
          <div className="border border-[#EAE2D2] bg-[#FDFBF6] rounded p-4">
            <div className="text-[10px] uppercase tracking-widest font-semibold text-[#3A4E63]">
              Users
            </div>
            <div className="font-[Fraunces] text-4xl mt-1">{stats.users}</div>
          </div>
          <div className="border border-[#EAE2D2] bg-[#FDFBF6] rounded p-4">
            <div className="text-[10px] uppercase tracking-widest font-semibold text-[#3A4E63]">
              RAB Items
            </div>
            <div className="font-[Fraunces] text-4xl mt-1">
              {stats.rabItems.toLocaleString("id-ID")}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
