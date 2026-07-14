/**
 * Bootstrap node-only (dimuat instrumentation.ts HANYA di runtime Node) — dijalankan sekali saat server start (runtime Node).
 *
 * Bootstrap admin pertama untuk deployment baru (mis. Railway) yang databasenya
 * kosong karena seed demo menolak production. Set env berikut lalu deploy:
 *   BOOTSTRAP_ADMIN_PASSWORD  (wajib — memicu bootstrap; min 8 karakter)
 *   BOOTSTRAP_ADMIN_USERNAME  (opsional, default "admin")
 *
 * Aman: hanya MEMBUAT bila username belum ada — tidak pernah menimpa user/password
 * yang sudah ada. `mustChangePassword` dipaksa true. Setelah admin dibuat & login,
 * hapus kedua env var tersebut. Kalau env tidak diset, fungsi ini no-op.
 */


/**
 * Muat data demo (7 lokasi contoh, user demo password marlin123) bila
 * BOOTSTRAP_DEMO_DATA=true. Untuk deployment UJI COBA — idempotent, aman
 * diulang. Setelah termuat, hapus env-nya. JANGAN dipakai saat sudah ada
 * data operasional sungguhan.
 */
async function bootstrapDemoData() {
  if (process.env.BOOTSTRAP_DEMO_DATA !== "true") return;
  try {
    const { db } = await import("@/lib/db");
    const { runDemoSeed } = await import("@/lib/seed/demo");
    console.log("[bootstrap] BOOTSTRAP_DEMO_DATA=true — memuat data demo…");
    await runDemoSeed(db);
    console.log(
      "[bootstrap] data demo termuat (7 lokasi, user demo password 'marlin123' — wajib diganti). " +
        "HAPUS env BOOTSTRAP_DEMO_DATA setelah ini.",
    );
  } catch (err) {
    console.error("[bootstrap] gagal memuat data demo:", err);
  }
}

async function bootstrapAdmin() {
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!password) return;
  if (password.length < 8) {
    console.error("[bootstrap] BOOTSTRAP_ADMIN_PASSWORD minimal 8 karakter — admin tidak dibuat");
    return;
  }
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin").trim();

  try {
    const { db } = await import("@/lib/db");
    const existing = await db.user.findUnique({ where: { username }, select: { id: true } });
    if (existing) {
      console.log(`[bootstrap] user '${username}' sudah ada — dilewati`);
      return;
    }
    const { hashPassword } = await import("@/lib/auth/password");
    const org = await db.organization.upsert({
      where: { slug: "gibaku" },
      update: {},
      create: { name: "PT Gibaku Bangun Persada", slug: "gibaku" },
    });
    await db.user.create({
      data: {
        orgId: org.id,
        username,
        fullName: "Administrator",
        role: "super_admin",
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
    });
    console.log(
      `[bootstrap] admin '${username}' berhasil dibuat — login lalu ganti password. ` +
        "Setelah itu HAPUS env BOOTSTRAP_ADMIN_PASSWORD & BOOTSTRAP_ADMIN_USERNAME.",
    );
  } catch (err) {
    console.error("[bootstrap] gagal membuat admin:", err);
  }
}

// Dijalankan saat modul dimuat (sekali per start server Node).
export const bootstrapDone: Promise<void> = (async () => {
  await bootstrapAdmin();
  await bootstrapDemoData();
})();
