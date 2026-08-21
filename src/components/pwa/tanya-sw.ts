/**
 * Tanya-jawab dengan service worker (DECISIONS 398/399).
 *
 * Dipakai dua tempat: banner "dari simpanan" di dalam aplikasi, dan halaman
 * `/offline` yang perlu tahu apakah Foto Cepat sudah tersimpan sebelum
 * menawarkannya. Keduanya menanyakan hal yang sama, jadi jalurnya satu.
 */

export interface InfoSimpanan {
  /** Halaman yang sedang dibaca ini disajikan dari simpanan, bukan dari server. */
  dariSimpanan: boolean;
  /** ISO waktu simpanan itu direkam; null bila halamannya memang tak tersimpan. */
  disimpanPada: string | null;
}

const BATAS_TANYA_MS = 3000;

function baca(data: unknown): InfoSimpanan | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Partial<InfoSimpanan>;
  return {
    dariSimpanan: d.dariSimpanan === true,
    disimpanPada: typeof d.disimpanPada === "string" ? d.disimpanPada : null,
  };
}

/**
 * Kirim pertanyaan ke service worker lewat MessageChannel; null bila tidak
 * menjawab dalam batas waktu.
 *
 * Batas waktunya ada karena service worker bisa saja sedang dibangunkan atau
 * sudah diganti versi baru. Menunggu selamanya berarti banner atau tombol yang
 * tidak pernah selesai memeriksa – dan di layar, "memeriksa" yang menggantung
 * tak bisa dibedakan dari aplikasi yang macet.
 */
export function tanya(sw: ServiceWorker, pesan: Record<string, unknown>): Promise<InfoSimpanan | null> {
  return new Promise((selesai) => {
    const kanal = new MessageChannel();
    const jam = window.setTimeout(() => selesai(null), BATAS_TANYA_MS);
    kanal.port1.onmessage = (e: MessageEvent) => {
      window.clearTimeout(jam);
      selesai(baca(e.data));
    };
    sw.postMessage(pesan, [kanal.port2]);
  });
}

/** Apakah `url` ada di simpanan HP ini, dan sejak kapan. */
export async function tanyaSimpanan(url: string): Promise<InfoSimpanan | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sw = reg?.active;
    if (!sw) return null;
    return await tanya(sw, { jenis: "info-simpanan", url });
  } catch {
    return null;
  }
}
