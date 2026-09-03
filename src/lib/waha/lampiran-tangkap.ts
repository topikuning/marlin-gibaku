import "server-only";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { isR2Configured, r2Put } from "@/lib/r2";
import { klasifikasiLampiran, terlaluBesar } from "./lampiran-klasifikasi";
import { siapkanDirektoriLampiran } from "./lampiran-simpanan";

// Tempat berkasnya ditulis dipisah ke `lampiran-simpanan.ts` (tanpa Prisma).
// Diteruskan dari sini supaya pemanggil lama tidak perlu diubah.
export {
  direktoriLampiran,
  siapkanDirektoriLampiran,
  periksaSimpananLampiran,
  type SimpananLampiran,
} from "./lampiran-simpanan";

/**
 * Penangkap berkas lampiran grup WA (DECISIONS 432).
 *
 * Masalah yang ditutup: MARLIN hanya mencatat BAHWA ada lampiran, tanpa pernah
 * mengunduh berkasnya. URL media WAHA berumur pendek, jadi surat yang dikirim
 * ke grup lenyap tak lama setelah dikirim.
 *
 * Urutan sengaja: **unduh → tulis ke disk LOKAL → catat baris DB**. Titik.
 *
 * ### Siapa yang naik ke R2, dan siapa yang tidak (DECISIONS 472)
 *
 * Hanya berkas yang DITETAPKAN orang sebagai surat/dokumen (`arsipkanLampiran`,
 * dipanggil dari layar penetapan dan dari penyapu). Sisanya cukup di disk.
 *
 * Dua ketetapan sebelumnya sama-sama meleset, dan bekasnya ada di layar:
 *
 *   2026-08-25 "lokal dulu, R2 setelah dikonfirmasi" — benar soal arsip, tapi
 *     disk kontainer Railway SEMENTARA, dan deploy datang lebih sering daripada
 *     keputusan. Berkasnya mati sebelum sempat diputuskan.
 *   2026-08-29 pagi "arsipkan semua begitu ditangkap" — menyelamatkan berkas,
 *     tapi R2 menampung setiap foto yang lewat 19 grup, dan daftar penetapan
 *     ikut membengkak.
 *
 * Yang membuat "cukup di disk" tidak lagi berarti "hilang saat deploy" bukan
 * kode, melainkan VOLUME Railway di production: `LAMPIRAN_DIR` diarahkan ke
 * titik pasangnya. Di dev tanpa volume berkasnya memang boleh hilang — dan
 * layarnya mengatakan itu apa adanya, bukan diam.
 *
 * Yang tidak pernah ditetapkan tidak menumpuk selamanya: `kedaluwarsakanLampiran`
 * menghapusnya setelah 3 hari (foto) atau 14 hari (berkas lain).
 */

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
   * TIDAK diarsipkan ke R2 di sini (ketetapan user 2026-08-29, DECISIONS 472).
   *
   * Sehari sebelumnya justru sebaliknya — semua diarsipkan begitu ditangkap —
   * dan akibatnya langsung terlihat: R2 menampung tiap foto yang lewat 19 grup,
   * padahal foto resmi proyek masuk lewat menu Foto. Yang naik arsip permanen
   * hanya yang DITETAPKAN orang sebagai surat/dokumen (`arsipkanLampiran`).
   *
   * Yang membuat "cukup di disk" tidak berarti "hilang saat deploy" adalah
   * Volume Railway di production (`LAMPIRAN_DIR` diarahkan ke titik pasangnya).
   * Di dev tanpa volume berkasnya memang boleh hilang, dan layarnya mengatakan
   * itu apa adanya.
   */
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
 * Yang dikejar hanya yang SUDAH ditetapkan orang: arsip permanen memang bukan
 * tempat seluruh isi grup (DECISIONS 472). Yang belum ditetapkan cukup di disk
 * sampai umur simpannya habis — lihat `kedaluwarsakanLampiran`.
 *
 * Dipanggil putaran `/api/cron/waha` (tiap 5 menit), bukan hanya dari tombol —
 * sampai 2026-08-29 ia tidak pernah dipanggil dari mana pun.
 */
export async function arsipkanYangTertinggal(batas = 50): Promise<{ dipindah: number; gagal: number }> {
  if (!isR2Configured()) return { dipindah: 0, gagal: 0 };
  const antre = await db.waAttachment.findMany({
    where: {
      status: "tertangkap",
      r2Key: null,
      localPath: { not: null },
      decision: { in: ["jadi_surat", "jadi_dokumen"] },
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

/* ── Retensi: yang tidak pernah ditetapkan tidak menumpuk selamanya ───────── */

/** Umur simpan FOTO yang belum ditetapkan (ketetapan user 2026-08-29). */
export const UMUR_FOTO_HARI = 3;
/** Umur simpan berkas lain yang belum ditetapkan. */
export const UMUR_BERKAS_HARI = 14;

const HARI_MS = 24 * 60 * 60 * 1000;

/**
 * Habiskan umur simpan lampiran yang tidak pernah ditetapkan siapa pun.
 *
 * Dua angka, karena dua jenis kiriman yang berbeda umurnya di mata orang: foto
 * grup basi dalam hitungan hari, sedangkan surat bisa baru dibuka pekan
 * depannya. Yang SUDAH ditetapkan tidak pernah kedaluwarsa — ia sudah jadi
 * surat/dokumen resmi dan arsipnya permanen.
 *
 * Barisnya TIDAK dihapus, hanya berkasnya. "Pernah ada berkas ini, dari siapa,
 * kapan" adalah catatan yang tetap berguna; yang mahal cuma isinya.
 *
 * Berkas yang dipakai bersama beberapa baris (kiriman ulang, sidik jari sama)
 * hanya dihapus kalau SELURUH baris itu ikut kedaluwarsa. Menghapus lebih awal
 * akan membuat baris kembarnya yang masih ditunggu jadi tidak bisa dibuka.
 */
export async function kedaluwarsakanLampiran(
  now = new Date(),
  batas = 200,
): Promise<{ kedaluwarsa: number; berkasDihapus: number; r2Dihapus: number }> {
  const batasFoto = new Date(now.getTime() - UMUR_FOTO_HARI * HARI_MS);
  const batasBerkas = new Date(now.getTime() - UMUR_BERKAS_HARI * HARI_MS);

  const calon = await db.waAttachment.findMany({
    where: {
      status: "tertangkap",
      // "bukan bahan kerja" ikut kedaluwarsa: orangnya sudah bilang berkas ini
      // tidak dipakai, jadi menyimpannya sampai kapan pun hanya menumpuk ongkos.
      decision: { in: ["belum", "bukan_apa_apa"] },
      OR: [
        { saranKind: "foto_lapangan", createdAt: { lt: batasFoto } },
        { saranKind: { not: "foto_lapangan" }, createdAt: { lt: batasBerkas } },
      ],
    },
    take: batas,
    orderBy: { createdAt: "asc" },
    select: { id: true, localPath: true, r2Key: true, sha256: true, saranKind: true },
  });
  if (calon.length === 0) return { kedaluwarsa: 0, berkasDihapus: 0, r2Dihapus: 0 };

  // Kembaran: baris lain yang menunjuk berkas fisik yang sama.
  const sidik = [...new Set(calon.map((c) => c.sha256).filter((s): s is string => !!s))];
  const sekeluarga = sidik.length
    ? await db.waAttachment.findMany({
        where: { sha256: { in: sidik } },
        select: { id: true, sha256: true, decision: true, status: true },
      })
    : [];
  const ikutKedaluwarsa = new Set(calon.map((c) => c.id));
  const tertahan = new Set(
    sekeluarga
      .filter((s) => !ikutKedaluwarsa.has(s.id) && s.status === "tertangkap")
      .map((s) => s.sha256!),
  );

  const { unlink } = await import("node:fs/promises");
  let kedaluwarsa = 0;
  let berkasDihapus = 0;
  let r2Dihapus = 0;

  for (const a of calon) {
    const bolehHapusBerkas = !a.sha256 || !tertahan.has(a.sha256);
    if (!bolehHapusBerkas) continue;

    if (a.localPath) {
      try {
        await unlink(a.localPath);
        berkasDihapus += 1;
      } catch (err) {
        // Sudah tidak ada (deploy ulang) bukan kegagalan — tujuannya tercapai.
        if ((err as { code?: string } | null)?.code !== "ENOENT") {
          console.error("[lampiran] gagal menghapus berkas kedaluwarsa:", err);
        }
      }
    }
    if (a.r2Key && isR2Configured()) {
      try {
        const { r2Delete } = await import("@/lib/r2");
        await r2Delete(a.r2Key);
        r2Dihapus += 1;
      } catch (err) {
        console.error("[lampiran] gagal menghapus objek R2 kedaluwarsa:", err);
      }
    }

    const hari = a.saranKind === "foto_lapangan" ? UMUR_FOTO_HARI : UMUR_BERKAS_HARI;
    await db.waAttachment.update({
      where: { id: a.id },
      data: {
        status: "kedaluwarsa",
        localPath: null,
        r2Key: null,
        failReason:
          `Umur simpan ${hari} hari habis – berkasnya dihapus. ` +
          "Berkas aslinya masih ada di pesan WhatsApp-nya.",
      },
    });
    kedaluwarsa += 1;
  }

  return { kedaluwarsa, berkasDihapus, r2Dihapus };
}
