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
 * `nilaiTagihanTermin` (calculation layer keuangan); modul ini hanya
 * menuliskannya – rupiah dan terbilangnya.
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

/** Jenis surat yang sudah bisa disusun (tahap 2a); sisanya menyusul. */
export const JENIS_SURAT_TERSEDIA: JenisSuratPenyedia[] = ["permohonan_pembayaran", "invoice", "kwitansi"];

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
  | { jenis: "daftar"; butir: string[] }
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

export type SuratTersusun = { judulBerkas: string; blok: Blok[] };

export type DataSurat = {
  jenis: JenisSuratPenyedia;
  penyedia: { nama: string; npwp: string | null };
  penandaTangan: { nama: string; jabatan: string };
  kontrak: { nomor: string; tanggal: Date; judul: string; nilai: bigint };
  bank: { nama: string; rekening: string; atasNama: string } | null;
  termin: { ke: number; bayarPct: number; nilai: bigint };
  surat: { nomor: string; tanggal: Date; kota: string; kepada: string[]; lampiran: string[] };
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

/** "20% × Rp 13.478.994.000,- = Rp 2.695.798.800,-" */
function hitunganTermin(d: DataSurat): string {
  return `${persenSurat(d.termin.bayarPct)} × ${rupiahSurat(d.kontrak.nilai)} = ${rupiahSurat(d.termin.nilai)}`;
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
                  `Khusus Kontrak sebesar ${hitunganTermin(d)}. Sehingga Pembayaran Termin ${ke} menjadi sebesar `,
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
              { label: "Total Tagihan", isi: [t(`${persenSurat(d.termin.bayarPct)} × ${rupiahSurat(d.kontrak.nilai)} = `), t(rupiahSurat(d.termin.nilai), true)] },
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
                isi: [t(`Pembayaran Termin ${ke} ${d.kontrak.judul} sesuai dengan ${rincianKontrak(d)}`)],
              },
              { label: "NPWP", isi: [t(d.penyedia.npwp ?? "–")] },
              { label: "Bank", isi: [t(teksBank(d))] },
            ],
          },
          tandaTangan(d, { tempatTanggal: true, meterai: true, kotakNominal: rupiahSurat(d.termin.nilai) }),
        ],
      };

    default:
      throw new Error(`${LABEL_JENIS_SURAT[d.jenis]} belum bisa disusun.`);
  }
}

function teksBank(d: DataSurat): string {
  if (!d.bank) return "–";
  return `${d.bank.nama} dengan Nomor Rekening ${d.bank.rekening} atas nama ${d.bank.atasNama}`;
}

/** Lampiran bawaan permohonan pembayaran, persis contoh TERMIN 1. */
export function lampiranBawaan(jenis: JenisSuratPenyedia, terminKe: number): string[] {
  if (jenis !== "permohonan_pembayaran") return [];
  const ke = urutanTermin(terminKe);
  return ["Laporan Kemajuan Pekerjaan", `Kwitansi Pembayaran Termin ${ke}`, `Faktur Pajak Pembayaran Termin ${ke}`];
}
