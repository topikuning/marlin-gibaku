import type { Capability } from "@/lib/authz";

/**
 * Nama kewenangan untuk layar pengaturan hak akses (DECISIONS 793). `Record`
 * memaksa setiap kewenangan baru di `authz.ts` diberi nama di sini – typecheck
 * gagal kalau terlupa.
 */
export const LABEL_KEWENANGAN: Record<Capability, string> = {
  "portfolio.view": "Lihat portofolio",
  "package.view": "Lihat paket",
  "package.create": "Buat paket",
  "package.edit": "Ubah data paket",
  "package.bypass": "Lewati tahapan paket",
  "prospect.manage": "Kelola prospek dan tender",
  "contract.manage": "Kelola kontrak",
  "contract.edit": "Koreksi data kontrak berjalan",
  "contract.week_mode": "Ubah mode periode minggu laporan",
  "amendment.manage": "Kelola adendum kontrak",
  "location.view": "Lihat lokasi",
  "location.manage": "Kelola lokasi (alamat, koordinat, status)",
  "location.rename": "Ganti nama lokasi",
  "location.correct": "Koreksi susunan lokasi paket",
  "location_scope.archive": "Arsipkan riwayat pencabutan lokasi",
  "daily_report.reset_location": "Reset seluruh laporan harian satu lokasi",
  "rab.revision_purge": "Hapus revisi RAB adendum yang keliru",
  "location.signer": "Atur penanda tangan lokasi",
  "rab.view": "Lihat RAB",
  "rab.manage": "Kelola RAB (impor, draft adendum)",
  "rapl.view": "Lihat RAPL termasuk margin",
  "rapl.manage": "Isi RAPL (harga dasar, rincian)",
  "money.view": "Lihat angka rupiah",
  "baseline.manage": "Kelola kurva-S",
  "weekly_plan.manage": "Kelola rencana mingguan",
  "daily_report.create": "Isi laporan harian",
  "daily_report.review": "Periksa laporan harian (setujui, minta koreksi)",
  "daily_report.finalize": "Finalkan laporan harian",
  "daily_report.unfinalize": "Buka kunci laporan harian final",
  "daily_report.move_date": "Pindahkan laporan ke tanggal lain",
  "field_activity.manage": "Catat kegiatan lapangan",
  "photo.quick": "Foto Cepat",
  "photo.restamp": "Perbaiki cap foto",
  "photo.archive_purge": "Hapus arsip berkas asli foto",
  "photo.manage_others": "Urus foto unggahan orang lain (hapus, kembalikan ke Foto Cepat)",
  "wa.configure": "Atur grup WhatsApp paket",
  "gdrive.open_folder": "Buka folder Google Drive vendor",
  "progress.view": "Lihat progres",
  "issue.manage": "Kelola kendala",
  "finding.view": "Lihat temuan",
  "finding.create": "Buat temuan",
  "finding.respond": "Tanggapi temuan",
  "finding.verify": "Verifikasi penutupan temuan",
  "inspection.manage": "Kelola inspeksi lapangan",
  "report.verify_external": "Verifikasi eksternal laporan harian",
  "finance.view": "Lihat keuangan",
  "finance.input": "Input transaksi keuangan",
  "finance.approve": "Setujui transaksi keuangan",
  "document.view": "Lihat dokumen",
  "document.upload": "Unggah dokumen",
  "letter.view": "Lihat surat",
  "letter.manage": "Kelola surat masuk dan keluar",
  "letter.void": "Batalkan atau pulihkan surat",
  "document.verify": "Verifikasi dokumen",
  "document.edit": "Koreksi data dokumen",
  "document.void": "Batalkan atau pulihkan dokumen",
  "document.delete": "Hapus dokumen permanen",
  "compliance.manage": "Kelola kepatuhan dan milestone",
  "report.export": "Unduh laporan (PDF, Excel)",
  "wa.chat": "Chat grup dan kontak WhatsApp",
  "contact.view_all": "Lihat kontak WhatsApp semua akun",
  "ai.view": "Buka AI Intelligence",
  "ai.generate": "Jalankan analisis AI",
  "ai.ask": "Tanya MARLIN (AI)",
  "ai.report_review": "Periksa draf laporan AI",
  "ai.report_approve": "Setujui laporan AI",
  "ai.report_send": "Kirim laporan AI",
  "user.manage": "Kelola pengguna",
  "user.create": "Buat pengguna",
  "system.manage": "Pengaturan sistem",
  "kawal.manage": "Kelola sinkron Kawal KNMP",
  "kawal.view": "Lihat pembanding Kawal KNMP",
  "audit.view": "Lihat jejak audit",
};

/** Kelompok tampilan, urut. Kewenangan yang tidak cocok mana pun masuk "Lainnya". */
const KELOMPOK: { judul: string; awalan: string[] }[] = [
  { judul: "Paket dan kontrak", awalan: ["portfolio.", "package.", "prospect.", "contract.", "amendment."] },
  {
    judul: "Lokasi dan RAB",
    awalan: ["location.", "location_scope.", "rab.", "rapl.", "money.", "baseline.", "weekly_plan."],
  },
  {
    judul: "Laporan harian dan lapangan",
    awalan: ["daily_report.", "field_activity.", "photo.", "progress.", "issue."],
  },
  { judul: "Temuan dan pemeriksaan", awalan: ["finding.", "inspection.", "report.verify_external"] },
  { judul: "Keuangan, dokumen, dan surat", awalan: ["finance.", "document.", "letter.", "compliance.", "report."] },
  { judul: "WhatsApp, AI, dan Kawal", awalan: ["wa.", "contact.", "gdrive.", "ai.", "kawal."] },
  { judul: "Pengguna dan sistem", awalan: ["user.", "system.", "audit."] },
];

export function kelompokKewenangan(c: Capability): string {
  return KELOMPOK.find((k) => k.awalan.some((a) => c === a || c.startsWith(a)))?.judul ?? "Lainnya";
}

export const URUTAN_KELOMPOK = [...KELOMPOK.map((k) => k.judul), "Lainnya"];
