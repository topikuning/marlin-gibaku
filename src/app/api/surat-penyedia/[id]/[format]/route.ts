import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { buatDocxSurat } from "@/lib/docx/surat";
import { buatPdfSurat } from "@/lib/pdf/surat-penyedia";
import { kekuranganData, susunSurat } from "@/lib/surat-penyedia/aturan";
import { dataSuratTersimpan } from "@/lib/surat-penyedia/data";

export const dynamic = "force-dynamic";

const JENIS_BERKAS = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/** Unduh surat berkop penyedia sebagai PDF atau Word (DECISIONS 716). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; format: string }> }) {
  const user = await getCurrentUser();
  if (user?.mustChangePassword) {
    return NextResponse.json({ error: "Ganti password terlebih dahulu." }, { status: 403 });
  }
  if (!user) return NextResponse.json({ error: "Anda belum masuk. Silakan masuk dulu." }, { status: 401 });
  if (!can(user.role, "contract.manage")) {
    return NextResponse.json({ error: "Tidak punya izin membuat surat penyedia." }, { status: 403 });
  }
  const { id, format } = await params;
  if (format !== "pdf" && format !== "docx") return NextResponse.json({ error: "Format tidak dikenal." }, { status: 404 });

  const susun = await dataSuratTersimpan(id, user.orgId);
  if (!susun) return NextResponse.json({ error: "Surat tidak ditemukan." }, { status: 404 });
  // Data bisa berubah sesudah surat dibuat (rekening dihapus, jadwal termin dikosongkan).
  const kurang = kekuranganData(susun.data);
  if (kurang.length > 0) {
    return NextResponse.json({ error: `Surat belum bisa disusun. Lengkapi dulu: ${kurang.join("; ")}.` }, { status: 409 });
  }

  const surat = susunSurat(susun.data);
  const isi = format === "pdf" ? await buatPdfSurat(surat, susun.kop) : await buatDocxSurat(surat, susun.kop);
  await audit(user.id, "surat_penyedia.unduh", "surat_penyedia", id, { format, nomor: susun.data.surat.nomor });

  const nama = surat.judulBerkas.replace(/[\\/:*?"<>|]+/g, "-");
  const namaAscii = nama.replace(/[^\x20-\x7e]/g, "-");
  return new NextResponse(new Uint8Array(isi), {
    headers: {
      "Content-Type": JENIS_BERKAS[format],
      "Content-Disposition": `attachment; filename="${namaAscii}.${format}"; filename*=UTF-8''${encodeURIComponent(nama)}.${format}`,
    },
  });
}
