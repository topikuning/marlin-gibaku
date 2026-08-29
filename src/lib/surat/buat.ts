import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";
import { SuratDuplikatError, alasanDuplikat, normalNomorSurat } from "./duplikat";

/**
 * PEMBUATAN BARIS SURAT + NOMOR AGENDA.
 *
 * Dipanggil dari server action pencatatan surat – bukan modul "use server"
 * sendiri, dan itu DISENGAJA (audit 2026-08-28, C-5).
 *
 * Di App Router, setiap fungsi yang diekspor dari modul `"use server"` menjadi
 * endpoint yang bisa dipanggil klien, bukan hanya yang dipakai komponen. Fungsi
 * ini menerima `orgId` dan `createdById` sebagai ARGUMEN, jadi selama ia tinggal
 * di modul aksi, memanggilnya langsung berarti mencatat surat di register resmi
 * atas nama user lain, di organisasi lain, tanpa jejak. Penjaganya (capability +
 * lingkup paket + audit) tetap satu tempat di pemanggil; yang dipindah ke sini
 * hanya penomoran dan pagar duplikatnya.
 *
 * Polanya meniru `src/lib/kendala/naikkan.ts`, yang menyelesaikan persoalan sama
 * dengan cara sama.
 */
export async function buatSurat(input: {
  orgId: string;
  createdById: string;
  packageId: string | null;
  locationId?: string | null;
  direction: "masuk" | "keluar";
  party: "penyedia" | "wakil_ppk" | "ppk" | "konsultan" | "dinas" | "internal" | "lainnya";
  partyName: string | null;
  subject: string;
  summary?: string | null;
  letterNumber: string | null;
  letterDate: Date | null;
  handledDate: Date;
  category: "mutu" | "jadwal" | "pembayaran" | "administrasi" | "koordinasi" | "k3" | "lainnya";
  needsReply: boolean;
  replyDueDate: Date | null;
  attachmentId?: string | null;
  documentId?: string | null;
  /** Berkas surat yang diunggah langsung (DECISIONS 434). */
  fileR2Key?: string | null;
  fileName?: string | null;
  fileMime?: string | null;
}): Promise<{ id: string; agendaNo: number; agendaYear: number }> {
  const tahun = jakartaToday().getUTCFullYear();
  return db.$transaction(async (tx) => {
    /*
     * Pagar duplikat (DECISIONS 436) — DI DALAM transaksi yang sama dengan
     * penomoran agenda, supaya dua kiriman yang beriringan (tombol simpan
     * ditekan dua kali) tidak sama-sama lolos pemeriksaan lalu sama-sama
     * membuat baris.
     */
    const nomorBaru = normalNomorSurat(input.letterNumber);
    if (nomorBaru) {
      const sekandidat = await tx.letter.findMany({
        where: {
          orgId: input.orgId,
          direction: input.direction,
          agendaYear: tahun,
          letterNumber: { not: null },
          // Surat yang DIBATALKAN tidak lagi memegang nomornya (DECISIONS
          // 437) — kalau tetap menghalangi, salah ketik menjadi hukuman
          // seumur register: nomor yang benar tak bisa dicatat ulang.
          status: { not: "dibatalkan" },
        },
        select: { agendaNo: true, agendaYear: true, letterNumber: true, fileName: true },
      });
      const kembar = sekandidat.find((l) => normalNomorSurat(l.letterNumber) === nomorBaru);
      if (kembar) {
        throw new SuratDuplikatError(
          alasanDuplikat(
            { nomorNormal: nomorBaru, direction: input.direction, fileR2Key: input.fileR2Key ?? null },
            kembar,
            "nomor",
          ),
          "nomor",
        );
      }
    }
    if (input.fileR2Key) {
      // Kunci R2 berkas surat = sha256 isinya, jadi kunci yang sama berarti
      // berkas yang sama persis – bukan sekadar nama berkas yang mirip.
      const samaBerkas = await tx.letter.findFirst({
        where: { orgId: input.orgId, fileR2Key: input.fileR2Key, status: { not: "dibatalkan" } },
        select: { agendaNo: true, agendaYear: true, letterNumber: true, fileName: true },
      });
      if (samaBerkas) {
        throw new SuratDuplikatError(
          alasanDuplikat(
            { nomorNormal: nomorBaru, direction: input.direction, fileR2Key: input.fileR2Key },
            samaBerkas,
            "berkas",
          ),
          "berkas",
        );
      }
    }

    const terakhir = await tx.letter.aggregate({
      where: { orgId: input.orgId, agendaYear: tahun },
      _max: { agendaNo: true },
    });
    const agendaNo = (terakhir._max.agendaNo ?? 0) + 1;
    const row = await tx.letter.create({
      data: {
        orgId: input.orgId,
        packageId: input.packageId,
        locationId: input.locationId ?? null,
        agendaNo,
        agendaYear: tahun,
        direction: input.direction,
        party: input.party,
        partyName: input.partyName,
        subject: input.subject,
        summary: input.summary ?? null,
        letterNumber: input.letterNumber,
        letterDate: input.letterDate,
        handledDate: input.handledDate,
        category: input.category,
        // Status awal mengikuti kenyataan: surat yang menuntut jawaban langsung
        // berdiri sebagai utang, bukan "baru" yang tidak menagih apa pun.
        status: input.needsReply ? "perlu_jawaban" : "baru",
        needsReply: input.needsReply,
        replyDueDate: input.replyDueDate,
        attachmentId: input.attachmentId ?? null,
        documentId: input.documentId ?? null,
        fileR2Key: input.fileR2Key ?? null,
        fileName: input.fileName ?? null,
        fileMime: input.fileMime ?? null,
        createdById: input.createdById,
      },
      select: { id: true, agendaNo: true, agendaYear: true },
    });
    return row;
  });
}
