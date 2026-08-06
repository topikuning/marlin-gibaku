import { REPORT_STATUS_LABEL } from "@/lib/lifecycle";
import type { DailyReportStatus } from "@/generated/prisma/enums";

/**
 * PESAN WHATSAPP PENGIRING laporan harian ringkas — modul MURNI (DECISIONS 261).
 *
 * Penerimanya sama dengan rencana mingguan: **PPK, dinas terkait, pejabat**.
 * Forum pertanggungjawaban, bukan tempat mengarahkan pekerjaan. Karena itu
 * aturannya juga sama:
 *
 * - yang disajikan adalah **posisi dan akibatnya**, bukan daftar perintah;
 * - **tidak ada nama pelaksana per item** — itu urusan internal;
 * - **keadaan dokumen dinyatakan**. Pengiriman tidak digerbangi status
 *   (keputusan user 2026-08-05), jadi draf pun bisa sampai ke grup ini; yang
 *   membaca berhak tahu bahwa angkanya belum diverifikasi TANPA harus membuka
 *   lampiran.
 *
 * Rincian per item, kegiatan, dan foto ada di PDF terlampir.
 */

export type IsiPesanRingkas = {
  locationName: string;
  packageName: string;
  hari: string;
  tanggalFull: string;
  status: DailyReportStatus | null;
  weekNumber: number;
  totalWeeks: number;
  realizedPct: number;
  planPct: number;
  deviationPct: number;
  bobotHariIni: number;
  nilaiHariIni: bigint;
  jumlahPekerjaan: number;
  jumlahKegiatan: number;
  jumlahFoto: number;
  kendala: { title: string; severity: string; status: string }[];
};

/** Batas kendala yang ditulis di badan pesan; sisanya disebut jumlahnya. */
export const MAKS_KENDALA_TAMPIL = 3;

const pctFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p2 = (n: number) => `${pctFmt.format(n)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${pctFmt.format(Math.abs(n))}%`;
const rupiah = (n: bigint) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;

/**
 * Keadaan dokumen dalam satu kalimat.
 *
 * `final` sengaja TIDAK diberi peringatan — itu keadaan normal. Selain final,
 * kalimatnya menyebut apa yang belum terjadi, bukan sekadar nama statusnya:
 * "Dikirim" saja tidak memberi tahu pembaca bahwa belum ada yang memeriksa.
 */
export function kalimatStatus(status: DailyReportStatus | null): string {
  switch (status) {
    case "final":
      return "Status: Final — angka sudah dikunci.";
    case "disetujui":
      return "Status: Disetujui — sudah diperiksa, belum difinalkan.";
    case "dikirim":
      return "Status: Dikirim — BELUM diverifikasi siapa pun.";
    case "perlu_koreksi":
      return "Status: Perlu koreksi — dikembalikan ke pelapor, angkanya belum bisa dipakai.";
    case "draft":
      return "Status: Draf — belum dikirim pelapor, angkanya masih bisa berubah.";
    default:
      return "Status: Belum ada laporan harian untuk tanggal ini.";
  }
}

export function pesanRingkasHarianWa(r: IsiPesanRingkas): string {
  const bagian: string[] = [];

  bagian.push(
    [
      `*LAPORAN HARIAN — ${r.hari}, ${r.tanggalFull}*`,
      r.packageName,
      `Lokasi: ${r.locationName}`,
    ].join("\n"),
  );

  bagian.push(`_${kalimatStatus(r.status)}_`);

  bagian.push(
    [
      `*Posisi kemajuan*`,
      `Realisasi s/d hari ini: ${p2(r.realizedPct)}`,
      r.totalWeeks > 0
        ? `Rencana kurva-S (minggu ke-${r.weekNumber} dari ${r.totalWeeks}): ${p2(r.planPct)}`
        : `Rencana kurva-S: belum ada baseline`,
      `Deviasi: ${signed(r.deviationPct)}`,
    ].join("\n"),
  );

  const hariIni: string[] = [`*Yang dikerjakan hari ini*`];
  if (r.jumlahPekerjaan === 0 && r.jumlahKegiatan === 0) {
    hariIni.push("Tidak ada pekerjaan maupun kegiatan yang tercatat.");
  } else {
    if (r.jumlahPekerjaan > 0) {
      hariIni.push(
        `${r.jumlahPekerjaan} item pekerjaan · ${p2(r.bobotHariIni)} · ${rupiah(r.nilaiHariIni)}`,
      );
    } else {
      hariIni.push("Tidak ada volume pekerjaan yang dilaporkan.");
    }
    if (r.jumlahKegiatan > 0) hariIni.push(`${r.jumlahKegiatan} kegiatan lapangan`);
  }
  if (r.jumlahFoto > 0) hariIni.push(`${r.jumlahFoto} foto dokumentasi`);
  bagian.push(hariIni.join("\n"));

  if (r.kendala.length > 0) {
    const baris = [`*Permasalahan tercatat*`];
    for (const k of r.kendala.slice(0, MAKS_KENDALA_TAMPIL)) {
      baris.push(`• ${k.title} — ${k.severity}, ${k.status}`);
    }
    const sisa = r.kendala.length - MAKS_KENDALA_TAMPIL;
    if (sisa > 0) baris.push(`_…dan ${sisa} permasalahan lain, ada di berkas terlampir._`);
    bagian.push(baris.join("\n"));
  }

  bagian.push("_Rincian pekerjaan, kegiatan, dan foto ada pada berkas terlampir._");
  return bagian.join("\n\n");
}

/** Label status untuk nama berkas & pesan hasil di layar. */
export function labelStatus(status: DailyReportStatus | null): string {
  return status ? REPORT_STATUS_LABEL[status] : "Belum ada laporan";
}
