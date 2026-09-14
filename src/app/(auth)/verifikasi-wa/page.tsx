import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { bacaKeadaan } from "@/lib/waha/verifikasi";
import { getIdentitasMarlin } from "@/lib/waha/client";
import { normalizePhone } from "@/lib/waha/sender-identity";
import { VerifikasiWaForm } from "./verifikasi-form";

export const metadata: Metadata = { title: "Verifikasi WhatsApp" };
export const dynamic = "force-dynamic";

/**
 * VERIFIKASI NOMOR WHATSAPP — sesudah login, sekali seumur akun (DECISIONS 570).
 *
 * Halaman ini tidak pernah MENGUNCI: tombol "Lewati" selalu ada. Yang dikunci
 * bukan aplikasinya melainkan klaim nomornya — selama belum terbukti, MARLIN
 * tidak menganggap nomor itu milik orang ini.
 */
export default async function VerifikasiWaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/masuk");

  const [keadaan, identitas, akun] = await Promise.all([
    bacaKeadaan(user.id),
    // Nomor tujuan dibaca dari sesi WhatsApp yang sedang jalan, bukan diketik
    // admin di suatu tempat: nomor yang salah tulis di sini membuat SEMUA orang
    // mengirim frasa ke nomor yang tidak pernah menjawab.
    getIdentitasMarlin().catch(() => ({ nomor: null, lid: null })),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { waNumber: true } }),
  ]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-xl font-bold tracking-tight text-primary">Verifikasi Nomor WhatsApp</div>
          <p className="mt-1 text-sm text-ink-muted">
            Sekali saja. Supaya MARLIN yakin nomor WhatsApp yang tercatat benar-benar milik Anda –
            ke sanalah pengingat laporan dan jawaban pertanyaan dikirim.
          </p>
        </div>
        <VerifikasiWaForm
          awal={keadaan}
          nomorTujuan={normalizePhone(identitas.nomor) ?? identitas.nomor}
          // Yang tersimpan bisa berupa JID mentah "628…@c.us". Menampilkannya
          // apa adanya membuat orang mengira nomornya salah tercatat.
          nomorTercatat={normalizePhone(akun.waNumber) ?? akun.waNumber}
        />
      </div>
    </main>
  );
}
