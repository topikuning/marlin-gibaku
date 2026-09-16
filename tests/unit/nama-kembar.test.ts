// AMBANG "NAMA KEMBAR" HARUS PERSIS SEBATAS KEMAMPUAN PEMILAH DRIVE.
//
// Guard nama kembar ada untuk satu sebab konkret: `matchLocation` melekatkan
// berkas Google Drive ke lokasi berdasarkan NAMA, dari daftar lokasi satu
// paket, dan mengambil yang pertama cocok. Kalau ambang guard-nya lebih longgar
// daripada pemilah itu, kita melarang data yang sistemnya sanggup tangani;
// kalau lebih ketat, tetap ada pasangan yang lolos lalu saling menyamar.
import { describe, expect, it } from "vitest";
import { kunciNamaLokasi, namaKembarDi, kelompokNamaKembar } from "@/lib/package/nama-kembar";
import { matchLocation } from "@/lib/gdrive/classify";

const L = (id: string, name: string) => ({ id, name });

describe("kunci nama lokasi", () => {
  it("abai huruf besar-kecil dan tanda baca", () => {
    expect(kunciNamaLokasi("Kedung Mutih")).toBe(kunciNamaLokasi("KEDUNG  MUTIH"));
    expect(kunciNamaLokasi("Sukamaju-Barat")).toBe(kunciNamaLokasi("Sukamaju Barat"));
  });

  it("TIDAK menyamakan ejaan yang berbeda spasi – pemilah Drive masih bisa membedakannya", () => {
    expect(kunciNamaLokasi("Kedungmutih")).not.toBe(kunciNamaLokasi("Kedung Mutih"));
  });
});

describe("ambangnya terikat pada matchLocation", () => {
  it("dua nama ber-kunci sama membuat pemilah Drive tidak bisa memilih dengan dasar", () => {
    const a = L("a", "Sukamaju");
    const b = L("b", "SUKAMAJU");
    expect(namaKembarDi(a.name, [a, b], a.id)).toHaveLength(1);

    // Dan memang: berkas yang jelas milik "Sukamaju" tetap mendarat di SATU
    // lokasi saja – yang kebetulan lebih dulu, bukan yang benar.
    const hasil = matchLocation({ fileName: "Laporan Sukamaju.pdf", path: [] }, [a, b]);
    expect(hasil).not.toBeNull();
    expect([a.id, b.id]).toContain(hasil!.locationId);
  });

  it("nama yang kuncinya berbeda tetap terpilah benar, jadi tidak perlu ditolak", () => {
    const a = L("a", "Kedungmutih");
    const b = L("b", "Kedung Mutih");
    expect(namaKembarDi(a.name, [a, b], a.id)).toHaveLength(0);
    expect(matchLocation({ fileName: "Foto Kedung Mutih.jpg", path: [] }, [a, b])?.locationId).toBe("b");
  });
});

describe("kelompok nama kembar", () => {
  it("hanya kelompok berisi dua atau lebih yang dilaporkan", () => {
    const k = kelompokNamaKembar([
      L("1", "Sukamaju"),
      L("2", "sukamaju"),
      L("3", "Tanjung Pura"),
    ]);
    expect(k).toHaveLength(1);
    expect(k[0].anggota.map((a) => a.id).sort()).toEqual(["1", "2"]);
  });

  it("nama kosong tidak dianggap kembar dengan nama kosong lain", () => {
    expect(kelompokNamaKembar([L("1", "   "), L("2", "")])).toHaveLength(0);
  });
});
