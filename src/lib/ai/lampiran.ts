/**
 * Lampiran berkas untuk AI (DECISIONS 434/435) — MURNI, tanpa DB/server-only,
 * supaya bentuk medannya bisa diuji unit tanpa menyalakan aplikasi.
 */
import type { JalurPdf } from "./providers";

/**
 * Berkas yang ikut dibaca AI (DECISIONS 434). `dataBase64` TANPA baris baru —
 * API menolak base64 ber-newline.
 */
export type AiAttachment = {
  /** MIME asli, mis. `image/jpeg` atau `application/pdf`. */
  mediaType: string;
  dataBase64: string;
  /** Nama berkas – WAJIB dikirim OpenAI bersama `file_data`. */
  nama?: string;
};

export type AiRequest = {
  system?: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Berkas yang HARUS dibaca isinya (surat hasil pindai). Tidak semua provider
   * jalurnya sudah dibangun; lihat `dukunganLampiran()` — pemanggil wajib
   * memeriksanya dulu supaya kegagalannya terbaca sebagai "MARLIN belum bisa
   * mengirim ini", bukan galat HTTP mentah yang membingungkan admin.
   */
  attachments?: AiAttachment[];
};

/**
 * Yang bisa dibaca lewat jalur yang SUDAH DIBANGUN MARLIN. MURNI.
 *
 * Setiap nilai di sini HARUS punya dasar yang bisa ditunjuk — bentuk medannya
 * diambil dari tipe SDK resmi tiap provider (lihat `JalurPdf` di
 * `providers.ts`), bukan dari ingatan. Kalau suatu jalur belum diverifikasi,
 * tulis "MARLIN belum bisa", JANGAN "provider X tidak bisa": itu klaim tentang
 * pihak lain yang tidak kita punya dasarnya. DECISIONS 435.
 */
export type DukunganLampiran = { gambar: boolean; pdf: boolean; alasan: string };

export function dukunganLampiran(jalurPdf: JalurPdf): DukunganLampiran {
  switch (jalurPdf) {
    case "anthropic_document":
      return { gambar: true, pdf: true, alasan: "Claude membaca gambar dan PDF." };
    case "openai_file":
      return { gambar: true, pdf: true, alasan: "ChatGPT membaca gambar dan PDF." };
    case "mistral_document_url":
      return { gambar: true, pdf: true, alasan: "Mistral membaca gambar dan PDF." };
    case "unggah_dulu":
      // Grok memang membaca PDF, tapi lewat Files API dua langkah
      // (unggah → `attachments:[{file_id}]`) yang MARLIN belum bangun.
      return {
        gambar: true,
        pdf: false,
        alasan:
          "MARLIN belum bisa mengirim PDF ke provider ini – PDF-nya harus diunggah lewat " +
          "Files API dua langkah, dan jalur itu belum dibangun. Untuk PDF, pilih Claude, " +
          "ChatGPT, atau Mistral di Sistem → AI.",
      };
  }
}

/**
 * Isi pesan untuk API bentuk Anthropic. Lampiran ditaruh SEBELUM teks —
 * urutan yang dianjurkan dokumentasi: model membaca berkasnya dulu, baru
 * perintahnya.
 */
export function kontenAnthropic(req: AiRequest): unknown {
  const lampiran = req.attachments ?? [];
  if (lampiran.length === 0) return req.prompt;
  const blok: unknown[] = lampiran.map((a) =>
    a.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: a.mediaType, data: a.dataBase64 } }
      : { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.dataBase64 } },
  );
  blok.push({ type: "text", text: req.prompt });
  return blok;
}

/**
 * Isi pesan untuk API bentuk OpenAI. Gambar seragam (`image_url` data-URI),
 * tapi PDF TIDAK: tiap provider punya bentuk medannya sendiri, jadi jalurnya
 * ditentukan `jalurPdf`, bukan `apiStyle`. PDF pada provider yang jalurnya
 * belum dibangun disaring di sini — pemanggil sudah dicegat `dukunganLampiran()`
 * lebih dulu supaya pesannya terbaca orang, bukan jadi galat HTTP mentah.
 */
export function kontenOpenAi(req: AiRequest, jalurPdf: JalurPdf): unknown {
  const bagian = (req.attachments ?? []).flatMap((a): Record<string, unknown>[] => {
    if (a.mediaType !== "application/pdf") {
      return [{ type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.dataBase64}` } }];
    }
    if (jalurPdf === "openai_file") {
      return [
        {
          type: "file",
          file: { filename: a.nama?.trim() || "surat.pdf", file_data: `data:${a.mediaType};base64,${a.dataBase64}` },
        },
      ];
    }
    if (jalurPdf === "mistral_document_url") {
      return [
        {
          type: "document_url",
          document_url: `data:${a.mediaType};base64,${a.dataBase64}`,
          ...(a.nama?.trim() ? { document_name: a.nama.trim() } : {}),
        },
      ];
    }
    return [];
  });
  if (bagian.length === 0) return req.prompt;
  return [{ type: "text", text: req.prompt }, ...bagian];
}

