import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { presignKeys } from "@/lib/photos";
import { susunDokumentasiSarpras } from "@/lib/dokumentasi-sarpras/susun";
import { requireLocationPage } from "../../get-location";
import { SlideFoto, type SlideItem } from "./slide-foto";

export const metadata: Metadata = { title: "Urutan Foto Sarana" };
export const dynamic = "force-dynamic";

/**
 * Foto satu sarana/prasarana sebagai slide, dari tanggal paling awal sampai
 * terkini (DECISIONS 683). Tiap slide menyebut tanggal, minggu ke berapa, dan
 * progres sarana s/d tanggal itu.
 */
export default async function SlideSarprasPage({ params }: { params: Promise<{ slug: string; kunci: string }> }) {
  const { slug, kunci: kunciMentah } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "progress.view");
  const kunci = decodeURIComponent(kunciMentah);

  const dok = await susunDokumentasiSarpras(location.id);
  const s = dok?.sarpras.find((x) => x.kunci === kunci);
  if (!s) notFound();

  // Alamat berlaku satu jam: slide dibuka lama, gambar dimuat saat digeser.
  const url = await presignKeys(s.foto.flatMap((f) => [f.r2Key, ...(f.thumbnailKey ? [f.thumbnailKey] : [])]), 3600);
  const slides: SlideItem[] = s.foto.map((f) => ({
    id: f.id,
    tanggal: f.tanggal,
    minggu: f.minggu,
    progres: f.progres,
    lineageKey: f.lineageKey,
    pekerjaan: f.pekerjaan,
    full: url.get(f.r2Key) ?? null,
    thumb: url.get(f.thumbnailKey ?? f.r2Key) ?? url.get(f.r2Key) ?? null,
  }));

  return (
    <SlideFoto
      slug={slug}
      judul={`${s.code}. ${s.name}`}
      progresKini={s.progresKini}
      slides={slides}
      pekerjaan={s.pekerjaan}
    />
  );
}
