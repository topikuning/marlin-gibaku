"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { isWahaConfigured, normalizeGroupChatId, toFilePayload, WahaError } from "@/lib/waha/client";
import { sendFile } from "@/lib/waha/kirim";
import { namaBerkasLaporanLokasi } from "./jenis";

/**
 * KIRIM LAPORAN LENGKAP LOKASI KE GRUP WHATSAPP PAKET.
 *
 * Tujuannya SELALU grup WA paket lokasi ini — tanpa pilihan tujuan bebas.
 * Laporan menyeluruh satu lokasi memuat kendala, temuan, dan administrasi
 * paket; itu bahan rapat, bukan pesan pribadi, dan grup paket adalah satu-
 * satunya tujuan yang lingkupnya sudah jelas milik siapa. Pengirim laporan
 * harian punya "tujuan lain" karena berkasnya memang sering diminta perorangan;
 * di sini pilihan itu sengaja tidak dibuat.
 *
 * Pagarnya: `report.export` (mengunduh/mengirim dokumen = EKSPOR, bukan sekadar
 * melihat layar) + `requireLocationAccess` + `audit`.
 */

export type WaLaporanLokasiState = { error?: string; success?: string } | undefined;

function gagal(err: unknown): WaLaporanLokasiState {
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof WahaError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

export async function kirimLaporanLokasiWaAction(
  _prev: WaLaporanLokasiState,
  formData: FormData,
): Promise<WaLaporanLokasiState> {
  const parsed = z
    .object({ locationId: z.uuid() })
    .safeParse({ locationId: formData.get("locationId") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { locationId } = parsed.data;

  try {
    const user = await requireCapability("report.export");
    await requireLocationAccess(user, locationId);

    const lokasi = await db.location.findUnique({
      where: { id: locationId },
      select: {
        slug: true,
        name: true,
        package: { select: { waGroupId: true, waGroupName: true } },
      },
    });
    if (!lokasi) return { error: "Lokasi tidak ditemukan." };
    if (!(await isWahaConfigured())) return { error: "WhatsApp (WAHA) belum dikonfigurasi." };
    if (!lokasi.package.waGroupId) {
      return { error: "Paket ini belum ditautkan ke grup WhatsApp – atur grupnya di halaman Paket." };
    }
    const chatId = normalizeGroupChatId(lokasi.package.waGroupId);

    /*
     * Impor dinamis: modul snapshot + renderer PDF berat (pdfkit, sharp) dan
     * hanya dibutuhkan saat tombolnya benar-benar ditekan.
     */
    const { buatLaporanLokasiLengkap } = await import("./snapshot");
    const laporan = await buatLaporanLokasiLengkap(locationId);
    if (!laporan) return { error: "Lokasi tidak ditemukan saat menyusun laporannya." };

    const { renderLaporanLokasiPdf } = await import("./render-pdf");
    const pdf = await renderLaporanLokasiPdf(laporan);

    // Caption = kesimpulan yang SAMA dengan yang ada di PDF dan di layar.
    const caption = [
      `*Laporan lengkap ${laporan.identitas.nama}* – s.d. ${laporan.asOfKey}`,
      `${laporan.identitas.kabupaten}, ${laporan.identitas.provinsi}`,
      "",
      ...laporan.kesimpulan,
    ].join("\n");

    const namaBerkas = namaBerkasLaporanLokasi(laporan, "laporan");
    await sendFile(chatId, toFilePayload(pdf, "application/pdf", namaBerkas), caption);

    await audit(user.id, "report.lokasi_lengkap_wa_send", "location", locationId, {
      chatId,
      asOfKey: laporan.asOfKey,
      berkas: namaBerkas,
    });
    revalidatePath(`/lokasi/${lokasi.slug}/laporan-lengkap`);
    return {
      success: `Laporan lengkap ${lokasi.name} terkirim ke grup WhatsApp${lokasi.package.waGroupName ? ` ${lokasi.package.waGroupName}` : " paket"}.`,
    };
  } catch (err) {
    return gagal(err);
  }
}
