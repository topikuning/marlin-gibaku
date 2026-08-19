// KANTONG FOTO CEPAT — dua keluhan user 2026-08-06, keduanya soal ATURAN.
//
//   *"halaman foto cepat terlalu memaksakan untuk beberapa foto yang diambil
//   diberi tag lokasi yang sama. satu foto diklik tidak terjadi apa-apa."*
//
// Keduanya lolos dari uji apa pun yang hanya memeriksa "fotonya tersimpan":
// kantongnya terisi, tombolnya ada, aksinya jalan. Yang salah adalah foto MANA
// yang boleh disentuh, dan foto mana yang ikut terbawa saat satu jawaban lokasi
// diberikan. Berkas ini mengunci tepat dua hal itu.
import { describe, expect, it } from "vitest";
import {
  kelompokkanKantong,
  pangkasPilihan,
  tindakanKantong,
  LABEL_TANPA_LOKASI,
  type FotoKantong,
} from "@/lib/foto-cepat/kantong-pilihan";

const foto = (id: string, locationId: string | null, locationName?: string): FotoKantong => ({
  id,
  takenAtIso: "2026-08-06T02:00:00.000Z",
  waktuLabel: "06 Agu 09:00",
  locationId,
  locationName: locationName ?? (locationId ? `Lokasi ${locationId}` : LABEL_TANPA_LOKASI),
  lat: null,
  lng: null,
  gpsAsli: false,
  reporterName: "Mandor",
  bisaDilengkapi: true,
});

describe("kelompokkanKantong", () => {
  it("menaruh foto tanpa lokasi paling depan, bukan diselipkan di tengah", () => {
    // Itu satu-satunya kelompok yang MENUNGGU tindakan; di tengah daftar ia
    // tidak akan pernah dikerjakan.
    const g = kelompokkanKantong([foto("a", "L1"), foto("b", null), foto("c", "L1")]);
    expect(g[0].tanpaLokasi).toBe(true);
    expect(g[0].nama).toBe(LABEL_TANPA_LOKASI);
    expect(g[0].fotos.map((f) => f.id)).toEqual(["b"]);
    expect(g[1].fotos.map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("tidak memunculkan kelompok tanpa-lokasi bila memang tidak ada", () => {
    const g = kelompokkanKantong([foto("a", "L1"), foto("b", "L2")]);
    expect(g.every((k) => !k.tanpaLokasi)).toBe(true);
    expect(g).toHaveLength(2);
  });

  it("SETIAP foto masuk ke salah satu kelompok – tak ada yang tercecer", () => {
    // Inti keluhan "diklik tidak terjadi apa-apa": foto tanpa lokasi dulu
    // dirender di luar daftar yang bisa dipilih, jadi bagi pelapor yang
    // geotag-nya gagal TIDAK ADA satu pun foto yang bisa disentuh.
    const kantong = [foto("a", null), foto("b", "L1"), foto("c", null), foto("d", "L2")];
    const semua = kelompokkanKantong(kantong).flatMap((k) => k.fotos.map((f) => f.id));
    expect(semua.sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("tindakanKantong", () => {
  const kantong = [foto("a", null), foto("b", null), foto("c", "L1"), foto("d", "L2")];

  it("tanpa pilihan → tidak ada tindakan yang ditawarkan", () => {
    expect(tindakanKantong(kantong, new Set())).toEqual({ jenis: "kosong" });
  });

  it("menetapkan lokasi HANYA untuk foto yang dipilih", () => {
    // Ini keluhan "terlalu memaksakan ... diberi tag lokasi yang sama": dulu
    // panelnya memborong SELURUH foto tanpa lokasi dengan satu Combobox. Satu
    // perjalanan lapangan lazim melewati beberapa desa; memaksa satu jawaban
    // untuk semuanya membuat penetapan yang benar mustahil.
    const t = tindakanKantong(kantong, new Set(["a"]));
    expect(t.jenis).toBe("tetapkan");
    if (t.jenis !== "tetapkan") return;
    expect(t.fotos.map((f) => f.id)).toEqual(["a"]);
    // "b" juga tanpa lokasi, tapi TIDAK dipilih — dan karena itu tidak tersentuh.
    expect(t.fotos.map((f) => f.id)).not.toContain("b");
    expect(t.diabaikan).toBe(0);
  });

  it("pilihan campur → yang sudah berlokasi disebut jumlahnya, bukan dilewati diam-diam", () => {
    const t = tindakanKantong(kantong, new Set(["a", "c"]));
    expect(t.jenis).toBe("tetapkan");
    if (t.jenis !== "tetapkan") return;
    expect(t.fotos.map((f) => f.id)).toEqual(["a"]);
    expect(t.diabaikan).toBe(1);
  });

  it("foto tanpa lokasi TIDAK PERNAH langsung bisa dipakai", () => {
    // DECISIONS 254: menautkannya ke laporan lokasi X akan MENETAPKAN lokasinya
    // ke X secara diam-diam, padahal deteksi tadi justru menolak menebak.
    for (const pilihan of [["a"], ["a", "c"], ["a", "b", "c", "d"]]) {
      expect(tindakanKantong(kantong, new Set(pilihan)).jenis).toBe("tetapkan");
    }
  });

  it("dua lokasi berbeda → ditolak dengan sebabnya, bukan diam-diam dipakai sebagian", () => {
    const t = tindakanKantong(kantong, new Set(["c", "d"]));
    expect(t.jenis).toBe("campur_lokasi");
    if (t.jenis !== "campur_lokasi") return;
    expect(t.locationIds.sort()).toEqual(["L1", "L2"]);
  });

  it("satu lokasi, semua berlokasi → siap dipakai", () => {
    const isi = [foto("c", "L1"), foto("e", "L1"), foto("d", "L2")];
    const t = tindakanKantong(isi, new Set(["c", "e"]));
    expect(t).toEqual({ jenis: "pakai", locationId: "L1", photoIds: ["c", "e"] });
  });

  it("id yang sudah tidak ada di kantong tidak ikut dihitung", () => {
    // Foto yang baru dipakai/dibuang di tab lain. Tanpa penyaringan ini
    // tombolnya menjanjikan "Pakai 3 foto" padahal satu sudah pindah, lalu
    // server menolak sebagian tanpa pelapor tahu foto mana.
    const isi = [foto("c", "L1")];
    const t = tindakanKantong(isi, new Set(["c", "hantu"]));
    expect(t).toEqual({ jenis: "pakai", locationId: "L1", photoIds: ["c"] });
  });
});

describe("pangkasPilihan", () => {
  it("membuang id yang sudah lenyap dari kantong", () => {
    const sisa = pangkasPilihan([foto("a", "L1")], new Set(["a", "b"]));
    expect([...sisa]).toEqual(["a"]);
  });

  it("mengembalikan set yang SAMA bila tidak ada yang perlu dibuang", () => {
    // Identitas dijaga supaya sinkronisasi saat render tidak memicu render
    // berulang tanpa henti.
    const semula = new Set(["a"]);
    expect(pangkasPilihan([foto("a", "L1")], semula)).toBe(semula);
  });

  it("set kosong dibiarkan apa adanya", () => {
    const semula = new Set<string>();
    expect(pangkasPilihan([foto("a", "L1")], semula)).toBe(semula);
  });
});
