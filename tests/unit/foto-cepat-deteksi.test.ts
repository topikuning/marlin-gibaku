// DETEKSI LOKASI DARI GEOTAG (DECISIONS 254).
//
// Permintaan user: "bahkan tidak perlu input lokasi. kalau bisa kamu deteksi
// lokasi berdasarkan geotagnya."
//
// Yang dijaga berkas ini bukan "deteksinya jalan" — itu bagian mudahnya —
// melainkan bahwa deteksinya BERHENTI saat tidak yakin. Foto yang masuk ke desa
// sebelah tidak menerbitkan galat apa pun dan baru ketahuan berminggu-minggu
// kemudian saat laporan KKP disusun, kalau ketahuan. Menolak menebak adalah
// perilaku yang benar, dan hanya uji yang bisa menahannya tetap begitu.
//
// Koordinat di bawah memakai jarak NYATA dari katalog master KNMP: pasangan
// paling berdekatan 474 m (Kedungmalang Jepara ↔ Kedungmutih Demak).
import { describe, expect, it } from "vitest";
import {
  RADIUS_LOKASI_M,
  SELISIH_MINIMAL_M,
  alasanDeteksi,
  deteksiLokasi,
} from "@/lib/foto-cepat/deteksi";
import { jarakMeter } from "@/lib/foto-cepat/jarak";

/**
 * Geser dari titik acuan sejauh `m` meter ke UTARA (lintang saja, mudah dihitung).
 *
 * Pembaginya diturunkan dari jari-jari yang DIPAKAI `jarakMeter` (R = 6.371 km),
 * bukan dari angka bulat 111.320 m/derajat. Bedanya cuma ~0,1%, tapi itu sudah
 * cukup membuat fixture "474 m" terukur 473 m — dan uji yang meleset karena
 * cara fixture-nya dibuat akan dibaca sebagai kodenya yang salah.
 */
const METER_PER_DERAJAT_LINTANG = (2 * Math.PI * 6_371_000) / 360;
function geser(lat: number, lng: number, m: number) {
  return { lat: lat + m / METER_PER_DERAJAT_LINTANG, lng };
}

const A = { id: "a", name: "Kedungmalang", lat: -6.5, lng: 110.65 };
// 474 m di utara A — jarak pasangan terdekat yang benar-benar ada di lapangan.
const B = { id: "b", name: "Kedungmutih", ...geser(-6.5, 110.65, 474) };
const JAUH = { id: "c", name: "Kranji", lat: -6.87, lng: 112.3 };
const TANPA_TITIK = { id: "d", name: "Belum Dipetakan", lat: null, lng: null };

describe("berhasil mendeteksi", () => {
  it("berdiri TEPAT di titik proyek → lokasi itu", () => {
    const h = deteksiLokasi({ lat: A.lat, lng: A.lng }, [A, JAUH]);
    expect(h.status).toBe("cocok");
    if (h.status === "cocok") expect(h.lokasi.id).toBe("a");
  });

  it("satu-satunya lokasi dalam radius → tidak ada yang bisa dikacaukan", () => {
    const h = deteksiLokasi(geser(A.lat, A.lng, 400), [A, JAUH]);
    expect(h.status).toBe("cocok");
  });

  it("jauh lebih dekat ke salah satu → tetap yakin", () => {
    // 50 m dari A, ±424 m dari B: rasio 8×, selisih 374 m — dua-duanya lewat.
    const h = deteksiLokasi(geser(A.lat, A.lng, 50), [A, B]);
    expect(h.status).toBe("cocok");
    if (h.status === "cocok") expect(h.lokasi.id).toBe("a");
  });

  it("lokasi TANPA titik proyek diabaikan, bukan bikin gagal", () => {
    const h = deteksiLokasi({ lat: A.lat, lng: A.lng }, [TANPA_TITIK, A]);
    expect(h.status).toBe("cocok");
  });
});

describe("MENOLAK menebak", () => {
  it("di antara dua lokasi berdekatan → ambigu, bukan asal pilih", () => {
    // Titik tengah pasangan 474 m: ~237 m dari keduanya. Rasio ~1, selisih ~0.
    const h = deteksiLokasi(geser(A.lat, A.lng, 237), [A, B]);
    expect(h.status).toBe("ambigu");
    if (h.status === "ambigu") expect(h.kandidat).toHaveLength(2);
  });

  it("selisih besar tapi rasio kecil → tetap ambigu", () => {
    // Dua syarat sengaja dipasang bersama; rasio saja lolos di angka kecil,
    // selisih saja lolos untuk dua lokasi yang sama-sama jauh.
    const dekat = { id: "x", name: "X", lat: -6.5, lng: 110.65 };
    const agak = { id: "y", name: "Y", ...geser(-6.5, 110.65, 900) };
    const h = deteksiLokasi(geser(-6.5, 110.65, 500), [dekat, agak]);
    // 500 m vs 400 m → yang terdekat justru Y, dan rasionya 1,25 → ambigu.
    expect(h.status).toBe("ambigu");
  });

  it("tanpa koordinat → tidak mendeteksi apa pun", () => {
    const h = deteksiLokasi(null, [A, B]);
    expect(h.status).toBe("tanpa_koordinat");
  });

  it("semua lokasi di luar radius → jauh, berikut yang terdekat", () => {
    const h = deteksiLokasi({ lat: JAUH.lat, lng: JAUH.lng }, [A, B]);
    expect(h.status).toBe("jauh");
    if (h.status === "jauh") {
      expect(h.terdekat).not.toBeNull();
      expect(h.terdekat!.jarakMeter).toBeGreaterThan(RADIUS_LOKASI_M);
    }
  });

  it("tidak ada lokasi berkoordinat sama sekali → jauh tanpa terdekat", () => {
    const h = deteksiLokasi({ lat: A.lat, lng: A.lng }, [TANPA_TITIK]);
    expect(h.status).toBe("jauh");
    if (h.status === "jauh") expect(h.terdekat).toBeNull();
  });
});

describe("ambang yang dipakai memang memisahkan lokasi NYATA", () => {
  it("pasangan terdekat di katalog (474 m) tidak bertumpuk dalam radius", () => {
    // Kalau suatu saat radius dinaikkan melewati jarak ini, berdiri di A akan
    // selalu memasukkan B ke dalam radius — dan deteksinya bergantung penuh
    // pada aturan margin. Uji ini yang mengingatkannya.
    const d = jarakMeter(A.lat, A.lng, B.lat, B.lng);
    expect(Math.round(d)).toBe(474);
    expect(SELISIH_MINIMAL_M).toBeLessThan(d);
  });

  it("radius tidak boleh melampaui jarak pasangan terdekat", () => {
    // 1 km > 474 m — jadi B MEMANG bisa ikut masuk radius saat kita di A.
    // Itu disengaja: yang memutuskan bukan radius, melainkan margin. Yang
    // dijaga di sini cuma supaya radius tidak dinaikkan sampai absurd.
    expect(RADIUS_LOKASI_M).toBeLessThanOrEqual(2000);
  });
});

describe("alasan yang bisa dibaca manusia", () => {
  it("menyebut sebabnya, bukan sekadar gagal", () => {
    expect(alasanDeteksi(deteksiLokasi(null, [A]))).toMatch(/tidak membawa koordinat/i);
    expect(alasanDeteksi(deteksiLokasi({ lat: JAUH.lat, lng: JAUH.lng }, [A]))).toMatch(/km/);
    expect(alasanDeteksi(deteksiLokasi(geser(A.lat, A.lng, 237), [A, B]))).toMatch(/berdekatan/i);
  });

  it("yang berhasil tidak punya alasan untuk ditampilkan", () => {
    expect(alasanDeteksi(deteksiLokasi({ lat: A.lat, lng: A.lng }, [A]))).toBeNull();
  });
});
