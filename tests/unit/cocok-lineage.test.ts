// IDENTITAS ITEM SAAT NOMORNYA BERGESER.
//
// Keberatan user 2026-09-01 atas pratinjau impor MC-0 KEMANTREN: *"berapa harga
// lamanya, tidak ada informasi jelas"*. Panelnya melaporkan "harga satuan 39
// item KONTRAK LAMA berubah", salah satunya `6 Pekerjaan Skonengan –
// 1.037.988,58 → 78.808,37`. Di berkas itu 1.037.988,58 adalah harga **Pintu
// Rooling Door**, item nomor **7**; 78.808,37 memang harga Skonengan. Bukan
// harganya yang berubah — pasangannya yang meleset satu baris, karena identitas
// item = jalur kode (`lineageKey`) dan satu baris yang disisipkan menggeser
// seluruh nomor di bawahnya.
//
// Yang paling mahal bukan panelnya: `DailyReportItem.lineageKey` memakai kunci
// yang sama, jadi realisasi harian ikut berpindah ke pekerjaan yang salah tanpa
// satu pun peringatan.
//
// Diuji dari bentuk datanya. Modul `cocok-lineage` murni — tanpa DB.
import { describe, expect, it } from "vitest";
import type { FlatNode } from "@/lib/rab/flatten";
import { samakanLineage, type NodeLamaCocok } from "@/lib/rab/cocok-lineage";
import { bandingkanTerhadapAktif, type NodeAktif } from "@/lib/rab/diff-parsed";
import { formatRupiahSatuan } from "@/lib/format";

type Spek = { kode: string; nama: string; harga?: number; vol?: number; sat?: string };

/** Satu kategori "V" berisi item-item bernomor urut. */
function fileBaru(items: Spek[]): FlatNode[] {
  const out: FlatNode[] = [
    {
      kind: "kategori",
      code: "V",
      name: "PEKERJAAN BANGUNAN KIOS",
      volume: null,
      unit: null,
      unitPrice: null,
      amount: 0n,
      lineageKey: "V",
      parentLineageKey: null,
      sortOrder: 0,
    },
  ];
  items.forEach((it, i) => {
    out.push({
      kind: "item",
      code: it.kode,
      name: it.nama,
      volume: it.vol ?? 1,
      unit: it.sat ?? "m²",
      unitPrice: it.harga ?? null,
      amount: BigInt(Math.round((it.harga ?? 0) * (it.vol ?? 1))),
      lineageKey: `V#${it.kode}`,
      parentLineageKey: "V",
      sortOrder: i + 1,
    });
  });
  return out;
}

function kontrak(items: Spek[]): NodeLamaCocok[] {
  return [
    { lineageKey: "V", parentLineageKey: null, kind: "kategori", code: "V", name: "PEKERJAAN BANGUNAN KIOS", unit: null },
    ...items.map((it) => ({
      lineageKey: `V#${it.kode}`,
      parentLineageKey: "V",
      kind: "item",
      code: it.kode,
      name: it.nama,
      unit: it.sat ?? "m²",
    })),
  ];
}

/** Kontrak yang sama, dalam bentuk yang dimengerti `bandingkanTerhadapAktif`. */
function kontrakAktif(items: Spek[]): NodeAktif[] {
  return [
    { lineageKey: "V", kind: "kategori", code: "V", name: "PEKERJAAN BANGUNAN KIOS", volume: null, unitPrice: null, amount: 0n },
    ...items.map((it) => ({
      lineageKey: `V#${it.kode}`,
      kind: "item",
      code: it.kode,
      name: it.nama,
      volume: it.vol ?? 1,
      unitPrice: it.harga ?? null,
      amount: BigInt(Math.round((it.harga ?? 0) * (it.vol ?? 1))),
    })),
  ];
}

const KONTRAK: Spek[] = [
  { kode: "5", nama: "Pekerjaan Kusen Aluminium", harga: 900_000 },
  { kode: "6", nama: "Pekerjaan Skonengan (Opening Kusen)", harga: 78_808.37 },
  { kode: "7", nama: "Pekerjaan Pintu Rooling Door", harga: 1_037_988.58 },
];
/** Satu baris disisipkan di nomor 6 — seluruh nomor di bawahnya turun satu. */
const BERGESER: Spek[] = [
  { kode: "5", nama: "Pekerjaan Kusen Aluminium", harga: 900_000 },
  { kode: "6", nama: "Pekerjaan Pemasangan Plastik Cor", harga: 12_712.12 },
  { kode: "7", nama: "Pekerjaan Skonengan (Opening Kusen)", harga: 78_808.37 },
  { kode: "8", nama: "Pekerjaan Pintu Rooling Door", harga: 1_037_988.58 },
];

describe("nomor bergeser, pekerjaannya tetap sama", () => {
  it("item dikenali lewat nama, bukan lewat nomor urutnya", () => {
    const h = samakanLineage(fileBaru(BERGESER), kontrak(KONTRAK));
    const byNama = new Map(h.nodes.map((n) => [n.name, n.lineageKey]));
    // Skonengan bernomor 7 di file baru, tapi identitasnya tetap V#6 — kunci yang
    // dipegang realisasi hariannya.
    expect(byNama.get("Pekerjaan Skonengan (Opening Kusen)")).toBe("V#6");
    expect(byNama.get("Pekerjaan Pintu Rooling Door")).toBe("V#7");
    // Yang benar-benar baru tidak mencuri identitas siapa pun.
    expect(byNama.get("Pekerjaan Pemasangan Plastik Cor")).not.toBe("V#6");
  });

  it("pergeserannya dilaporkan, tidak dilakukan diam-diam", () => {
    const h = samakanLineage(fileBaru(BERGESER), kontrak(KONTRAK));
    expect(h.digeser.map((d) => `${d.kodeLama}→${d.kode}`).sort()).toEqual(["6→7", "7→8"]);
  });

  it("tidak ada lagi “harga satuan berubah” yang tidak pernah terjadi", () => {
    // Inti keberatannya: tanpa penyamaan identitas, diff melaporkan Skonengan
    // berharga 1.037.988,58 (harga Pintu Rooling Door) berubah jadi 78.808,37.
    const h = samakanLineage(fileBaru(BERGESER), kontrak(KONTRAK));
    const beda = bandingkanTerhadapAktif(kontrakAktif(KONTRAK), h.nodes, new Map());
    expect(beda.hargaBerubah).toHaveLength(0);
    expect(beda.itemBaru.map((b) => b.name)).toEqual(["Pekerjaan Pemasangan Plastik Cor"]);
    expect(beda.itemHilang).toHaveLength(0);
  });

  it("tanpa penyamaan, diff memang melaporkan harga palsu (bukti arah sebaliknya)", () => {
    const beda = bandingkanTerhadapAktif(kontrakAktif(KONTRAK), fileBaru(BERGESER), new Map());
    const skonengan = beda.hargaBerubah.find((x) => x.name.startsWith("Pekerjaan Skonengan"));
    expect(skonengan?.dari).toBe(1_037_988.58); // harga Pintu Rooling Door
    expect(skonengan?.ke).toBe(78_808.37);
  });

  it("akar kunci (kategori) tidak pernah berubah – kedalamannya juga", () => {
    // Beberapa tempat lain membaca kategori dari `lineageKey.split("#")[0]`.
    const h = samakanLineage(fileBaru(BERGESER), kontrak(KONTRAK));
    const kunciKontrak = new Set(kontrak(KONTRAK).map((x) => x.lineageKey));
    for (const n of h.nodes.filter((x) => x.kind === "item")) {
      expect(n.lineageKey.split("#")[0]).toBe("V");
      // Yang dipasangkan dengan kontrak memakai kunci kontrak apa adanya –
      // kedalamannya tidak boleh bertambah. (Item BARU yang kodenya bentrok
      // memang mendapat sufiks `#2`, sama seperti dedup di `flattenParsedRab`.)
      if (kunciKontrak.has(n.lineageKey)) expect(n.lineageKey.split("#")).toHaveLength(2);
    }
  });

  it("item BARU tidak mewarisi kunci item kontrak yang kebetulan senomor", () => {
    // Kalau ia mengambil "V#6", seluruh realisasi harian Skonengan berpindah ke
    // pekerjaan yang baru pertama kali muncul hari ini.
    const h = samakanLineage(fileBaru(BERGESER), kontrak(KONTRAK));
    const plastik = h.nodes.find((n) => n.name === "Pekerjaan Pemasangan Plastik Cor")!;
    expect(plastik.lineageKey).not.toBe("V#6");
    expect(plastik.lineageKey.startsWith("V#")).toBe(true);
  });
});

describe("yang tidak boleh ditebak", () => {
  it("nama kembar di antara saudara → jatuh ke jalur kode, tidak menebak", () => {
    // Di berkas KKP ini lazim: "Pekerjaan Urugan Pasir t = 3 cm" muncul
    // berkali-kali dalam satu kategori. Mencocokkan lewat nama di situ sama
    // saja melempar koin.
    const kembar: Spek[] = [
      { kode: "1", nama: "Pekerjaan Urugan Pasir t = 3 cm", harga: 482_432.32 },
      { kode: "2", nama: "Pekerjaan Urugan Pasir t = 3 cm", harga: 482_432.32 },
    ];
    const h = samakanLineage(fileBaru(kembar), kontrak(kembar));
    expect(h.nodes.filter((n) => n.kind === "item").map((n) => n.lineageKey)).toEqual([
      "V#1",
      "V#2",
    ]);
    expect(h.digeser).toHaveLength(0);
  });

  it("kunci sama tapi nama berbeda → tetap dipakai, TAPI disebut", () => {
    // Item yang memang diganti namanya harus tetap membawa realisasinya;
    // membuangnya jadi "baru + hilang" justru memutus progres.
    const lama: Spek[] = [{ kode: "3", nama: "Pekerjaan Kusen Kayu", harga: 500_000 }];
    const baru: Spek[] = [{ kode: "3", nama: "Pekerjaan Kusen Aluminium", harga: 500_000 }];
    const h = samakanLineage(fileBaru(baru), kontrak(lama));
    expect(h.nodes.find((n) => n.kind === "item")?.lineageKey).toBe("V#3");
    expect(h.namaBerbeda).toEqual([
      { lineageKey: "V#3", kode: "3", name: "Pekerjaan Kusen Aluminium", namaLama: "Pekerjaan Kusen Kayu" },
    ]);
  });

  it("satu item kontrak tidak bisa diklaim dua kali", () => {
    const baru: Spek[] = [
      { kode: "1", nama: "Pekerjaan Skonengan (Opening Kusen)", harga: 78_808.37 },
      { kode: "2", nama: "Pekerjaan Skonengan (Opening Kusen)", harga: 78_808.37 },
    ];
    const h = samakanLineage(fileBaru(baru), kontrak(KONTRAK));
    const kunci = h.nodes.filter((n) => n.kind === "item").map((n) => n.lineageKey);
    expect(new Set(kunci).size).toBe(kunci.length);
  });
});

describe("panel harga menyebut pemilik angkanya", () => {
  it("diff membawa nama item KONTRAK, bukan hanya nama file", () => {
    const beda = bandingkanTerhadapAktif(kontrakAktif(KONTRAK), fileBaru(BERGESER), new Map());
    const skonengan = beda.hargaBerubah.find((x) => x.name.startsWith("Pekerjaan Skonengan"));
    expect(skonengan?.namaLama).toBe("Pekerjaan Pintu Rooling Door");
  });

  it("harga satuan diformat bersen – layar tidak lagi beda dari Excel", () => {
    // `unit_price` bertipe Decimal(15,2); yang membuang sennya cuma formatter.
    expect(formatRupiahSatuan(12_712.12)).toContain("12.712,12");
    expect(formatRupiahSatuan(12_712)).not.toContain(",");
    expect(formatRupiahSatuan(null)).toBe("–");
  });
});
