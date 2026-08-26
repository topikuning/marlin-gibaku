/**
 * Pembaca keluaran AI pemeta surat (DECISIONS 434) — MURNI, unit-tested.
 *
 * Ketetapan user 2026-08-26: *"sekali kirim... sekali request saja"*. Jadi satu
 * panggilan AI menghasilkan SELURUH isian formulir, dan berkas ini yang
 * menerjemahkannya menjadi nilai yang bisa dipakai layar.
 *
 * Kenapa baris berlabel, bukan JSON: model kadang membungkus JSON dalam pagar
 * kode atau menyisipkan kalimat pengantar, dan itu membuat `JSON.parse`
 * gagal total — satu karakter salah menghanguskan seluruh pemetaan. Parser
 * baris berlabel mengambil apa yang bisa diambil dan mengabaikan sisanya.
 *
 * Prinsip yang dijaga: **yang tidak terbaca menjadi null, tidak pernah
 * ditebak.** Formulir yang terisi tebakan lebih berbahaya daripada formulir
 * kosong — orang cenderung menyetujui apa yang sudah terisi.
 */

export type PotensiSurat = "kendala" | "temuan" | "tidak";

export type HasilBacaSurat = {
  nomor: string | null;
  /** YYYY-MM-DD, atau null bila tidak tertulis / formatnya tidak sah. */
  tanggal: string | null;
  pihak: "penyedia" | "wakil_ppk" | "ppk" | "konsultan" | "dinas" | "internal" | "lainnya";
  namaPihak: string | null;
  arah: "masuk" | "keluar";
  perihal: string | null;
  kategori: "mutu" | "jadwal" | "pembayaran" | "administrasi" | "koordinasi" | "k3" | "lainnya";
  /** Nama lokasi yang DISEBUT surat — dicocokkan ke data oleh pemanggil. */
  lokasiSebutan: string | null;
  /** Nama/nomor paket yang DISEBUT surat. */
  paketSebutan: string | null;
  butuhJawaban: boolean;
  tenggat: string | null;
  ringkasan: string | null;
  potensi: PotensiSurat;
  alasanPotensi: string | null;
};

const PIHAK_SAH = ["penyedia", "wakil_ppk", "ppk", "konsultan", "dinas", "internal", "lainnya"] as const;
const KATEGORI_SAH = ["mutu", "jadwal", "pembayaran", "administrasi", "koordinasi", "k3", "lainnya"] as const;

/** Ambil nilai satu medan berlabel. Tanda minus & kosong dianggap tidak ada. */
function medan(teks: string, label: string): string | null {
  // Label dicari di awal baris; `[^\n]*` supaya isi ber-spasi tetap utuh.
  const re = new RegExp(`^\\s*${label}\\s*:\\s*([^\\n]*)$`, "im");
  const v = teks.match(re)?.[1]?.trim();
  if (!v) return null;
  // Model kadang membungkus nilai dengan tanda kutip atau bintang tebal.
  const bersih = v.replace(/^["'*_\s]+|["'*_\s]+$/g, "").trim();
  if (!bersih || bersih === "-" || /^(tidak diketahui|n\/a|null|kosong)$/i.test(bersih)) return null;
  return bersih;
}

/** Tanggal hanya diterima bila BENAR-BENAR YYYY-MM-DD dan tanggal yang ada. */
function tanggalSah(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, bl, d] = m;
  const dt = new Date(`${y}-${bl}-${d}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return null;
  // Tolak tanggal yang "terbentuk" tapi bergeser (mis. 2026-02-31 → 3 Maret).
  if (dt.toISOString().slice(0, 10) !== `${y}-${bl}-${d}`) return null;
  return `${y}-${bl}-${d}`;
}

function pilih<T extends readonly string[]>(v: string | null, sah: T, bawaan: T[number]): T[number] {
  if (!v) return bawaan;
  const k = v.toLowerCase().replace(/[\s-]+/g, "_");
  return (sah as readonly string[]).includes(k) ? (k as T[number]) : bawaan;
}

/**
 * Terjemahkan keluaran AI menjadi isian formulir. Tidak pernah melempar:
 * keluaran yang berantakan menghasilkan formulir yang sebagian kosong, bukan
 * kegagalan yang membuang pekerjaan orang.
 */
export function bacaHasilSurat(teks: string): HasilBacaSurat {
  const t = teks ?? "";
  const butuh = medan(t, "BUTUH_JAWABAN");
  const potensiMentah = (medan(t, "POTENSI") ?? "").toLowerCase();
  return {
    nomor: medan(t, "NOMOR"),
    tanggal: tanggalSah(medan(t, "TANGGAL")),
    pihak: pilih(medan(t, "PIHAK"), PIHAK_SAH, "lainnya"),
    namaPihak: medan(t, "NAMA_PIHAK"),
    // Bawaan "masuk": surat yang diunggah ke register hampir selalu surat
    // yang DITERIMA. Salah tebak ke arah ini paling mudah dikoreksi orang.
    arah: (medan(t, "ARAH") ?? "").toLowerCase() === "keluar" ? "keluar" : "masuk",
    perihal: medan(t, "PERIHAL"),
    kategori: pilih(medan(t, "KATEGORI"), KATEGORI_SAH, "lainnya"),
    lokasiSebutan: medan(t, "LOKASI"),
    paketSebutan: medan(t, "PAKET"),
    // Hanya "ya" yang berarti ya. Apa pun yang lain – termasuk kalimat
    // mengambang – tidak boleh memasang tenggat yang menagih orang.
    butuhJawaban: (butuh ?? "").toLowerCase() === "ya",
    tenggat: tanggalSah(medan(t, "TENGGAT")),
    ringkasan: medan(t, "RINGKASAN"),
    potensi: potensiMentah === "kendala" ? "kendala" : potensiMentah === "temuan" ? "temuan" : "tidak",
    alasanPotensi: medan(t, "ALASAN_POTENSI"),
  };
}

/**
 * Cocokkan sebutan bebas dari surat ("Kampung Nelayan Kedungmutih") ke daftar
 * yang ada. Sengaja KETAT: hanya cocok bila salah satu memuat yang lain secara
 * utuh. Pencocokan longgar akan menautkan surat ke lokasi yang salah, dan
 * tautan yang salah lebih buruk daripada tidak ada tautan.
 */
export function cocokkanSebutan<T extends { id: string; name: string }>(
  sebutan: string | null,
  daftar: T[],
): T | null {
  if (!sebutan) return null;
  const s = sebutan.toLowerCase().trim();
  if (s.length < 3) return null;
  const persis = daftar.find((d) => d.name.toLowerCase().trim() === s);
  if (persis) return persis;
  const memuat = daftar.filter((d) => {
    const n = d.name.toLowerCase().trim();
    return n.length >= 3 && (s.includes(n) || n.includes(s));
  });
  // Ambigu (dua lokasi sama-sama cocok) = jangan menebak.
  return memuat.length === 1 ? memuat[0] : null;
}
