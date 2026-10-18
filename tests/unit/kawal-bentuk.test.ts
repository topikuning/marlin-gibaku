import { describe, expect, it } from "vitest";
import { cekPenanggalanMinggu, FIELD_DIPAKAI, petakanBentuk, tipeNilai } from "@/lib/kawal/bentuk";

/**
 * PETA BENTUK DATA KAWAL – NAMA & TIPE SAJA, TANPA NILAI (DECISIONS 689).
 *
 * Laporan uji sambungan tampil di layar Sistem; respons Kawal yang sungguhan
 * memuat nomor HP dan nama personel. Data di sini SINTETIS.
 */

const NILAI_RAHASIA = ["081299990000", "Budi Pengawas Contoh", "KONTRAK-RAHASIA-77", "Desa Contohsari"];

function baris(id: number, mulai: string, minggu: number | string) {
  return {
    id,
    nama_knmp: "KNMP Desa Contohsari",
    desa_kelurahan: "Desa Contohsari",
    no_kontrak_penyedia: "KONTRAK-RAHASIA-77",
    start_date_penyedia: mulai,
    current_week: minggu,
    progres_final: "12.5",
    progres_pelaksana: 13,
    kurva_rencana_kumulatif: "[0,1.5,3.2,6.1]",
    kurva_realisasi_mingguan: [0, 1.1, 1.4],
    progres_relatif: null,
    hp_pengawas: "081299990000",
    nama_pengawas: "Budi Pengawas Contoh",
    sarpras: [
      { sarpras_id: 1, nama_sarpras: "Dermaga", bobot: 12.3, progres: "40" },
      { sarpras_id: 2, nama_sarpras: "Gudang Beku", bobot: 8, progres: null },
    ],
  };
}

const BODY = {
  status: true,
  count: 2,
  data: [baris(1, "2026-08-01", 12), baris(2, "2026-09-05", "7")],
};

describe("peta bentuk data Kawal", () => {
  it("tidak ada satu pun NILAI yang keluar – hanya nama field dan tipe", () => {
    const keluar = JSON.stringify(petakanBentuk(BODY));
    for (const v of NILAI_RAHASIA) expect(keluar, v).not.toContain(v);
  });

  it("menghitung baris, field, dan kunci tingkat atas", () => {
    const b = petakanBentuk(BODY);
    expect(b.jumlahBaris).toBe(2);
    expect(b.atas.map((a) => a.nama)).toEqual(["status", "count", "data"]);
    expect(b.field.find((f) => f.nama === "progres_relatif")?.diisi).toBe(0);
  });

  it("tipe dibedakan: angka, teks angka, teks JSON, array", () => {
    const b = petakanBentuk(BODY);
    const tipe = (n: string) => b.field.find((f) => f.nama === n)!.tipe.map((t) => t.tipe);
    expect(tipe("progres_final")).toEqual(["teks angka"]);
    expect(tipe("progres_pelaksana")).toEqual(["angka"]);
    expect(tipe("kurva_rencana_kumulatif")).toEqual(["teks JSON: array angka"]);
    expect(tipe("current_week").sort()).toEqual(["angka", "teks angka"]);
  });

  it("isi array-objek (sarpras) dipetakan terpisah", () => {
    const anak = petakanBentuk(BODY).anak.sarpras;
    expect(anak.map((f) => f.nama)).toEqual(["bobot", "nama_sarpras", "progres", "sarpras_id"]);
    // Dua baris × dua sarpras; "Dermaga" terisi di keduanya, "Gudang Beku" kosong.
    expect(anak.find((f) => f.nama === "progres")?.diisi).toBe(2);
  });

  it("field yang akan dipakai tapi tidak ada disebut, kurva mingguan & calon Relatif ditemukan", () => {
    const b = petakanBentuk(BODY);
    expect(b.dipakaiHilang).toContain("target_fisik");
    expect(b.dipakaiHilang).not.toContain("progres_final");
    // Baris sintetis memuat 10 field yang dipakai (id … kurva_rencana_kumulatif, sarpras).
    expect(b.dipakaiHilang.length).toBe(FIELD_DIPAKAI.length - 10);
    expect(b.kurvaMingguan).toEqual(["kurva_realisasi_mingguan"]);
    expect(b.kandidatRelatif).toEqual(["progres_relatif"]);
  });

  it("respons yang bukan objek ber-`data` dilaporkan, tidak melempar", () => {
    const b = petakanBentuk("<html>masuk dulu</html>");
    expect(b.jumlahBaris).toBeNull();
    expect(b.atas).toEqual([{ nama: "(akar)", tipe: "teks" }]);
  });
});

describe("label tipe satu nilai", () => {
  it.each([
    [null, "kosong"],
    ["", "teks kosong"],
    ["2026-08-01", "teks tanggal (YYYY-MM-DD)"],
    ["01/08/2026", "teks tanggal (DD/MM/YYYY)"],
    ["1.5, 2, 3.25", "teks daftar angka dipisah koma"],
    ["[1,", "teks berawalan [ atau { (bukan JSON sah)"],
    [[{ a: 1 }], "array objek"],
    [{ a: 1 }, "objek"],
  ])("%j → %s", (v, label) => {
    expect(tipeNilai(v)).toBe(label);
  });
});

describe("penanggalan minggu Kawal", () => {
  it("menghitung sebaran selisih current_week terhadap '7 hari sejak start_date'", () => {
    // 2026-10-18: dari 2026-08-01 = 78 hari → minggu ke-12; dari 2026-09-05 = 43 hari → minggu ke-7.
    const hasil = cekPenanggalanMinggu(BODY, new Date(Date.UTC(2026, 9, 18)));
    expect(hasil).toEqual({ diperiksa: 2, tanpaData: 0, selisih: [{ selisih: 0, jumlah: 2 }] });
  });

  it("baris tanpa tanggal yang terbaca dihitung terpisah", () => {
    const hasil = cekPenanggalanMinggu(
      { data: [baris(1, "01/08/2026", 12), baris(2, "2026-09-05", 8)] },
      new Date(Date.UTC(2026, 9, 18)),
    );
    expect(hasil).toEqual({ diperiksa: 1, tanpaData: 1, selisih: [{ selisih: 1, jumlah: 1 }] });
  });
});
