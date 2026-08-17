/**
 * KENDALA DITANYAKAN SAAT MENGIRIM — modul MURNI (DECISIONS 341).
 *
 * Keluhan user 2026-08-17: *"form kendala itu sebaiknya muncul saat laporan
 * dikirim/direview, jadi bisa dipilih tidak ada kendala, tapi bukan form sangat
 * di bawah begitu. itu menyesatkan pengguna, karena bisa jadi dia tidak tahu
 * kalau ada inputan itu."*
 *
 * Dua hal berbeda diperbaiki sekaligus, dan keduanya benar:
 *
 * 1. **Tempatnya.** Formulir yang menganga di dasar halaman empat layar tidak
 *    terbaca sebagai pertanyaan. Ia terlewat, dan yang terlewat bukan kolom
 *    hiasan — kendala adalah dasar tindakan pemulihan.
 * 2. **Bentuknya.** "Tidak ada kendala" harus bisa DIKATAKAN, bukan hanya
 *    disimpulkan dari kolom yang dibiarkan kosong. Diam bukan jawaban: dari
 *    sisi pemeriksa, laporan tanpa kendala dan laporan yang orangnya lupa
 *    mengisi kendala terlihat persis sama.
 *
 * ### Kegagalan yang dijaga berkas ini
 *
 * Penanya memilih "Ada kendala", lalu judulnya kosong. Kalau itu diterima,
 * kendalanya lenyap TANPA jejak dan laporannya terkirim seolah-olah tidak ada
 * kendala — persis kebalikan dari yang barusan dinyatakan orangnya. Ditolak,
 * dengan sebabnya disebut.
 */

export const PILIHAN_KENDALA = ["tidak_ada", "ada"] as const;
export type PilihanKendala = (typeof PILIHAN_KENDALA)[number];

export const TINGKAT_KENDALA = ["rendah", "sedang", "tinggi", "kritis"] as const;
export type TingkatKendala = (typeof TINGKAT_KENDALA)[number];

export type KendalaKirim = {
  title: string;
  severity: TingkatKendala;
  description: string | null;
};

export type HasilBacaKendala =
  | { ok: true; kendala: KendalaKirim | null }
  | { ok: false; error: string };

export type MasukanKendala = {
  pilihan: unknown;
  title: unknown;
  severity: unknown;
  description: unknown;
};

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Baca jawaban kendala yang menyertai pengiriman laporan.
 *
 * `pilihan` yang TIDAK dikenali (termasuk tidak dikirim sama sekali) berarti
 * pengiriman datang dari jalur yang belum menanyakannya — dan itu diperlakukan
 * sebagai "tidak ada kendala yang menyertai kiriman ini", bukan galat.
 * Menolaknya akan mematikan jalur pengiriman yang sah tanpa menambah satu pun
 * jaminan: pertanyaan ini soal kelengkapan laporan, bukan soal izin.
 *
 * Yang TIDAK ditoleransi cuma satu: "Ada kendala" tanpa judul.
 */
export function bacaKendalaKirim(m: MasukanKendala): HasilBacaKendala {
  const pilihan = teks(m.pilihan);
  if (pilihan !== "ada") return { ok: true, kendala: null };

  const title = teks(m.title);
  if (title.length < 3) {
    return {
      ok: false,
      error:
        'Anda memilih "Ada kendala" tetapi judulnya belum diisi (min 3 karakter). Isi judulnya, atau pilih "Tidak ada kendala".',
    };
  }
  if (title.length > 200) {
    return { ok: false, error: "Judul kendala maksimal 200 karakter." };
  }

  const sev = teks(m.severity);
  const severity = (TINGKAT_KENDALA as readonly string[]).includes(sev)
    ? (sev as TingkatKendala)
    : "sedang";

  const desc = teks(m.description);
  if (desc.length > 2000) {
    return { ok: false, error: "Uraian kendala maksimal 2000 karakter." };
  }

  return { ok: true, kendala: { title, severity, description: desc || null } };
}
