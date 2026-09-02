// KASUS NYATA user 2026-09-03: satu GRUP dinolkan, grup pengganti disisipkan.
//
// Bentuk berkasnya (tangkapan layar):
//
//   IV    PEKERJAAN DINDING PENAHAN TANAH
//   IV.1    Pekerjaan Turap Beton
//   1         Pekerjaan Tapak Beton Menerus 30 x 140 cm
//   a           Pekerjaan Galian Tanah sampai dengan 1 m   103,30 -> "-"
//   b..g        ...                                        semua  -> "-"
//   2         Pekerjaan Dinding Beton t = 20 cm
//   a..e        ...                                        semua  -> "-"
//   3         Pekerjaan Pondasi Batu Belah                 (BARU)
//   a           Pekerjaan Galian Tanah keras s.d 1 m       "-"    -> 114,85
//   b..f        ...
//
// Panah user menunjuk 1.a -> 3.a: pekerjaan yang sama, nama berbeda, nomor
// berbeda, DAN induk berbeda (grup 1 vs grup 3). Tidak ada satu pun sinyal
// otomatis yang tersisa.
//
// Yang diuji: apakah pemetaan manual benar-benar bisa menyeberangi GRUP selama
// masih dalam KATEGORI yang sama - bukan asumsi bahwa "seharusnya bisa".
import { describe, expect, it } from "vitest";
import { samakanLineage, type NodeLamaCocok } from "@/lib/rab/cocok-lineage";
import type { FlatNode } from "@/lib/rab/flatten";

const K = "IV";
const S = "IV#IV.1";
const G1 = "IV#IV.1#1";
const G3 = "IV#IV.1#3";

const nodeLama = (lineageKey: string, parent: string | null, kind: NodeLamaCocok["kind"], code: string, name: string): NodeLamaCocok => ({
  lineageKey, parentLineageKey: parent, kind, code, name, unit: "m3",
});

/** RAB kontrak: kategori IV > sub IV.1 > grup 1 (a,b) dan grup 2 (a). */
const KONTRAK: NodeLamaCocok[] = [
  nodeLama(K, null, "kategori", "IV", "PEKERJAAN DINDING PENAHAN TANAH"),
  nodeLama(S, K, "sub", "IV.1", "Pekerjaan Turap Beton"),
  nodeLama(G1, S, "grup", "1", "Pekerjaan Tapak Beton Menerus 30 x 140 cm"),
  nodeLama(`${G1}#a`, G1, "item", "a", "Pekerjaan Galian Tanah sampai dengan 1 m"),
  nodeLama(`${G1}#b`, G1, "item", "b", "Pekerjaan Cerucuk Kayu Dolken 6 - 8 cm"),
  nodeLama("IV#IV.1#2", S, "grup", "2", "Pekerjaan Dinding Beton t = 20 cm"),
  nodeLama("IV#IV.1#2#a", "IV#IV.1#2", "item", "a", "Pekerjaan Bekesting Dinding 5 kali pakai (2 sisi)"),
];

const nodeBaru = (
  lineageKey: string, parent: string | null, kind: FlatNode["kind"], code: string, name: string, volume: number | null,
): FlatNode => ({
  kind, code, name, volume, unit: "m3", unitPrice: 81_138.73,
  amount: BigInt(Math.round((volume ?? 0) * 81_138.73)),
  lineageKey, parentLineageKey: parent, sortOrder: 0,
});

/** Berkas: grup 1 & 2 DINOLKAN, grup 3 baru berisi penggantinya. */
const BERKAS: FlatNode[] = [
  nodeBaru(K, null, "kategori", "IV", "PEKERJAAN DINDING PENAHAN TANAH", null),
  nodeBaru(S, K, "sub", "IV.1", "Pekerjaan Turap Beton", null),
  nodeBaru(G1, S, "grup", "1", "Pekerjaan Tapak Beton Menerus 30 x 140 cm", null),
  // Sel "-" di Excel terbaca `null`, bukan 0 - itu yang benar-benar terjadi.
  nodeBaru(`${G1}#a`, G1, "item", "a", "Pekerjaan Galian Tanah sampai dengan 1 m", null),
  nodeBaru(`${G1}#b`, G1, "item", "b", "Pekerjaan Cerucuk Kayu Dolken 6 - 8 cm", null),
  nodeBaru("IV#IV.1#2", S, "grup", "2", "Pekerjaan Dinding Beton t = 20 cm", null),
  nodeBaru("IV#IV.1#2#a", "IV#IV.1#2", "item", "a", "Pekerjaan Bekesting Dinding 5 kali pakai (2 sisi)", null),
  nodeBaru(G3, S, "grup", "3", "Pekerjaan Pondasi Batu Belah", null),
  nodeBaru(`${G3}#a`, G3, "item", "a", "Pekerjaan Galian Tanah keras s.d 1 m", 114.85),
  nodeBaru(`${G3}#b`, G3, "item", "b", "Pekerjaan Urugan Pasir urug t = 7 cm", 15.42),
];

const cari = (h: { nodes: FlatNode[] }, lineageAsli: string) =>
  h.nodes.find((n) => n.name === BERKAS.find((b) => b.lineageKey === lineageAsli)!.name)!;

describe("tanpa pemetaan: grup pengganti terbaca sebagai item baru", () => {
  it("3.a tidak mewarisi apa pun, dan 1.a tetap memegang kuncinya", () => {
    const h = samakanLineage(BERKAS, KONTRAK);
    expect(cari(h, `${G3}#a`).lineageKey).toBe(`${G3}#a`);
    expect(cari(h, `${G1}#a`).lineageKey).toBe(`${G1}#a`);
    // Item grup 3 ditawarkan sebagai kandidat pasangan.
    expect(h.itemBaruAsli.map((x) => x.lineageAsli)).toContain(`${G3}#a`);
  });
});

describe("KASUS USER: 1.a dipetakan ke 3.a - beda nama, beda nomor, beda GRUP", () => {
  const h = samakanLineage(BERKAS, KONTRAK, {
    padanan: [{ lineageBaru: `${G3}#a`, lineageLama: `${G1}#a` }],
  });

  it("pemetaan DITERIMA - grup boleh berbeda selama kategorinya sama", () => {
    expect(h.padananDitolak).toEqual([]);
    expect(h.padananDipakai).toHaveLength(1);
  });

  it("3.a mewarisi kunci 1.a, jadi realisasi 60 m3 ikut ke pekerjaan penggantinya", () => {
    expect(cari(h, `${G3}#a`).lineageKey).toBe(`${G1}#a`);
  });

  it("baris 1.a yang dinolkan tetap tercantum, dengan kunci segar", () => {
    const tua = cari(h, `${G1}#a`);
    expect(tua.lineageKey).not.toBe(`${G1}#a`);
    expect(tua.volume).toBeNull();
  });

  it("saudara yang TIDAK dipetakan tidak ikut bergeser", () => {
    expect(cari(h, `${G1}#b`).lineageKey).toBe(`${G1}#b`);
    expect(cari(h, `${G3}#b`).lineageKey).toBe(`${G3}#b`);
  });
});

describe("beberapa pasangan sekaligus", () => {
  it("dua item dari dua GRUP berbeda dipetakan ke grup pengganti yang sama", () => {
    const h = samakanLineage(BERKAS, KONTRAK, {
      padanan: [
        { lineageBaru: `${G3}#a`, lineageLama: `${G1}#a` },
        { lineageBaru: `${G3}#b`, lineageLama: "IV#IV.1#2#a" },
      ],
    });
    expect(h.padananDitolak).toEqual([]);
    expect(cari(h, `${G3}#a`).lineageKey).toBe(`${G1}#a`);
    expect(cari(h, `${G3}#b`).lineageKey).toBe("IV#IV.1#2#a");
  });
});

/*
 * KASUS NYATA KEDUA (user 2026-09-03, tangkapan layar Excel + layar MARLIN).
 *
 * Pemetaan yang dipilih user DITOLAK dengan alasan:
 *
 *   Beda kategori: "Pekerjaan Galian Tanah sampai dengan 1 m" ada di IV,
 *   "Pekerjaan Galian Tanah keras s.d 1 m" di III.
 *
 * Padahal di berkasnya kedua baris jelas berada dalam SATU kategori yang sama -
 * "PEKERJAAN DINDING PENAHAN TANAH". Yang bergeser cuma NOMOR ROMAWI-nya:
 * kategori itu bernomor IV di RAB kontrak dan III di berkas baru, karena ada
 * kategori yang disisipkan atau dibuang di atasnya.
 *
 * Membandingkan KODE kategori karena itu menolak pemetaan yang sah - persis
 * kesalahan yang sudah diperbaiki untuk ITEM (DECISIONS 489: identitas dikenali
 * dari pekerjaannya, bukan dari nomor urutnya), tapi belum untuk KATEGORI.
 */
describe("KASUS USER 2: kategori sama, nomor romawinya bergeser IV -> III", () => {
  const KAT_LAMA = "IV";
  const KAT_BARU = "III";
  const NAMA_KAT = "PEKERJAAN DINDING PENAHAN TANAH";

  const kontrak: NodeLamaCocok[] = [
    nodeLama(KAT_LAMA, null, "kategori", "IV", NAMA_KAT),
    nodeLama(`${KAT_LAMA}#IV.1`, KAT_LAMA, "sub", "IV.1", "Pekerjaan Turap Beton"),
    nodeLama(`${KAT_LAMA}#IV.1#1`, `${KAT_LAMA}#IV.1`, "grup", "1", "Pekerjaan Tapak Beton Menerus 30 x 140 cm"),
    nodeLama(`${KAT_LAMA}#IV.1#1#a`, `${KAT_LAMA}#IV.1#1`, "item", "a", "Pekerjaan Galian Tanah sampai dengan 1 m"),
  ];

  const berkas: FlatNode[] = [
    nodeBaru(KAT_BARU, null, "kategori", "III", NAMA_KAT, null),
    nodeBaru(`${KAT_BARU}#III.1`, KAT_BARU, "sub", "III.1", "Pekerjaan Turap Beton", null),
    nodeBaru(`${KAT_BARU}#III.1#1`, `${KAT_BARU}#III.1`, "grup", "1", "Pekerjaan Tapak Beton Menerus 30 x 140 cm", null),
    nodeBaru(`${KAT_BARU}#III.1#1#a`, `${KAT_BARU}#III.1#1`, "item", "a", "Pekerjaan Galian Tanah sampai dengan 1 m", null),
    nodeBaru(`${KAT_BARU}#III.1#3`, `${KAT_BARU}#III.1`, "grup", "3", "Pekerjaan Pondasi Batu Belah", null),
    nodeBaru(`${KAT_BARU}#III.1#3#a`, `${KAT_BARU}#III.1#3`, "item", "a", "Pekerjaan Galian Tanah keras s.d 1 m", 32.15),
  ];

  it("kategori dikenali lewat NAMA, jadi pemetaannya DITERIMA", () => {
    const h = samakanLineage(berkas, kontrak, {
      padanan: [{ lineageBaru: `${KAT_BARU}#III.1#3#a`, lineageLama: `${KAT_LAMA}#IV.1#1#a` }],
    });
    expect(h.padananDitolak).toEqual([]);
    expect(h.padananDipakai).toHaveLength(1);
  });

  it("3.a mewarisi kunci 1.a walau nomor kategorinya bergeser", () => {
    const h = samakanLineage(berkas, kontrak, {
      padanan: [{ lineageBaru: `${KAT_BARU}#III.1#3#a`, lineageLama: `${KAT_LAMA}#IV.1#1#a` }],
    });
    const baru = h.nodes.find((n) => n.name === "Pekerjaan Galian Tanah keras s.d 1 m")!;
    expect(baru.lineageKey).toBe(`${KAT_LAMA}#IV.1#1#a`);
  });

  it("kategori yang benar-benar BERBEDA tetap ditolak", () => {
    const kontrakDua: NodeLamaCocok[] = [
      ...kontrak,
      nodeLama("V", null, "kategori", "V", "PEKERJAAN BANGUNAN SHELTER PENDARATAN IKAN"),
      nodeLama("V#1", "V", "item", "1", "Pekerjaan Bouwplank dan Uitzet"),
    ];
    const h = samakanLineage(berkas, kontrakDua, {
      padanan: [{ lineageBaru: `${KAT_BARU}#III.1#3#a`, lineageLama: "V#1" }],
    });
    expect(h.padananDipakai).toEqual([]);
    expect(h.padananDitolak[0].sebab).toMatch(/kategori/i);
  });
});

/*
 * NAMA KEMBAR — pertanyaan user 2026-09-03 setelah membaca Excel-nya sendiri.
 *
 * Di berkasnya, "Pekerjaan Galian Tanah keras s.d 1 m" muncul DUA KALI di
 * kategori berbeda: III grup 3 (baru, 32,15) dan IV grup 3 (sudah ada, 12,53,
 * "TETAP"). Nama pekerjaan memang berulang antar bangunan.
 *
 * Yang diuji di sini bukan item-nya - pencocokan item sudah dikurung per
 * kelompok saudara sehingga nama kembar antar kategori tidak bertabrakan.
 * Yang diuji KATEGORI-nya: peta "kategori berkas -> kategori kontrak" mencocok
 * lewat nama, dan kalau namanya kembar, mengambil yang pertama berarti
 * melempar koin atas milik siapa realisasi sebuah item.
 */
describe("nama KATEGORI yang kembar tidak boleh dipetakan dengan menebak", () => {
  const KEMBAR = "PEKERJAAN PONDASI";

  const kontrakKembar: NodeLamaCocok[] = [
    nodeLama("III", null, "kategori", "III", KEMBAR),
    nodeLama("III#1", "III", "item", "1", "Galian Tanah"),
    nodeLama("IV", null, "kategori", "IV", KEMBAR),
    nodeLama("IV#1", "IV", "item", "1", "Urugan Pasir"),
  ];

  const berkasKembar: FlatNode[] = [
    nodeBaru("V", null, "kategori", "V", KEMBAR, null),
    nodeBaru("V#9", "V", "item", "9", "Galian Tanah Keras", 10),
  ];

  it("kategori berkas bernama kembar TIDAK dipetakan ke salah satunya", () => {
    const h = samakanLineage(berkasKembar, kontrakKembar, {
      padanan: [{ lineageBaru: "V#9", lineageLama: "III#1" }],
    });
    expect(h.padananDipakai).toEqual([]);
    expect(h.padananDitolak).toHaveLength(1);
    expect(h.padananDitolak[0].sebab).toMatch(/kategori/i);
  });

  it("kalau kontraknya TIDAK kembar, pemetaannya tetap jalan", () => {
    const kontrakTunggal: NodeLamaCocok[] = [
      nodeLama("IV", null, "kategori", "IV", KEMBAR),
      nodeLama("IV#1", "IV", "item", "1", "Urugan Pasir"),
    ];
    const h = samakanLineage(berkasKembar, kontrakTunggal, {
      padanan: [{ lineageBaru: "V#9", lineageLama: "IV#1" }],
    });
    expect(h.padananDitolak).toEqual([]);
    expect(h.padananDipakai).toHaveLength(1);
  });

  it("dua kategori BERKAS bernama sama juga tidak dipetakan", () => {
    const berkasDuaKembar: FlatNode[] = [
      nodeBaru("V", null, "kategori", "V", KEMBAR, null),
      nodeBaru("V#9", "V", "item", "9", "Galian Tanah Keras", 10),
      nodeBaru("VI", null, "kategori", "VI", KEMBAR, null),
      nodeBaru("VI#9", "VI", "item", "9", "Galian Tanah Keras Lain", 5),
    ];
    const kontrakTunggal: NodeLamaCocok[] = [
      nodeLama("IV", null, "kategori", "IV", KEMBAR),
      nodeLama("IV#1", "IV", "item", "1", "Urugan Pasir"),
    ];
    const h = samakanLineage(berkasDuaKembar, kontrakTunggal, {
      padanan: [{ lineageBaru: "V#9", lineageLama: "IV#1" }],
    });
    expect(h.padananDipakai).toEqual([]);
    expect(h.padananDitolak[0].sebab).toMatch(/kategori/i);
  });
});
