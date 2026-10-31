import { describe, expect, it } from "vitest";
import {
  awalanPeriodeTermin,
  namaLaporanTermin,
  pekerjaanBuang,
  namaDenganLokasi,
  periodePekerjaanTermin,
  refKeyPekerjaanTermin,
  subfolderLokasi,
  rencanaBerkasTermin,
  rentangMingguTermin,
  uraiPeriodeTermin,
  type PekerjaanTermin,
} from "@/lib/penagihan/berkas-termin-aturan";
import { KATALOG_BERKAS_TERMIN, gabungStatusLokasi, type StatusButir } from "@/lib/penagihan/katalog";

/**
 * "Siapkan berkas Termin n" (DECISIONS 721): periode laporan termin dan
 * daftar pekerjaan unggahnya.
 */

describe("rentangMingguTermin", () => {
  it("termin 1: minggu 1 s.d. minggu prestasinya", () => {
    expect(rentangMingguTermin(1, [{ terminKe: 1, mingguKe: 7 }])).toEqual({ ok: true, rentang: { awal: 1, akhir: 7 } });
  });

  it("termin berikutnya: sesudah minggu prestasi termin sebelumnya, tidak terikat nomor minggu tetap", () => {
    const prestasi = [
      { terminKe: 1, mingguKe: 7 },
      { terminKe: 2, mingguKe: 11 },
      { terminKe: 3, mingguKe: 19 },
    ];
    expect(rentangMingguTermin(2, prestasi)).toEqual({ ok: true, rentang: { awal: 8, akhir: 11 } });
    expect(rentangMingguTermin(3, prestasi)).toEqual({ ok: true, rentang: { awal: 12, akhir: 19 } });
  });

  it("progres yang belum diisi menunjuk termin yang harus diisi", () => {
    expect(rentangMingguTermin(1, [])).toMatchObject({ ok: false, terminKe: 1 });
    expect(rentangMingguTermin(2, [{ terminKe: 2, mingguKe: 10 }])).toMatchObject({ ok: false, terminKe: 1 });
    expect(rentangMingguTermin(2, [{ terminKe: 1, mingguKe: 7 }])).toMatchObject({ ok: false, terminKe: 2 });
  });

  it("minggu prestasi yang tidak maju ditolak, bukan dibalik diam-diam", () => {
    const r = rentangMingguTermin(2, [
      { terminKe: 1, mingguKe: 9 },
      { terminKe: 2, mingguKe: 9 },
    ]);
    expect(r).toMatchObject({ ok: false, terminKe: 2 });
    if (!r.ok) expect(r.alasan).toMatch(/tidak sesudah termin 1/);
  });
});

type Sumber = { dokumenId: string } | { suratId: string };
/** Semua butir dengan status bawaan halaman kosong; `ada` diisi per uji. */
function baris(ada: Record<string, Sumber[]> = {}) {
  return KATALOG_BERKAS_TERMIN.map((b) => ({
    kode: b.kode,
    status: (ada[b.kode] ? "ada" : b.sumber === "marlin" && !b.surat ? "disiapkan_marlin" : "menunggu") as StatusButir,
    sumber: ada[b.kode] ?? [],
  }));
}

describe("rencanaBerkasTermin", () => {
  const dasar = { terminKe: 1, lokasi: ["L1", "L2"], rentang: { awal: 1, akhir: 3 }, bulan: [1] };

  it("pola berkas yang lolos (Putera Fahlevi): Kurva S & mingguan minggu prestasi per lokasi; harian tiap minggu; bulanan per bulan; dokumentasi per lokasi", () => {
    const r = rencanaBerkasTermin({ ...dasar, baris: baris() });
    const hitung = (j: string) => r.filter((p) => p.jenis === j).length;
    expect(hitung("kurva_s")).toBe(2);
    expect(hitung("mingguan")).toBe(2);
    expect(hitung("harian")).toBe(2 * 3);
    expect(hitung("bulanan")).toBe(2 * 1);
    expect(hitung("dokumentasi")).toBe(2);
    expect(hitung("berkas")).toBe(0);
    // Hanya folder utama – duplikat BERKAS DOKUMEN TEKNIS tidak diisi ulang.
    expect(r.find((p) => p.jenis === "mingguan")).toMatchObject({ kode: ["7"], nomor: 3 });
    expect(r.filter((p) => p.jenis === "kurva_s").map((p) => [p.locationId, p.nomor, p.kode])).toEqual([
      ["L1", 3, ["5"]],
      ["L2", 3, ["5"]],
    ]);
    expect(r.filter((p) => p.jenis === "harian").map((p) => p.nomor)).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it("berkas yang sudah ada disalin ke folder utama saja", () => {
    const kurva = [{ dokumenId: "kurva-sendiri" }];
    const r = rencanaBerkasTermin({
      ...dasar,
      baris: baris({ "3": [{ dokumenId: "spmk" }], "9a": [{ suratId: "s1" }], "5": kurva, T9: kurva }),
    });
    expect(r.filter((p) => p.jenis === "berkas").map((p) => [p.kode[0], p.sumber])).toEqual([
      ["3", "dspmk"],
      ["5", "dkurva-sendiri"],
      ["9a", "ss1"],
    ]);
    expect(r.some((p) => p.jenis === "kurva_s")).toBe(false);
  });

  it("versi sendiri PER LOKASI: hanya lokasi yang belum diisi diberi versi MARLIN; berkas desa itu tetap disalin", () => {
    const perLokasi: { locationId: string; status: StatusButir }[] = [
      { locationId: "L1", status: "ada" },
      { locationId: "L2", status: "disiapkan_marlin" },
    ];
    // Status gabungannya seperti di halaman: satu desa versi sendiri, satu desa MARLIN = belum "ada".
    const status = gabungStatusLokasi(perLokasi.map((x) => x.status))!;
    expect(status).not.toBe("ada");
    const rows = baris({ "7": [{ dokumenId: "scan-l1" }] }).map((b) => (b.kode === "7" ? { ...b, status, lokasi: perLokasi } : b));
    const r = rencanaBerkasTermin({ ...dasar, baris: rows });
    expect(r.filter((p) => p.jenis === "mingguan").map((p) => p.locationId)).toEqual(["L2"]);
    expect(r.filter((p) => p.jenis === "berkas").map((p) => p.sumber)).toEqual(["dscan-l1"]);
  });

  it("versi sendiri bisa beberapa berkas (scan per minggu): semuanya disalin, satu baris antrean per berkas", () => {
    const scan = [{ dokumenId: "m1" }, { dokumenId: "m2" }, { dokumenId: "m3" }];
    const r = rencanaBerkasTermin({ ...dasar, baris: baris({ "7": scan }) });
    const salin = r.filter((p) => p.jenis === "berkas");
    expect(salin).toHaveLength(3);
    expect(new Set(salin.map((p) => refKeyPekerjaanTermin("P", p))).size).toBe(3);
    expect(r.some((p) => p.jenis === "mingguan")).toBe(false);
    expect(r.filter((p) => p.jenis === "harian")).toHaveLength(6);
  });

  it("butir yang belum ada di MARLIN tidak ikut (menunggu pihak lain, surat belum dibuat)", () => {
    const r = rencanaBerkasTermin({ ...dasar, baris: baris() });
    expect(r.some((p) => p.kode.includes("9c") || p.kode.includes("9b"))).toBe(false);
  });

  it("tanpa lokasi aktif: hanya berkas yang ada", () => {
    const r = rencanaBerkasTermin({ ...dasar, lokasi: [], baris: baris({ "3": [{ dokumenId: "x" }] }) });
    expect(r.map((p) => p.jenis)).toEqual(["berkas"]);
  });

  it("subfolder & nama desa seperti berkas yang lolos", () => {
    expect(subfolderLokasi("7", "Asemdoyong")).toEqual(["ASEMDOYONG"]);
    expect(subfolderLokasi("8", "Asemdoyong")).toEqual(["DOKUMENTASI - ASEMDOYONG"]);
    expect(subfolderLokasi("12", "Asemdoyong")).toEqual([]);
    expect(subfolderLokasi("7", null)).toEqual([]);
    expect(namaDenganLokasi("Lampiran NEGO.xlsx", "Muarareja")).toBe("Muarareja - Lampiran NEGO.xlsx");
    expect(namaDenganLokasi("SHOP DRAWING KNMP MUARAREJA.pdf", "Muarareja")).toBe("SHOP DRAWING KNMP MUARAREJA.pdf");
    expect(namaDenganLokasi("RKS.pdf", null)).toBe("RKS.pdf");
  });
});

describe("kunci & periode antrean", () => {
  const p: PekerjaanTermin = { terminKe: 2, jenis: "mingguan", nomor: 9, kode: ["7"], sumber: null, locationId: "L1" };

  it("periode bolak-balik utuh dan diawali nomor termin", () => {
    const periode = periodePekerjaanTermin(p);
    expect(periode.startsWith(awalanPeriodeTermin(2))).toBe(true);
    expect(periode.startsWith(awalanPeriodeTermin(1))).toBe(false);
    expect(uraiPeriodeTermin(periode, "L1")).toEqual(p);
    const salin: PekerjaanTermin = { terminKe: 1, jenis: "berkas", nomor: null, kode: ["9a"], sumber: "s123", locationId: null };
    expect(uraiPeriodeTermin(periodePekerjaanTermin(salin), null)).toEqual(salin);
  });

  it("termin 1 tidak ikut tersaring sebagai termin 10+", () => {
    expect(awalanPeriodeTermin(1)).toBe("1|");
    expect(periodePekerjaanTermin({ ...p, terminKe: 12 }).startsWith(awalanPeriodeTermin(1))).toBe(false);
  });

  it("refKey: laporan & Kurva S tetap satu baris saat isinya berubah; berkas salinan satu baris per berkas sumber", () => {
    const a: PekerjaanTermin = { terminKe: 1, jenis: "berkas", nomor: null, kode: ["3"], sumber: "dlama", locationId: null };
    expect(refKeyPekerjaanTermin("P", a)).not.toBe(refKeyPekerjaanTermin("P", { ...a, sumber: "dbaru" }));
    expect(refKeyPekerjaanTermin("P", a)).not.toBe(refKeyPekerjaanTermin("P", { ...a, kode: ["T12"] }));
    expect(refKeyPekerjaanTermin("P", p)).toBe(refKeyPekerjaanTermin("P", { ...p, kode: ["7", "T6"] }));
    // Minggu prestasi dibetulkan: Kurva S termin itu tetap satu baris.
    const kurva: PekerjaanTermin = { terminKe: 1, jenis: "kurva_s", nomor: 7, kode: ["5"], sumber: null, locationId: null };
    expect(refKeyPekerjaanTermin("P", kurva)).toBe(refKeyPekerjaanTermin("P", { ...kurva, nomor: 6 }));
    expect(refKeyPekerjaanTermin("P", p)).not.toBe(refKeyPekerjaanTermin("P", { ...p, nomor: 10 }));
    expect(refKeyPekerjaanTermin("P", p)).not.toBe(refKeyPekerjaanTermin("P", { ...p, locationId: "L2" }));
  });

  it("pekerjaan buang: hanya laporan MARLIN yang sudah naik lalu keluar rencana; salinan unggahan orang tidak pernah dibuang", () => {
    const baru = { terminKe: 1, jenis: "mingguan" as const, nomor: 3, kode: ["7", "T6"], sumber: null, locationId: "L1" };
    const tetap = { ...baru, nomor: 2 };
    const salinan: PekerjaanTermin = { terminKe: 1, jenis: "berkas", nomor: null, kode: ["3"], sumber: "dx", locationId: null };
    const baris = (q: PekerjaanTermin, status: string) => ({
      refKey: refKeyPekerjaanTermin("P", q),
      periode: periodePekerjaanTermin(q),
      locationId: q.locationId,
      status,
    });
    const lama = [
      baris(baru, "sukses"),
      baris(tetap, "sukses"),
      baris({ ...baru, nomor: 1 }, "menunggu"),
      baris(salinan, "sukses"),
    ];
    const b = pekerjaanBuang(lama, new Set([refKeyPekerjaanTermin("P", tetap)]));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ jenis: "buang", nomor: 3, kode: ["7", "T6"], sumber: refKeyPekerjaanTermin("P", baru), locationId: "L1" });
    // Bolak-balik lewat kolom periode tetap utuh (refKey lama memuat ":" dan ">").
    expect(uraiPeriodeTermin(periodePekerjaanTermin(b[0]), "L1")).toEqual(b[0]);
    expect(refKeyPekerjaanTermin("P", b[0]).startsWith("buang>")).toBe(true);
    // Baris buang lama tidak membuang dirinya sendiri.
    expect(pekerjaanBuang([baris(b[0], "sukses")], new Set())).toEqual([]);
  });

  it("periode rusak ditolak", () => {
    for (const rusak of ["", "x|mingguan|1|7|", "1|asal|1|7|", "1|mingguan|0|7|", "1|mingguan|1|99|", "1|mingguan|1||", "1|berkas||3|d|lebih"]) {
      expect(uraiPeriodeTermin(rusak, null), rusak).toBeNull();
    }
  });

  it("nama berkas laporan menyebut minggu dan lokasinya", () => {
    expect(namaLaporanTermin(p, { lokasi: "Asemdoyong", paket: "Paket A" })).toBe("Laporan Mingguan Minggu ke-9 - Asemdoyong.pdf");
    expect(namaLaporanTermin({ ...p, jenis: "kurva_s", nomor: 7 }, { lokasi: "Asemdoyong", paket: "Paket A" })).toBe(
      "Kurva S Minggu 1-7 - Asemdoyong.pdf",
    );
  });
});
