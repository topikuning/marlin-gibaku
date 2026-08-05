import type { UserRole } from "@/generated/prisma/enums";
import { CAPABILITIES, ROLE_CAPABILITIES, type Capability } from "@/lib/authz";

/**
 * RINGKASAN capability untuk MANUSIA.
 *
 * `authz.ts` menjawab pertanyaan mesin ("boleh atau tidak"), dan jawabannya
 * berupa 49 nama teknis ber-titik. Halaman Administrasi harus menjawab
 * pertanyaan yang berbeda — "kalau akun ini saya beri peran X, dia bisa apa?"
 * — dan daftar `document.void`/`ai.report_approve` tidak menjawabnya.
 *
 * Jadi di sini capability dikelompokkan jadi KEMAMPUAN INTI berbahasa
 * Indonesia. Yang penting: pengelompokannya DITURUNKAN dari `CAPABILITIES`,
 * bukan disalin. `KEMAMPUAN_LABEL` bertipe `Record<Capability, string>`
 * sehingga capability baru menggagalkan `pnpm typecheck` — dan
 * `tests/unit/authz-ringkas.test.ts` gagal kalau ada capability yang tidak
 * masuk grup mana pun. Ringkasan yang diam-diam ketinggalan lebih berbahaya
 * daripada tidak ada ringkasan sama sekali: ia terbaca lengkap.
 */

/** Label pendek berbahasa Indonesia untuk tiap capability. */
export const KEMAMPUAN_LABEL: Record<Capability, string> = {
  "portfolio.view": "Lihat dashboard portofolio",
  "package.view": "Lihat paket",
  "package.create": "Buat paket",
  "package.edit": "Ubah paket",
  "package.bypass": "Lewati urutan tahapan paket",
  "prospect.manage": "Kelola prospek & tender",
  "contract.manage": "Kelola kontrak",
  "contract.edit": "Koreksi data kontrak",
  "amendment.manage": "Kelola adendum",
  "location.view": "Lihat lokasi",
  "location.manage": "Kelola lokasi",
  "location.correct": "Koreksi susunan lokasi paket berkontrak",
  "rab.view": "Lihat RAB",
  "rab.manage": "Kelola & revisi RAB",
  "baseline.manage": "Tetapkan baseline kurva-S",
  "weekly_plan.manage": "Susun rencana mingguan",
  "daily_report.create": "Buat laporan harian",
  "daily_report.review": "Verifikasi / minta koreksi laporan",
  "daily_report.finalize": "Finalkan laporan harian",
  "daily_report.unfinalize": "Buka kunci laporan final",
  "field_activity.manage": "Catat aktivitas & foto lapangan",
  "photo.restamp": "Perbaiki cap foto dari arsip asli",
  "photo.archive_purge": "Hapus arsip foto asli",
  "wa.configure": "Atur grup WhatsApp paket",
  "progress.view": "Lihat progress & deviasi",
  "issue.manage": "Kelola kendala & tindak lanjut",
  "finance.view": "Lihat keuangan",
  "finance.input": "Input transaksi keuangan",
  "finance.approve": "Setujui pengeluaran",
  "document.view": "Lihat dokumen",
  "document.upload": "Unggah dokumen",
  "document.verify": "Verifikasi dokumen",
  "document.edit": "Koreksi metadata dokumen",
  "document.void": "Batalkan / pulihkan dokumen",
  "document.delete": "Hapus permanen dokumen",
  "compliance.manage": "Kelola milestone kepatuhan KKP",
  "report.export": "Ekspor laporan (PDF / Excel)",
  "wa.chat": "Kirim & kelola pesan WhatsApp",
  "contact.view_all": "Lihat kontak WhatsApp semua akun",
  "ai.view": "Buka AI Insight & riwayatnya",
  "ai.generate": "Jalankan analisis AI",
  "ai.ask": "Tanya-jawab Ask MARLIN",
  "ai.report_review": "Review & edit draf laporan AI",
  "ai.report_approve": "Setujui & bekukan laporan",
  "ai.report_send": "Distribusikan laporan beku",
  "user.manage": "Kelola semua akun",
  "user.create": "Buat akun peran di bawahnya",
  "system.manage": "Ubah pengaturan sistem",
  "audit.view": "Lihat jejak audit",
};

export type KelompokKemampuan = {
  key: string;
  nama: string;
  /** Satu kalimat: apa yang sebenarnya bisa dilakukan di kelompok ini. */
  arti: string;
  kemampuan: readonly Capability[];
};

/**
 * Urutannya mengikuti alur kerja (lihat → rencanakan → laksanakan → kendalikan
 * → laporkan → kelola), bukan urutan abjad. Baris teratas adalah yang paling
 * sering ditanyakan saat membuat akun baru.
 */
export const KELOMPOK_KEMAMPUAN: readonly KelompokKemampuan[] = [
  {
    key: "pantau",
    nama: "Pantau",
    arti: "Membaca portofolio, lokasi, RAB, progress, dan dokumen — tanpa mengubah apa pun.",
    kemampuan: [
      "portfolio.view",
      "package.view",
      "location.view",
      "rab.view",
      "progress.view",
      "document.view",
    ],
  },
  {
    key: "paket",
    nama: "Paket & kontrak",
    arti: "Menyusun prospek sampai kontrak, adendum, dan susunan lokasi paket.",
    kemampuan: [
      "package.create",
      "package.edit",
      "package.bypass",
      "prospect.manage",
      "contract.manage",
      "contract.edit",
      "amendment.manage",
      "location.manage",
      "location.correct",
    ],
  },
  {
    key: "rencana",
    nama: "RAB & rencana",
    arti: "Revisi RAB, penetapan baseline kurva-S, dan rencana mingguan.",
    kemampuan: ["rab.manage", "baseline.manage", "weekly_plan.manage"],
  },
  {
    key: "harian",
    nama: "Laporan harian",
    arti: "Membuat, memverifikasi, memfinalkan laporan harian, serta mencatat kendala.",
    kemampuan: [
      "daily_report.create",
      "daily_report.review",
      "daily_report.finalize",
      "daily_report.unfinalize",
      "field_activity.manage",
      "issue.manage",
    ],
  },
  {
    key: "foto",
    nama: "Bukti foto",
    arti: "Memperbaiki cap foto dari arsip asli, dan menghapus arsip itu sendiri.",
    kemampuan: ["photo.restamp", "photo.archive_purge"],
  },
  {
    key: "keuangan",
    nama: "Keuangan",
    arti: "Melihat, menginput, dan menyetujui transaksi keuangan pelaksanaan.",
    kemampuan: ["finance.view", "finance.input", "finance.approve"],
  },
  {
    key: "dokumen",
    nama: "Dokumen & kepatuhan",
    arti: "Unggah, verifikasi, koreksi, pembatalan dokumen, dan milestone KKP.",
    kemampuan: [
      "document.upload",
      "document.verify",
      "document.edit",
      "document.void",
      "document.delete",
      "compliance.manage",
    ],
  },
  {
    key: "distribusi",
    nama: "Laporan & distribusi",
    arti: "Ekspor laporan dan pengiriman lewat WhatsApp beserta kontak tujuannya.",
    kemampuan: ["report.export", "wa.chat", "wa.configure", "contact.view_all"],
  },
  {
    key: "ai",
    nama: "AI Insight",
    arti: "Analisis AI, Ask MARLIN, serta review–setujui–kirim draf laporan AI.",
    kemampuan: [
      "ai.view",
      "ai.generate",
      "ai.ask",
      "ai.report_review",
      "ai.report_approve",
      "ai.report_send",
    ],
  },
  {
    key: "administrasi",
    nama: "Administrasi",
    arti: "Akun & penugasan, pengaturan sistem, dan jejak audit.",
    kemampuan: ["user.manage", "user.create", "system.manage", "audit.view"],
  },
];

export type TingkatKemampuan = "penuh" | "sebagian" | "tidak";

export type SelKemampuan = {
  tingkat: TingkatKemampuan;
  /** Yang DIMILIKI peran ini di kelompok tersebut — untuk keterangan rinci. */
  dimiliki: Capability[];
  total: number;
};

export function selKemampuan(role: UserRole, kelompok: KelompokKemampuan): SelKemampuan {
  const set = ROLE_CAPABILITIES[role];
  const dimiliki = kelompok.kemampuan.filter((c) => set.has(c));
  const tingkat: TingkatKemampuan =
    dimiliki.length === 0 ? "tidak" : dimiliki.length === kelompok.kemampuan.length ? "penuh" : "sebagian";
  return { tingkat, dimiliki, total: kelompok.kemampuan.length };
}

/**
 * Capability yang belum masuk kelompok mana pun. Dipakai uji unit — bukan
 * dipakai UI, karena UI tidak boleh punya jalur "tampilkan sisanya" yang
 * membuat kelalaian jadi tidak terlihat.
 */
export function kemampuanTanpaKelompok(): Capability[] {
  const terpakai = new Set(KELOMPOK_KEMAMPUAN.flatMap((k) => k.kemampuan));
  return CAPABILITIES.filter((c) => !terpakai.has(c));
}
