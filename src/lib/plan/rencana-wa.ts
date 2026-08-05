import { LABEL_STATUS, type Ppc, type Proyeksi, type StatusRencana } from "./rencana-format";

/**
 * PESAN WHATSAPP RENCANA KERJA MINGGUAN — modul MURNI (DECISIONS 259).
 *
 * ### Siapa yang membaca menentukan isinya
 *
 * Grup WA paket berisi **PPK, dinas terkait, dan pejabat** — BUKAN mandor atau
 * pelaksana. Itu forum **pertanggungjawaban**, bukan tempat mengarahkan
 * pekerjaan.
 *
 * Akibatnya pada isi pesan, dan ini bukan soal panjang-pendek:
 *
 * - **Tidak ada daftar item beserta PIC.** Menyebut siapa mengerjakan apa di
 *   forum pejabat memindahkan pengarahan internal ke ruang pengawasan, dan
 *   membuat orang yang belum tentu tahu konteksnya menilai per-orang.
 * - Yang disajikan adalah yang memang **hak forum itu**: posisi kemajuan,
 *   deviasi terhadap kurva-S, **akibat rencana ini bila dijalankan penuh**, dan
 *   **kredibilitas komitmen minggu lalu (PPC)**. Itulah alasan seseorang
 *   menyetujui atau menahan rencana — kalau semuanya hanya ada di lampiran,
 *   forum menyetujui rencana yang belum dibacanya.
 * - Lingkup minggu ini disebut sebagai **agregat** (jumlah item, bobot, nilai,
 *   kelompok pekerjaan) — cukup untuk menilai, tanpa menjadi perintah kerja.
 * - Rincian per item dan lembar tanda tangan ada di **berkas terlampir**,
 *   tempat yang memang untuk itu.
 *
 * Format WhatsApp: `*tebal*`, `_miring_`. Tanpa tabel — angka ditulis berlabel.
 */

/** Bentuk minimal yang dibutuhkan pesan — sengaja BUKAN `RencanaMingguan`
 *  supaya modul ini bebas dari `server-only` dan bisa diuji langsung. */
export type IsiPesanRencana = {
  locationName: string;
  packageName: string;
  weekNumber: number;
  totalWeeks: number;
  periodeStart: Date;
  periodeEnd: Date;
  actualPct: number;
  targetPct: number;
  deviationPct: number;
  status: StatusRencana;
  proyeksi: Proyeksi;
  ppc: Ppc;
  tidakTuntas: { code: string; name: string; unit: string | null; target: number; realisasi: number }[];
  /** Dipakai untuk AGREGAT saja — jumlah item & kelompok pekerjaan. */
  baris: { categoryName: string }[];
  totalNilai: number;
  totalBobot: number;
  catatan: string | null;
  disusunOleh: string | null;
};

/**
 * Batas daftar di badan pesan. Yang disembunyikan SELALU disebut jumlahnya,
 * supaya "tidak muncul" tidak terbaca "tidak ada".
 */
export const MAKS_KELOMPOK_TAMPIL = 6;
export const MAKS_TIDAK_TUNTAS_TAMPIL = 5;

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupiah = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
const p2 = (n: number) => `${pctFmt.format(n)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${pctFmt.format(Math.abs(n))}%`;
const vol = (n: number, unit: string | null) => `${volFmt.format(n)}${unit ? ` ${unit}` : ""}`;
const tgl = (d: Date) =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" })
    .format(d);

export function pesanRencanaWa(r: IsiPesanRencana): string {
  const bagian: string[] = [];

  bagian.push(
    [
      `*RENCANA KERJA MINGGUAN — Minggu ke-${r.weekNumber} dari ${r.totalWeeks}*`,
      r.packageName,
      `Lokasi: ${r.locationName}`,
      `Periode: ${tgl(r.periodeStart)} – ${tgl(r.periodeEnd)}`,
    ].join("\n"),
  );

  bagian.push(
    [
      `*Posisi kemajuan*`,
      `Realisasi s/d saat ini: ${p2(r.actualPct)}`,
      `Rencana kurva-S: ${p2(r.targetPct)}`,
      `Deviasi: ${signed(r.deviationPct)} — ${LABEL_STATUS[r.status]}`,
    ].join("\n"),
  );

  // Inti bagi forum ini: rencana bisa DINILAI sebelum disetujui.
  bagian.push(
    [
      `*Proyeksi akhir minggu ini*`,
      `Bila rencana ini dikerjakan penuh, realisasi menjadi *${p2(r.proyeksi.proyeksiPct)}*, sedangkan kurva-S menuntut ${p2(r.proyeksi.targetPct)}.`,
      r.proyeksi.masihTertinggal
        ? `Masih tertinggal ${p2(Math.abs(r.proyeksi.selisihPct))} — rencana ini belum cukup untuk kembali ke jadwal.`
        : `Menutup ketertinggalan dengan selisih ${signed(r.proyeksi.selisihPct)}.`,
    ].join("\n"),
  );

  // Pertanggungjawaban janji lama MENDAHULUI janji baru (Last Planner System).
  if (r.ppc.pct == null) {
    if (r.weekNumber > 1) {
      bagian.push(
        `*Kredibilitas rencana minggu ke-${r.weekNumber - 1}*\nTidak ada rencana tercatat — tidak ada komitmen yang bisa dievaluasi (bukan nilai 0%).`,
      );
    }
  } else {
    const baris = [
      `*Kredibilitas rencana minggu ke-${r.weekNumber - 1}*`,
      `PPC ${p2(r.ppc.pct)} — ${r.ppc.tuntas} dari ${r.ppc.jumlah} komitmen tuntas.`,
    ];
    if (r.tidakTuntas.length > 0) {
      baris.push("Belum tuntas:");
      for (const t of r.tidakTuntas.slice(0, MAKS_TIDAK_TUNTAS_TAMPIL)) {
        baris.push(`• ${t.code} · ${t.name} — ${vol(t.realisasi, t.unit)} dari ${vol(t.target, t.unit)}`);
      }
      const sisa = r.tidakTuntas.length - MAKS_TIDAK_TUNTAS_TAMPIL;
      if (sisa > 0) baris.push(`_…dan ${sisa} komitmen lain, ada di berkas terlampir._`);
    }
    bagian.push(baris.join("\n"));
  }

  // Lingkup: AGREGAT, bukan perintah kerja. Cukup untuk menilai "pekerjaan apa
  // dan sebesar apa", tanpa menyebut siapa mengerjakan apa.
  if (r.baris.length === 0) {
    bagian.push(`*Lingkup komitmen minggu ini*\n_Belum ada komitmen yang dimasukkan untuk minggu ini._`);
  } else {
    const lingkup = [
      `*Lingkup komitmen minggu ini*`,
      `${r.baris.length} item pekerjaan · bobot ${p2(r.totalBobot)} · ${rupiah(r.totalNilai)}`,
    ];
    const kelompok = ringkasKelompok(r.baris);
    for (const k of kelompok.slice(0, MAKS_KELOMPOK_TAMPIL)) {
      lingkup.push(`• ${k.name} (${k.jumlah} item)`);
    }
    const sisa = kelompok.length - MAKS_KELOMPOK_TAMPIL;
    if (sisa > 0) lingkup.push(`_…dan ${sisa} kelompok pekerjaan lain._`);
    bagian.push(lingkup.join("\n"));
  }

  if (r.catatan?.trim()) bagian.push(`*Catatan*\n${r.catatan.trim()}`);

  const penutup = ["_Rincian per item dan lembar tanda tangan ada pada berkas terlampir._"];
  if (r.disusunOleh) penutup.push(`_Disusun oleh: ${r.disusunOleh}._`);
  bagian.push(penutup.join("\n"));

  return bagian.join("\n\n");
}

/** Kelompok pekerjaan + jumlah item, URUTAN KEMUNCULAN dipertahankan (urutan RAB). */
function ringkasKelompok(baris: { categoryName: string }[]): { name: string; jumlah: number }[] {
  const out: { name: string; jumlah: number }[] = [];
  for (const b of baris) {
    const ada = out.find((k) => k.name === b.categoryName);
    if (ada) ada.jumlah += 1;
    else out.push({ name: b.categoryName, jumlah: 1 });
  }
  return out;
}
