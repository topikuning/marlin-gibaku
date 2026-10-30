import { formatTanggal } from "@/lib/format";
import type { JenisSuratPenyedia } from "@/generated/prisma/enums";

/**
 * SURAT BERKOP PENYEDIA – aturan & isi MURNI (DECISIONS 716).
 *
 * Permintaan user 2026-10-30: *"terutama kalau perlu buat surat yang bisa kamu
 * generate yang kop suratnya cv putera fahlevi"*, dengan berkas TERMIN 1 CV.
 * Putera Fahlevi (lengkap & sudah cair) sebagai contoh.
 *
 * Isi surat disusun SEKALI di sini sebagai blok (paragraf, pasangan
 * label–isi, daftar, tanda tangan) lalu digambar dua penggambar: PDF dan Word.
 * Dua penggambar yang masing-masing menulis kalimatnya sendiri akan berbeda
 * kalimat – persis jenis selisih yang membuat contoh aslinya memuat tiga ejaan
 * nama direktur.
 *
 * Angka uang TIDAK dihitung di sini: nilai tagihan termin datang dari
 * `rincianTagihanTermin` (calculation layer keuangan); modul ini hanya
 * menuliskannya – rupiah dan terbilangnya.
 *
 * Tahap 2b (DECISIONS 717): jadwal termin bawaan KKP, retensi termin akhir,
 * Surat Permohonan Pemeriksaan, dan BA Pembahasan Kemajuan Pekerjaan.
 */

/* ── Angka & tanggal ────────────────────────────────────────────────────── */

const SATUAN = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan"];

function ratusan(n: number): string {
  const r = Math.floor(n / 100);
  const sisa = n % 100;
  const bagian: string[] = [];
  if (r === 1) bagian.push("Seratus");
  else if (r > 1) bagian.push(`${SATUAN[r]} Ratus`);
  if (sisa >= 20) {
    bagian.push(`${SATUAN[Math.floor(sisa / 10)]} Puluh`);
    if (sisa % 10) bagian.push(SATUAN[sisa % 10]);
  } else if (sisa >= 12) bagian.push(`${SATUAN[sisa - 10]} Belas`);
  else if (sisa === 11) bagian.push("Sebelas");
  else if (sisa === 10) bagian.push("Sepuluh");
  else if (sisa > 0) bagian.push(SATUAN[sisa]);
  return bagian.join(" ");
}

const SKALA = ["", "Ribu", "Juta", "Miliar", "Triliun"];

/** Terbilang bilangan bulat ≥ 0 (sampai ratusan triliun), huruf awal kapital. */
export function terbilang(n: bigint): string {
  if (n < 0n) return `Minus ${terbilang(-n)}`;
  if (n === 0n) return "Nol";
  const kelompok: number[] = [];
  let x = n;
  while (x > 0n) {
    kelompok.push(Number(x % 1000n));
    x /= 1000n;
  }
  if (kelompok.length > SKALA.length) throw new Error("Angka terlalu besar untuk terbilang.");
  const bagian: string[] = [];
  for (let i = kelompok.length - 1; i >= 0; i--) {
    const k = kelompok[i];
    if (k === 0) continue;
    if (i === 1 && k === 1) bagian.push("Seribu");
    else bagian.push(`${ratusan(k)}${SKALA[i] ? ` ${SKALA[i]}` : ""}`);
  }
  return bagian.join(" ");
}

/** "Dua Miliar … Delapan Ratus Rupiah". */
export function terbilangRupiah(n: bigint): string {
  return `${terbilang(n)} Rupiah`;
}

/** "Rp 2.695.798.800,-" */
export function rupiahSurat(n: bigint): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}Rp ${s},-`;
}

/** Persen gaya Indonesia: 20 → "20%", 26.6 → "26,6%". */
export function persenSurat(p: number): string {
  return `${p.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
}

const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** Bulan 1–12 → angka Romawi, seperti di nomor surat ("…/IX/2026"). */
export function bulanRomawi(bulan: number): string {
  const r = ROMAWI[bulan - 1];
  if (!r) throw new Error(`Bulan tidak valid: ${bulan}`);
  return r;
}

const URUTAN = ["Pertama", "Kedua", "Ketiga", "Keempat", "Kelima", "Keenam", "Ketujuh", "Kedelapan", "Kesembilan", "Kesepuluh"];

/** Termin 1 → "Pertama". */
export function urutanTermin(ke: number): string {
  return URUTAN[ke - 1] ?? `Ke-${ke}`;
}

/** Tanggal surat: "17 September 2026" (zona Asia/Jakarta). */
export function tanggalSurat(d: Date): string {
  return formatTanggal(d, "d MMMM yyyy");
}

/** "Rabu, tanggal Enam Belas, bulan September, tahun Dua Ribu Dua Puluh Enam" (WIB). */
export function hariTanggalTerbilang(d: Date): string {
  const [hari, tgl, bulan, tahun] = formatTanggal(d, "EEEE|d|MMMM|yyyy").split("|");
  return `${hari}, tanggal ${terbilang(BigInt(tgl))}, bulan ${bulan}, tahun ${terbilang(BigInt(tahun))}`;
}

/* ── Jadwal termin bawaan KKP ───────────────────────────────────────────── */

export type BarisJadwal = { terminKe: number; ambangPct: number; bayarPct: number; retensiPct: number };

/**
 * JADWAL TERMIN BAWAAN KKP (ketetapan user 2026-10-30): *"di semua kkp,
 * termin nya 4x"* – progres 25% ditagih 20%, 50% → 25%, 80% → 30%, 100% →
 * 25% dengan retensi 5% ditahan, jadi termin 4 dibayar 20%. Retensi bisa
 * dicairkan dengan jaminan pemeliharaan, tidak harus menunggu FHO.
 *
 * Langsung berlaku untuk kontrak yang belum menyimpan jadwal sendiri.
 */
export const JADWAL_TERMIN_BAWAAN: readonly BarisJadwal[] = [
  { terminKe: 1, ambangPct: 25, bayarPct: 20, retensiPct: 0 },
  { terminKe: 2, ambangPct: 50, bayarPct: 25, retensiPct: 0 },
  { terminKe: 3, ambangPct: 80, bayarPct: 30, retensiPct: 0 },
  { terminKe: 4, ambangPct: 100, bayarPct: 25, retensiPct: 5 },
];

/** Jadwal yang berlaku: milik kontrak bila ada, selain itu bawaan KKP. */
export function jadwalBerlaku(tersimpan: readonly BarisJadwal[]): { bawaan: boolean; baris: readonly BarisJadwal[] } {
  return tersimpan.length > 0 ? { bawaan: false, baris: tersimpan } : { bawaan: true, baris: JADWAL_TERMIN_BAWAAN };
}

/** Jumlah persen bayar termin-termin SEBELUM `terminKe` – dasar pembulatan kumulatif. */
export function pctSebelum(jadwal: readonly BarisJadwal[], terminKe: number): number {
  return jadwal.filter((t) => t.terminKe < terminKe).reduce((s, t) => s + t.bayarPct, 0);
}

/* ── Nomor surat ────────────────────────────────────────────────────────── */

/**
 * Pola nomor perusahaan, mis. "324.{urut}/SP/PF-KNMP-ATMP/{bulan}/{tahun}".
 * `{urut}` wajib ada – tanpa itu semua surat bernomor sama.
 */
export function polaNomorSah(pola: string): string | null {
  const p = pola.trim();
  if (!p) return "Pola nomor surat masih kosong.";
  if (!p.includes("{urut}")) return "Pola nomor surat harus memuat {urut}, tempat nomor urut surat.";
  const asing = [...p.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((k) => !["urut", "bulan", "tahun"].includes(k));
  if (asing.length > 0) return `Penanda {${asing[0]}} tidak dikenal. Yang bisa dipakai: {urut}, {bulan}, {tahun}.`;
  return null;
}

/** Isi pola: {urut} nomor urut, {bulan} bulan Romawi, {tahun} empat angka (WIB). */
export function susunNomor(pola: string, urut: number, tanggal: Date): string {
  const [tahun, bulan] = formatTanggal(tanggal, "yyyy-M").split("-");
  return pola
    .trim()
    .replaceAll("{urut}", String(urut))
    .replaceAll("{bulan}", bulanRomawi(Number(bulan)))
    .replaceAll("{tahun}", tahun);
}

/** Tahun surat (WIB) – nomor urut dihitung ulang tiap tahun. */
export function tahunSurat(tanggal: Date): number {
  return Number(formatTanggal(tanggal, "yyyy"));
}

/* ── Isi surat ──────────────────────────────────────────────────────────── */

export const LABEL_JENIS_SURAT: Record<JenisSuratPenyedia, string> = {
  permohonan_pemeriksaan: "Surat Permohonan Pemeriksaan Pekerjaan",
  ba_pembahasan_kemajuan: "BA Pembahasan Kemajuan Pekerjaan",
  permohonan_pembayaran: "Surat Permohonan Pembayaran",
  invoice: "Invoice",
  kwitansi: "Kwitansi",
};

/** Jenis surat yang bisa disusun, berurutan seperti berkas termin. */
export const JENIS_SURAT_TERSEDIA: JenisSuratPenyedia[] = [
  "permohonan_pemeriksaan",
  "ba_pembahasan_kemajuan",
  "permohonan_pembayaran",
  "invoice",
  "kwitansi",
];

/** Surat yang memuat progres dari laporan konsultan. */
export const JENIS_SURAT_PROGRES: JenisSuratPenyedia[] = ["permohonan_pemeriksaan", "ba_pembahasan_kemajuan"];

/** Isian bawaan BA pembahasan kemajuan, mengikuti contoh TERMIN 1. */
export const PIMPINAN_RAPAT_BAWAAN = "Wakil Sah PPK Sesditjen DJPT";
export const CARA_RAPAT_BAWAAN = "secara hybrid melalui zoom meeting";
export function pesertaRapatBawaan(penyedia: string, konsultan: string | null): string[] {
  return [
    "Wakil Sah PPK",
    `Konsultan Pengawas${konsultan ? ` ${konsultan}` : ""}`,
    "Tenaga Ahli Teknis KNMP",
    "Tenaga Ahli Administrasi KNMP",
    `Direktur ${penyedia}`,
  ];
}

/** Alamat tujuan bawaan – PPK KNMP, persis contoh; bisa diubah per surat. */
export const KEPADA_BAWAAN = [
  "Pejabat Pembuat Komitmen Kegiatan Kampung Nelayan Merah Putih",
  "Satker Sekretariat Direktorat Jenderal Perikanan Tangkap",
  "Kementerian Kelautan dan Perikanan",
];

export type Run = { teks: string; tebal?: boolean; garisBawah?: boolean };

export type Blok =
  | { jenis: "paragraf"; isi: Run[]; rata?: "kiri" | "kanan" | "tengah" | "penuh"; jarakAtas?: number }
  | { jenis: "judul"; teks: string; sub?: string }
  | { jenis: "pasangan"; baris: { label: string; isi: Run[] }[] }
  | {
      jenis: "daftar";
      butir: string[];
      /** "angka" 1. · "kurung" (1) · "huruf" a) · "poin" • – bawaan "angka". */
      penanda?: "angka" | "kurung" | "huruf" | "poin";
      /** Nomor/huruf pertama (melanjutkan daftar yang diselingi). */
      mulai?: number;
      /** 1 = anak daftar (menjorok sekali lagi). */
      tingkat?: 0 | 1;
    }
  | {
      /** Dua tanda tangan berdampingan (BA: penyedia & konsultan). */
      jenis: "ttd2";
      kiri: PihakTtd;
      kanan: PihakTtd;
    }
  | {
      jenis: "ttd";
      tempatTanggal: string | null;
      salam: string;
      perusahaan: string;
      nama: string;
      jabatan: string;
      /** Tempat meterai di atas tanda tangan (kwitansi). */
      meterai: boolean;
      /** Kotak nominal di sisi kiri (kwitansi). */
      kotakNominal: string | null;
    };

export type PihakTtd = { peran: string; perusahaan: string; nama: string; jabatan: string };

/** Penanda butir daftar – satu tempat, supaya PDF dan Word sama persis. */
export function penandaButir(b: Extract<Blok, { jenis: "daftar" }>, i: number): string {
  const n = (b.mulai ?? 1) + i;
  switch (b.penanda ?? "angka") {
    case "kurung":
      return `(${n})`;
    case "huruf":
      return `${String.fromCharCode(96 + n)})`;
    case "poin":
      return "•";
    default:
      return `${n}.`;
  }
}

export type SuratTersusun = { judulBerkas: string; blok: Blok[] };

export type DataSurat = {
  jenis: JenisSuratPenyedia;
  penyedia: { nama: string; npwp: string | null };
  penandaTangan: { nama: string; jabatan: string };
  kontrak: { nomor: string; tanggal: Date; judul: string; nilai: bigint };
  bank: { nama: string; rekening: string; atasNama: string } | null;
  /** `bruto` = persen bayar × nilai kontrak; `nilai` = yang DIBAYAR (bruto − retensi). */
  termin: {
    ke: number;
    ambangPct: number;
    bayarPct: number;
    retensiPct: number;
    bruto: bigint;
    retensi: bigint;
    nilai: bigint;
  };
  /** Progres menurut laporan konsultan untuk termin ini; null = belum diisi. */
  progres: {
    pct: number;
    mingguKe: number;
    lokasi: { nama: string; nomor: string; tanggal: Date; mingguKe: number; persen: number }[];
  } | null;
  /** Konsultan pengawas & penanda tangannya di BA (Co-Team Leader / Team Leader). */
  konsultan: { firma: string | null; nama: string | null; jabatan: string };
  surat: {
    nomor: string;
    tanggal: Date;
    kota: string;
    kepada: string[];
    lampiran: string[];
    rapat: { pimpinan: string; peserta: string[]; cara: string };
  };
};

const t = (teks: string, tebal = false): Run => ({ teks, tebal });

/** Hal yang belum lengkap untuk menyusun surat ini – kosong = siap. */
export function kekuranganData(d: DataSurat): string[] {
  const kurang: string[] = [];
  if (!d.penandaTangan.nama.trim()) kurang.push("nama penanda tangan penyedia (Kontrak › Penanda tangan)");
  if ((d.jenis === "invoice" || d.jenis === "kwitansi") && !d.bank)
    kurang.push("rekening bank penyedia (Termin & Surat › Data surat)");
  if ((d.jenis === "invoice" || d.jenis === "kwitansi") && !d.penyedia.npwp?.trim())
    kurang.push("NPWP perusahaan (Master › Perusahaan)");
  if (d.termin.nilai <= 0n) kurang.push("persen pembayaran termin ini (Termin & Surat › Jadwal termin)");
  if (JENIS_SURAT_PROGRES.includes(d.jenis)) {
    if (!d.konsultan.firma?.trim()) kurang.push("nama firma konsultan pengawas (Kontrak › Penanda tangan)");
    if (!d.progres) kurang.push(`progres dari laporan konsultan untuk termin ${d.termin.ke} (Termin & Surat › Progres laporan konsultan)`);
    else if (d.progres.pct < d.termin.ambangPct)
      kurang.push(
        `progres laporan konsultan yang mencapai ambang termin ${d.termin.ke}: tercatat ${persenSurat(d.progres.pct)}, ` +
          `ambangnya ${persenSurat(d.termin.ambangPct)}`,
      );
  }
  if (d.jenis === "ba_pembahasan_kemajuan" && !d.konsultan.nama?.trim())
    kurang.push("nama Co-Team Leader atau Team Leader konsultan (Kontrak › Penanda tangan)");
  return kurang;
}

function kepalaSurat(d: DataSurat, perihal: string): Blok[] {
  return [
    { jenis: "paragraf", isi: [t(`${d.surat.kota}, ${tanggalSurat(d.surat.tanggal)}`)], rata: "kanan" },
    {
      jenis: "pasangan",
      baris: [
        { label: "Nomor", isi: [t(d.surat.nomor)] },
        { label: "Perihal", isi: [t(perihal, true)] },
        { label: "Lampiran", isi: [t(d.surat.lampiran.length > 0 ? "1 (satu) berkas" : "–")] },
      ],
    },
    {
      jenis: "paragraf",
      isi: [t(["Kepada Yth,", ...d.surat.kepada, "di –", "Tempat"].join("\n"))],
      jarakAtas: 10,
    },
    { jenis: "paragraf", isi: [t("Dengan Hormat,")], jarakAtas: 10 },
  ];
}

function tandaTangan(d: DataSurat, o: { tempatTanggal: boolean; meterai?: boolean; kotakNominal?: string | null }): Blok {
  return {
    jenis: "ttd",
    tempatTanggal: o.tempatTanggal ? `${d.surat.kota}, ${tanggalSurat(d.surat.tanggal)}` : null,
    salam: o.meterai ? "Penyedia Jasa," : "Hormat kami,",
    perusahaan: d.penyedia.nama,
    nama: d.penandaTangan.nama,
    jabatan: d.penandaTangan.jabatan,
    meterai: o.meterai ?? false,
    kotakNominal: o.kotakNominal ?? null,
  };
}

function rincianKontrak(d: DataSurat): string {
  return `Surat Perjanjian Nomor: ${d.kontrak.nomor} tanggal ${tanggalSurat(d.kontrak.tanggal)}`;
}

/** "20% × Rp 13.478.994.000,- = Rp 2.695.798.800,-" (nilai bruto termin). */
function hitunganTermin(d: DataSurat): string {
  return `${persenSurat(d.termin.bayarPct)} × ${rupiahSurat(d.kontrak.nilai)} = ${rupiahSurat(d.termin.bruto)}`;
}

/** "5% × Rp 13.478.994.000,- = Rp 673.949.700,-" */
function hitunganRetensi(d: DataSurat): string {
  return `${persenSurat(d.termin.retensiPct)} × ${rupiahSurat(d.kontrak.nilai)} = ${rupiahSurat(d.termin.retensi)}`;
}

const adaRetensi = (d: DataSurat) => d.termin.retensi > 0n;

/** "Lokasi KNMP Desa Asemdoyong" – nama yang sudah memuat Desa/Kelurahan tidak digandakan. */
function namaLokasiSurat(nama: string): string {
  return /^(desa|kelurahan|kel\.)\s/i.test(nama.trim()) ? `Lokasi KNMP ${nama.trim()}` : `Lokasi KNMP Desa ${nama.trim()}`;
}

/** "di 4 lokasi" / "di Lokasi KNMP Desa X" – kalimat BA mengikuti jumlah lokasi. */
function cakupanLokasi(d: DataSurat): string {
  const n = d.progres?.lokasi.length ?? 0;
  return n === 1 ? `di ${namaLokasiSurat(d.progres!.lokasi[0].nama)}` : `di ${n} lokasi`;
}

export function susunSurat(d: DataSurat): SuratTersusun {
  const ke = urutanTermin(d.termin.ke);
  switch (d.jenis) {
    case "permohonan_pembayaran":
      return {
        judulBerkas: `Surat Permohonan Pembayaran Termin ${d.termin.ke} - ${d.penyedia.nama}`,
        blok: [
          ...kepalaSurat(d, `Permohonan Pembayaran Termin ${ke}`),
          {
            jenis: "paragraf",
            rata: "penuh",
            isi: [
              t(
                `Sehubungan dengan ${rincianKontrak(d)} tentang ${d.kontrak.judul} dengan nilai Kontrak sebesar ` +
                  `${rupiahSurat(d.kontrak.nilai)} (${terbilangRupiah(d.kontrak.nilai)}), maka dengan ini kami ` +
                  `mengajukan permohonan Pembayaran Termin ${ke} sesuai dengan yang tertuang dalam Syarat-Syarat ` +
                  `Khusus Kontrak sebesar ${hitunganTermin(d)}` +
                  (adaRetensi(d) ? `, dikurangi retensi sebesar ${hitunganRetensi(d)}` : "") +
                  `. Sehingga Pembayaran Termin ${ke} menjadi sebesar `,
              ),
              t(rupiahSurat(d.termin.nilai), true),
              t(` (${terbilangRupiah(d.termin.nilai)}).`),
            ],
          },
          ...(d.surat.lampiran.length > 0
            ? ([
                {
                  jenis: "paragraf",
                  isi: [t(`Bersama Surat Permohonan Pembayaran Termin ${ke} ini kami lampirkan:`)],
                },
                { jenis: "daftar", butir: d.surat.lampiran },
              ] satisfies Blok[])
            : []),
          {
            jenis: "paragraf",
            rata: "penuh",
            isi: [
              t(
                `Demikian Surat Permohonan Pembayaran Termin ${ke} ini kami buat, atas perhatian dan kerja samanya ` +
                  "kami ucapkan terima kasih.",
              ),
            ],
          },
          tandaTangan(d, { tempatTanggal: false }),
        ],
      };

    case "invoice":
      return {
        judulBerkas: `Invoice Termin ${d.termin.ke} - ${d.penyedia.nama}`,
        blok: [
          { jenis: "paragraf", isi: [t(`${d.surat.kota}, ${tanggalSurat(d.surat.tanggal)}`)], rata: "kanan" },
          { jenis: "judul", teks: "INVOICE", sub: `Nomor ${d.surat.nomor}` },
          { jenis: "paragraf", isi: [t(["Kepada Yth,", ...d.surat.kepada, "di –", "Tempat"].join("\n"))] },
          { jenis: "paragraf", isi: [t("Dengan Hormat,")], jarakAtas: 10 },
          {
            jenis: "paragraf",
            rata: "penuh",
            isi: [
              t(
                `Bersama ini kami sampaikan invoice Pembayaran Termin ${ke} atas pekerjaan dengan nilai Kontrak ` +
                  `sebesar ${rupiahSurat(d.kontrak.nilai)}, sebagai berikut:`,
              ),
            ],
          },
          {
            jenis: "pasangan",
            baris: [
              { label: "Uraian Pekerjaan", isi: [t(`${d.kontrak.judul} sesuai dengan ${rincianKontrak(d)}`)] },
              ...(adaRetensi(d)
                ? [
                    { label: "Nilai Termin", isi: [t(hitunganTermin(d))] },
                    { label: "Retensi", isi: [t(`${hitunganRetensi(d)} (ditahan)`)] },
                    { label: "Total Tagihan", isi: [t(rupiahSurat(d.termin.nilai), true)] },
                  ]
                : [
                    {
                      label: "Total Tagihan",
                      isi: [t(`${persenSurat(d.termin.bayarPct)} × ${rupiahSurat(d.kontrak.nilai)} = `), t(rupiahSurat(d.termin.nilai), true)],
                    },
                  ]),
              { label: "Terbilang", isi: [t(`(${terbilangRupiah(d.termin.nilai)})`)] },
              { label: "NPWP", isi: [t(d.penyedia.npwp ?? "–")] },
              { label: "Bank", isi: [t(teksBank(d))] },
            ],
          },
          {
            jenis: "paragraf",
            rata: "penuh",
            isi: [t("Demikian invoice ini kami sampaikan. Atas perhatian dan kerja samanya, kami ucapkan terima kasih.")],
          },
          tandaTangan(d, { tempatTanggal: false }),
        ],
      };

    case "kwitansi":
      return {
        judulBerkas: `Kwitansi Termin ${d.termin.ke} - ${d.penyedia.nama}`,
        blok: [
          { jenis: "judul", teks: "KWITANSI", sub: `Nomor : ${d.surat.nomor}` },
          {
            jenis: "pasangan",
            baris: [
              { label: "Sudah Terima Dari", isi: [t(d.surat.kepada.slice(0, 2).join(" "))] },
              { label: "Sebesar", isi: [t(rupiahSurat(d.termin.nilai), true)] },
              { label: "Terbilang", isi: [t(`(${terbilangRupiah(d.termin.nilai)})`)] },
              {
                label: "Guna Membayar",
                isi: [
                  t(
                    `Pembayaran Termin ${ke}` +
                      (adaRetensi(d)
                        ? ` (${persenSurat(d.termin.bayarPct)} dikurangi retensi ${persenSurat(d.termin.retensiPct)})`
                        : "") +
                      ` ${d.kontrak.judul} sesuai dengan ${rincianKontrak(d)}`,
                  ),
                ],
              },
              { label: "NPWP", isi: [t(d.penyedia.npwp ?? "–")] },
              { label: "Bank", isi: [t(teksBank(d))] },
            ],
          },
          tandaTangan(d, { tempatTanggal: true, meterai: true, kotakNominal: rupiahSurat(d.termin.nilai) }),
        ],
      };

    case "permohonan_pemeriksaan": {
      const p = d.progres;
      if (!p) throw new Error("Progres dari laporan konsultan belum diisi.");
      const butir = p.lokasi.map(
        (l, i) =>
          `${namaLokasiSurat(l.nama)}${l.nomor ? ` Nomor: ${l.nomor}` : ""} tanggal ${tanggalSurat(l.tanggal)} ` +
          `pada Minggu ke-${l.mingguKe} sebesar ${persenSurat(l.persen)}${i === p.lokasi.length - 1 ? "." : ";"}`,
      );
      return {
        judulBerkas: `Surat Permohonan Pemeriksaan Pekerjaan Termin ${d.termin.ke} - ${d.penyedia.nama}`,
        blok: [
          ...kepalaSurat(d, "Permohonan Pemeriksaan Progres Pekerjaan"),
          {
            jenis: "paragraf",
            rata: "penuh",
            isi: [
              t(
                `Sehubungan dengan ${rincianKontrak(d)} tentang ${d.kontrak.judul} dan Laporan Kemajuan Pekerjaan ` +
                  `dari Konsultan Pengawas ${d.konsultan.firma ?? ""} dengan nilai rata-rata progres sebesar `,
              ),
              t(persenSurat(p.pct), true),
              t(butir.length > 0 ? ", yaitu:" : "."),
            ],
          },
          ...(butir.length > 0 ? ([{ jenis: "daftar", butir, penanda: "kurung" }] satisfies Blok[]) : []),
          {
            jenis: "paragraf",
            rata: "penuh",
            isi: [
              t(
                `Maka dengan ini kami mengajukan permohonan Pemeriksaan Progres Pekerjaan kepada ` +
                  `${d.surat.kepada.slice(0, 2).join(" ")} sebagai syarat pengajuan Pembayaran Termin ${ke}.`,
              ),
            ],
          },
          {
            jenis: "paragraf",
            rata: "penuh",
            isi: [t("Demikian kami sampaikan, atas perhatian dan kerja samanya kami ucapkan terima kasih.")],
          },
          tandaTangan(d, { tempatTanggal: false }),
        ],
      };
    }

    case "ba_pembahasan_kemajuan": {
      const p = d.progres;
      if (!p) throw new Error("Progres dari laporan konsultan belum diisi.");
      const r = d.surat.rapat;
      const pimpinan = r.pimpinan || PIMPINAN_RAPAT_BAWAAN;
      const peserta = r.peserta.length > 0 ? r.peserta : pesertaRapatBawaan(d.penyedia.nama, d.konsultan.firma);
      const capaian = `progres fisik pekerjaan ${cakupanLokasi(d)} pada minggu ke-${p.mingguKe} telah mencapai sebesar `;
      return {
        judulBerkas: `BA Pembahasan Kemajuan Pekerjaan Termin ${d.termin.ke} - ${d.penyedia.nama}`,
        blok: [
          {
            jenis: "judul",
            teks: `BERITA ACARA\nPEMBAHASAN KEMAJUAN HASIL PEKERJAAN (${persenSurat(d.termin.ambangPct)})`,
            sub: `Nomor ${d.surat.nomor}`,
          },
          {
            jenis: "paragraf",
            rata: "penuh",
            jarakAtas: 12,
            isi: [
              t(
                `Pada hari ini ${hariTanggalTerbilang(d.surat.tanggal)}, telah dilaksanakan Pembahasan Kemajuan ` +
                  // Judul kontrak biasanya sudah diawali "Pekerjaan …" – jangan jadi "Pekerjaan Pekerjaan".
                  `${/^pekerjaan\s/i.test(d.kontrak.judul) ? "" : "Pekerjaan "}${d.kontrak.judul}, ${rincianKontrak(d)} ` +
                  `${r.cara || CARA_RAPAT_BAWAAN} ` +
                  "dengan hasil sebagai berikut:",
              ),
            ],
          },
          { jenis: "paragraf", isi: [t("I. Peserta Rapat", true)], jarakAtas: 10 },
          {
            jenis: "paragraf",
            rata: "penuh",
            isi: [t(`Rapat atau pembahasan ini dipimpin langsung oleh ${pimpinan} dan dihadiri oleh:`)],
          },
          { jenis: "daftar", butir: peserta, penanda: "kurung" },
          { jenis: "paragraf", isi: [t("Susunan acara rapat sebagai berikut:")] },
          { jenis: "daftar", butir: ["Pembukaan", "Pembahasan Kemajuan Pekerjaan", "Penutup"], penanda: "poin" },
          { jenis: "paragraf", isi: [t("II. Hasil Rapat", true)], jarakAtas: 10 },
          { jenis: "daftar", butir: [`Penjelasan dari ${pimpinan}:`] },
          {
            jenis: "daftar",
            tingkat: 1,
            penanda: "huruf",
            butir: [
              `Berdasarkan hasil pemantauan dan evaluasi pelaksanaan pekerjaan, ${capaian}${persenSurat(p.pct)}. ` +
                `Capaian tersebut menjadi dasar Pengajuan Termin ${ke} serta memastikan kegiatan selanjutnya ` +
                "dilaksanakan sesuai dengan rencana, jadwal, dan ketentuan yang telah ditetapkan dalam kontrak.",
            ],
          },
          { jenis: "daftar", mulai: 2, butir: [`Penjelasan dari Penyedia Jasa Konstruksi, ${d.penyedia.nama}:`] },
          {
            jenis: "daftar",
            tingkat: 1,
            penanda: "huruf",
            butir: [
              "Pelaksanaan di lapangan terus dilakukan sesuai dengan rencana pelaksanaan pekerjaan. Kegiatan " +
                "difokuskan pada pekerjaan yang dapat dilaksanakan berdasarkan kondisi lapangan, ketersediaan " +
                "material, tenaga kerja, serta kesiapan area kerja.",
              "Penyedia akan melakukan percepatan dan pengendalian pelaksanaan pekerjaan di lapangan agar target " +
                "progres fisik tercapai sesuai dengan jadwal pelaksanaan yang telah ditetapkan.",
            ],
          },
          {
            jenis: "daftar",
            mulai: 3,
            butir: [`Penjelasan dari Konsultan Pengawas ${d.konsultan.firma ?? ""}:`],
          },
          {
            jenis: "daftar",
            tingkat: 1,
            penanda: "huruf",
            butir: [
              `Berdasarkan hasil pengukuran bersama di lapangan dan perhitungan volume, ${capaian}${persenSurat(p.pct)}. ` +
                "Capaian tersebut merupakan hasil verifikasi dan pengukuran terhadap pekerjaan yang telah " +
                "dilaksanakan di lapangan.",
            ],
          },
          {
            jenis: "ttd2",
            kiri: {
              peran: "Penyedia Jasa Konstruksi",
              perusahaan: d.penyedia.nama,
              nama: d.penandaTangan.nama,
              jabatan: d.penandaTangan.jabatan,
            },
            kanan: {
              peran: "Konsultan Pengawas",
              perusahaan: d.konsultan.firma ?? "",
              nama: d.konsultan.nama ?? "",
              jabatan: d.konsultan.jabatan,
            },
          },
        ],
      };
    }
  }
}

function teksBank(d: DataSurat): string {
  if (!d.bank) return "–";
  return `${d.bank.nama} dengan Nomor Rekening ${d.bank.rekening} atas nama ${d.bank.atasNama}`;
}

/** Lampiran bawaan, persis contoh TERMIN 1. */
export function lampiranBawaan(jenis: JenisSuratPenyedia, terminKe: number): string[] {
  if (jenis === "permohonan_pemeriksaan") return ["Laporan Kemajuan Pekerjaan dari Konsultan Pengawas"];
  if (jenis !== "permohonan_pembayaran") return [];
  const ke = urutanTermin(terminKe);
  return ["Laporan Kemajuan Pekerjaan", `Kwitansi Pembayaran Termin ${ke}`, `Faktur Pajak Pembayaran Termin ${ke}`];
}
