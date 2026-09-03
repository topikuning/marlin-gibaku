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

// Statis, bukan `await import`: berkasnya hanya `AsyncLocalStorage` — tidak
// menyentuh `db` maupun env, jadi tidak ada yang ikut termuat lebih awal.
import { jalankanDiLatar } from "@/lib/auth/latar";


/**
 * Muat data demo bila BOOTSTRAP_DEMO_DATA=true. Untuk deployment UJI COBA —
 * idempotent, aman diulang. Setelah termuat, hapus env-nya.
 *
 * Ini SATU-SATUNYA jalan seed demo bisa menyentuh server yang sedang berjalan
 * (`pnpm db:seed` menolak `APP_ENV=production`), dan sampai 2026-08-28 ia tidak
 * punya penjaga apa pun — hanya komentar "jangan dipakai kalau sudah ada data
 * sungguhan". Satu env var salah pasang sudah cukup untuk menyuntikkan lokasi
 * contoh dan user berpassword `marlin123` ke basis data berisi pekerjaan nyata.
 *
 * Penjaganya sekarang membaca ISI basis data, bukan nama lingkungan — lihat
 * `bolehMuatDemo()`.
 */
async function bootstrapDemoData() {
  if (process.env.BOOTSTRAP_DEMO_DATA !== "true") return;
  try {
    const { db } = await import("@/lib/db");
    const { runDemoSeed, bolehMuatDemo } = await import("@/lib/seed/demo");
    const izin = await bolehMuatDemo(db);
    if (!izin.boleh) {
      console.error(
        `[bootstrap] BOOTSTRAP_DEMO_DATA=true DIABAIKAN – ${izin.alasan} ` +
          "Hapus env tersebut; kalau memang ingin memuat demo, pakai basis data terpisah.",
      );
      return;
    }
    console.log("[bootstrap] BOOTSTRAP_DEMO_DATA=true – memuat data demo…");
    await runDemoSeed(db);
    console.log(
      "[bootstrap] data demo termuat (user demo password 'marlin123' – wajib diganti). " +
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
    console.error("[bootstrap] BOOTSTRAP_ADMIN_PASSWORD minimal 8 karakter – admin tidak dibuat");
    return;
  }
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin").trim();

  try {
    const { db } = await import("@/lib/db");
    const existing = await db.user.findUnique({ where: { username }, select: { id: true } });
    if (existing) {
      console.log(`[bootstrap] user '${username}' sudah ada – dilewati`);
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
      `[bootstrap] admin '${username}' berhasil dibuat – login lalu ganti password. ` +
        "Setelah itu HAPUS env BOOTSTRAP_ADMIN_PASSWORD & BOOTSTRAP_ADMIN_USERNAME.",
    );
  } catch (err) {
    console.error("[bootstrap] gagal membuat admin:", err);
  }
}

/**
 * Migrasi data yang butuh formula TS (tidak bisa di SQL) — idempoten, jalan
 * tiap boot dan berhenti sendiri lewat penanda AppSetting. DECISIONS 429.
 */
async function migrasiDataOtomatis() {
  // URUTAN PENTING: rentang periode snapshot lama dibekukan DULU (memakai mode
  // 7-hari, sesuai cara nomor minggunya dulu dihitung), baru mode kontrak
  // diubah. Terbalik pun hasilnya sama — backfill tidak membaca mode kontrak —
  // tapi urutan ini membuat jendela "mode sudah baru, rentang belum beku"
  // tidak pernah ada sama sekali.
  /*
   * Rahasia telanjang di AppSetting dienkripsi-ulang lebih DULU: selama masih
   * telanjang, tiap salinan basis data yang dibuat sementara migrasi lain
   * berjalan ikut membawa kuncinya.
   */
  try {
    const { enkripsiUlangRahasiaTelanjang } = await import("@/lib/migrasi/rahasia-terenkripsi");
    const r = await enkripsiUlangRahasiaTelanjang();
    if (r.status === "dilewati" && r.telanjang > 0) {
      console.error(
        `[migrasi] ${r.telanjang} rahasia tersimpan TELANJANG di AppSetting dan tidak bisa ` +
          "dienkripsi: AI_SECRET_ENCRYPTION_KEY belum diset. Set env tersebut lalu deploy ulang.",
      );
    } else if (r.status === "selesai" && r.dienkripsi > 0) {
      console.log(`[migrasi] ${r.dienkripsi} rahasia AppSetting dienkripsi (dari ${r.diperiksa}).`);
    }
  } catch (err) {
    console.error("[migrasi] enkripsi ulang rahasia gagal (dicoba lagi boot berikutnya):", err);
  }

  try {
    const { backfillPeriodeSnapshotLama } = await import("@/lib/migrasi/snapshot-periode-backfill");
    const b = await backfillPeriodeSnapshotLama();
    if (b.status === "selesai" && b.diisi > 0) {
      console.log(
        `[migrasi] rentang periode snapshot final lama dibekukan: ${b.diisi} dari ${b.diperiksa} laporan ` +
          `(${b.dilewati} sudah punya / tanpa SPMK).`,
      );
    }
  } catch (err) {
    console.error("[migrasi] backfill periode snapshot gagal (dicoba lagi boot berikutnya):", err);
  }

  try {
    const { terapkanDefaultSeninMinggu } = await import("@/lib/migrasi/mode-minggu-default");
    const r = await terapkanDefaultSeninMinggu();
    if (r.status === "selesai") {
      console.log(
        `[migrasi] default mode minggu Senin–Minggu diterapkan: ${r.kontrak} kontrak, ` +
          `${r.dikonversi} baseline dikonversi, ${r.digenerate} dihitung ulang.`,
      );
    } else if (r.status === "ditunda") {
      console.warn("[migrasi] default mode minggu ditunda (belum ada user) – dicoba lagi boot berikutnya.");
    }
  } catch (err) {
    console.error("[migrasi] default mode minggu gagal (dicoba lagi boot berikutnya):", err);
  }
}

/*
 * Dijalankan saat modul dimuat (sekali per start server Node), DI DALAM penanda
 * latar (DECISIONS 456).
 *
 * Tanpa penanda itu jejak auditnya hilang tanpa suara. Boot bukan request, jadi
 * `headers()` di `requestIp()` melempar; `audit()` menelan lemparannya dan
 * hanya mencetak ke console — sehingga migrasi data SATU KALI yang benar-benar
 * mengubah isi basis data tidak meninggalkan baris audit apa pun. Terlihat di
 * log E2E CI 2026-09-03:
 *
 *   [audit] gagal menulis audit log: daily_report.snapshot_periode_backfill
 *   Error: `headers` was called outside a request scope.
 *
 * Penandanya dipasang di SATU tempat — di sini — bukan di tiap migrasi:
 * `AsyncLocalStorage` mengikuti seluruh rantai `await` di dalamnya, dan yang
 * ditambahkan besok ikut terlindungi tanpa harus ingat.
 */
export const bootstrapDone: Promise<void> = jalankanDiLatar(async () => {
  await bootstrapAdmin();
  await bootstrapDemoData();
  await migrasiDataOtomatis();
});
