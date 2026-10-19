import { normalizeName } from "@/lib/gdrive/classify";

/**
 * PENCOCOKAN LOKASI KAWAL ↔ MARLIN (DECISIONS 690). Murni, tanpa basis data.
 *
 * Tidak ada kunci bersama yang pasti: nomor kontrak Kawal menunjuk PAKET
 * (`Contract` satu per paket), dan satu paket bisa memuat beberapa lokasi.
 * Karena itu pencocokan otomatis hanya diambil bila buktinya tunggal:
 *
 * 1. Kontrak cocok → kandidatnya lokasi paket itu. Dari situ:
 *    - desa ATAU nama sama + kabupaten sama, tepat satu lokasi → otomatis;
 *    - paket hanya berisi satu lokasi + kabupaten sama → otomatis.
 * 2. Kontrak tidak cocok → desa ATAU nama sama + kabupaten sama, tepat satu
 *    lokasi di seluruh MARLIN → otomatis.
 * 3. Ada petunjuk tapi tidak tunggal (nama kembar, kabupaten beda, dua baris
 *    Kawal berebut satu lokasi) → ANTREAN konfirmasi orang.
 * 4. Tanpa petunjuk sama sekali → dibuang, hanya dihitung (milik entitas lain).
 *
 * Nama kembar di Kawal (Bajo, Ketapang, Kuala, Pasir Putih) karenanya tidak
 * pernah dipetakan otomatis tanpa kontrak atau kabupaten yang cocok. Pasangan
 * yang sudah ada – otomatis maupun keputusan orang – selalu dihormati.
 */

export type BarisCocok = {
  kawalId: number;
  namaKnmp: string;
  desa: string | null;
  kabupaten: string;
  noKontrak: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type LokasiCocok = {
  id: string;
  name: string;
  village: string;
  regency: string;
  packageId: string;
  contractNumber: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
};

export type PetaAda = { kawalId: number; locationId: string | null; status: string };

export type BasisOtomatis = "kontrak_desa" | "kontrak_satu_lokasi" | "desa_kabupaten";

export type Kandidat = {
  locationId: string;
  kontrakSama: boolean;
  desaSama: boolean;
  namaSama: boolean;
  kabupatenSama: boolean;
  /** Jarak titik Kawal ke titik lokasi MARLIN, km; null bila salah satu tanpa koordinat. */
  jarakKm: number | null;
};

export type Keputusan =
  | { kawalId: number; jenis: "berpasangan"; locationId: string; baru: null | { basis: BasisOtomatis } }
  | { kawalId: number; jenis: "antre"; kandidat: Kandidat[] }
  | { kawalId: number; jenis: "bukan_marlin" }
  | { kawalId: number; jenis: "buang" };

const KATA_BUANG = new Set(["desa", "ds", "kelurahan", "kel", "knmp", "kabupaten", "kab"]);

/** Kunci nama desa/lokasi/kabupaten. "Kota" sengaja dipertahankan: Kota Bima ≠ Kabupaten Bima. */
export function kunciWilayah(s: string | null | undefined): string {
  if (!s) return "";
  return normalizeName(s.replace(/kampung\s+nelayan\s+merah\s+putih/gi, " "))
    .split(" ")
    .filter((t) => t && !KATA_BUANG.has(t))
    .join(" ");
}

/** Nomor kontrak: huruf besar, tanpa spasi. */
export function kunciKontrak(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/\s+/g, "");
}

export function jarakKm(
  a: { lat: number | null; lng: number | null },
  b: { lat: number | null; lng: number | null },
): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function nilaiKandidat(k: Kandidat): number {
  return (k.kontrakSama ? 8 : 0) + (k.kabupatenSama ? 4 : 0) + (k.desaSama ? 2 : 0) + (k.namaSama ? 2 : 0);
}

function kandidatUntuk(b: BarisCocok, lokasi: LokasiCocok[]): Kandidat[] {
  const kontrak = kunciKontrak(b.noKontrak);
  const desa = kunciWilayah(b.desa);
  const nama = kunciWilayah(b.namaKnmp);
  const kab = kunciWilayah(b.kabupaten);
  const hasil: Kandidat[] = [];
  for (const l of lokasi) {
    const kontrakSama = !!kontrak && kunciKontrak(l.contractNumber) === kontrak;
    const kunciDesaL = kunciWilayah(l.village);
    const kunciNamaL = kunciWilayah(l.name);
    const desaSama = !!desa && (kunciDesaL === desa || kunciNamaL === desa);
    const namaSama = !!nama && (kunciNamaL === nama || kunciDesaL === nama);
    if (!kontrakSama && !desaSama && !namaSama) continue;
    hasil.push({
      locationId: l.id,
      kontrakSama,
      desaSama,
      namaSama,
      kabupatenSama: !!kab && kunciWilayah(l.regency) === kab,
      jarakKm: jarakKm({ lat: b.latitude, lng: b.longitude }, { lat: l.gpsLat, lng: l.gpsLng }),
    });
  }
  return hasil.sort((x, y) => nilaiKandidat(y) - nilaiKandidat(x) || (x.jarakKm ?? 1e9) - (y.jarakKm ?? 1e9));
}

/** Usulan otomatis untuk satu baris, atau null bila buktinya tidak tunggal. */
function usulOtomatis(kandidat: Kandidat[], lokasiPaket: Map<string, number>, lokasi: Map<string, LokasiCocok>) {
  const sekontrak = kandidat.filter((k) => k.kontrakSama);
  if (sekontrak.length > 0) {
    const pas = sekontrak.filter((k) => (k.desaSama || k.namaSama) && k.kabupatenSama);
    if (pas.length === 1) return { locationId: pas[0].locationId, basis: "kontrak_desa" as const };
    if (pas.length === 0 && sekontrak.length === 1 && sekontrak[0].kabupatenSama) {
      const paket = lokasi.get(sekontrak[0].locationId)!.packageId;
      if (lokasiPaket.get(paket) === 1)
        return { locationId: sekontrak[0].locationId, basis: "kontrak_satu_lokasi" as const };
    }
    return null;
  }
  const pas = kandidat.filter((k) => (k.desaSama || k.namaSama) && k.kabupatenSama);
  return pas.length === 1 ? { locationId: pas[0].locationId, basis: "desa_kabupaten" as const } : null;
}

/**
 * Putuskan nasib setiap baris Kawal. Deterministik: urutan baris tidak
 * mengubah hasil – usulan yang berebut lokasi yang sama SEMUANYA masuk
 * antrean, bukan dimenangkan yang datang duluan.
 */
export function cocokkanLokasi(baris: BarisCocok[], lokasi: LokasiCocok[], peta: PetaAda[]): Keputusan[] {
  const petaPerKawal = new Map(peta.map((p) => [p.kawalId, p]));
  const lokasiTerpakai = new Set(peta.filter((p) => p.locationId).map((p) => p.locationId!));
  const lokasiPerId = new Map(lokasi.map((l) => [l.id, l]));
  const lokasiPaket = new Map<string, number>();
  for (const l of lokasi) lokasiPaket.set(l.packageId, (lokasiPaket.get(l.packageId) ?? 0) + 1);

  const keputusan = new Map<number, Keputusan>();
  let sisa: BarisCocok[] = [];
  for (const b of baris) {
    const ada = petaPerKawal.get(b.kawalId);
    if (!ada) {
      sisa.push(b);
      continue;
    }
    keputusan.set(
      b.kawalId,
      ada.locationId
        ? { kawalId: b.kawalId, jenis: "berpasangan", locationId: ada.locationId, baru: null }
        : { kawalId: b.kawalId, jenis: "bukan_marlin" },
    );
  }

  // Kandidat dihitung terhadap lokasi yang BELUM berpasangan: lokasi yang
  // sudah dipegang baris Kawal lain bukan pilihan, otomatis maupun manual.
  //
  // Diulang sampai tidak ada pasangan baru: pasangan yang diterima di satu
  // ronde bisa membuat baris lain tinggal punya SATU kandidat (atau nol).
  // Tanpa pengulangan, tarikan pertama dan kedua atas data yang sama memberi
  // hasil berbeda – baris yang kemarin antre hari ini mendadak terbuang.
  const bebas = new Map(lokasi.filter((l) => !lokasiTerpakai.has(l.id)).map((l) => [l.id, l]));
  for (;;) {
    const ronde = sisa.map((b) => {
      const kandidat = kandidatUntuk(b, [...bebas.values()]);
      return { b, kandidat, usul: usulOtomatis(kandidat, lokasiPaket, lokasiPerId) };
    });
    const peminat = new Map<string, number>();
    for (const r of ronde) if (r.usul) peminat.set(r.usul.locationId, (peminat.get(r.usul.locationId) ?? 0) + 1);
    const diterima = ronde.filter((r) => r.usul && peminat.get(r.usul.locationId) === 1);
    if (diterima.length === 0) {
      for (const { b, kandidat } of ronde) {
        keputusan.set(
          b.kawalId,
          kandidat.length > 0
            ? { kawalId: b.kawalId, jenis: "antre", kandidat }
            : { kawalId: b.kawalId, jenis: "buang" },
        );
      }
      break;
    }
    for (const { b, usul } of diterima) {
      keputusan.set(b.kawalId, {
        kawalId: b.kawalId,
        jenis: "berpasangan",
        locationId: usul!.locationId,
        baru: { basis: usul!.basis },
      });
      bebas.delete(usul!.locationId);
    }
    const sudah = new Set(diterima.map((r) => r.b.kawalId));
    sisa = sisa.filter((b) => !sudah.has(b.kawalId));
  }
  return baris.map((b) => keputusan.get(b.kawalId)!);
}

export const LABEL_BASIS: Record<BasisOtomatis, string> = {
  kontrak_desa: "nomor kontrak + desa/nama + kabupaten",
  kontrak_satu_lokasi: "nomor kontrak (paket satu lokasi) + kabupaten",
  desa_kabupaten: "desa/nama + kabupaten",
};
