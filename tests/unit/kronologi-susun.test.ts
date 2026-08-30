// Kronologi lokasi: aturan JENDELA, urutan, dan pemotongannya.
//
// Permintaan user 2026-08-31: *"aku membutuhkan marlin dapat membuat kronologi,
// mengambil informasi dari kendala dan kegiatan lapangan ... dan menjelaskan
// kondisi terkini dari lokasi tersebut"*.
//
// Yang dikunci di sini adalah keputusan yang paling mudah salah dan paling
// mahal kalau salah: sebuah kronologi yang dibatasi jendela waktu akan
// MENYEMBUNYIKAN kendala yang dibuka empat bulan lalu dan sampai sekarang belum
// selesai — justru kendala yang paling menentukan "kondisi terkini". Jendela
// boleh memotong yang sudah lewat; ia tidak boleh memotong yang masih berjalan.
import { describe, expect, it } from "vitest";
import { susunKronologi, type KegiatanMentah, type KendalaMentah } from "@/lib/kronologi/susun";

const kendala = (o: Partial<KendalaMentah> & { id: string; dibuka: string }): KendalaMentah => ({
  judul: `Kendala ${o.id}`,
  rincian: null,
  tingkat: "sedang",
  status: "terbuka",
  sumber: "manual",
  pic: null,
  tenggat: null,
  ditutup: null,
  catatanPenutup: null,
  ...o,
});

const kegiatan = (o: Partial<KegiatanMentah> & { id: string; tanggal: string }): KegiatanMentah => ({
  jenis: "Rapat koordinasi",
  judul: `Kegiatan ${o.id}`,
  catatan: null,
  kendala: null,
  solusi: null,
  peserta: null,
  status: "final",
  jumlahFoto: 0,
  ...o,
});

const SAMPAI = "2026-08-31";

describe("susunKronologi", () => {
  it("mengurutkan dari yang terbaru", () => {
    const k = susunKronologi({
      sampai: SAMPAI,
      kendala: [kendala({ id: "a", dibuka: "2026-08-10" })],
      kegiatan: [kegiatan({ id: "b", tanggal: "2026-08-20" })],
    });
    expect(k.peristiwa.map((p) => p.tanggal)).toEqual(["2026-08-20", "2026-08-10"]);
  });

  it("TIDAK menyembunyikan kendala terbuka yang lebih tua dari jendela", () => {
    const k = susunKronologi({
      sampai: SAMPAI,
      hari: 30,
      kendala: [kendala({ id: "lama", dibuka: "2026-01-05", tingkat: "kritis" })],
      kegiatan: [],
    });
    expect(k.peristiwa).toHaveLength(1);
    expect(k.peristiwa[0]?.kunci).toContain("lama");
    expect(k.dipotong).toBe(0);
  });

  it("membuang yang sudah SELESAI di luar jendela, dan menghitungnya", () => {
    const k = susunKronologi({
      sampai: SAMPAI,
      hari: 30,
      kendala: [
        kendala({ id: "tutup", dibuka: "2026-01-05", status: "selesai", ditutup: "2026-01-20" }),
      ],
      kegiatan: [kegiatan({ id: "tua", tanggal: "2026-02-01" })],
    });
    expect(k.peristiwa).toHaveLength(0);
    // Tiga peristiwa: kendala dibuka, kendala ditutup, dan satu kegiatan.
    // Penutupan dihitung sebagai peristiwanya sendiri — itulah yang membuat
    // sebuah kronologi bisa dibaca sebagai cerita, bukan sebagai daftar.
    expect(k.dipotong).toBe(3);
  });

  it("penutupan kendala jadi peristiwanya sendiri", () => {
    const k = susunKronologi({
      sampai: SAMPAI,
      kendala: [
        kendala({
          id: "a",
          dibuka: "2026-08-10",
          status: "selesai",
          ditutup: "2026-08-25",
          catatanPenutup: "Lahan dibebaskan",
        }),
      ],
      kegiatan: [],
    });
    expect(k.peristiwa.map((p) => p.jenis)).toEqual(["kendala_ditutup", "kendala_dibuka"]);
    expect(k.peristiwa[0]?.rincian.join(" ")).toContain("Lahan dibebaskan");
  });

  it("pemotongan tidak boleh memakan kendala yang masih terbuka", () => {
    const k = susunKronologi({
      sampai: SAMPAI,
      batas: 2,
      kendala: [kendala({ id: "terbuka", dibuka: "2026-06-01" })],
      kegiatan: [
        kegiatan({ id: "k1", tanggal: "2026-08-29" }),
        kegiatan({ id: "k2", tanggal: "2026-08-28" }),
        kegiatan({ id: "k3", tanggal: "2026-08-27" }),
      ],
    });
    expect(k.peristiwa.map((p) => p.kunci)).toContain("kendala:terbuka:dibuka");
    expect(k.peristiwa).toHaveLength(3);
    expect(k.dipotong).toBe(1);
  });

  it("menyimpulkan kondisi terkini dari bahan yang sama", () => {
    const k = susunKronologi({
      sampai: SAMPAI,
      kendala: [
        kendala({ id: "a", dibuka: "2026-06-01", tingkat: "kritis", tenggat: "2026-08-01" }),
        kendala({ id: "b", dibuka: "2026-08-20", status: "ditangani" }),
        kendala({ id: "c", dibuka: "2026-08-02", status: "selesai", ditutup: "2026-08-15" }),
      ],
      kegiatan: [kegiatan({ id: "k1", tanggal: "2026-08-24", status: "draft" })],
    });
    expect(k.kondisi.kendalaTerbuka).toBe(2);
    expect(k.kondisi.kendalaKritis).toBe(1);
    expect(k.kondisi.kendalaLewatTenggat).toBe(1);
    expect(k.kondisi.kendalaTertuaHari).toBe(91);
    expect(k.kondisi.kegiatanTerakhir).toBe("2026-08-24");
    expect(k.kondisi.hariTanpaKegiatan).toBe(7);
    expect(k.kondisi.drafKegiatan).toBe(1);
  });

  it("mengaku saat memang tidak ada apa-apa", () => {
    const k = susunKronologi({ sampai: SAMPAI, kendala: [], kegiatan: [] });
    expect(k.peristiwa).toHaveLength(0);
    expect(k.kondisi.kegiatanTerakhir).toBeNull();
    expect(k.kondisi.hariTanpaKegiatan).toBeNull();
    expect(k.kondisi.kendalaTertuaHari).toBeNull();
  });
});
