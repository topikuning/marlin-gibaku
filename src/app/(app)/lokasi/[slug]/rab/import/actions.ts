"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess, ForbiddenError } from "@/lib/auth/session";
import { ImporPerluJawaban, colLetter, parseHpsBuffer } from "@/lib/rab/hps-parser";
import { barisTanpaJumlah, bedaAntarLayer, flattenParsedRab, grandTotal } from "@/lib/rab/flatten";
import { bolehAktifTanpaPersetujuan } from "@/lib/rab/persetujuan";
import {
  activateRevision,
  createRevisionFromNodes,
  createRevisionFromParsed,
  discardDraft,
  DraftTerpakaiError,
  gantiDraftLama,
  regenerateBaseline,
} from "@/lib/rab/import";
import { PROFIL_KURVA, PROFIL_KURVA_LABEL } from "@/lib/scurve/profil";
import type { BaselineProfil } from "@/generated/prisma/enums";
import { AdendumTemplateError } from "@/lib/rab/adendum-template-parse";
import { bandingkanPerItem, bandingkanTerhadapAktif, type BandingItem, type RingkasBeda } from "@/lib/rab/diff-parsed";
import { pohonRingkas, pohonRingkasBanding, type SimpulBanding } from "@/lib/rab/pohon-ringkas";
import { samakanLineage } from "@/lib/rab/cocok-lineage";
import { kalimatUbah, rencanaKoreksiTimpa } from "@/lib/rab/koreksi-timpa";
import { KoreksiTimpaError, kalimatTerhalang, simpulAktif, terapkanKoreksiTimpa, terhalangKoreksi } from "@/lib/rab/koreksi-timpa-simpan";
import { cocokKonfirmasiKoreksi, konfirmasiKoreksi } from "@/lib/rab/persetujuan-aturan";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { formatNumber, formatRupiah, formatRupiahSatuan } from "@/lib/format";
import { isR2Configured, r2Put } from "@/lib/r2";

/**
 * Impor HPS/adendum — SATU server action, dua langkah dalam satu form multipart:
 *   1. tanpa `confirm` → parse + pratinjau (TIDAK menyimpan apa pun)
 *   2. `confirm=1` + sha256 pratinjau cocok → simpan revisi (draft) → aktifkan
 *      → regenerate baseline (+ arsip file ke R2 best-effort)
 * File dikirim ulang di langkah 2 (File tidak bisa disimpan di state), sha256
 * menjaga file yang di-commit = file yang dipratinjau.
 */

const MAX_BYTES = 15 * 1024 * 1024; // di bawah bodySizeLimit 16mb
const XLSX_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

export type ImportPreview = {
  fileName: string;
  bytes: number;
  sha256: string;
  /** Σ kategori pra-PPN, rupiah string. */
  grandTotal: string;
  itemCount: number;
  isAdendum: boolean;
  /** Kolom nilai yang dipakai parser — mis. "NEGOSIASI (kolom K/L)". Wajib
   *  terlihat sebelum commit: file lampiran negosiasi memuat 3 blok harga
   *  (HPS/penawaran/negosiasi) dan salah kolom = nilai kontrak salah. */
  priceColumnLabel: string;
  priceSource: "nego" | "penawaran" | "hps";
  warnings: string[];
  /**
   * Kategori DAN sub-kategorinya, urut berkas (DECISIONS 599).
   *
   * Permintaan user 2026-09-21: *"bukan hanya kategori harusnya munculkan juga
   * sub kategorinya, berapa jumlahnya."* Satu baris kategori bernilai miliaran
   * cukup untuk memastikan grand total cocok, tidak cukup untuk melihat
   * pekerjaan mana yang bergeser.
   */
  categories: {
    kind: "kategori" | "sub";
    /** Identitas unik baris — kode kategori/sub berulang antar cabang. */
    lineageKey: string;
    code: string;
    name: string;
    /** Nilai di berkas yang diimpor. `null` = kategori ini HILANG dari berkas. */
    total: string | null;
    jumlahItem: number;
    level: number;
    /**
     * Nilai KONTRAK untuk kategori/sub yang sama, dan selisihnya.
     *
     * Permintaan user 2026-09-21: *"yang kuminta ada perbandingan itu di bagian
     * ini, kenapa ini malah tidak ada!"* Pembandingnya dibawa di baris yang sama
     * supaya mata turun satu kolom, bukan pindah blok. `null` di `kontrak`
     * berarti kategori ini belum ada di kontrak; `null` di `total` berarti ia
     * hilang dari berkas yang diimpor. Seluruh kolom ini kosong kalau lokasinya
     * memang belum punya RAB aktif — tidak ada sisi kiri untuk diadu.
     */
    kontrak: string | null;
    selisih: string | null;
    status: "tetap" | "berubah" | "baru" | "hilang" | null;
  }[];
  /** Tab Excel yang benar-benar dibaca — pemilihannya tebakan berperingkat. */
  sheetName: string;
  /**
   * Sheet & kolom yang bisa diganti user dari pratinjau (DECISIONS 624). null
   * untuk Template Adendum MARLIN – bentuknya pasti, tidak ada yang dipilih.
   */
  baca: import("@/lib/rab/hps-parser").PilihanBaca | null;
  mode: ImportMode;
  /**
   * Mode `aktifkan` pada lokasi yang SUDAH punya RAB aktif = KOREKSI (DECISIONS
   * 728): isi RAB aktif ditimpa di tempat dengan isi berkas, tanpa revisi baru,
   * bukan adendum/CCO, tanpa dua persetujuan. Hanya super admin utama (`boleh`).
   * Baris yang masih dipakai laporan harian/rencana tidak boleh hilang
   * (`terhalang`) – disebut sebelum disimpan.
   */
  koreksi: {
    revisionNo: number;
    boleh: boolean;
    ringkas: import("@/lib/rab/koreksi-timpa").RencanaTimpa["ringkas"];
    contoh: string[];
    tambah: string[];
    hapus: string[];
    terhalang: string[];
  } | null;
  /** Draft yang sudah ada di lokasi ini — isinya akan DIGANTI (mode draft). */
  draftAda: { revisionNo: number; totalValue: string } | null;
  /**
   * ITEM | JUMLAH KONTRAK | JUMLAH DRAFT ADENDUM, berdampingan (DECISIONS 599).
   *
   * Permintaan user 2026-09-21. Berbeda dari `beda` di bawah, yang memilah
   * perubahan menurut JENISNYA: yang ini satu tabel yang dibaca dengan mata
   * turun satu kolom — cara orang benar-benar memeriksa adendum. `null` hanya
   * saat lokasi belum punya revisi aktif (tidak ada sisi kiri untuk diadu).
   */
  banding: {
    /** Identitas unik baris — kode item hanya unik di dalam induknya. */
    lineageKey: string;
    code: string;
    jalur: string;
    name: string;
    kontrak: string | null;
    adendum: string | null;
    selisih: string;
    status: "tetap" | "berubah" | "baru" | "hilang";
  }[] | null;
  /** Perbandingan terhadap RAB aktif — apa yang akan berubah, sebelum disimpan. */
  beda: {
    totalAktif: string;
    totalBaru: string;
    jumlahTetap: number;
    /* `lineageKey` ikut dibawa BUKAN untuk ditampilkan, melainkan sebagai kunci
       React: kunci lama disusun dari `code + name`, dan kode item hanya unik di
       dalam induknya ("1" ada di setiap sub-kategori). Kunci kembar membuat
       React boleh menghilangkan baris – daftar periksa yang diam-diam kehilangan
       isi. */
    itemBaru: { lineageKey: string; code: string; jalur: string; name: string }[];
    itemHilang: { lineageKey: string; code: string; jalur: string; name: string; realisasi: number }[];
    volumeBerubah: { lineageKey: string; code: string; jalur: string; name: string; dari: number | null; ke: number | null; realisasi: number; dibawahRealisasi: boolean }[];
    /** Harga satuan item KONTRAK LAMA yang bergeser (DECISIONS 213). */
    hargaBerubah: {
      lineageKey: string;
      code: string;
      jalur: string;
      name: string;
      namaLama: string;
      dari: number | null;
      ke: number | null;
      /** Rupiah string — BigInt tidak bisa menyeberang ke klien. */
      dampakRupiah: string;
    }[];
    /** Nilai item KONTRAK LAMA yang bergeser tanpa volume/harga bergerak. */
    nilaiBergeser: { lineageKey: string; code: string; jalur: string; name: string; dari: string; ke: string; selisih: string }[];
  } | null;
  /**
   * Bahan PEMETAAN MANUAL (permintaan user 2026-09-02): item kontrak yang sudah
   * punya realisasi tapi di berkas ini DINOLKAN atau hilang, beserta item BARU
   * yang tersedia untuk dipasangkan dengannya.
   *
   * Pencocokan otomatis tidak bisa menebak pasangan ini — namanya berbeda DAN
   * nomornya berbeda, jadi tidak ada satu pun sinyal yang tersisa. Yang tahu
   * bahwa dua baris itu pekerjaan yang sama hanya orangnya.
   */
  padanan: {
    /**
     * `jalur` = induk-induknya ("I. PEKERJAAN … › 7. Pek. Umpak …"). Keluhan
     * user 2026-10-07: "1 Pekerjaan Bouwplank" saja tidak menunjuk pekerjaan
     * mana – nama dan nomor item berulang di banyak induk (DECISIONS 656).
     */
    lama: { lineageKey: string; code: string; jalur: string; name: string; realisasi: number; sebab: "dinolkan" | "hilang" }[];
    /** `volume` ikut dibawa: pemakainya harus bisa melihat, SEBELUM memilih,
     *  apakah baris pengganti itu cukup menampung realisasi yang sudah ada. */
    baru: { lineageAsli: string; code: string; jalur: string; name: string; volume: number | null }[];
    dipakai: { lineageBaru: string; lineageLama: string; code: string; name: string; namaLama: string }[];
    ditolak: { lineageBaru: string; lineageLama: string; sebab: string }[];
  };
  /**
   * Backup volume, analisa, bahan & upah yang terbaca dari berkas ini
   * (DECISIONS baru 2026-10-06). null = berkas Template Adendum MARLIN, yang
   * memang tidak membawa rincian. `rincianGagal` = pembacaannya gagal; impor
   * tetap jalan karena angka resmi tidak bergantung padanya.
   */
  rincian: { ringkasan: import("@/lib/rab/rincian/baca").RingkasanRincian; tersembunyiDibaca: string[] } | null;
  rincianGagal?: string;
  /** Diisi bila file berubah setelah pratinjau — commit ditolak, pratinjau diperbarui. */
  notice?: string;
};

/**
 * Tujuan impor (DECISIONS 209).
 * - `aktifkan` — perilaku lama: revisi baru langsung jadi RAB AKTIF + baseline
 *   di-regenerate. Dipakai untuk HPS awal dan adendum yang SUDAH resmi.
 * - `draft` — isi DRAFT adendum saja. RAB aktif, progres, kurva-S, dan
 *   keuangan tidak tersentuh. Ini yang hilang sebelumnya: satu-satunya jalur
 *   impor selalu mengaktifkan, jadi adendum yang masih diajukan terpaksa
 *   diperlakukan seolah sudah sah.
 */
export type ImportMode = "aktifkan" | "draft";

/** Ringkasan perubahan terhadap RAB aktif, siap-tampil. */
export type BedaPratinjau = NonNullable<ImportPreview["beda"]>;

export type ImportState =
  | {
      error?: string;
      success?: string;
      preview?: ImportPreview;
      /**
       * HPS AWAL sudah aktif, tetapi kurva-S SENGAJA BELUM dibuat — user yang
       * memilih bentuknya (permintaan 2026-09-19: *"jadi tidak langsung
       * pemaksaan gayamu sekarang"*).
       *
       * Diisi hanya pada impor HPS awal yang berhasil. Selama ruas ini ada,
       * layar menahan panel pilihan profil dan lokasi itu memang belum punya
       * baseline sama sekali.
       */
      pilihProfil?: { revisionNo: number; itemCount: number };
      /**
       * MARLIN tidak yakin membaca berkas ini → layar BERTANYA sheet & kolom
       * mana yang dipakai, bukan menampilkan galat (DECISIONS 624).
       */
      tanya?: { sebab: string } & import("@/lib/rab/hps-parser").PilihanBaca;
    }
  | undefined;

function safeName(n: string): string {
  return n.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/**
 * Baca template adendum + susun peringatan khas template (DECISIONS 216).
 *
 * Dua hal yang WAJIB disebut di pratinjau karena tidak terlihat di diff biasa:
 * item yang dinyatakan HAPUS (baris hilang bisa juga berarti user lupa), dan
 * item yang volumenya dijadikan 0 (tetap ada, nilainya nol — bukan dihapus).
 */
async function bacaTemplateAdendum(wb: import("exceljs").Workbook) {
  const { parseAdendumTemplate } = await import("@/lib/rab/adendum-template-parse");
  const h = parseAdendumTemplate(wb);
  const warnings: string[] = [];
  const daftar = (xs: { code: string; name: string }[], n = 8) =>
    xs.slice(0, n).map((x) => `${x.code} ${x.name}`).join("; ") +
    (xs.length > n ? `; +${xs.length - n} lainnya` : "");

  if (h.dihapus.length > 0) {
    warnings.push(
      `${h.dihapus.length} item DINYATAKAN DICABUT lewat kolom Keterangan: ${daftar(h.dihapus)}. ` +
        `Item yang sudah punya realisasi disebut terpisah di bawah. Periksa dulu sebelum melanjutkan.`,
    );
  }
  if (h.volumeNegatif.length > 0) {
    // DITOLAK, bukan dibetulkan sendiri jadi 0 (DECISIONS 203). Pekerjaan-kurang
    // dinyatakan dengan MENURUNKAN volume, bukan dengan volume negatif, jadi
    // angka negatif di sini selalu salah ketik atau rumus yang meleset.
    warnings.push(
      `PERHATIAN – ${h.volumeNegatif.length} item ber-volume NEGATIF dan TIDAK diikutkan: ` +
        h.volumeNegatif.slice(0, 8).map((x) => `${x.code} ${x.name} (${x.volume})`).join("; ") +
        (h.volumeNegatif.length > 8 ? `; +${h.volumeNegatif.length - 8} lainnya` : "") +
        `. Volume tidak boleh negatif. Untuk pekerjaan kurang, TURUNKAN volumenya. ` +
        `Betulkan angkanya di berkas, lalu unggah ulang.`,
    );
  }
  if (h.volumeNol.length > 0) {
    warnings.push(
      `${h.volumeNol.length} item volumenya dijadikan 0: ${daftar(h.volumeNol)}. ` +
        `Item ini TETAP tercantum di RAB dengan nilai nol, bukan dihapus. ` +
        `Kalau maksudnya menghapus item, tulis HAPUS di kolom Keterangan.`,
    );
  }
  if (h.itemBaru.length > 0) {
    warnings.push(
      `${h.itemBaru.length} item baru disisipkan: ` +
        h.itemBaru.slice(0, 8).map((x) => `${x.code} ${x.name} (${x.kategori})`).join("; ") +
        (h.itemBaru.length > 8 ? `; +${h.itemBaru.length - 8} lainnya` : "") +
        `. Harga item baru dipakai apa adanya – ia memang belum pernah disepakati.`,
    );
  }
  return { ...h, warnings };
}

export async function importHps(_prev: ImportState, formData: FormData): Promise<ImportState> {
  try {
    const user = await requireCapability("rab.manage");
    const locId = z.uuid().safeParse(formData.get("locationId"));
    if (!locId.success) return { error: "Lokasi tidak valid." };
    await requireLocationAccess(user, locId.data);
    const location = await db.location.findUniqueOrThrow({
      where: { id: locId.data },
      select: {
        id: true,
        slug: true,
        name: true,
        packageId: true,
        package: { select: { orgId: true, contract: { select: { startDate: true } } } },
      },
    });

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "File HPS (.xlsx) wajib dipilih." };
    if (file.size > MAX_BYTES) return { error: "File terlalu besar (maks 15 MB)." };
    if (!XLSX_MIME.includes(file.type) && !/\.xlsx?$/i.test(file.name)) {
      return { error: "File harus Excel (.xlsx)." };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    // TEMPLATE KERJA ADENDUM terbitan MARLIN punya bentuk sendiri (kolom
    // kontrak dan kolom adendum berdampingan) dan identitas baris yang
    // eksplisit lewat lineageKey — tidak bisa dibaca `hps-parser`, yang menebak
    // struktur dari pola kode. Dikenali dari penanda di sel header, lalu
    // dikonversi ke bentuk `FlatNode[]` YANG SAMA supaya seluruh mesin
    // pratinjau di bawah ini (diff, realisasi lepas, harga bergeser) berlaku
    // apa adanya. DECISIONS 216.
    // Hanya dicoba pada mode draft: template adendum memang cuma dipakai di
    // sana, dan membuka workbook dua kali untuk berkas HPS 4-5 MB itu mahal.
    const mode: ImportMode = formData.get("mode") === "draft" ? "draft" : "aktifkan";
    /*
     * PEMETAAN MANUAL yang dipilih user di pratinjau. Dikirim ulang pada tiap
     * pratinjau maupun saat menyimpan, sama seperti berkasnya sendiri — form
     * ini memang menyusun FormData-nya sendiri, jadi tidak ada state server
     * yang perlu dijaga tetap hidup di antara dua langkah.
     */
    const padananDiminta = ((): { lineageBaru: string; lineageLama: string }[] => {
      const mentah = String(formData.get("padanan") ?? "").trim();
      if (!mentah) return [];
      const parsed = z
        .array(z.object({ lineageBaru: z.string().min(1).max(300), lineageLama: z.string().min(1).max(300) }))
        .max(500)
        .safeParse(JSON.parse(mentah));
      return parsed.success ? parsed.data : [];
    })();
    /*
     * Sheet & kolom yang DIPILIH user (DECISIONS 624) – dikirim ulang pada tiap
     * pratinjau dan saat menyimpan, sama seperti berkasnya.
     */
    const opsiBaca = ((): import("@/lib/rab/hps-parser").OpsiBaca => {
      const sheet = String(formData.get("sheet") ?? "").trim();
      const mentah = String(formData.get("kolom") ?? "").trim();
      const kol = z.number().int().min(1).max(200);
      const k = mentah
        ? z
            .object({ vol: kol, unit: kol, price: kol, amount: kol })
            .safeParse((() => { try { return JSON.parse(mentah); } catch { return null; } })())
        : null;
      return { ...(sheet ? { sheet } : {}), ...(k?.success ? { kolom: k.data } : {}) };
    })();
    let templateAdendum:
      | (Awaited<ReturnType<typeof bacaTemplateAdendum>> & { wb: import("exceljs").Workbook; sheet: string })
      | null = null;
    /*
     * Deteksi template berjalan di KEDUA mode.
     *
     * Dulu dipagari `mode === "draft"` demi biaya, padahal gerbang murahnya
     * (`namaSheetXlsx`) sudah ada di bawah ini. Akibatnya: template terbitan
     * MARLIN yang diunggah lewat "Jadikan RAB AKTIF" — jalur yang memang
     * ditawarkan untuk adendum yang SUDAH resmi — jatuh ke parser HPS dan
     * membaca kolom HPS, bukan kolom adendum. Pada berkas Situbondo nilainya
     * terbaca Rp 7,45 M dari Rp 3,72 M yang sebenarnya, dengan `warnings`
     * kosong: pratinjau menjanjikan nilai DUA KALI LIPAT tanpa satu peringatan
     * pun. Audit 2026-09-15 (F-1).
     */
    {
      // Nama sheet DULU, isinya belakangan. Memuat seluruh workbook cuma untuk
      // mengintip satu sel penanda berharga 180 MB heap + 25 detik pada berkas
      // KKP 45-sheet — dan itulah yang mematikan proses di kontainer 512 MB
      // (DECISIONS 297). Penanda template mustahil ada bila sheet-nya tidak
      // ada, jadi pemeriksaan murah ini menutup seluruh jalur mahalnya.
      const { namaSheetXlsx } = await import("@/lib/rab/xlsx-slim");
      const { ADENDUM_TEMPLATE_SHEET } = await import("@/lib/export/adendum-template-xlsx");
      const mungkinTemplate = (await namaSheetXlsx(buffer)).some((x) => x.nama === ADENDUM_TEMPLATE_SHEET && !x.tersembunyi);

      const ExcelJS = (await import("exceljs")).default;
      const probe = new ExcelJS.Workbook();
      let cocok = false;
      try {
        if (mungkinTemplate) {
          await probe.xlsx.load(buffer as unknown as ArrayBuffer);
          const { isAdendumTemplate } = await import("@/lib/rab/adendum-template-parse");
          cocok = isAdendumTemplate(probe);
        }
      } catch {
        // Gagal dibuka sebagai workbook → biar jalur HPS yang melaporkannya,
        // dengan pesan galat yang sudah dikenal user.
      }
      if (cocok) {
        // Sudah pasti template: galatnya BUKAN "coba jalur lain", melainkan
        // kesalahan pengisian yang harus disebut apa adanya ke user.
        try {
          templateAdendum = { ...(await bacaTemplateAdendum(probe)), wb: probe, sheet: ADENDUM_TEMPLATE_SHEET };
        } catch (e) {
          if (e instanceof AdendumTemplateError) return { error: e.message };
          throw e;
        }
      }
    }

    let parsed;
    let warnings: string[];
    let priceColumn;
    let nodes: import("@/lib/rab/flatten").FlatNode[];
    /* Tab yang BENAR-BENAR dibaca — permintaan user 2026-09-21. */
    let sheetName: string;
    let baca: import("@/lib/rab/hps-parser").PilihanBaca | null = null;
    /** Kolom volume & harga yang dibaca parser – dipakai pelacak rincian. */
    let kolomBaca: { vol: number; price: number } | null = null;
    if (templateAdendum) {
      warnings = [...templateAdendum.warnings];
      priceColumn = { label: "TEMPLATE ADENDUM (kolom Volume Adendum)", source: "nego" as const };
      nodes = templateAdendum.nodes;
      sheetName = templateAdendum.sheet;
      // Volume Adendum yang diberi rumus ke sheet backup ikut ditelusuri
      // (DECISIONS baru 2026-10-07); yang diketik tetap diketik.
      const { KOLOM_RINCIAN_TEMPLATE } = await import("@/lib/rab/adendum-template-parse");
      kolomBaca = { ...KOLOM_RINCIAN_TEMPLATE };
    } else {
      try {
        let pilihan: import("@/lib/rab/hps-parser").PilihanBaca | undefined;
        ({ parsed, warnings, priceColumn, sheetName, pilihan, kolom: kolomBaca } = await parseHpsBuffer(
          buffer,
          opsiBaca,
        ));
        baca = pilihan ?? null;
      } catch (e) {
        if (e instanceof ImporPerluJawaban) return { tanya: { sebab: e.sebab, ...e.pilihan } };
        return { error: e instanceof Error ? e.message : "Gagal membaca file HPS." };
      }
      nodes = flattenParsedRab(parsed);
      /*
       * PAGAR ANTAR LAYER — dipasang di sini karena di sinilah angka berhenti
       * jadi bacaan dan mulai jadi nilai kontrak.
       *
       * `parseHpsBuffer` sudah mencocokkan Σ item terhadap total yang DITULIS
       * berkas. Yang tidak pernah dicek: apakah yang akan DISIMPAN sama dengan
       * yang dibaca itu. Pada `MC 1 FINAL GEMPOLSEWU` bedanya Rp 35.003.407
       * (DECISIONS 543), dan tidak ada satu layar pun yang menyebutkannya.
       *
       * Selisih di sini bukan cacat berkas — kedua layer membaca berkas yang
       * sama — jadi ia DITOLAK, bukan diperingatkan, dan pesannya menyebut
       * kategori mana yang meleset supaya berkas berikutnya tidak menuntut
       * pembedahan manual dari nol.
       */
      /*
       * Baris yang punya volume & harga satuan tapi kolom JUMLAH-nya kosong di
       * berkas. `flatten` mengikuti subtotal berkasnya sendiri (lihat
       * `cadanganDipakaiBerkas`), dan itu WAJIB dikatakan: kalau kosongnya tidak
       * disengaja, orang yang menguploadlah yang tahu — bukan MARLIN.
       */
      const tanpaJumlah = barisTanpaJumlah(parsed);
      if (tanpaJumlah.length > 0) {
        const sebut = tanpaJumlah
          .slice(0, 3)
          .map(
            (b) =>
              // Barisnya ikut disebut: peringatan ini menyuruh orang membuka
              // Excel dan mengisi kolomnya (DECISIONS 608).
              `${b.excelRow != null ? `baris ${b.excelRow} ` : ""}"${b.name}" ` +
              `(volume ${b.volume.toLocaleString("id-ID")} × ` +
              `${b.unitPrice.toLocaleString("id-ID")} = ${b.seandainya.toLocaleString("id-ID")})`,
          )
          .join("; ");
        warnings.push(
          `${tanpaJumlah.length} baris punya volume & harga satuan tetapi kolom JUMLAH-nya kosong di berkas: ` +
            `${sebut}${tanpaJumlah.length > 3 ? `, dan ${tanpaJumlah.length - 3} baris lain` : ""}. ` +
            "MARLIN mengikuti subtotal yang ditulis berkas – tidak mengarang angkanya sendiri. " +
            "Kalau kosongnya tidak disengaja, isi kolom jumlahnya di Excel lalu impor ulang.",
        );
      }

      /*
       * Item BERNILAI tanpa satuan – disebut, tidak dikarang (DECISIONS 675).
       * Bentuk yang ditemukan: berkas CCO yang item barunya hanya punya blok
       * TAMBAH/ADD-2, dan kedua blok itu tidak punya kolom SAT (MC-0 Desa Batu
       * Putih: 393 item). Satuannya kosong di MARLIN sampai berkasnya diisi.
       */
      const tanpaSatuan = nodes.filter((n) => n.kind === "item" && n.amount > 0n && !n.unit?.trim());
      if (tanpaSatuan.length > 0) {
        const contoh = tanpaSatuan
          .slice(0, 3)
          .map((n) => `${n.excelRow != null ? `baris ${n.excelRow} ` : ""}"${n.name.slice(0, 60)}"`)
          .join("; ");
        warnings.push(
          `${tanpaSatuan.length} item bernilai tidak punya satuan di berkas: ${contoh}` +
            `${tanpaSatuan.length > 3 ? `, dan ${tanpaSatuan.length - 3} item lain` : ""}. ` +
            "MARLIN tidak mengarang satuannya, jadi kolom satuannya akan kosong. Kalau perlu, isi kolom satuan di " +
            "Excel lalu impor ulang.",
        );
      }

      const beda = bedaAntarLayer(parsed, nodes);
      if (beda.length > 0) {
        const rinci = beda
          .map(
            (b) =>
              `${b.label}: berkas ${b.berkas.toLocaleString("id-ID")}, akan tersimpan ` +
              `${b.masuk.toLocaleString("id-ID")} (selisih ${(b.berkas - b.masuk).toLocaleString("id-ID")})`,
          )
          .join("; ");
        /*
         * Bacaan yang tidak cocok = MARLIN tidak paham berkasnya, jadi user
         * DITANYA sheet & kolomnya, bukan diberi jalan buntu (DECISIONS 624/665;
         * teguran user 2026-10-14: *"seharusnya kamu sajikan saja pemilihan
         * manual kalau sistem impor rab mu tidak sanggup"*). Bentuk yang paling
         * sering: kolom JUMLAH kosong, sehingga berkas terbaca 0 sementara
         * volume × harga satuan menghasilkan angka lain. Tetap tidak ada yang
         * disimpan sebelum keduanya sama.
         */
        const sebab =
          `Angka yang terbaca dari berkas tidak sama dengan yang akan disimpan – ${rinci}. ` +
          "Biasanya kolom yang dipakai MARLIN keliru, atau kolom jumlahnya kosong. Nilai kontrak tidak disimpan " +
          "sebelum angkanya sama. Pilih sendiri sheet dan kolom volume, satuan, harga satuan, dan jumlah di bawah.";
        if (baca) return { tanya: { sebab, ...baca } };
        return {
          error:
            `Impor dihentikan: angka yang akan tersimpan tidak sama dengan angka yang dibaca dari berkas ini. ` +
            `${rinci}. Ini kesalahan MARLIN saat membaca, bukan kesalahan berkas Anda. Nilai kontrak tidak boleh ` +
            `disimpan sebelum keduanya sama. Kirimkan berkas ini beserta pesan ini supaya bisa diperbaiki.`,
        };
      }
    }
    if (nodes.length === 0) {
      // MARLIN tidak paham berkasnya → TANYA sheet & kolomnya (DECISIONS 624/665),
      // bukan berhenti. Galat hanya bila bahan pertanyaannya tidak ada.
      const sebab =
        "Tidak ada baris RAB yang bernilai dari pembacaan ini. Pilih sheet dan kolom volume, satuan, harga satuan, dan jumlah di bawah.";
      if (baca) return { tanya: { sebab, ...baca } };
      return { error: sebab.replace(/ Pilih sheet.*$/, " Periksa sheet RAB di berkas Anda.") };
    }

    /*
     * VOLUME / JUMLAH NEGATIF DITOLAK DI SINI — BUKAN OLEH POSTGRES.
     *
     * Dilaporkan user 2026-09-23 untuk berkas `MC 1 BETAH WALANG`: impor
     * adendum dijawab layar *"Gagal mengirim – server menolak permintaan ini"*
     * dan, di konsol, *"An unexpected response was received from the server"*.
     * Tidak ada satu pun kalimat yang menyebut apa yang salah dengan berkasnya.
     *
     * Penyebabnya SATU baris: item `1.4 "Pekerjaan Bekesting Pasangan Batako"`
     * bervolume −42 (jumlah −7.511.351), karena berkas itu menulis
     * pekerjaan-kurang sebagai blok KURANG ber-angka minus. Saat ditulis, ia
     * melanggar `rab_nodes_amounts_nonneg_ck`; galat mentah Postgres itu lolos
     * dari server action, dan yang sampai ke user adalah kalimat kerangka Next,
     * bukan kalimat MARLIN.
     *
     * Aturannya sendiri sudah ada dan sudah dipakai di jalur template adendum
     * (lihat `bacaTemplateAdendum` di atas): volume tidak bisa negatif,
     * pekerjaan-kurang dinyatakan dengan MENURUNKAN volume. Yang hilang cuma
     * penerapannya di jalur parser HPS. DITOLAK, bukan dijadikan 0 atau
     * di-mutlak-kan sendiri: angka yang diunggah user dipakai apa adanya, dan
     * membetulkan tanda diam-diam persis yang dilarang DECISIONS 203.
     */
    const negatif = nodes.filter((n) => (n.volume != null && n.volume < 0) || n.amount < 0n);
    if (negatif.length > 0) {
      const sebut = negatif
        .slice(0, 8)
        .map(
          (n) =>
            /*
             * BARIS Excel didahulukan — permintaan user 2026-09-23 (*"penunjuk
             * item juga perlu informasi rows berapa agar spesifik masalah di
             * filenya yang mana"*). Di berkas yang memicunya, nama item itu
             * muncul SEMBILAN kali; nomor baris satu-satunya penunjuk yang bisa
             * langsung diketik ke kotak "Go To" Excel.
             */
            // Alamat SEL bila kolom volumenya diketahui (teguran user 2026-10-14:
            // "sebut … bahwa cell ini menyebabkan error"), baris saja bila tidak.
            `${
              n.excelRow == null
                ? "baris tak diketahui"
                : kolomBaca && n.volume != null && n.volume < 0
                  ? `baris ${n.excelRow} (sel ${colLetter(kolomBaca.vol)}${n.excelRow})`
                  : `baris ${n.excelRow}`
            } – ` +
            `${n.code} "${n.name}" (volume ${(n.volume ?? 0).toLocaleString("id-ID")}, ` +
            `jumlah ${n.amount.toLocaleString("id-ID")})`,
        )
        .join("; ");
      return {
        error:
          `Impor dihentikan: ${negatif.length} baris volume/jumlahnya NEGATIF, yaitu ` +
          `${sebut}${negatif.length > 8 ? `; +${negatif.length - 8} baris lain` : ""}. ` +
          `Volume tidak boleh negatif. MARLIN menyimpan RAB sebagai volume HASIL, ` +
          `jadi pekerjaan kurang ditulis dengan MENURUNKAN volume item itu di barisnya sendiri, ` +
          `bukan sebagai baris minus terpisah. Kalau berkas ini berformat tambah-kurang ` +
          `(blok TAMBAH / KURANG / TETAP), yang perlu diimpor adalah blok HASIL-nya. ` +
          `Betulkan angkanya di berkas, lalu unggah ulang.`,
      };
    }

    const total = grandTotal(nodes);

    const activeRevision = await db.rabRevision.findFirst({
      where: { locationId: location.id, status: "aktif" },
      select: { id: true, revisionNo: true },
    });

    /*
     * TEMPLATE BASI DITOLAK — sebelum satu baris pun dibandingkan.
     *
     * Dilaporkan user 2026-09-12: template terbitan MARLIN sendiri, diimpor ke
     * draft adendum, dijawab "676 item baru · 676 item hilang · 140 item yang
     * SUDAH dikerjakan tidak ada di file ini". Angka 676 yang muncul dua kali
     * bukan perubahan data melainkan satu himpunan item yang tidak saling
     * kenal: berkasnya dibuat dari revisi #1, sementara yang aktif saat diimpor
     * revisi lain dengan penomoran kategori berbeda (`VI.1` vs `VI`).
     *
     * Nomor revisinya SUDAH tercetak di berkas itu sejak dulu — sebagai kalimat
     * untuk dibaca orang, dan tidak pernah diperiksa mesin. Pemeriksaan inilah
     * yang hilang. Tanpanya, pratinjau yang benar secara teknis (memang tidak
     * ada yang cocok) menjadi laporan yang menyesatkan secara praktis: ia
     * terbaca sebagai "adendummu mengubah segalanya", padahal yang terjadi
     * cuma dua berkas yang bicara tentang RAB yang berbeda.
     *
     * DITOLAK, bukan diperingatkan: melanjutkan berarti menulis draft yang
     * membuang seluruh item kontrak berikut realisasinya.
     */
    if (templateAdendum && activeRevision) {
      const { sumberRevisiTemplate } = await import("@/lib/rab/adendum-template-parse");
      const sumber = sumberRevisiTemplate(templateAdendum.wb);
      const beda =
        sumber != null &&
        (sumber.revisionId != null
          ? sumber.revisionId !== activeRevision.id
          : sumber.revisionNo !== activeRevision.revisionNo);
      if (beda) {
        return {
          error:
            `Template ini dibuat dari RAB revisi #${sumber!.revisionNo}, sedangkan yang aktif sekarang ` +
            `revisi #${activeRevision.revisionNo}. Item di kedua revisi itu tidak bisa dicocokkan, jadi impor ini ` +
            `akan terbaca seolah seluruh isi kontrak diganti. Unduh template adendum yang baru, ` +
            `pindahkan isian volumenya ke sana, lalu impor lagi.`,
        };
      }
    }
    // Adendum HANYA bila kontrak sudah SPMK/jalan (startDate terisi). Sebelum SPMK
    // (masih "menunggu SPMK"), impor RAB ulang = KOREKSI HPS awal, bukan adendum
    // resmi. DECISIONS 118.
    const contractStarted = location.package?.contract?.startDate != null;
    const isAdendum = activeRevision !== null && contractStarted;

    /*
     * IDENTITAS ITEM disamakan dengan RAB aktif SEBELUM apa pun dibandingkan
     * atau ditulis (lihat `samakanLineage`).
     *
     * `lineageKey` = jalur kode. Satu baris disisipkan di adendum menggeser
     * seluruh nomor di bawahnya, dan sejak itu "item 6" file baru dipasangkan
     * dengan "item 6" kontrak — pekerjaan yang berbeda. Akibatnya dua: pratinjau
     * melaporkan puluhan "harga satuan berubah" yang tidak pernah terjadi, dan
     * realisasi harian nempel ke pekerjaan yang salah tanpa suara.
     */
    let aktifNodes: {
      id: string;
      parentId: string | null;
      lineageKey: string;
      kind: string;
      code: string;
      name: string;
      unit: string | null;
      volume: unknown;
      unitPrice: unknown;
      amount: bigint;
      sortOrder: number;
    }[] = [];
    let padananDipakai: { lineageBaru: string; lineageLama: string; code: string; name: string; namaLama: string }[] = [];
    let padananDitolak: { lineageBaru: string; lineageLama: string; sebab: string }[] = [];
    let padananBaruTersedia: { lineageAsli: string; code: string; jalur: string; name: string; volume: number | null }[] = [];
    if (activeRevision) {
      aktifNodes = await db.rabNode.findMany({
        where: { revisionId: activeRevision.id },
        select: {
          id: true,
          parentId: true,
          lineageKey: true,
          kind: true,
          code: true,
          name: true,
          unit: true,
          volume: true,
          unitPrice: true,
          amount: true,
          sortOrder: true,
        },
      });
      const keyById = new Map(aktifNodes.map((n) => [n.id, n.lineageKey]));
      // Node berkas SEBELUM dicocokkan: kunci di sini yang dipakai
      // `PadananManual.lineageBaru`, dan volumenya yang perlu dilihat user.
      const nodesAsli = nodes;
      /*
       * TEMPLATE TIDAK PERNAH DITEBAK-ULANG IDENTITASNYA (RAB-ADD-01).
       *
       * `samakanLineage` ada untuk berkas HPS/MC mentah, yang identitasnya
       * memang harus disimpulkan dari pola kode: satu baris disisipkan di
       * adendum menggeser seluruh nomor di bawahnya, dan tanpa penebakan itu
       * "item 6" berkas baru akan dipasangkan dengan "item 6" kontrak yang
       * berbeda pekerjaannya.
       *
       * Template adendum BUKAN berkas seperti itu. Ia terbitan MARLIN sendiri
       * dan membawa `lineageKey` kontrak apa adanya di kolom identitas — tidak
       * ada yang perlu ditebak, dan menebaknya justru merusak yang sudah benar.
       *
       * Dilaporkan user 2026-09-12 dan ditiru persis dari dua berkas terbitan
       * MARLIN miliknya: template + ekspor RAB aktif → 674 "item baru", 52
       * volume berubah, 177 tetap (di layarnya 676 · 52 · 175). Kunci
       * `I#6#6.1#6.1.a` ditulis ulang jadi `I#6#2#6.1#6.1.a` — satu ruas
       * disisipkan, dan sejak itu 674 dari 903 item kehilangan pasangannya.
       * Keduanya, berkas dan basis data, sebenarnya SUDAH sepakat.
       *
       * Yang paling merusak bukan angkanya melainkan artinya di layar: "676
       * item hilang · 140 item yang SUDAH dikerjakan tidak ada di file ini"
       * terbaca sebagai adendum yang membuang separuh kontrak berikut
       * realisasinya — padahal tidak ada satu pun yang berubah.
       */
      const cocok: ReturnType<typeof samakanLineage> = templateAdendum
        ? { nodes, padananDipakai: [], padananDitolak: [], itemBaruAsli: [], namaBerbeda: [], digeser: [] }
        : samakanLineage(
        nodes,
        aktifNodes.map((n) => ({
          lineageKey: n.lineageKey,
          parentLineageKey: n.parentId ? (keyById.get(n.parentId) ?? null) : null,
          kind: n.kind,
          code: n.code,
          name: n.name,
          unit: n.unit,
        })),
        { padanan: padananDiminta },
      );
      nodes = cocok.nodes;
      padananDipakai = cocok.padananDipakai;
      padananDitolak = cocok.padananDitolak;
      {
        const volAsli = new Map(nodesAsli.map((n) => [n.lineageKey, n.volume]));
        const nodeAsli = new Map(nodesAsli.map((n) => [n.lineageKey, n]));
        const jalurAsli = (key: string | null): string => {
          const n = key ? nodeAsli.get(key) : undefined;
          if (!n) return "";
          const atas = jalurAsli(n.parentLineageKey);
          const nama = [n.code, n.name].filter(Boolean).join(". ");
          return atas ? `${atas} › ${nama}` : nama;
        };
        padananBaruTersedia = cocok.itemBaruAsli.map((x) => ({
          ...x,
          jalur: jalurAsli(nodeAsli.get(x.lineageAsli)?.parentLineageKey ?? null),
          volume: volAsli.get(x.lineageAsli) ?? null,
        }));
      }
      if (cocok.padananDipakai.length > 0) {
        warnings.push(
          `${cocok.padananDipakai.length} item DIPETAKAN MANUAL ke item kontrak: ` +
            cocok.padananDipakai
              .slice(0, 8)
              .map((p) => `"${p.namaLama}" → ${p.code} "${p.name}"`)
              .join("; ") +
            (cocok.padananDipakai.length > 8 ? `; +${cocok.padananDipakai.length - 8} lainnya` : "") +
            `. Realisasi harian item kontrak itu ikut pindah ke item barunya. Tidak ada baris laporan yang diubah; ` +
            `yang pindah hanya identitas itemnya.`,
        );
      }
      if (cocok.padananDitolak.length > 0) {
        warnings.push(
          `PERHATIAN – ${cocok.padananDitolak.length} pemetaan TIDAK bisa dipakai: ` +
            cocok.padananDitolak.slice(0, 5).map((p) => p.sebab).join(" ") +
            (cocok.padananDitolak.length > 5 ? ` +${cocok.padananDitolak.length - 5} lainnya.` : ""),
        );
      }
      if (cocok.digeser.length > 0) {
        const contoh = cocok.digeser
          .slice(0, 8)
          .map((d) => `${d.name} (kontrak ${d.kodeLama} → file ${d.kode})`);
        warnings.push(
          `${cocok.digeser.length} item dikenali lewat NAMA karena nomornya bergeser terhadap kontrak: ` +
            `${contoh.join("; ")}${cocok.digeser.length > contoh.length ? `; +${cocok.digeser.length - contoh.length} lainnya` : ""}. ` +
            `Realisasi hariannya tetap tersambung ke item yang benar, tidak pindah ke pekerjaan lain yang kebetulan bernomor sama.`,
        );
      }
      if (cocok.namaBerbeda.length > 0) {
        const contoh = cocok.namaBerbeda
          .slice(0, 5)
          .map((d) => `${d.kode}: "${d.namaLama}" → "${d.name}"`);
        warnings.push(
          `PERHATIAN – ${cocok.namaBerbeda.length} item bernomor sama dengan kontrak tapi NAMANYA berbeda, ` +
            `dan tidak ada pasangan nama yang tunggal untuk dicocokkan: ${contoh.join("; ")}` +
            `${cocok.namaBerbeda.length > contoh.length ? `; +${cocok.namaBerbeda.length - contoh.length} lainnya` : ""}. ` +
            `Item ini dianggap sama karena nomornya sama. Periksa apakah ini memang ganti nama, ` +
            `bukan dua pekerjaan berbeda yang kebetulan bernomor sama.`,
        );
      }
    }

    // Lineage realisasi yang HILANG di file baru: realisasi item itu tidak akan
    // tersambung ke revisi baru (progress lokasi turun diam-diam). Tampilkan di
    // pratinjau SEBELUM commit — audit 2026-07-27, B17.
    if (activeRevision) {
      const realized = await cumulativeVolumeByLineage(location.id);
      const newItemKeys = new Set(
        nodes.filter((n) => n.kind === "item").map((n) => n.lineageKey),
      );
      const lostKeys = [...realized.entries()]
        .filter(([key, vol]) => vol > 0 && !newItemKeys.has(key))
        .map(([key]) => key);
      if (lostKeys.length > 0) {
        // Lengkap dengan induknya: "1 Pekerjaan Bouwplank" saja tidak menunjuk
        // pekerjaan mana – nomor dan nama item berulang di banyak induk.
        const aktifById = new Map(aktifNodes.map((n) => [n.id, n]));
        const label = (n: (typeof aktifNodes)[number] | undefined): string => {
          if (!n) return "";
          const atas = label(n.parentId ? aktifById.get(n.parentId) : undefined);
          const nama = [n.code, n.name].filter(Boolean).join(" ");
          return atas ? `${atas} › ${nama}` : nama;
        };
        const nodeByKey = new Map(aktifNodes.map((n) => [n.lineageKey, n]));
        const labels = lostKeys.map((k) => label(nodeByKey.get(k)) || k);
        const shown = labels.slice(0, 8);
        warnings.push(
          `PERHATIAN – ${lostKeys.length} item yang SUDAH punya realisasi tidak ditemukan di file baru: ` +
            `${shown.join("; ")}${labels.length > shown.length ? `; +${labels.length - shown.length} lainnya` : ""}. ` +
            `Realisasi item tersebut TIDAK akan tersambung ke revisi baru sehingga progress lokasi bisa turun. ` +
            `Pastikan kode/struktur item di file sama dengan RAB aktif, atau lanjutkan hanya bila item memang dihapus lewat adendum resmi.`,
        );
      }
    }

    const draft = await db.rabRevision.findFirst({
      where: { locationId: location.id, status: "draft" },
      select: { id: true, revisionNo: true, totalValue: true, amendmentId: true, note: true },
    });

    // Perbandingan terhadap RAB aktif — supaya "apa yang berubah" terlihat
    // SEBELUM ada yang ditulis, bukan sesudah (DECISIONS 209).
    let beda: RingkasBeda | null = null;
    let banding: BandingItem[] | null = null;
    if (activeRevision) {
      // Rantai induk ikut dikirim: tanpanya pratinjau hanya bisa menyebut
      // "2.d" – nomor yang berulang di banyak kategori (keluhan user
      // 2026-09-05).
      const kunciById = new Map(aktifNodes.map((n) => [n.id, n.lineageKey]));
      beda = bandingkanTerhadapAktif(
        aktifNodes.map((n) => ({
          lineageKey: n.lineageKey,
          parentLineageKey: n.parentId ? (kunciById.get(n.parentId) ?? null) : null,
          kind: n.kind,
          code: n.code,
          name: n.name,
          volume: n.volume == null ? null : Number(n.volume),
          unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
          amount: n.amount,
        })),
        nodes,
        await cumulativeVolumeByLineage(location.id),
      );

      // Tabel banding memakai simpul aktif yang SAMA — dua daftar yang disusun
      // terpisah akan menyimpang, dan yang dibandingkan orang justru angkanya.
      banding = bandingkanPerItem(
        aktifNodes.map((n) => ({
          lineageKey: n.lineageKey,
          parentLineageKey: n.parentId ? (kunciById.get(n.parentId) ?? null) : null,
          kind: n.kind,
          code: n.code,
          name: n.name,
          volume: n.volume == null ? null : Number(n.volume),
          unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
          amount: n.amount,
        })),
        nodes,
      );

      // Harga satuan item KONTRAK LAMA yang bergeser (DECISIONS 213). Adendum
      // mengubah volume; harga item yang sudah disepakati tidak boleh ikut
      // bergerak. Kalau bergerak, nilai kontrak berubah TANPA ada pekerjaan
      // yang bertambah — dan tidak satu pun kolom volume memperlihatkannya.
      if (beda.hargaBerubah.length > 0) {
        const naik = beda.hargaBerubah.filter((h) => h.dampakRupiah > 0n).length;
        const dampak = beda.hargaBerubah.reduce((t, h) => t + h.dampakRupiah, 0n);
        // Nama KONTRAK ikut disebut: kalau ia berbeda dari nama file, yang
        // bergeser itu pasangannya, bukan harganya.
        const contoh = beda.hargaBerubah
          .slice(0, 5)
          .map(
            (h) =>
              `${h.jalur} kontrak "${h.namaLama}" ${formatRupiahSatuan(h.dari)} → file "${h.name}" ${formatRupiahSatuan(h.ke)}`,
          );
        warnings.push(
          `PERHATIAN – harga satuan ${beda.hargaBerubah.length} item KONTRAK LAMA berubah di file ini ` +
            `(${naik} naik, ${beda.hargaBerubah.length - naik} turun; dampak neto ${formatRupiah(dampak)}): ` +
            `${contoh.join("; ")}${beda.hargaBerubah.length > contoh.length ? `; +${beda.hargaBerubah.length - contoh.length} lainnya` : ""}. ` +
            `Adendum seharusnya hanya mengubah VOLUME. Harga satuan item yang sudah ada di kontrak tetap. ` +
            `MARLIN TIDAK mengubah angka berkas sendiri. Pastikan pergeseran ini memang ada dasarnya sebelum melanjutkan.`,
        );
      }

      // Nilai item yang bergeser SENDIRI. Berkas RAB memakai kolom JUMLAH apa
      // adanya (DECISIONS 212), jadi nilai item tidak selalu sama dengan
      // volume x harga. Kolom JUMLAH yang diketik ulang karena itu menggeser
      // nilai kontrak tanpa satu pun volume atau harga bergerak, dan cek-silang
      // parser baru berbunyi di atas 1% per baris.
      if (beda.nilaiBergeser.length > 0) {
        const selisih = beda.nilaiBergeser.reduce((t, h) => t + h.selisih, 0n);
        const contoh = beda.nilaiBergeser
          .slice(0, 5)
          .map((h) => `${h.jalur} ${h.name} ${formatRupiah(Number(h.dari))} → ${formatRupiah(Number(h.ke))}`);
        warnings.push(
          `PERHATIAN – nilai ${beda.nilaiBergeser.length} item KONTRAK LAMA bergeser di file ini padahal ` +
            `volume dan harga satuannya sama (selisih neto ${formatRupiah(Number(selisih))}): ` +
            `${contoh.join("; ")}${beda.nilaiBergeser.length > contoh.length ? `; +${beda.nilaiBergeser.length - contoh.length} lainnya` : ""}. ` +
            `Kolom JUMLAH di file dipakai apa adanya, jadi pergeseran ini masuk ke nilai kontrak ` +
            `tanpa terlihat di kolom volume mana pun.`,
        );
      }
    }

    /*
     * Kandidat sisi LAMA: item kontrak yang sudah punya realisasi tapi di
     * berkas ini dinolkan atau hilang. Dua-duanya keadaan yang sama bagi user
     * ("pekerjaannya pindah ke baris lain"), jadi ditawarkan bersama - hanya
     * sebabnya yang dibedakan supaya kalimat di layar tidak mengarang.
     */
    const padananLama = beda
      ? [
          ...beda.volumeBerubah
            .filter((v) => v.realisasi > 0 && (v.ke ?? 0) === 0)
            .map((v) => ({ lineageKey: v.lineageKey, code: v.code, jalur: v.jalur, name: v.name, realisasi: v.realisasi, sebab: "dinolkan" as const })),
          ...beda.itemHilang
            .filter((v) => v.realisasi > 0)
            .map((v) => ({ lineageKey: v.lineageKey, code: v.code, jalur: v.jalur, name: v.name, realisasi: v.realisasi, sebab: "hilang" as const })),
        ]
      : [];

    /*
     * Ringkasan berjenjang untuk layar — DIADU dengan kontrak kalau ada
     * pembandingnya (permintaan user 2026-09-21). Tanpa RAB aktif, kolom
     * pembanding sengaja `null` di tiap baris, BUKAN nol: belum ada kontrak
     * untuk dibandingkan, dan layar harus bisa mengatakannya.
     */
    const kunciAktifById = new Map(aktifNodes.map((n) => [n.id, n.lineageKey]));
    const ringkasKategori: (SimpulBanding | (ReturnType<typeof pohonRingkas>[number] & {
      kontrak: null;
      adendum: bigint;
      selisih: bigint;
      status: null;
    }))[] = activeRevision
      ? pohonRingkasBanding(
          aktifNodes.map((n) => ({
            kind: n.kind,
            code: n.code,
            name: n.name,
            amount: n.amount,
            lineageKey: n.lineageKey,
            parentLineageKey: n.parentId ? (kunciAktifById.get(n.parentId) ?? null) : null,
            sortOrder: n.sortOrder,
          })),
          nodes,
        )
      : pohonRingkas(nodes).map((b) => ({ ...b, kontrak: null, adendum: b.total, selisih: 0n, status: null }));

    /*
     * BACKUP VOLUME, ANALISA, BAHAN & UPAH (DECISIONS baru 2026-10-06).
     *
     * Dibaca dari berkas yang SAMA, lewat rumus yang ditulis penyusunnya.
     * Kuncinya nomor baris Excel – lineage item baru pasti sesudah revisi
     * tersimpan. Gagal membaca rincian tidak menggagalkan impor: angka resmi
     * tidak bergantung padanya, dan kegagalannya disebut di pratinjau.
     */
    let rincian: import("@/lib/rab/rincian/baca").RincianBerkas | null = null;
    let rincianGagal: string | undefined;
    if (kolomBaca) {
      try {
        const { bacaRincian } = await import("@/lib/rab/rincian/baca");
        rincian = await bacaRincian(buffer, {
          sheetRab: sheetName,
          kolom: kolomBaca,
          items: nodes
            .filter((n) => n.kind === "item" && n.excelRow != null)
            .map((n) => ({ kunci: String(n.excelRow), excelRow: n.excelRow!, unitPrice: n.unitPrice })),
        });
      } catch (e) {
        console.error("[rab-import] baca rincian gagal:", e);
        rincianGagal = e instanceof Error ? e.message : "kesalahan tak dikenal";
      }
    }

    /*
     * KOREKSI (DECISIONS 728): "Jadikan RAB AKTIF" pada lokasi ber-RAB aktif
     * menimpa isi revisi aktif di tempat. Rencananya dihitung di pratinjau –
     * berapa baris berubah, baru, dihapus, dan baris mana yang tidak boleh
     * hilang – supaya orang melihatnya sebelum ada yang ditulis.
     */
    let koreksi: ImportPreview["koreksi"] = null;
    if (activeRevision && mode === "aktifkan") {
      const rencana = rencanaKoreksiTimpa(await simpulAktif(activeRevision.id), nodes);
      const fmt = {
        angka: (n: number | null) => (n == null ? "kosong" : formatNumber(n)),
        rupiah: (n: number | null) => (n == null ? "kosong" : formatRupiahSatuan(n)),
      };
      koreksi = {
        revisionNo: activeRevision.revisionNo,
        boleh: bolehAktifTanpaPersetujuan(user),
        ringkas: rencana.ringkas,
        contoh: rencana.ubah
          .filter((u) => u.volume || u.unitPrice || u.amount || u.induk || u.kind || u.code || u.name || u.unit)
          .slice(0, 12)
          .map((u) => `${u.label}: ${kalimatUbah(u, fmt)}`),
        tambah: rencana.tambah.slice(0, 8).map((n) => [n.code, n.name].filter(Boolean).join(" ")),
        hapus: rencana.hapus.slice(0, 8).map((h) => h.label),
        terhalang: await terhalangKoreksi(rencana),
      };
    }

    const preview: ImportPreview = {
      koreksi,
      rincian: rincian ? { ringkasan: rincian.ringkasan, tersembunyiDibaca: rincian.tersembunyiDibaca } : null,
      ...(rincianGagal ? { rincianGagal } : {}),
      padanan: {
        lama: padananLama,
        baru: padananBaruTersedia,
        dipakai: padananDipakai,
        ditolak: padananDitolak,
      },
      fileName: file.name,
      bytes: file.size,
      sha256,
      grandTotal: total.toString(),
      itemCount: nodes.filter((n) => n.kind === "item").length,
      isAdendum,
      priceColumnLabel: priceColumn.label,
      priceSource: priceColumn.source,
      warnings,
      /*
       * Ringkasan berjenjang, DIADU dengan kontrak kalau ada pembandingnya.
       *
       * Permintaan user 2026-09-21: *"yang kuminta ada perbandingan itu di
       * bagian ini, kenapa ini malah tidak ada!"* Tabel banding per ITEM sudah
       * ada sejak DECISIONS 599, tetapi ia blok lain; yang dibaca lebih dulu
       * saat memeriksa adendum adalah ringkasan kategori ini.
       */
      categories: ringkasKategori.map((b) => ({
        kind: b.kind,
        lineageKey: b.lineageKey,
        code: b.code,
        name: b.name,
        total: b.adendum == null ? null : b.adendum.toString(),
        jumlahItem: b.jumlahItem,
        level: b.level,
        kontrak: b.kontrak == null ? null : b.kontrak.toString(),
        selisih: b.status == null ? null : b.selisih.toString(),
        status: b.status,
      })),
      sheetName,
      baca,
      mode,
      banding: banding
        ? banding.map((b) => ({
            lineageKey: b.lineageKey,
            code: b.code,
            jalur: b.jalur,
            name: b.name,
            kontrak: b.kontrak == null ? null : b.kontrak.toString(),
            adendum: b.adendum == null ? null : b.adendum.toString(),
            selisih: b.selisih.toString(),
            status: b.status,
          }))
        : null,
      draftAda: draft ? { revisionNo: draft.revisionNo, totalValue: draft.totalValue.toString() } : null,
      beda: beda
        ? {
            totalAktif: beda.totalAktif.toString(),
            totalBaru: beda.totalBaru.toString(),
            jumlahTetap: beda.jumlahTetap,
            itemBaru: beda.itemBaru.map((b) => ({ lineageKey: b.lineageKey, code: b.code, jalur: b.jalur, name: b.name })),
            itemHilang: beda.itemHilang.map((b) => ({ lineageKey: b.lineageKey, code: b.code, jalur: b.jalur, name: b.name, realisasi: b.realisasi })),
            volumeBerubah: beda.volumeBerubah.map((b) => ({
              lineageKey: b.lineageKey,
              code: b.code,
              jalur: b.jalur,
              name: b.name,
              dari: b.dari,
              ke: b.ke,
              realisasi: b.realisasi,
              dibawahRealisasi: b.dibawahRealisasi,
            })),
            hargaBerubah: beda.hargaBerubah.map((b) => ({
              lineageKey: b.lineageKey,
              code: b.code,
              jalur: b.jalur,
              name: b.name,
              namaLama: b.namaLama,
              dari: b.dari,
              ke: b.ke,
              dampakRupiah: b.dampakRupiah.toString(),
            })),
            nilaiBergeser: beda.nilaiBergeser.map((b) => ({
              lineageKey: b.lineageKey,
              code: b.code,
              jalur: b.jalur,
              name: b.name,
              dari: b.dari.toString(),
              ke: b.ke.toString(),
              selisih: b.selisih.toString(),
            })),
          }
        : null,
    };

    const confirm = formData.get("confirm") === "1";
    const previewSha = String(formData.get("previewSha") ?? "");
    if (!confirm) return { preview };
    if (previewSha !== sha256) {
      return {
        preview: {
          ...preview,
          notice: "File berubah sejak pratinjau – belum disimpan. Periksa ringkasan baru lalu simpan lagi.",
        },
      };
    }

    // ── Commit ──────────────────────────────────────────────────────────────
    const note = String(formData.get("note") ?? "").trim() || null;
    // Draft = usulan perubahan kontrak (MC-0/CCO); "aktifkan" tanpa RAB aktif =
    // HPS awal. "Aktifkan" DENGAN RAB aktif adalah koreksi, tanpa revisi baru.
    const source = mode === "draft" ? ("adendum" as const) : ("hps_awal" as const);

    // Mode DRAFT: isi draft adendum saja. RAB aktif, progres, kurva-S, dan
    // keuangan tidak tersentuh sedikit pun. Draft yang sudah ada DIGANTI
    // seluruhnya (pilihan user 2026-08-02) — kaitan ke adendum kontrak (CCO)
    // dan catatannya dibawa ikut supaya tidak hilang diam-diam.
    if (mode === "draft") {
      if (!activeRevision) {
        return {
          preview: {
            ...preview,
            notice:
              "Belum ada RAB aktif di lokasi ini – impor draft adendum butuh RAB aktif sebagai pembanding. Impor sebagai RAB aktif dulu.",
          },
        } as ImportState;
      }
      const amendmentId = draft?.amendmentId ?? null;
      const noteDraft = note ?? draft?.note ?? null;
      /*
       * DRAFT LAMA DIBUANG SESUDAH yang baru berhasil dibuat, bukan sebelum.
       *
       * Urutan lama membuang dulu, dan setiap kegagalan `createRevisionFromNodes`
       * — struktur yatim, lineageKey kembar, constraint DB — meninggalkan lokasi
       * TANPA draft sama sekali. Yang hilang bukan berkas unggahan, melainkan
       * pekerjaan adendum yang sedang disusun orang. Audit 2026-09-15 (F-2).
       */
      const resDraft = await createRevisionFromNodes(location.id, nodes, {
        source,
        note: noteDraft,
        userId: user.id,
        amendmentId,
      });
      /*
       * Draft lama DIGANTI, dan baris laporan harian yang sudah diinput
       * terhadapnya ikut pindah ke draft baru lewat `lineageKey`
       * (ketetapan user 2026-09-24, DECISIONS 611). Seluruhnya satu transaksi.
       *
       * Kalau ada baris yang tidak berpadanan, pemindahannya menolak — dan
       * draft yang baru saja dibuat DIBATALKAN di sini, supaya impor yang
       * ditolak tidak meninggalkan lokasi dengan DUA draft. Itu persis keadaan
       * yang dilaporkan user: create berhasil, discard gagal, drafnya dua.
       */
      if (draft) {
        try {
          await gantiDraftLama(draft.id, resDraft.revisionId, user.id);
        } catch (e) {
          await discardDraft(resDraft.revisionId, user.id).catch(() => {});
          if (e instanceof DraftTerpakaiError) return { error: e.message };
          throw e;
        }
      }
      const docDraft = await arsipkanSumber({
        buffer,
        file,
        sha256,
        location,
        userId: user.id,
        revisionId: resDraft.revisionId,
        revisionNo: resDraft.revisionNo,
        adendum: true,
      });
      const kalimatRincianDraft = await simpanRincianImpor(resDraft.revisionId, rincian, nodes, docDraft, user.id);
      revalidatePath(`/lokasi/${location.slug}/rab`);
      revalidatePath(`/lokasi/${location.slug}/rab/adendum`);
      return {
        success:
          `Draft adendum revisi #${resDraft.revisionNo} terisi dari ${file.name} ` +
          `(${resDraft.itemCount} item). RAB aktif dan progres TIDAK berubah. ` +
          `Draft ini baru berlaku setelah diaktifkan.` +
          (draft ? ` Isi draft #${draft.revisionNo} sebelumnya diganti.` : "") +
          kalimatRincianDraft,
      };
    }

    /*
     * KOREKSI RAB AKTIF – DITIMPA DI TEMPAT (DECISIONS 728).
     *
     * Ketetapan user 2026-11-01: *"pilihan jadikan rab aktif sekarang oleh dan
     * hanya super admin adalah koreksi, bukan adendum"*. Dulu jalur ini membuat
     * REVISI ADENDUM baru (atau draft yang menunggu dua persetujuan), ikut
     * terhitung sebagai CCO, dan menggeser nomor CCO seluruh lokasi itu.
     * Perubahan kontrak (MC-0, CCO) tetap lewat "Isi DRAFT adendum".
     */
    if (activeRevision && mode === "aktifkan") {
      if (!koreksi?.boleh) {
        return {
          preview: {
            ...preview,
            notice:
              "Koreksi RAB aktif hanya untuk super admin utama. Perubahan kontrak (MC-0, CCO) diajukan lewat " +
              "\"Isi DRAFT adendum\" dan berlaku setelah disetujui.",
          },
        } as ImportState;
      }
      if (!cocokKonfirmasiKoreksi(formData.get("konfirmasi"), activeRevision.revisionNo)) {
        return {
          preview: {
            ...preview,
            notice: `Ketik ${konfirmasiKoreksi(activeRevision.revisionNo)} persis untuk konfirmasi koreksi.`,
          },
        } as ImportState;
      }
      if (koreksi.terhalang.length > 0) {
        return { preview: { ...preview, notice: kalimatTerhalang(koreksi.terhalang) } } as ImportState;
      }
      let h: Awaited<ReturnType<typeof terapkanKoreksiTimpa>>;
      try {
        h = await terapkanKoreksiTimpa({
          revisionId: activeRevision.id,
          locationId: location.id,
          nodes,
          userId: user.id,
          berkas: file.name,
        });
      } catch (e) {
        if (e instanceof KoreksiTimpaError) return { preview: { ...preview, notice: e.message } } as ImportState;
        throw e;
      }
      // Berkas koreksi menjadi berkas sumber revisi aktif. Berkas sumber lama
      // tidak lagi RAB yang berlaku: ditandai, tidak dihapus.
      const sumberLama = await db.rabRevision.findUnique({
        where: { id: activeRevision.id },
        select: { sourceDocumentId: true },
      });
      const docKoreksi = await arsipkanSumber({
        buffer,
        file,
        sha256,
        location,
        userId: user.id,
        revisionId: activeRevision.id,
        revisionNo: activeRevision.revisionNo,
        adendum: false,
        judul: `HPS/RAB koreksi (revisi #${activeRevision.revisionNo}) – ${location.name}`,
      });
      if (docKoreksi && sumberLama?.sourceDocumentId && sumberLama.sourceDocumentId !== docKoreksi) {
        const lama = await db.document.findUnique({ where: { id: sumberLama.sourceDocumentId }, select: { title: true } });
        if (lama) {
          await db.document.update({
            where: { id: sumberLama.sourceDocumentId },
            data: { type: "lainnya", title: `${lama.title} (sebelum koreksi)` },
          });
        }
      }
      // Rincian (backup volume, analisa) hanya diisi bila revisi aktif belum
      // punya: yang sudah ada bisa memuat isian tangan (DECISIONS 680).
      const rincianAda = await db.rabRincianRevisi.findUnique({
        where: { revisionId: activeRevision.id },
        select: { revisionId: true },
      });
      const kalimatRincianKoreksi = rincianAda
        ? ""
        : await simpanRincianImpor(activeRevision.id, rincian, nodes, docKoreksi, user.id);
      revalidatePath(`/lokasi/${location.slug}`, "layout");
      revalidatePath("/progress");
      const r = h.ringkas;
      const bagian = [
        r.volume ? `${r.volume} volume` : null,
        r.harga ? `${r.harga} harga satuan` : null,
        r.jumlah ? `${r.jumlah} jumlah` : null,
        r.pindah ? `${r.pindah} pindah kelompok` : null,
        r.lain ? `${r.lain} nomor/nama/satuan` : null,
        r.tambah ? `${r.tambah} baris baru` : null,
        r.hapus ? `${r.hapus} baris dihapus` : null,
      ].filter(Boolean);
      return {
        success:
          `RAB aktif revisi #${h.revisionNo} dikoreksi dari ${file.name}` +
          (bagian.length ? `: ${bagian.join(", ")}.` : ", tidak ada angka yang berbeda.") +
          ` Tidak ada revisi baru, tidak dihitung sebagai adendum/CCO.` +
          (h.barisHarian > 0 ? ` Nilai terpasang ${h.barisHarian} baris laporan harian dihitung ulang dengan harga baru.` : "") +
          (h.disesuaikan.length > 0
            ? ` PERHATIAN: realisasi ${h.disesuaikan.length} item diturunkan mengikuti volume barunya` +
              ` (${h.disesuaikan.slice(0, 3).map((d) => `${d.item} ${formatNumber(d.dari)} → ${formatNumber(d.ke)}`).join("; ")}` +
              `${h.disesuaikan.length > 3 ? `; +${h.disesuaikan.length - 3} lainnya` : ""}).`
            : "") +
          (h.snapshotDibangunUlang > 0 ? ` ${h.snapshotDibangunUlang} blanko harian final dibangun ulang.` : "") +
          (h.kategoriBaruTanpaKurva.length > 0
            ? ` ${h.kategoriBaruTanpaKurva.length} kategori baru belum punya jadwal di kurva-S (${h.kategoriBaruTanpaKurva.slice(0, 3).join(", ")}` +
              `${h.kategoriBaruTanpaKurva.length > 3 ? ", …" : ""}); perbarui lewat Progress › Perbarui Kurva-S.`
            : "") +
          kalimatRincianKoreksi,
      };
    }

    /*
     * Sampai di sini hanya HPS AWAL: lokasi belum punya RAB aktif (koreksi dan
     * draft adendum sudah ditangani di atas). HPS awal tidak menggantikan
     * kontrak apa pun, jadi tidak menuntut dua persetujuan (DECISIONS 234).
     */
    const res = await createRevisionFromNodes(location.id, nodes, {
      source,
      note,
      userId: user.id,
    });
    const docAktif = await arsipkanSumber({
      buffer,
      file,
      sha256,
      location,
      userId: user.id,
      revisionId: res.revisionId,
      revisionNo: res.revisionNo,
      adendum: false,
    });
    const kalimatRincian = await simpanRincianImpor(res.revisionId, rincian, nodes, docAktif, user.id);
    await activateRevision(res.revisionId, user.id);
    /*
     * KURVA-S TIDAK DIPAKSAKAN PADA HPS AWAL (permintaan user 2026-09-19):
     * layar menawarkan tiga bentuk lewat `pilihProfilKurvaAction`.
     */
    revalidatePath(`/lokasi/${location.slug}`, "layout");
    revalidatePath("/lokasi");
    revalidatePath("/progress");
    return {
      success:
        `Revisi RAB #${res.revisionNo} (HPS awal) aktif, berisi ${res.itemCount} item. ` +
        `Kurva-S BELUM dibuat. Pilih bentuknya di bawah.` +
        kalimatRincian,
      pilihProfil: { revisionNo: res.revisionNo, itemCount: res.itemCount },
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan saat impor." };
  }
}

export type ProfilKurvaState = { error?: string; success?: string; selesai?: boolean } | undefined;

/**
 * PILIH BENTUK KURVA-S sesudah impor HPS awal — atau kapan pun user ingin
 * berpindah (permintaan user 2026-09-19).
 *
 * Tiga jawaban yang sah, dan ketiganya benar-benar berbeda nasibnya:
 *
 * - `lambat`   → baseline dibuat dengan profil "awal lambat" (bawaan).
 * - `optimal`  → baseline dibuat dengan penjadwal urutan pekerjaan yang lama.
 * - `manual`   → TIDAK ADA baseline yang dibuat. Ini bukan penundaan diam-diam:
 *                jalannya disebutkan (tab Kurva-S – susun jadwal per pekerjaan,
 *                atau impor jadwal dari Excel yang dipakai apa adanya), karena
 *                "tidak terjadi apa-apa" tanpa keterangan sama saja dengan
 *                gagal.
 *
 * Izinnya SAMA dengan "Hitung ulang kurva-S" (`recalcBaselineAction`):
 * `baseline.manage` + akses lokasi. Yang dilakukan memang hal yang sama —
 * membuat baseline baru dari RAB aktif.
 */
export async function pilihProfilKurvaAction(
  _prev: ProfilKurvaState,
  formData: FormData,
): Promise<ProfilKurvaState> {
  const parsed = z
    .object({
      slug: z.string().min(1).max(200),
      profil: z.enum(PROFIL_KURVA),
    })
    .safeParse({ slug: formData.get("slug"), profil: formData.get("profil") });
  if (!parsed.success) return { error: "Pilihan bentuk kurva-S tidak dikenali. Pilih lagi dari daftar." };
  const { slug, profil } = parsed.data;

  try {
    const user = await requireCapability("baseline.manage");
    const location = await db.location.findUniqueOrThrow({
      where: { slug },
      select: { id: true, slug: true },
    });
    await requireLocationAccess(user, location.id);
    await audit(user.id, "baseline.profil_pilih", "location", location.id, { profil });

    if (profil === "manual") {
      /*
       * Tidak ada baseline yang dibuat — DAN TIDAK ADA pula yang disentuh.
       * Kolom `profil` tidak bisa menampung "manual" (lihat skema): ia bukan
       * bentuk kurva, melainkan keputusan untuk tidak membuatnya sekarang.
       */
      revalidatePath(`/lokasi/${location.slug}`, "layout");
      return {
        selesai: true,
        success:
          "Kurva-S tidak dibuat. Susun sendiri di halaman Progress: \"Jadwal Pekerjaan\" untuk " +
          "menentukan minggu tiap kategori, atau \"Perbarui Kurva-S\" bila jadwalnya sudah ada di " +
          "Excel dan ingin dipakai apa adanya. Sebelum salah satunya dikerjakan, lokasi ini belum " +
          "punya rencana, jadi deviasi dan prognosa belum bisa dihitung.",
      };
    }

    const aktif = await db.rabRevision.findFirst({
      where: { locationId: location.id, status: "aktif" },
      select: { id: true },
    });
    if (!aktif) return { error: "Belum ada revisi RAB aktif. Impor RAB dulu." };

    const bentuk: BaselineProfil = profil;
    const baseline = await regenerateBaseline(location.id, {
      source: "auto",
      rabRevisionId: aktif.id,
      profil: bentuk,
      note: `Kurva-S dibuat – profil ${PROFIL_KURVA_LABEL[profil].toLowerCase()}`,
      userId: user.id,
    });
    revalidatePath(`/lokasi/${location.slug}`, "layout");
    revalidatePath(`/lokasi/${location.slug}/progress`);
    revalidatePath("/progress");
    if (baseline.unchanged) {
      return {
        selesai: true,
        success: `Tidak ada perubahan. Baseline #${baseline.baselineNo} yang aktif sudah berbentuk ${PROFIL_KURVA_LABEL[profil].toLowerCase()}.`,
      };
    }
    return {
      selesai: true,
      success:
        `Kurva-S dibuat. Baseline #${baseline.baselineNo} sekarang aktif, bentuknya ` +
        `${PROFIL_KURVA_LABEL[profil].toLowerCase()}. Bentuknya bisa diganti kapan saja lewat ` +
        `"Hitung ulang" di Progress › Kurva-S & Baseline.`,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}

/**
 * Arsipkan file sumber ke R2 + catat sebagai Document, lalu tautkan ke revisi.
 * BEST-EFFORT: kegagalan arsip tidak boleh membatalkan revisi yang sudah
 * tersimpan — tapi tetap dicatat ke log server, bukan ditelan diam-diam.
 */
async function arsipkanSumber(a: {
  buffer: Buffer;
  file: File;
  sha256: string;
  location: { id: string; name: string; packageId: string; package: { orgId: string } };
  userId: string;
  revisionId: string;
  revisionNo: number;
  adendum: boolean;
  judul?: string;
}): Promise<string | null> {
  if (!isR2Configured()) return null;
  try {
    const key = `rab-import/${a.location.id}/${randomUUID()}-${safeName(a.file.name)}`;
    await r2Put(key, a.buffer, a.file.type || XLSX_MIME[0]);
    const doc = await db.document.create({
      data: {
        orgId: a.location.package.orgId,
        packageId: a.location.packageId,
        locationId: a.location.id,
        phase: a.adendum ? "adendum" : "kontrak",
        type: "hps",
        title: a.judul ?? `HPS/RAB ${a.adendum ? `adendum (revisi #${a.revisionNo})` : "awal"} – ${a.location.name}`,
        r2Key: key,
        fileName: a.file.name,
        mimeType: a.file.type || XLSX_MIME[0],
        bytes: a.file.size,
        sha256: a.sha256,
        uploadedById: a.userId,
      },
    });
    await db.rabRevision.update({ where: { id: a.revisionId }, data: { sourceDocumentId: doc.id } });
    return doc.id;
  } catch (e) {
    console.error("[rab-import] arsip R2 gagal (revisi tetap tersimpan):", e);
    return null;
  }
}

/**
 * Simpan rincian berkas ke revisi yang baru dibuat. Kunci rincian = nomor
 * baris Excel; di sini diganti dengan lineage FINAL tiap node (sesudah
 * pencocokan lineage & padanan manual). Mengembalikan satu kalimat untuk
 * pesan sukses – kegagalan dikatakan, tidak membatalkan impor.
 */
async function simpanRincianImpor(
  revisionId: string,
  rincian: import("@/lib/rab/rincian/baca").RincianBerkas | null,
  nodes: import("@/lib/rab/flatten").FlatNode[],
  documentId: string | null,
  userId: string,
): Promise<string> {
  if (!rincian) return "";
  try {
    const { gantiKunci } = await import("@/lib/rab/rincian/baca");
    const { simpanRincian } = await import("@/lib/rab/rincian/simpan");
    const peta = new Map(
      nodes.filter((n) => n.kind === "item" && n.excelRow != null).map((n) => [String(n.excelRow), n.lineageKey]),
    );
    const h = await simpanRincian(revisionId, gantiKunci(rincian, peta), { asal: "impor", documentId, userId });
    return (
      ` Backup volume tersimpan untuk ${rincian.ringkasan.volumeTertaut} item, ` +
      `analisa untuk ${h.itemAnalisa} item (${h.analisa} analisa, ${h.hargaDasar} bahan & upah).`
    );
  } catch (e) {
    console.error("[rab-import] simpan rincian gagal (revisi tetap tersimpan):", e);
    return (
      " Backup volume dan analisa GAGAL disimpan" +
      (e instanceof Error ? ` (${e.message})` : "") +
      ". RAB-nya sendiri tetap tersimpan; rinciannya bisa dilengkapi lagi dari berkas arsip."
    );
  }
}
