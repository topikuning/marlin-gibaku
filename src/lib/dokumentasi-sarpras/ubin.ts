import "server-only";
import { presignKeys } from "@/lib/photos";
import type { UbinSarprasItem } from "@/components/knmp/ubin-sarpras";
import type { DokumentasiSarpras } from "./susun";

/**
 * Data ubin sarana & prasarana: foto TERKINI tiap sarana sebagai latar
 * (DECISIONS 683). Satu kueri alamat untuk semua ubin.
 */
export async function ubinSarpras(dok: DokumentasiSarpras, slug: string): Promise<UbinSarprasItem[]> {
  const kini = dok.sarpras.map((s) => s.foto.at(-1) ?? null);
  const url = await presignKeys(
    kini.flatMap((f) => (f ? [f.thumbnailKey ?? f.r2Key] : [])),
    3600,
  );
  return dok.sarpras.map((s, i) => {
    const f = kini[i];
    return {
      kunci: s.kunci,
      code: s.code,
      name: s.name,
      progres: s.progresKini,
      jumlahFoto: s.foto.length,
      foto: f ? (url.get(f.thumbnailKey ?? f.r2Key) ?? null) : null,
      href: `/lokasi/${slug}/foto-sarpras/${encodeURIComponent(s.kunci)}`,
    };
  });
}
