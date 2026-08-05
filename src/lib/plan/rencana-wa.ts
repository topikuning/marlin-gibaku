import { LABEL_STATUS, type Ppc, type Proyeksi, type StatusRencana } from "./rencana-format";

/**
 * PESAN WHATSAPP RENCANA KERJA MINGGUAN — modul MURNI (DECISIONS 259).
 *
 * Pesannya sengaja MEMUAT rencananya, bukan sekadar sampul lampiran.
 *
 * Alasannya lapangan, bukan selera: penerima grup WA paket adalah mandor dan
 * pelaksana yang membuka HP di lokasi. Berkas PDF/Excel bisa gagal diunduh di
 * sinyal 1 bar, dan kerap tidak dibuka sama sekali. Kalau isi rencananya hanya
 * ada di lampiran, "rencana sudah dikirim" tetap berarti tidak ada yang tahu
 * harus mengerjakan apa — persis keluhan "berhenti di layar" yang memindah
 * tempat saja.
 *
 * Karena itu: ringkasan + daftar komitmen ada di BADAN pesan; lampiran adalah
 * dokumen resmi untuk yang perlu menandatangani atau mengarsipkan.
 *
 * Format WhatsApp: `*tebal*`, `_miring_`. TIDAK ada tabel — jadi angka ditulis
 * berlabel, bukan berkolom.
 */

/** Bentuk minimal yang dibutuhkan pesan — sengaja BUKAN `RencanaMingguan`
 *  supaya modul ini bebas dari `server-only` dan bisa diuji langsung. */
export type IsiPesanRencana = {
  locationName: string;
  packageName: string;
  weekNumber: number;
  periodeStart: Date;
  periodeEnd: Date;
  actualPct: number;
  targetPct: number;
  deviationPct: number;
  status: StatusRencana;
  proyeksi: Proyeksi;
  ppc: Ppc;
  tidakTuntas: { code: string; name: string; unit: string | null; target: number; realisasi: number }[];
  baris: { code: string; name: string; unit: string | null; target: number; picName: string | null }[];
  totalNilai: number;
  totalBobot: number;
  catatan: string | null;
  disusunOleh: string | null;
};

/**
 * Batas daftar di badan pesan. Pesan WA yang harus di-scroll berlayar-layar
 * tidak dibaca; sisanya ada di lampiran — dan JUMLAHNYA disebut, supaya
 * "tidak muncul" tidak terbaca "tidak ada".
 */
export const MAKS_KOMITMEN_TAMPIL = 12;
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
      `*RENCANA KERJA MINGGUAN — Minggu ke-${r.weekNumber}*`,
      `📅 ${tgl(r.periodeStart)} – ${tgl(r.periodeEnd)}`,
      `📍 ${r.locationName}`,
      `🏗️ ${r.packageName}`,
    ].join("\n"),
  );

  bagian.push(
    [
      `*Posisi saat ini*`,
      `• Realisasi: ${p2(r.actualPct)}`,
      `• Rencana kurva-S: ${p2(r.targetPct)}`,
      `• Deviasi: ${signed(r.deviationPct)} — ${LABEL_STATUS[r.status]}`,
    ].join("\n"),
  );

  // Angka yang membuat rencana bisa dinilai SEBELUM dijalankan. Ia ditulis
  // sebagai kalimat, bukan angka telanjang, supaya tetap berarti bagi yang
  // membaca sambil berdiri di lokasi.
  bagian.push(
    [
      `*Kalau rencana ini dikerjakan penuh*`,
      `Realisasi akhir minggu ke-${r.weekNumber} menjadi *${p2(r.proyeksi.proyeksiPct)}*, sedangkan kurva-S menuntut ${p2(r.proyeksi.targetPct)}.`,
      r.proyeksi.masihTertinggal
        ? `⚠️ Masih tertinggal ${p2(Math.abs(r.proyeksi.selisihPct))} — rencana ini belum cukup untuk kembali ke jadwal.`
        : `✅ Menutup ketertinggalan dengan selisih ${signed(r.proyeksi.selisihPct)}.`,
    ].join("\n"),
  );

  // Evaluasi janji minggu lalu MENDAHULUI janji baru (Last Planner System).
  if (r.ppc.pct == null) {
    if (r.weekNumber > 1) {
      bagian.push(
        `*Evaluasi minggu ke-${r.weekNumber - 1}*\nTidak ada rencana tercatat — tidak ada komitmen yang bisa dievaluasi (bukan nilai 0%).`,
      );
    }
  } else {
    const baris = [
      `*Evaluasi minggu ke-${r.weekNumber - 1} — PPC ${p2(r.ppc.pct)}*`,
      `${r.ppc.tuntas} dari ${r.ppc.jumlah} komitmen tuntas.`,
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

  const kepala =
    r.baris.length === 0
      ? `*Komitmen minggu ke-${r.weekNumber}*`
      : `*Komitmen minggu ke-${r.weekNumber}* (${r.baris.length} item · ${p2(r.totalBobot)} · ${rupiah(r.totalNilai)})`;
  const komitmen = [kepala];
  if (r.baris.length === 0) {
    komitmen.push("_Belum ada komitmen yang dimasukkan untuk minggu ini._");
  } else {
    r.baris.slice(0, MAKS_KOMITMEN_TAMPIL).forEach((b, i) => {
      const pic = b.picName?.trim() ? ` — ${b.picName.trim()}` : "";
      komitmen.push(`${i + 1}. ${b.code} · ${b.name}: *${vol(b.target, b.unit)}*${pic}`);
    });
    const sisa = r.baris.length - MAKS_KOMITMEN_TAMPIL;
    if (sisa > 0) komitmen.push(`_…dan ${sisa} item lain, ada di berkas terlampir._`);
  }
  bagian.push(komitmen.join("\n"));

  if (r.catatan?.trim()) bagian.push(`*Catatan*\n${r.catatan.trim()}`);

  const penutup = ["_Formulir lengkap (siap tanda tangan) ada di berkas PDF terlampir._"];
  if (r.disusunOleh) penutup.push(`_Disusun oleh: ${r.disusunOleh}._`);
  bagian.push(penutup.join("\n"));

  return bagian.join("\n\n");
}
