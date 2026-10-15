import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { susunKurvaPaket, type KurvaPaketDokumen } from "@/lib/laporan/kurva-paket";

/**
 * Gerbang bersama dua unduhan Kurva-S paket (DECISIONS 678): masuk, bukan
 * password sementara, boleh ekspor laporan DAN melihat paket, paketnya dalam
 * jangkauan pengguna (`packageScopeWhere`, sama dengan halaman paket).
 */
export async function periksaKurvaPaket(
  id: string,
): Promise<{ dok: KurvaPaketDokumen; userId: string } | { tolak: Response }> {
  const tolak = (error: string, status: number) => ({ tolak: NextResponse.json({ error }, { status }) });
  if (!z.uuid().safeParse(id).success) return tolak("Paket tidak ditemukan", 404);
  const user = await getCurrentUser();
  if (user?.mustChangePassword) return tolak("Ganti password terlebih dahulu.", 403);
  if (!user) return tolak("Anda belum masuk. Silakan masuk dulu.", 401);
  if (!can(user.role, "report.export") || !can(user.role, "package.view")) {
    return tolak("Tidak punya izin mengekspor laporan paket", 403);
  }
  const dok = await susunKurvaPaket(id, user);
  if (dok === "tidak_ada") return tolak("Paket tidak ditemukan", 404);
  if (dok === "kosong") {
    return tolak(
      "Kurva-S paket belum bisa dibuat: belum ada lokasi yang punya baseline kurva-S sekaligus RAB aktif.",
      404,
    );
  }
  return { dok, userId: user.id };
}
