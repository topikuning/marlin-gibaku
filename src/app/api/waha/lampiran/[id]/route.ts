import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { isR2Configured, r2PresignGet } from "@/lib/r2";

/**
 * Buka berkas lampiran WhatsApp yang menunggu ketetapan.
 *
 * Kenapa ada: sampai 2026-08-28 halaman `/lampiran` meminta orang memutuskan
 * "surat, dokumen, atau bukan bahan kerja" atas berkas yang **tidak bisa mereka
 * buka**. Yang tersedia hanya nama berkas, ukuran, dan dugaan mesin —
 * satu-satunya cara benar-benar melihat isinya adalah membuka WhatsApp sendiri,
 * yang berarti layar ini tidak menghemat apa pun. Meminta ketetapan tanpa
 * menyediakan buktinya bukan alur kerja; itu tebakan yang dicatat.
 *
 * Dua tempat penyimpanan, sesuai daur hidupnya (DECISIONS 432):
 *   - `r2Key`     — arsip permanen, dilayani lewat presigned URL;
 *   - `localPath` — persinggahan di disk kontainer sebelum diarsipkan. Di
 *                   Railway ia bisa hilang saat redeploy, jadi berkas yang
 *                   hilang dijawab dengan sebabnya, bukan 404 telanjang.
 *
 * Pagar SAMA dengan halamannya (`letter.manage`) plus lingkup organisasi lewat
 * paketnya. Lampiran tanpa paket TIDAK dilayani: tanpa paket tidak ada dasar
 * memeriksa lingkupnya, dan menebak di sini berarti membuka berkas satu
 * organisasi kepada organisasi lain.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID lampiran tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Belum masuk – silakan login" }, { status: 401 });
  }
  if (!can(user.role, "letter.manage")) {
    return NextResponse.json({ error: "Tidak punya akses ke lampiran masuk" }, { status: 403 });
  }

  const a = await db.waAttachment.findUnique({
    where: { id },
    select: {
      fileName: true,
      mimeType: true,
      status: true,
      failReason: true,
      localPath: true,
      r2Key: true,
      package: { select: { orgId: true } },
    },
  });
  if (!a || !a.package || a.package.orgId !== user.orgId) {
    return NextResponse.json({ error: "Lampiran tidak ditemukan" }, { status: 404 });
  }
  if (a.status !== "tertangkap") {
    return NextResponse.json(
      {
        error:
          a.failReason ??
          "Berkasnya tidak pernah tertangkap – tidak ada yang bisa dibuka. Buka pesan aslinya di WhatsApp.",
      },
      { status: 404 },
    );
  }

  if (a.r2Key && isR2Configured()) {
    return NextResponse.redirect(await r2PresignGet(a.r2Key, 120), 302);
  }

  if (a.localPath) {
    try {
      const { readFile } = await import("node:fs/promises");
      const buf = await readFile(a.localPath);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": a.mimeType ?? "application/octet-stream",
          // `inline`: berkas ini dibuka untuk DINILAI, bukan dikoleksi. Memaksa
          // unduhan membuat orang menumpuk salinan di laptopnya hanya untuk
          // menjawab satu pertanyaan.
          "Content-Disposition": `inline; filename="${(a.fileName ?? "lampiran").replace(/["\\]/g, "")}"`,
          "Cache-Control": "private, no-store",
        },
      });
    } catch {
      return NextResponse.json(
        {
          error:
            "Berkas tidak ada lagi di simpanan sementara (biasanya hilang saat aplikasi di-deploy ulang) " +
            "dan belum sempat diarsipkan. Buka pesan aslinya di WhatsApp.",
        },
        { status: 410 },
      );
    }
  }

  return NextResponse.json(
    { error: "Berkas belum tersimpan di mana pun – tidak ada yang bisa dibuka." },
    { status: 404 },
  );
}
