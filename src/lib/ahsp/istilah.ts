/**
 * Lapisan ISTILAH: padanan bahasa lapangan ↔ terminologi resmi AHSP. MURNI.
 * DECISIONS 321.
 *
 * ### Aturannya milik BERKAS, bukan milik MARLIN
 *
 * Semua padanan di sini datang dari `matching_engine` pada berkas master AHSP
 * (skema 2.1.0) — bukan daftar yang ditulis sendiri lalu menua diam-diam.
 * Konsekuensinya disengaja: kalau berkasnya diperbarui, aturannya ikut berubah,
 * dan setiap padanan bisa ditelusuri ke sumbernya. Berkas itu sendiri
 * memerintahkan hal yang sama: *"Ekspansi istilah hanya memakai
 * terminology_aliases dan rules yang tersedia; jangan menciptakan ekuivalensi
 * teknis baru."*
 *
 * ### Kenapa ini penting untuk RAB KNMP
 *
 * RAB lapangan menulis "Pekerjaan Pembesian", AHSP menulis "Penulangan".
 * Sebagai teks keduanya tidak beririsan sama sekali — pencocok mana pun akan
 * menyerah. Padahal itu pekerjaan yang sama.
 *
 * ### Yang TIDAK dilakukan
 *
 * Menebak jenis baja dari simbol diameter. Berkasnya tegas: `Øxx` tanpa kata
 * "polos"/"sirip" berarti `unknown`, dan tindakannya *"lihat spesifikasi atau
 * konteks, jangan menebak jenis baja"*.
 */

export type AturanIstilah = {
  /** frasa (sudah dinormalkan) → istilah kanonik */
  padanan: Map<string, string>;
  /** frasa berkata jamak, diurut dari yang terpanjang supaya cocok lebih dulu */
  frasaPanjang: string[];
  /** sinyal elemen struktur → kelompok elemen (slab / frame / …) */
  elemen: Map<string, string>;
  /** istilah yang menandai pekerjaan penulangan */
  penulangan: Set<string>;
  /**
   * Tabel keputusan penulangan dari `reinforcement_matching.verified_records`:
   * `${elemen}_${jenisBaja}_${kelasDiameter}` → kode AHSP.
   *
   * Ini BUKAN tebakan kemiripan nama — berkasnya menyebut delapan analisa ini
   * sudah diverifikasi, dan ketiga sumbunya (elemen, jenis baja, kelas
   * diameter) memang yang membedakan koefisiennya.
   */
  penulanganTerverifikasi: Map<string, string>;
};

export const ATURAN_KOSONG: AturanIstilah = {
  padanan: new Map(),
  frasaPanjang: [],
  elemen: new Map(),
  penulangan: new Set(),
  penulanganTerverifikasi: new Map(),
};

function rapikan(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function objek(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function daftarString(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Baca `matching_engine` jadi bentuk siap pakai.
 *
 * Berkas yang tidak membawa `matching_engine` (mis. terbitan lama) menghasilkan
 * aturan KOSONG, dan pencocokan tetap jalan tanpa ekspansi istilah — turun
 * mutunya, tapi tidak pernah menebak padanan yang tidak diberikan.
 */
export function bacaAturanIstilah(matchingEngine: unknown): AturanIstilah {
  const me = objek(matchingEngine);
  const padanan = new Map<string, string>();
  const elemen = new Map<string, string>();

  for (const [kanonikMentah, daftar] of Object.entries(objek(me.terminology_aliases))) {
    const kanonik = rapikan(kanonikMentah);
    if (!kanonik) continue;
    padanan.set(kanonik, kanonik);
    for (const a of daftarString(daftar)) {
      const k = rapikan(a);
      if (k) padanan.set(k, kanonik);
    }
  }

  const rein = objek(me.reinforcement_matching);
  for (const r of Array.isArray(rein.element_rules) ? rein.element_rules : []) {
    const o = objek(r);
    const grup = typeof o.element_group === "string" ? o.element_group : null;
    if (!grup) continue;
    for (const sinyal of daftarString(o.signals)) {
      const k = rapikan(sinyal);
      if (k) elemen.set(k, grup);
    }
  }

  const penulangan = new Set<string>();
  for (const s of daftarString(rein.synonyms)) {
    const k = rapikan(s);
    if (k) penulangan.add(padanan.get(k) ?? k);
  }

  const penulanganTerverifikasi = new Map<string, string>();
  for (const [kunci, kode] of Object.entries(objek(rein.verified_records))) {
    if (typeof kode === "string" && kode.trim()) {
      penulanganTerverifikasi.set(kunci.trim().toLowerCase(), kode.trim());
    }
  }

  const frasaPanjang = [...padanan.keys(), ...elemen.keys()]
    .filter((f) => f.includes(" "))
    .sort((a, b) => b.length - a.length);

  return { padanan, frasaPanjang, elemen, penulangan, penulanganTerverifikasi };
}

export type Bacaan = {
  /** Teks setelah frasa jamak dipadatkan jadi satu istilah kanonik. */
  teks: string;
  /** Istilah kanonik yang terdeteksi (mis. "penulangan", "beton"). */
  istilah: Set<string>;
  /** Kelompok elemen struktur yang terdeteksi ("slab", "frame", …). */
  elemen: Set<string>;
  /**
   * Kelas diameter tulangan menurut berkasnya: `lt12` / `ge12`, atau null.
   * Sengaja KELAS, bukan diameter persis — AHSP penulangan memang hanya
   * membedakan < 12 mm dan ≥ 12 mm, jadi D10 vs D8 bukan pertentangan.
   */
  kelasDiameter: string | null;
};

/**
 * Penanda diameter tulangan: D10, Ø 12, ∅16, phi 10, dia 13 — dan "8D10".
 *
 * Lookbehind "bukan huruf", BUKAN `\b`: pada "8D10" tidak ada batas kata antara
 * angka dan huruf, jadi `\bd` gagal justru pada bentuk yang paling lazim
 * ditulis orang lapangan. Sebaliknya huruf d di tengah kata ("sedang",
 * "grade") tetap tidak ikut terbaca.
 */
const RE_DIAMETER = /(?:(?<![a-z])d|ø|∅|(?<![a-z])phi|(?<![a-z])dia)\s*\.?\s*(\d{1,2})(?:\s*mm)?\b/gi;

/**
 * Baca satu uraian: padatkan frasa, kumpulkan istilah kanonik, elemen struktur,
 * dan kelas diameter tulangan.
 */
export function bacaIstilah(raw: string, aturan: AturanIstilah): Bacaan {
  const awal = rapikan(raw);
  const istilah = new Set<string>();
  const elemenKetemu = new Set<string>();

  let teks = awal;
  // Frasa jamak lebih dulu, dari yang terpanjang: "baja tulangan sirip" harus
  // tertangkap utuh sebelum "tulangan" memakannya sepotong.
  for (const frasa of aturan.frasaPanjang) {
    if (!teks.includes(frasa)) continue;
    const kanonik = aturan.padanan.get(frasa);
    const grup = aturan.elemen.get(frasa);
    if (kanonik) istilah.add(kanonik);
    if (grup) elemenKetemu.add(grup);
    teks = teks.split(frasa).join(` ${(kanonik ?? frasa).replace(/ /g, "_")} `);
  }
  teks = teks.replace(/\s+/g, " ").trim();

  for (const kata of teks.split(" ")) {
    const k = kata.replace(/_/g, " ");
    const kanonik = aturan.padanan.get(k);
    if (kanonik) istilah.add(kanonik);
    const grup = aturan.elemen.get(k);
    if (grup) elemenKetemu.add(grup);
  }

  // Diameter dibaca dari teks ASLI: notasi "8D10" menempel tanpa spasi dan
  // hilang begitu tanda baca diratakan. Jumlah batang (8) sengaja diabaikan —
  // berkasnya menyebutnya bukan bagian pemilihan kelas diameter.
  let kelasDiameter: string | null = null;
  for (const m of raw.matchAll(RE_DIAMETER)) {
    const mm = Number(m[1]);
    if (!Number.isFinite(mm) || mm <= 0) continue;
    const kelas = mm >= 12 ? "ge12" : "lt12";
    // Dua kelas berbeda dalam satu uraian = uraiannya sendiri campuran;
    // jangan mengaku tahu kelasnya.
    if (kelasDiameter && kelasDiameter !== kelas) return { teks, istilah, elemen: elemenKetemu, kelasDiameter: null };
    kelasDiameter = kelas;
  }

  return { teks, istilah, elemen: elemenKetemu, kelasDiameter };
}

/**
 * Pembacaan khusus pekerjaan PENULANGAN.
 *
 * Kenapa jalur sendiri: analisa penulangan dibedakan oleh tiga hal — elemen
 * struktur, jenis baja, dan kelas diameter — dan ketiganya tidak terbaca oleh
 * kemiripan nama. Diukur pada RAB Kedung Mutih, "Pembesian Besi Beton D13-150
 * mm secara semi mekanis" tercocok ke *"1 kg Pekerjaan baja pelat secara semi
 * mekanis"* dengan 45%: pekerjaan yang sama sekali berbeda, menang karena
 * kata "baja"/"pelat"/"semi mekanis".
 */
export type BacaanPenulangan = {
  /** "slab" | "frame" | null (tidak disebut) */
  elemen: string | null;
  /** "bjts" | "bjtp" | null (tidak bisa ditentukan tanpa menebak) */
  jenisBaja: string | null;
  /** "lt12" | "ge12" | null */
  kelasDiameter: string | null;
  /** Kode AHSP yang mungkin, hasil tabel terverifikasi. */
  kodeKandidat: string[];
  /**
   * true = ada sumbu yang tidak disebut uraiannya, jadi kandidatnya lebih dari
   * satu. Berkasnya menyuruh menampilkan kandidat dan menandai `needs_context`,
   * BUKAN memilih paksa.
   */
  perluKonteks: boolean;
  /** Kenapa ia tidak bisa diputuskan sendiri — untuk ditulis apa adanya di UI. */
  alasan: string[];
};

const SINYAL_BJTS = /\b(bjts|besi\s*ulir|baja\s*tulangan\s*sirip|deform\w*)\b/i;
const SINYAL_BJTP = /\b(bjtp|besi\s*polos|baja\s*tulangan\s*polos|plain\s*bar)\b/i;
/** Notasi "D13" / "D 13" / "8D10" — sinyal kuat BjTS menurut berkasnya. */
const NOTASI_D = /(?:^|[^a-z])d\s*\.?\s*\d{1,2}\b/i;

const URUT_ELEMEN = ["slab", "frame"] as const;

/**
 * Terjemahkan uraian RAB penulangan jadi kandidat kode AHSP.
 *
 * `null` = uraiannya bukan pekerjaan penulangan, atau tabel terverifikasi tidak
 * tersedia pada terbitan berkas ini.
 */
export function bacaPenulangan(
  raw: string,
  aturan: AturanIstilah,
  bacaan: Bacaan,
): BacaanPenulangan | null {
  if (aturan.penulanganTerverifikasi.size === 0) return null;
  const adalahPenulangan = [...bacaan.istilah].some((i) => aturan.penulangan.has(i));
  if (!adalahPenulangan) return null;

  const alasan: string[] = [];

  // Elemen: dari sinyal yang dibaca lapisan istilah. "frame_ge12_in_current_ahsp"
  // (shearwall) tetap kelompok frame — di AHSP terbitan ini ia memang satu baris
  // dengan kolom/balok.
  let elemen: string | null = null;
  for (const kandidat of URUT_ELEMEN) {
    if ([...bacaan.elemen].some((e) => e === kandidat || e.startsWith(`${kandidat}_`))) {
      elemen = kandidat;
      break;
    }
  }
  if (!elemen) alasan.push("elemen struktur tidak disebut (slab vs kolom/balok/sloof)");

  /*
   * Jenis baja. Notasi D dianggap BjTS — itu aturan berkasnya, bukan tafsir
   * sendiri. Simbol Ø sengaja TIDAK menentukan apa pun: berkasnya menegaskan
   * "jangan menebak jenis baja" dari simbol diameter saja.
   */
  const bjts = SINYAL_BJTS.test(raw) || NOTASI_D.test(raw);
  const bjtp = SINYAL_BJTP.test(raw);
  let jenisBaja: string | null = null;
  if (bjts && !bjtp) jenisBaja = "bjts";
  else if (bjtp && !bjts) jenisBaja = "bjtp";
  else if (bjts && bjtp) alasan.push("uraian menyebut BjTS dan BjTP sekaligus");
  else alasan.push("jenis baja tidak disebut (Ø saja tidak menentukan polos/sirip)");

  const kelasDiameter = bacaan.kelasDiameter;
  if (!kelasDiameter) alasan.push("diameter tulangan tidak terbaca");

  const kodeKandidat: string[] = [];
  for (const [kunci, kode] of aturan.penulanganTerverifikasi) {
    const [e, b, d] = kunci.split("_");
    if (elemen && e !== elemen) continue;
    if (jenisBaja && b !== jenisBaja) continue;
    if (kelasDiameter && d !== kelasDiameter) continue;
    kodeKandidat.push(kode);
  }

  return {
    elemen,
    jenisBaja,
    kelasDiameter,
    kodeKandidat: [...new Set(kodeKandidat)],
    perluKonteks: kodeKandidat.length !== 1,
    alasan,
  };
}
