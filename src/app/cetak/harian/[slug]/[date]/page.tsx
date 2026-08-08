import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { KkpDailyReport } from "@/components/knmp/kkp-daily-report";
import { KkpDailyCover } from "@/components/knmp/kkp-daily-cover";
import {
  KkpDailyPelengkapPhotos,
  KkpDailyPhotos,
  type FotoCetak,
} from "@/components/knmp/kkp-daily-photos";
import type { BuktiPelengkap } from "@/components/knmp/kkp-daily-report";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getKkpDailyData } from "@/lib/daily-report/queries";
import { parseDateKey } from "@/lib/format";
import { presignKeys } from "@/lib/photos";
import { getRequestOrigin } from "@/lib/http";
import { signPhotoToken } from "@/lib/pdf/photo-token";
import { PRINT_BACK_PARAM, safeBackPath } from "@/lib/print-back";

export const dynamic = "force-dynamic";

/**
 * Cetak Laporan Harian format KKP — A4, tanpa shell aplikasi.
 *
 * Halaman ini memuat dokumen LENGKAP: sampul → blanko harian → dokumentasi
 * pekerjaan, susunan yang sama persis dengan PDF-nya. Sebelumnya hanya blanko
 * (pertanyaan user 2026-08-07: *"kenapa pratinjau dan cetak laporan kkp di
 * halaman harian masih satu halaman blanko saja?"*) — dokumen resmi tidak
 * boleh berbeda tergantung tombol mana yang ditekan.
 */
export default async function CetakHarianPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; date: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, date } = await params;
  const sp = await searchParams;
  if (!parseDateKey(date)) notFound();
  const user = await requireUser();
  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const data = await getKkpDailyData(slug, date);
  if (!data) notFound();

  /*
   * Foto & logo pelaksana dipresign di sini, bukan di query: `getKkpDailyData`
   * juga melayani jalur PDF yang membaca R2 langsung dan tidak butuh URL
   * bertanda tangan. Kegagalan R2 TIDAK boleh menggagalkan cetakan — blankonya
   * tetap tercetak, halaman dokumentasi yang ikut kosong, dan itu terlihat.
   */
  const origin = await getRequestOrigin();
  const tautan = (id: string) => (origin ? `${origin}/api/foto/${signPhotoToken(id)}` : null);
  let fotoCetak: FotoCetak[] = [];
  /** Bukti material & alat (DECISIONS 304) — halamannya sendiri-sendiri. */
  type FotoPelengkap = BuktiPelengkap & { url: string; link?: string | null };
  let fotoMaterial: FotoPelengkap[] = [];
  let fotoAlat: FotoPelengkap[] = [];
  let logoVendorUrl: string | null = null;
  try {
    const kunci = [
      ...(data.photos ?? []).map((p) => p.r2Key),
      ...(data.materialPhotos ?? []).map((p) => p.r2Key),
      ...(data.equipmentPhotos ?? []).map((p) => p.r2Key),
      ...(data.vendorLogoKey ? [data.vendorLogoKey] : []),
    ];
    if (kunci.length > 0) {
      const url = await presignKeys(kunci, 900);
      fotoCetak = (data.photos ?? []).flatMap((p) => {
        const u = url.get(p.r2Key);
        if (!u) return [];
        return [
          {
            url: u,
            pekerjaan: p.pekerjaan,
            kategori: p.kategori,
            bobot: p.bobot,
            // Tautan yang SAMA dengan PDF-nya (DECISIONS 125) — permanen dan
            // bisa dibuka tanpa login, tidak seperti URL presigned di atas yang
            // habis dalam hitungan menit. Tanpa origin yang diketahui, tautannya
            // tidak dikarang.
            link: tautan(p.id),
          },
        ];
      });
      const pelengkap = (rows: BuktiPelengkap[]): FotoPelengkap[] =>
        rows.flatMap((p) => {
          const u = url.get(p.r2Key);
          return u ? [{ ...p, url: u, link: tautan(p.id) }] : [];
        });
      fotoMaterial = pelengkap(data.materialPhotos ?? []);
      fotoAlat = pelengkap(data.equipmentPhotos ?? []);
      logoVendorUrl = data.vendorLogoKey ? (url.get(data.vendorLogoKey) ?? null) : null;
    }
  } catch (err) {
    console.error("[cetak-harian] lampiran gagal disiapkan:", err);
  }

  return (
    <>
      <PrintToolbar
        backHref={safeBackPath(
          typeof sp[PRINT_BACK_PARAM] === "string" ? sp[PRINT_BACK_PARAM] : undefined,
          // Cadangan: laporan harian tanggal itu sendiri — BUKAN daftar laporan
          // lokasi (di sana ada laporan mingguan, terasa nyasar).
          `/lokasi/${slug}/harian/${date}`,
        )}
      />
      <main className="mx-auto max-w-[900px] bg-white p-6 print:p-0">
      {!data.isFinal && (
        <p className="no-print mb-3 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm">
          Pratinjau — laporan belum difinalisasi (data live, bukan snapshot).
        </p>
      )}
      {/* Form bergaris fixed-layout: scroll horizontal di layar sempit. */}
      <div className="overflow-x-auto print:overflow-visible">
        <div className="min-w-[720px]">
          <KkpDailyCover d={data} logoVendorUrl={logoVendorUrl} />
          <div className="mt-6 break-before-page">
            <KkpDailyReport d={data} />
          </div>
          <KkpDailyPhotos d={data} foto={fotoCetak} />
          {/* Masing-masing mulai di halaman baru — permintaan user 2026-08-08. */}
          <KkpDailyPelengkapPhotos
            d={data}
            foto={fotoMaterial}
            judul="Dokumentasi Material Masuk"
            labelBaris="Material"
          />
          <KkpDailyPelengkapPhotos
            d={data}
            foto={fotoAlat}
            judul="Dokumentasi Peralatan"
            labelBaris="Alat"
          />
        </div>
      </div>
      </main>
    </>
  );
}
