import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "@/lib/db";
import { isR2Configured, r2Put } from "@/lib/r2";
import { klasifikasiLampiran, terlaluBesar } from "./lampiran-klasifikasi";

/**
 * Penangkap berkas lampiran grup WA (DECISIONS 432).
 *
 * Masalah yang ditutup: MARLIN hanya mencatat BAHWA ada lampiran, tanpa pernah
 * mengunduh berkasnya. URL media WAHA berumur pendek, jadi surat yang dikirim
 * ke grup lenyap tak lama setelah dikirim.
 *
 * Urutan sengaja: **unduh → tulis ke disk LOKAL → catat baris DB → arsipkan ke
 * R2**. Simpanan lokal tetap ada karena ia yang melayani pembacaan berikutnya
 * tanpa menembak awan, tapi ia CACHE — bukan arsip.
 *
 * ### Kenapa arsipnya sekarang langsung, bukan menunggu konfirmasi
 *
 * Ketetapan 2026-08-25 berbunyi *"disimpan di lokal dulu, baru kemudian saat
 * dokumen itu dikonfirmasi, baru ke R2"*, dengan alasan arsip permanen
 * sebaiknya hanya memuat berkas yang sudah dinyatakan berguna oleh manusia.
 * Yang tidak diperhitungkan: disk kontainer Railway bersifat SEMENTARA dan
 * selama pengembangan masih padat, deploy terjadi beberapa kali sehari — jauh
 * lebih cepat daripada orang sempat menetapkan. Hasilnya terlihat di layar
 * 2026-08-29: kartu lampirannya ada, berkasnya sudah tidak.
 *
 * Ketetapan user 2026-08-29 karena itu membalik urutannya: arsipkan begitu
 * ditangkap. Ongkosnya disadari — R2 kini memuat juga berkas yang ternyata
 * bukan bahan kerja. Itu jauh lebih murah daripada kehilangan surat yang sudah
 * di tangan.
 *
 * Webhook tetap tidak boleh tertahan: pengarsipan bersifat best-effort dan
 * kegagalannya tidak menggagalkan penangkapan; `arsipkanYangTertinggal()` di
 * putaran cron menjaring sisanya.
 *
 * Kalau suatu saat disknya dibuat awet (mis. Volume Railway), cukup arahkan
 * `LAMPIRAN_DIR` ke titik pasangnya — tidak ada kode yang perlu berubah.
 */

/** Direktori simpanan lokal. Dibuat otomatis bila belum ada. */
export function direktoriLampiran(): string {
  return process.env.LAMPIRAN_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), ".data", "lampiran");
}

/**
 * Direktori yang BENAR-BENAR bisa ditulis, dengan cadangan.
 *
 * Kejadian 2026-08-26 di produksi: `EACCES: permission denied, mkdir
 * '/app/.data'`. Kontainer berjalan sebagai pengguna non-root (`marlin`),
 * sedangkan `/app` dibuat root oleh `WORKDIR` — jadi berkas grup yang sudah
 * berhasil diunduh dibuang lagi tepat di langkah terakhir. Direktorinya kini
 * disiapkan di Dockerfile, tapi itu saja tidak cukup: `LAMPIRAN_DIR` bisa
 * diarahkan ke tempat yang tidak boleh ditulis, dan lingkungan lain bisa
 * memasang berkas sistem read-only.
 *
 * Cadangannya `os.tmpdir()`. Itu bukan penurunan mutu: simpanan lokal memang
 * SUDAH bersifat sementara (hilang tiap redeploy) dan hanya persinggahan
 * sebelum berkas yang dikonfirmasi naik ke R2. Kehilangan berkas yang sudah di
 * tangan jauh lebih mahal daripada menyimpannya di tempat yang lebih fana.
 */
export async function siapkanDirektoriLampiran(): Promise<string> {
  const utama = direktoriLampiran();
  try {
    await mkdir(utama, { recursive: true });
    return utama;
  } catch (err) {
    const kode = (err as { code?: string } | null)?.code;
    if (kode !== "EACCES" && kode !== "EPERM" && kode !== "EROFS") throw err;
    const cadangan = join(tmpdir(), "marlin-lampiran");
    await mkdir(cadangan, { recursive: true });
    console.warn(
      `[waha] "${utama}" tidak bisa ditulis (${kode}) – lampiran disimpan sementara di "${cadangan}". ` +
        `Setel LAMPIRAN_DIR ke direktori yang boleh ditulis pengguna aplikasi.`,
    );
    return cadangan;
  }
}

/** Batas unduh — melindungi dari berkas raksasa yang menyumbat webhook. */
const BATAS_UNDUH_BYTE = 25 * 1024 * 1024;
const TIMEOUT_UNDUH_MS = 20_000;

export type TangkapInput = {
  messageId: string;
  packageId: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  fileName: string | null;
  caption: string;
};

export type TangkapHasil =
  | { ok: true; attachmentId: string; status: "tertangkap" | "dilewati" }
  | { ok: false; alasan: string };

/** Ekstensi dari MIME — supaya berkas di disk bisa dibuka orang. */
function ekstensiDari(mime: string | null, fileName: string | null): string {
  const dariNama = fileName?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (dariNama) return `.${dariNama.toLowerCase()}`;
  const m = (mime ?? "").toLowerCase();
  if (m.includes("pdf")) return ".pdf";
  if (m.includes("png")) return ".png";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("sheet") || m.includes("excel")) return ".xlsx";
  if (m.includes("word")) return ".docx";
  return ".bin";
}

/**
 * Tangkap satu lampiran: klasifikasi dulu (murah), baru unduh bila memang
 * layak disimpan. Selalu MENCATAT barisnya — termasuk saat gagal — supaya
 * lampiran yang hilang tetap terlihat, bukan menguap tanpa jejak.
 */
export async function tangkapLampiran(input: TangkapInput): Promise<TangkapHasil> {
  const kelas = klasifikasiLampiran({
    fileName: input.fileName,
    mimeType: input.mimeType,
    caption: input.caption,
    sizeBytes: null,
  });

  const dasar = {
    messageId: input.messageId,
    packageId: input.packageId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    saranKind: kelas.kind,
    saranAlasan: kelas.alasan,
  };

  // Stiker/meme: dicatat, tidak diunduh. Menyimpannya hanya menumpuk ongkos.
  if (kelas.kind === "abaikan") {
    const row = await db.waAttachment.create({
      data: { ...dasar, status: "dilewati", failReason: "Jenis diabaikan (stiker/audio/video)" },
      select: { id: true },
    });
    return { ok: true, attachmentId: row.id, status: "dilewati" };
  }

  if (!input.mediaUrl) {
    const row = await db.waAttachment.create({
      data: {
        ...dasar,
        status: "gagal",
        failReason:
          "Payload webhook tidak memuat URL berkas – tidak bisa diunduh. " +
          "Di WAHA, unduh media MENYALA secara bawaan, jadi sebab tersering adalah " +
          "WHATSAPP_FILES_MIMETYPES yang diisi (kalau diisi, HANYA jenis itu yang diunduh – " +
          "contoh bawaannya image/jpeg,image/png, yang membuang PDF). Kosongkan variabel itu, " +
          "atau tambahkan application/pdf. Periksa juga WHATSAPP_DOWNLOAD_MEDIA tidak diset false " +
          "dan WAHA_MEDIA_STORAGE terpasang.",
      },
      select: { id: true },
    });
    return { ok: true, attachmentId: row.id, status: "dilewati" };
  }

  let buf: Buffer;
  try {
    buf = await unduhBerkas(input.mediaUrl);
  } catch (err) {
    const row = await db.waAttachment.create({
      data: {
        ...dasar,
        status: "gagal",
        failReason: err instanceof Error ? err.message.slice(0, 300) : "Gagal mengunduh berkas",
      },
      select: { id: true },
    });
    return { ok: true, attachmentId: row.id, status: "dilewati" };
  }

  if (terlaluBesar(buf.byteLength)) {
    const row = await db.waAttachment.create({
      data: {
        ...dasar,
        sizeBytes: buf.byteLength,
        status: "dilewati",
        failReason: `Berkas ${Math.round(buf.byteLength / 1024 / 1024)} MB melebihi batas simpan.`,
      },
      select: { id: true },
    });
    return { ok: true, attachmentId: row.id, status: "dilewati" };
  }

  const sha = createHash("sha256").update(buf).digest("hex");

  // Kiriman ulang: satu surat sering dilempar berkali-kali di grup. Berkasnya
  // tidak ditulis dua kali, dan ketetapan yang sudah dibuat orang atas berkas
  // yang sama ikut dibawa — supaya tidak ditanyakan berulang.
  const kembar = await db.waAttachment.findFirst({
    where: { sha256: sha, status: "tertangkap" },
    select: { localPath: true, r2Key: true, decision: true, saranRingkas: true },
    orderBy: { createdAt: "asc" },
  });

  let localPath = kembar?.localPath ?? null;
  if (!kembar) {
    const dir = await siapkanDirektoriLampiran();
    const nama = `${sha}${ekstensiDari(input.mimeType, input.fileName)}`;
    localPath = join(dir, nama);
    await writeFile(localPath, buf);
  }

  const row = await db.waAttachment.create({
    data: {
      ...dasar,
      sizeBytes: buf.byteLength,
      sha256: sha,
      localPath,
      r2Key: kembar?.r2Key ?? null,
      status: "tertangkap",
      saranRingkas: kembar?.saranRingkas ?? null,
      // Ketetapan manusia atas berkas identik dibawa; kalau belum ada, tetap
      // menunggu orang — mesin tidak pernah menetapkan sendiri.
      decision: kembar?.decision ?? "belum",
    },
    select: { id: true },
  });

  /*
   * ARSIPKAN SEKARANG, jangan menunggu keputusan orang (ketetapan user
   * 2026-08-29, mengganti ketetapan 2026-08-25).
   *
   * Sebabnya terlihat di layar: membuka lampiran yang baru masuk menjawab
   * "berkas tidak ada lagi di simpanan sementara". Disk kontainer Railway
   * bersifat sementara, dan selama pengembangan masih padat, deploy terjadi
   * beberapa kali sehari — jauh lebih cepat daripada orang sempat menetapkan
   * berkas itu surat atau bukan. Menunggu keputusan berarti sebagian besar
   * lampiran mati sebelum sempat diputuskan, dan kartu yang tersisa menunjuk
   * berkas yang tidak ada.
   *
   * Best-effort: kegagalan mengarsipkan TIDAK menggagalkan penangkapan.
   * Berkasnya tetap ada di lokal dan `arsipkanYangTertinggal` menjaringnya
   * pada putaran berikutnya.
   */
  try {
    await arsipkanLampiran(row.id);
  } catch (err) {
    console.error("[lampiran] arsip awal gagal:", err);
  }
  return { ok: true, attachmentId: row.id, status: "tertangkap" };
}

/**
 * Unduh berkas dari server WAHA. API key disertakan karena URL media WAHA
 * umumnya dilayani server WAHA itu sendiri dan tertutup untuk publik.
 */
async function unduhBerkas(url: string): Promise<Buffer> {
  const { getWahaConfig } = await import("./config");
  let apiKey: string | null = null;
  try {
    const cfg = await getWahaConfig();
    apiKey = cfg?.apiKey ?? null;
  } catch {
    /* konfigurasi belum ada – tetap coba tanpa kunci */
  }
  const res = await fetch(url, {
    headers: apiKey ? { "X-Api-Key": apiKey } : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_UNDUH_MS),
  });
  if (!res.ok) {
    throw new Error(
      `Server berkas menolak (${res.status}). URL media WAHA berumur pendek – berkas mungkin sudah kedaluwarsa.`,
    );
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > BATAS_UNDUH_BYTE) throw new Error("Berkas melebihi batas unduh.");
  return Buffer.from(ab);
}

/**
 * Naikkan SATU lampiran dari simpanan lokal ke arsip R2.
 *
 * Dipanggil saat orang MENGKONFIRMASI berkas itu memang surat/dokumen —
 * ketetapan user 2026-08-25: *"disimpan di lokal dulu, baru kemudian saat
 * dokumen itu dikonfirmasi, baru ke R2."* Konsekuensinya disengaja: arsip
 * permanen hanya memuat berkas yang sudah dinyatakan berguna oleh manusia,
 * bukan seluruh isi grup. Yang tidak pernah dikonfirmasi cukup tinggal di
 * lokal dan boleh hilang bersama kontainer.
 *
 * Idempoten: yang sudah punya `r2Key` langsung dianggap selesai.
 */
export async function arsipkanLampiran(
  attachmentId: string,
): Promise<{ ok: true; r2Key: string | null; catatan?: string } | { ok: false; alasan: string }> {
  const a = await db.waAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, localPath: true, r2Key: true, mimeType: true, sha256: true, status: true },
  });
  if (!a) return { ok: false, alasan: "Lampiran tidak ditemukan." };
  if (a.r2Key) return { ok: true, r2Key: a.r2Key };
  if (a.status !== "tertangkap" || !a.localPath) {
    return { ok: false, alasan: "Berkasnya tidak tertangkap – tidak ada yang bisa diarsipkan." };
  }
  if (!isR2Configured()) {
    // Bukan kegagalan: berkas tetap ada di lokal. Tapi harus DIKATAKAN, karena
    // simpanan lokal bisa hilang saat redeploy.
    return {
      ok: true,
      r2Key: null,
      catatan: "R2 belum dikonfigurasi – berkas masih di simpanan lokal dan bisa hilang saat deploy ulang.",
    };
  }
  const { readFile } = await import("node:fs/promises");
  try {
    const buf = await readFile(a.localPath);
    const key = `wa-lampiran/${a.sha256 ?? a.id}`;
    await r2Put(key, buf, a.mimeType ?? "application/octet-stream");
    // Semua baris dengan sidik jari sama menunjuk arsip yang sama.
    await db.waAttachment.updateMany({
      where: a.sha256 ? { sha256: a.sha256 } : { id: a.id },
      data: { r2Key: key },
    });
    return { ok: true, r2Key: key };
  } catch (err) {
    /*
     * Berkasnya SUDAH TIDAK ADA — keadaan yang lahir dari deploy ulang, dan
     * satu-satunya kegagalan di sini yang tidak akan pernah membaik. Barisnya
     * ditandai `gagal` supaya dua hal berhenti: penyapu mencoba membacanya
     * setiap lima menit selamanya, dan layar menampilkannya seolah masih bisa
     * dibuka. Yang hilang harus terbaca hilang.
     */
    if ((err as { code?: string } | null)?.code === "ENOENT") {
      const alasan =
        "Berkas hilang dari simpanan sementara sebelum sempat diarsipkan – biasanya karena aplikasi di-deploy ulang. Berkas aslinya masih ada di pesan WhatsApp-nya.";
      await db.waAttachment.update({
        where: { id: a.id },
        data: { status: "gagal", failReason: alasan, localPath: null },
      });
      return { ok: false, alasan };
    }
    return {
      ok: false,
      alasan: err instanceof Error ? `Gagal mengarsipkan: ${err.message}` : "Gagal mengarsipkan berkas.",
    };
  }
}

/**
 * Jaring pengaman: lampiran tertangkap yang arsipnya belum jadi — mis. R2
 * sedang mati saat berkasnya masuk.
 *
 * Sejak 2026-08-29 penyaring `decision` DIBUANG. Sebelumnya penyapu ini hanya
 * mengejar yang sudah ditetapkan orang, sehingga berkas yang belum sempat
 * diputuskan tidak pernah punya kesempatan kedua — padahal justru itu yang
 * paling mungkin hilang, karena ia hidup paling singkat di disk sementara.
 *
 * Dipanggil putaran `/api/cron/waha` (tiap 5 menit), bukan hanya dari tombol.
 */
export async function arsipkanYangTertinggal(batas = 50): Promise<{ dipindah: number; gagal: number }> {
  if (!isR2Configured()) return { dipindah: 0, gagal: 0 };
  const antre = await db.waAttachment.findMany({
    where: {
      status: "tertangkap",
      r2Key: null,
      localPath: { not: null },
    },
    take: batas,
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  let dipindah = 0;
  let gagal = 0;
  for (const a of antre) {
    const r = await arsipkanLampiran(a.id);
    if (r.ok && r.r2Key) dipindah++;
    else gagal++;
  }
  return { dipindah, gagal };
}
