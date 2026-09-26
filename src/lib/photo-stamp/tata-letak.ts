/**
 * TATA LETAK CAP YANG MENGHINDARI CAP LAMA (DECISIONS 619).
 *
 * Keluhan user 2026-09-26 atas foto yang sudah membawa cap aplikasi kamera:
 * *"bagian tagging foto lama tergradasi dengan warna hitam buatanmu, lalu logo
 * lama tertutup logomu … apakah peletakan tagging/stamp mu bisa lebih
 * adaptif?"*. Cap MARLIN sebelumnya selalu di tempat yang sama: kepala (nama
 * perusahaan + logo) di atas, blok info di kiri-bawah, bayangan selebar foto
 * di bawah. Cap aplikasi kamera juga paling sering di bawah – jadi tertimpa.
 *
 * Modul MURNI. Masukannya kotak tulisan yang terbaca OCR (pecahan 0..1 dari
 * lebar/tinggi foto) dan ukuran tiap unsur cap; keluarannya susunan yang
 * paling sedikit menutup tulisan itu. Tanpa tulisan (foto biasa) hasilnya
 * PERSIS tata letak lama – yang dinilai hanya foto yang memang sudah ber-cap.
 */

/** Kotak tulisan, pecahan dari lebar/tinggi foto (0..1). */
export type KotakTulisan = { x: number; y: number; w: number; h: number };

/** Persegi dalam piksel foto. */
export type Persegi = { x: number; y: number; w: number; h: number };

/** Resolusi peta tulisan – tumpang-tindih kotak dari tiga lintasan OCR tidak dihitung ganda. */
const N = 96;

export type PetaTulisan = { sel: Uint8Array; kosong: boolean };

/**
 * Baris tulisan selebar ini (pecahan lebar foto) dianggap PITA PENUH: cap
 * aplikasi kamera yang lebar hampir selalu berupa bilah selebar foto, dengan
 * latar gelap dan logo yang tidak terbaca OCR di ujungnya. Tanpa ini blok
 * MARLIN "menemukan" ruang kosong di ujung bilah itu – tepat di atas logonya.
 */
const BARIS_PITA = 0.4;

/**
 * Tulisan di pita atas/bawah foto hampir selalu bagian dari cap yang MENEMPEL
 * ke tepi: deretan logo di atas nama BUMN, latar gelap di bawah alamat. Logo
 * tidak terbaca OCR, jadi daerah antara tulisan itu dan tepi terdekat ikut
 * dianggap terisi, sedikit melebar ke samping (DECISIONS 619a – foto
 * 2026-09-26: panel nama perusahaan menutupi deretan logo di atas "VIRAMA").
 */
const PITA_TEPI = 0.25;
const LEBAR_TEPI = 0.06;
/** Hanya BARIS tulisan (≥8% lebar foto) – satu kata nyasar tidak ditempelkan. */
const LEBAR_BARIS_MIN = 0.08;

function tempelKeTepi(k: KotakTulisan): KotakTulisan {
  const tengah = k.y + k.h / 2;
  if (k.w < LEBAR_BARIS_MIN || (tengah > PITA_TEPI && tengah < 1 - PITA_TEPI)) return k;
  const x = Math.max(0, k.x - LEBAR_TEPI);
  const w = Math.min(1, k.x + k.w + LEBAR_TEPI) - x;
  return tengah <= PITA_TEPI ? { x, y: 0, w, h: k.y + k.h } : { x, y: k.y, w, h: 1 - k.y };
}

export function petaTulisan(kotak: KotakTulisan[]): PetaTulisan {
  const sel = new Uint8Array(N * N);
  let kosong = true;
  for (const asli of kotak) {
    const k = tempelKeTepi(asli.w >= BARIS_PITA ? { ...asli, x: 0, w: 1 } : asli);
    const x0 = Math.max(0, Math.floor(k.x * N));
    const y0 = Math.max(0, Math.floor(k.y * N));
    const x1 = Math.min(N, Math.ceil((k.x + k.w) * N));
    const y1 = Math.min(N, Math.ceil((k.y + k.h) * N));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        sel[y * N + x] = 1;
        kosong = false;
      }
  }
  return { sel, kosong };
}

/** Bagian persegi (0..1) yang berisi tulisan lama. */
export function tutupan(peta: PetaTulisan, r: Persegi, W: number, H: number): number {
  if (peta.kosong || r.w <= 0 || r.h <= 0) return 0;
  const x0 = Math.max(0, Math.floor((r.x / W) * N));
  const y0 = Math.max(0, Math.floor((r.y / H) * N));
  const x1 = Math.min(N, Math.ceil(((r.x + r.w) / W) * N));
  const y1 = Math.min(N, Math.ceil(((r.y + r.h) / H) * N));
  let isi = 0;
  let semua = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      semua++;
      isi += peta.sel[y * N + x]!;
    }
  return semua === 0 ? 0 : isi / semua;
}

/**
 * - `bawah`: kepala di atas, blok info di bawah (tata letak lama).
 * - `atas`: kepala di atas, blok info tepat di bawah kepala – bawah foto bebas.
 * - `tukar`: blok info di atas, kepala di bawah.
 */
export type LetakTegak = "bawah" | "atas" | "tukar";

export type TataLetak = {
  tegak: LetakTegak;
  /** Blok info rata kanan (bukan kiri). */
  infoKanan: boolean;
  /** Logo di kiri, panel nama perusahaan di kanan (kebalikan tata letak lama). */
  logoKiri: boolean;
  /**
   * Logo dan panel perusahaan BERDAMPINGAN di sisi logo – sisi seberangnya
   * dibiarkan kosong untuk cap/logo lama (DECISIONS 619a).
   */
  kepalaRapat?: boolean;
};

export type UkuranCap = {
  W: number;
  H: number;
  safeX: number;
  safeY: number;
  /** Tinggi baris kepala (panel perusahaan / logo). */
  kepalaH: number;
  /** Jarak kepala ↔ blok info pada susunan `atas`. */
  jarak: number;
  info: { w: number; h: number };
  logo: { w: number; h: number };
  /** null = tidak ada nama perusahaan. */
  panel: { w: number; h: number } | null;
};

export const TATA_LETAK_LAMA: TataLetak = { tegak: "bawah", infoKanan: false, logoKiri: false };

/** Letak tiap unsur untuk satu susunan. */
export function letakUnsur(u: UkuranCap, t: TataLetak) {
  const kepalaY = t.tegak === "tukar" ? u.H - u.safeY - u.kepalaH : u.safeY;
  const infoY =
    t.tegak === "bawah"
      ? u.H - u.safeY - u.info.h
      : t.tegak === "atas"
        ? u.safeY + u.kepalaH + u.jarak
        : u.safeY;
  const infoX = t.infoKanan ? u.W - u.safeX - u.info.w : u.safeX;
  const logoX = t.logoKiri ? u.safeX : u.W - u.safeX - u.logo.w;
  const celah = Math.round(u.safeX * 0.6);
  const panelX = !u.panel
    ? 0
    : t.kepalaRapat
      ? t.logoKiri
        ? u.safeX + u.logo.w + celah
        : u.W - u.safeX - u.logo.w - celah - u.panel.w
      : t.logoKiri
        ? u.W - u.safeX - u.panel.w
        : u.safeX;
  return {
    kepalaY,
    info: { x: infoX, y: infoY, w: u.info.w, h: u.info.h },
    logo: { x: logoX, y: kepalaY + (u.kepalaH - u.logo.h) / 2, w: u.logo.w, h: u.logo.h },
    panel: u.panel ? { x: panelX, y: kepalaY + (u.kepalaH - u.panel.h) / 2, w: u.panel.w, h: u.panel.h } : null,
  };
}

/**
 * Harga tiap penyimpangan dari tata letak lama. Kecil, tapi cukup supaya
 * satu-dua kata nyasar hasil OCR (tekstur rumput, papan kecil) tidak
 * memindahkan cap: yang layak dihindari adalah blok tulisan sungguhan.
 */
const HARGA = { atas: 0.05, tukar: 0.04, infoKanan: 0.03, logoKiri: 0.02, kepalaRapat: 0.03 };

const perluas = (r: Persegi, d: number): Persegi => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

export function pilihTataLetak(u: UkuranCap, kotak: KotakTulisan[]): TataLetak {
  const peta = petaTulisan(kotak);
  if (peta.kosong) return TATA_LETAK_LAMA;
  const tepi = Math.round(Math.min(u.W, u.H) * 0.012);
  let terbaik = TATA_LETAK_LAMA;
  let skorTerbaik = Infinity;
  for (const tegak of ["bawah", "tukar", "atas"] as const) {
    // `atas` hanya kalau kepala + blok info muat di tinggi foto.
    if (tegak === "atas" && u.safeY + u.kepalaH + u.jarak + u.info.h > u.H - u.safeY) continue;
    for (const infoKanan of [false, true])
      for (const logoKiri of [false, true])
        for (const kepalaRapat of [false, true]) {
          // Berdampingan hanya kalau keduanya muat di lebar aman foto.
          if (kepalaRapat && (!u.panel || u.logo.w + u.panel.w + u.safeX * 0.6 > u.W - 2 * u.safeX)) continue;
          const t: TataLetak = kepalaRapat ? { tegak, infoKanan, logoKiri, kepalaRapat } : { tegak, infoKanan, logoKiri };
          const l = letakUnsur(u, t);
          const skor =
            tutupan(peta, perluas(l.info, tepi), u.W, u.H) +
            tutupan(peta, perluas(l.logo, tepi), u.W, u.H) +
            (l.panel ? 0.8 * tutupan(peta, perluas(l.panel, tepi), u.W, u.H) : 0) +
            (tegak === "atas" ? HARGA.atas : tegak === "tukar" ? HARGA.tukar : 0) +
            (infoKanan ? HARGA.infoKanan : 0) +
            (logoKiri ? HARGA.logoKiri : 0) +
            (kepalaRapat ? HARGA.kepalaRapat : 0);
          if (skor < skorTerbaik - 1e-9) {
            skorTerbaik = skor;
            terbaik = t;
          }
        }
  }
  return terbaik;
}

/** Ada tulisan lama di dalam pita ini? (penentu bayangan selebar foto vs setempat) */
export function adaTulisanDi(kotak: KotakTulisan[], r: Persegi, W: number, H: number): boolean {
  return tutupan(petaTulisan(kotak), r, W, H) > 0;
}
