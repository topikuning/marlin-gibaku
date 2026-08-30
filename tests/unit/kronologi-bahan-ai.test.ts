// KONTRAK GROUNDING kronologi: tiap peristiwa yang disodorkan ke model punya id
// sumber yang SAMA di payload dan di daftar sumber run.
//
// Kalau keduanya berbeda walau satu aksara, penyaring `filterGrounded` akan
// membuang SETIAP babak cerita yang menunjuk peristiwa — dan yang tersisa adalah
// run yang tampak berhasil dengan cakupan bukti 0%. Kegagalan yang paling mahal
// justru yang paling sunyi.
//
// Ditulis SESUDAH wiring-nya (bukan merah dulu): ia mengunci invarian antara dua
// berkas yang sudah ada, bukan menuntun perilaku baru.
import { describe, expect, it } from "vitest";
import { buildKronologiPayload, sumberKronologi } from "@/lib/ai-hub/kronologi-format";
import { susunKronologi } from "@/lib/kronologi/susun";
import type { KronologiLokasi } from "@/lib/kronologi/queries";

const inti = susunKronologi({
  sampai: "2026-08-31",
  kendala: [
    {
      id: "a",
      judul: "Lahan blok B belum bebas",
      rincian: "Menunggu surat dinas",
      tingkat: "kritis",
      status: "terbuka",
      dibuka: "2026-06-01",
      ditutup: null,
      catatanPenutup: null,
      sumber: "manual",
      pic: "Dinas PU",
      tenggat: "2026-08-01",
    },
  ],
  kegiatan: [
    {
      id: "g",
      tanggal: "2026-08-24",
      jenis: "Rapat koordinasi",
      judul: "Koordinasi pembebasan lahan",
      catatan: "Disepakati pengukuran ulang",
      kendala: null,
      solusi: null,
      peserta: null,
      status: "draft",
      jumlahFoto: 3,
    },
  ],
});

const k: KronologiLokasi = {
  lokasi: { id: "loc-1", nama: "Danasari", slug: "knmp-danasari", wilayah: "Pemalang, Jawa Tengah" },
  ...inti,
};

describe("bahan kronologi untuk provider", () => {
  const payload = buildKronologiPayload(k);
  const refs = sumberKronologi(k);

  it("tiap peristiwa punya sumber yang bisa dikutip", () => {
    expect(refs).toHaveLength(k.peristiwa.length);
    for (const r of refs) expect(payload).toContain(`[${r.id}]`);
  });

  it("tiap sumber menunjuk halaman yang memang memuat peristiwanya", () => {
    const kegiatan = refs.find((r) => r.entityType === "kronologi_kegiatan");
    const kendala = refs.find((r) => r.entityType === "kronologi_kendala_dibuka");
    expect(kegiatan?.href).toBe("/lokasi/knmp-danasari/kegiatan");
    expect(kendala?.href).toBe("/lokasi/knmp-danasari/progress");
  });

  it("menyodorkan hitungan kondisi SUDAH JADI, dengan larangan menghitung ulang", () => {
    expect(payload).toContain("sudah dihitung sistem");
    expect(payload).toContain("kendala masih terbuka: 1");
    expect(payload).toContain("umur kendala terbuka tertua: 91 hari");
  });

  it("menandai keadaan yang mengubah arti peristiwanya", () => {
    expect(payload).toContain("LEWAT TENGGAT");
    expect(payload).toContain("masih draf");
  });

  it("melarang menyimpulkan kekosongan dari jendela yang dipotong", () => {
    const banyak = susunKronologi({
      sampai: "2026-08-31",
      batas: 1,
      kendala: [],
      kegiatan: [
        { id: "x", tanggal: "2026-08-20", jenis: "Rapat", judul: "A", catatan: null, kendala: null, solusi: null, peserta: null, status: "final", jumlahFoto: 0 },
        { id: "y", tanggal: "2026-08-19", jenis: "Rapat", judul: "B", catatan: null, kendala: null, solusi: null, peserta: null, status: "final", jumlahFoto: 0 },
      ],
    });
    const teks = buildKronologiPayload({ ...k, ...banyak });
    expect(teks).toContain("Jangan menyimpulkan bahwa tidak ada apa-apa sebelum");
  });
});
