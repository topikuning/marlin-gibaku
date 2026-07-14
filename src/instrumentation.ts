/**
 * Instrumentation Next.js — dijalankan sekali saat server start (runtime Node).
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
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

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
