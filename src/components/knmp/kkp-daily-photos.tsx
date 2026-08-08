import { susunKartu } from "@/lib/daily-report/kkp-lampiran-susun";
import type { BuktiPelengkap, KkpDailyData } from "./kkp-daily-report";

/**
 * DOKUMENTASI PEKERJAAN — versi HTML dari `lib/pdf/harian-kkp-lampiran.ts`.
 *
 * Dua kartu berdampingan per halaman, tiap kartu memuat kop pelaksana, nama
 * pekerjaan + bangunannya, lalu maksimal 3 foto dengan kolom bobot. Pembagian
 * kartunya memakai `susunKartu` yang SAMA dengan PDF — kalau layar
 * mengelompokkan sendiri, cepat atau lambat urutan fotonya berbeda dari
 * dokumen yang dikirim.
 *
 * ### Satu tabel, bukan tumpukan baris flex
 *
 * Teguran user 2026-08-07: *"kamu bikin garis antara kolom gambar dan bobot
 * saja tidak lurus."* Versi pertama menyusun tiap baris sebagai `flex`
 * tersendiri dengan rasio yang sama (4,2 : 1). Rasionya memang sama, tapi flex
 * membagi SISA ruang, dan sisa ruang tiap baris berbeda karena padding serta
 * lebar-minimum isinya berbeda — baris judul berisi teks yang bisa membungkus,
 * baris foto berisi gambar dengan lebar intrinsik. Hasilnya batas kolom
 * bergeser beberapa piksel antar baris, dan pada dokumen bergaris itu langsung
 * terlihat ceroboh.
 *
 * Sekarang satu `<table class="table-fixed">` dengan SATU `<colgroup>`: batas
 * kolom dihitung sekali untuk seluruh kartu, jadi tidak ada lagi baris yang
 * bisa menghitungnya sendiri. Alasan yang sama dengan blanko harian, yang juga
 * memakai satu tabel supaya semua garisnya bertemu.
 *
 * Tidak menggambar apa pun bila tidak ada foto: halaman kosong berjudul
 * "DOKUMENTASI PEKERJAAN" hanya membuat pembaca mengira fotonya hilang.
 */

const pctFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Tiga kolom untuk DUA batas, sama persis dengan PDF:
 *   batas label  (kolom 1 | 2+3) = 1,1 : 3,4  → 24,444%
 *   batas bobot  (kolom 1+2 | 3) = 4,2 : 1    → 80,769%
 */
const KOL = ["24.444%", "56.325%", "19.231%"];

export type FotoCetak = {
  url: string;
  pekerjaan: string | null;
  kategori: string | null;
  bobot: number | null;
  /**
   * Tautan ke gambar PENUH di cloud (`/api/foto/<token>`, DECISIONS 125).
   *
   * Permintaan user 2026-08-07: *"fotonya harusnya juga bisa diklik ke ukuran
   * yang lebih besar/cloud. tapi tidak perlu di crop, apa adanya seperti
   * sekarang, hanya beri link ke gambar yang lebih besar."* — gambarnya TIDAK
   * disentuh; yang ditambah hanya pembungkus yang bisa diklik.
   *
   * Sengaja tautan `/api/foto/<token>` yang SAMA dengan PDF, bukan URL
   * presigned R2 yang kebetulan sudah ada di halaman: presigned kedaluwarsa
   * dalam hitungan menit, dan tautan yang mati di dokumen resmi lebih buruk
   * daripada tidak ada tautan. null = origin tidak diketahui → tidak dikarang.
   */
  link?: string | null;
};

export function KkpDailyPhotos({ d, foto }: { d: KkpDailyData; foto: FotoCetak[] }) {
  const kartu = susunKartu(foto);
  if (kartu.length === 0) return null;

  const halaman: FotoCetak[][][] = [];
  for (let i = 0; i < kartu.length; i += 2) halaman.push(kartu.slice(i, i + 2));

  return (
    <>
      {halaman.map((pasangan, i) => (
        <section
          key={`dok${i}`}
          className="mt-6 grid grid-cols-2 items-start gap-4 break-before-page text-slate-900"
        >
          {pasangan.map((k, j) => (
            <Kartu
              key={`k${i}-${j}`}
              kartu={k}
              vendor={{ nama: d.contractorFirm, alamat: d.contractorAddress }}
            />
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * DOKUMENTASI MATERIAL / PERALATAN (DECISIONS 304) — halaman SENDIRI, sesudah
 * dokumentasi pekerjaan.
 *
 * Permintaan user 2026-08-08: *"foto material dan alat juga perlu disendirikan
 * / start halaman tersendiri setelah data foto-foto pekerjaan"*, dan
 * masing-masing (material sendiri, alat sendiri) mulai di halaman baru.
 *
 * Pengelompokan kartunya memakai `susunKartu` YANG SAMA dengan foto pekerjaan
 * — kuncinya cuma dipetakan dari `nama` ke `pekerjaan`. Menyalin logikanya ke
 * sini akan mengulang kesalahan yang sudah dua kali dicatat (DECISIONS
 * 241/301): dua penyusun yang berbeda cepat atau lambat menyimpang.
 */
export function KkpDailyPelengkapPhotos({
  d,
  foto,
  judul,
  labelBaris,
}: {
  d: KkpDailyData;
  foto: (BuktiPelengkap & { url: string; link?: string | null })[];
  judul: string;
  labelBaris: string;
}) {
  if (foto.length === 0) return null;
  const kartu = susunKartu(foto.map((f) => ({ ...f, pekerjaan: f.nama })));
  const halaman: (typeof kartu)[] = [];
  for (let i = 0; i < kartu.length; i += 2) halaman.push(kartu.slice(i, i + 2));

  return (
    <>
      {halaman.map((pasangan, i) => (
        <section
          key={`${judul}-${i}`}
          className="mt-6 grid grid-cols-2 items-start gap-4 break-before-page text-slate-900"
        >
          {pasangan.map((k, j) => (
            <table
              key={`${judul}-${i}-${j}`}
              className="w-full table-fixed border-collapse break-inside-avoid text-[9px]"
            >
              <colgroup>
                {KOL.map((w) => (
                  <col key={w} style={{ width: w }} />
                ))}
              </colgroup>
              <tbody>
                <tr>
                  <Sel colSpan={3} tengah className="h-[34px]">
                    <div className="text-[8px] leading-tight font-bold uppercase">
                      {d.contractorFirm ?? ""}
                    </div>
                    {d.contractorAddress ? (
                      <div className="text-[6.5px] leading-tight text-ink-muted">
                        {d.contractorAddress}
                      </div>
                    ) : null}
                  </Sel>
                </tr>
                <tr>
                  <Sel colSpan={3} className="bg-slate-50 text-center text-[10px] font-bold uppercase">
                    {judul}
                  </Sel>
                </tr>
                <tr>
                  <Sel>{labelBaris}</Sel>
                  <Sel colSpan={2} className="font-semibold">
                    {k[0]?.nama}
                  </Sel>
                </tr>
                <tr>
                  <Sel>Jumlah</Sel>
                  {/* Jumlah yang TIDAK diisi ditulis "—", bukan 0: "belum
                      diisi" berbeda dari "nol". */}
                  <Sel colSpan={2}>{k[0]?.keterangan ?? "—"}</Sel>
                </tr>
                {k.map((f, n) => (
                  <tr key={`${f.id}-${n}`}>
                    <Sel colSpan={3} tengah className="text-center">
                      <Gambar url={f.url} link={f.link} />
                    </Sel>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </section>
      ))}
    </>
  );
}

function Kartu({
  kartu,
  vendor,
}: {
  kartu: FotoCetak[];
  vendor: { nama?: string | null; alamat?: string | null };
}) {
  return (
    <table className="w-full table-fixed border-collapse break-inside-avoid text-[9px]">
      <colgroup>
        {KOL.map((w) => (
          <col key={w} style={{ width: w }} />
        ))}
      </colgroup>
      <tbody>
        {/* Kop pelaksana — sama di tiap kartu, seperti contoh KKP. */}
        <tr>
          <Sel colSpan={3} tengah className="h-[34px]">
            <div className="text-[8px] leading-tight font-bold uppercase">{vendor.nama ?? ""}</div>
            {vendor.alamat ? (
              <div className="text-[6.5px] leading-tight text-ink-muted">{vendor.alamat}</div>
            ) : null}
          </Sel>
        </tr>
        <tr>
          <Sel colSpan={3} className="bg-slate-50 text-center text-[10px] font-bold uppercase">
            Dokumentasi Pekerjaan
          </Sel>
        </tr>
        <tr>
          <Sel>Pekerjaan</Sel>
          <Sel colSpan={2} className="font-semibold">
            {kartu[0]?.pekerjaan ?? "(tanpa item pekerjaan)"}
          </Sel>
        </tr>
        <tr>
          <Sel>Bangunan</Sel>
          <Sel colSpan={2}>{kartu[0]?.kategori ?? "—"}</Sel>
        </tr>

        {kartu.map((f, i) => (
          <FotoBaris key={`f${i}`} f={f} />
        ))}
      </tbody>
    </table>
  );
}

/** Judul + gambar satu foto. Dipisah supaya kedua barisnya tidak terpisah halaman. */
function FotoBaris({ f }: { f: FotoCetak }) {
  return (
    <>
      <tr>
        <Sel colSpan={2} className="bg-slate-50 text-center text-[7px] font-semibold uppercase">
          {f.pekerjaan ?? "Dokumentasi lapangan"}
        </Sel>
        <Sel className="bg-slate-50 text-center text-[7px] font-semibold uppercase">Bobot (%)</Sel>
      </tr>
      <tr>
        <Sel colSpan={2} tengah className="text-center">
          {/* Gambarnya sama persis dengan/tanpa tautan — yang berubah hanya
              pembungkusnya, bukan ukuran atau pemotongannya. */}
          <Gambar url={f.url} link={f.link} />
        </Sel>
        {/* Bobot DIISI bila diketahui — angkanya sudah ada di sistem, jadi
            mengosongkannya justru menyuruh orang menghitung ulang. */}
        <Sel tengah className="text-center text-[9px] font-bold tabular-nums">
          {f.bobot != null ? pctFmt.format(f.bobot) : ""}
        </Sel>
      </tr>
    </>
  );
}

/**
 * Foto apa adanya; kalau ada tautannya, dibungkus anchor ke gambar penuh.
 * TIDAK di-crop dan tidak diubah ukurannya — permintaan user eksplisit.
 */
function Gambar({ url, link }: { url: string; link?: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={url} alt="" className="mx-auto max-h-[46mm] w-auto max-w-full object-contain" />;
  if (!link) return img;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      title="Buka foto ukuran penuh"
      className="block"
    >
      {img}
    </a>
  );
}

/**
 * `tengah` MEMILIH `align-middle`, bukan menumpuknya di atas `align-top`.
 * Dua utility Tailwind untuk properti yang sama tidak ditentukan urutan
 * penulisannya di atribut class, melainkan urutan di stylesheet — menumpuk
 * keduanya berarti menyerahkan hasilnya pada kebetulan.
 */
function Sel({
  children,
  colSpan,
  tengah,
  className = "",
}: {
  children?: React.ReactNode;
  colSpan?: number;
  tengah?: boolean;
  className?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`border border-slate-500 px-1.5 py-0.5 ${tengah ? "align-middle" : "align-top"} ${className}`}
    >
      {children}
    </td>
  );
}
