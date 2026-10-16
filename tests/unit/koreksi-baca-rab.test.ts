/*
 * PERBAIKAN PEMBACAAN RAB AKTIF (DECISIONS 680).
 *
 * Laporan user 2026-10-15: RAB aktif CCO Krakahan terbaca dengan harga satuan
 * item baru KOSONG (jumlahnya ada). Pembacanya sudah dibetulkan (679), tapi
 * impor ulang lewat "Jadikan RAB AKTIF sekarang" berakhir sebagai DRAFT yang
 * menunggu dua persetujuan – padahal tidak ada satu angka kontrak pun yang
 * berubah. *"ini harus diperbaiki tanpa skema adendum"*.
 *
 * Yang boleh dibetulkan di tempat: harga satuan, satuan, nama, nomor. Yang
 * TIDAK boleh: item, induk, volume, jumlah – itu isi kontrak, dan mengubahnya
 * tetap lewat adendum.
 */
import { describe, expect, it } from "vitest";
import { bandingKoreksiBaca, type SimpulAktif } from "@/lib/rab/koreksi-baca";
import type { FlatNode } from "@/lib/rab/flatten";

const aktif: SimpulAktif[] = [
  { id: "k1", lineageKey: "I", parentLineageKey: null, kind: "kategori", code: "I", name: "PERSIAPAN", unit: null, volume: null, unitPrice: null, amount: 3_100_000n },
  { id: "i1", lineageKey: "I#1", parentLineageKey: "I", kind: "item", code: "1", name: "Bedeng", unit: "m2", volume: 2, unitPrice: 1_000_000, amount: 2_000_000n },
  { id: "i2", lineageKey: "I#2", parentLineageKey: "I", kind: "item", code: "2", name: "Skonengan", unit: "m1", volume: 10, unitPrice: null, amount: 1_100_000n },
];

const baru = (ubah: (n: FlatNode[]) => void = () => {}): FlatNode[] => {
  const ns: FlatNode[] = aktif.map((a, i) => ({
    kind: a.kind as FlatNode["kind"],
    code: a.code,
    name: a.name,
    unit: a.unit,
    volume: a.volume,
    unitPrice: a.lineageKey === "I#2" ? 110_000 : a.unitPrice,
    amount: a.amount,
    lineageKey: a.lineageKey,
    parentLineageKey: a.parentLineageKey,
    sortOrder: i,
    excelRow: null,
  }));
  ubah(ns);
  return ns;
};

describe("bandingKoreksiBaca", () => {
  it("harga satuan yang kosong terisi – boleh dibetulkan di tempat", () => {
    const h = bandingKoreksiBaca(aktif, baru());
    expect(h.boleh).toBe(true);
    if (!h.boleh) return;
    expect(h.hargaTerisi).toBe(1);
    expect(h.perubahan).toEqual([
      expect.objectContaining({ id: "i2", unitPrice: { dari: null, ke: 110_000 } }),
    ]);
  });

  it("isi sama persis: boleh, tanpa perubahan", () => {
    const sama = baru((ns) => (ns[2].unitPrice = null));
    const h = bandingKoreksiBaca(aktif, sama);
    expect(h).toMatchObject({ boleh: true, perubahan: [] });
  });

  it("satuan, nama, dan nomor yang terbaca beda ikut dibetulkan", () => {
    const h = bandingKoreksiBaca(
      aktif,
      baru((ns) => {
        ns[1].unit = "m²";
        ns[1].name = "Bedeng Pekerja";
      }),
    );
    expect(h.boleh).toBe(true);
    if (!h.boleh) return;
    expect(h.perubahan.find((p) => p.id === "i1")).toMatchObject({
      unit: { dari: "m2", ke: "m²" },
      name: { dari: "Bedeng", ke: "Bedeng Pekerja" },
    });
  });

  it("volume berubah – DITOLAK, itu adendum", () => {
    const h = bandingKoreksiBaca(aktif, baru((ns) => (ns[1].volume = 3)));
    expect(h.boleh).toBe(false);
    if (h.boleh) return;
    expect(h.sebab.join(" ")).toMatch(/volume.*Bedeng/i);
  });

  it("jumlah berubah – DITOLAK", () => {
    const h = bandingKoreksiBaca(aktif, baru((ns) => (ns[2].amount = 1_100_001n)));
    expect(h.boleh).toBe(false);
  });

  it("volume selisih pembulatan Decimal(15,3) masih dianggap sama", () => {
    const h = bandingKoreksiBaca(aktif, baru((ns) => (ns[1].volume = 2.0004)));
    expect(h.boleh).toBe(true);
  });

  it("item baru, item hilang, atau pindah induk – DITOLAK", () => {
    const tambah = baru((ns) =>
      ns.push({ ...ns[2], lineageKey: "I#3", code: "3", name: "Pagar", amount: 0n }),
    );
    expect(bandingKoreksiBaca(aktif, tambah).boleh).toBe(false);
    expect(bandingKoreksiBaca(aktif, baru((ns) => ns.pop())).boleh).toBe(false);
    expect(bandingKoreksiBaca(aktif, baru((ns) => (ns[2].parentLineageKey = null))).boleh).toBe(false);
    expect(bandingKoreksiBaca(aktif, baru((ns) => (ns[2].kind = "sub"))).boleh).toBe(false);
  });

  it("judul kelompok yang terbaca sebagai jenis lain (kategori → sub) ikut dibetulkan", () => {
    const h = bandingKoreksiBaca(aktif, baru((ns) => (ns[0].kind = "sub")));
    expect(h.boleh).toBe(true);
    if (!h.boleh) return;
    expect(h.perubahan.find((p) => p.id === "k1")).toMatchObject({ jenis: { dari: "kategori", ke: "sub" } });
  });

  it("harga satuan yang SUDAH ada lalu terbaca lain dihitung terpisah dari yang terisi", () => {
    const h = bandingKoreksiBaca(aktif, baru((ns) => (ns[1].unitPrice = 999_999.99)));
    expect(h.boleh).toBe(true);
    if (!h.boleh) return;
    expect(h.hargaTerisi).toBe(1);
    expect(h.hargaBerubah).toBe(1);
  });
});

/*
 * Laporan user 2026-10-16: impor ulang CCO Krakahan lewat "Jadikan RAB
 * AKTIF" TETAP jadi draft #3 – berkasnya tidak sama persis dengan RAB aktif
 * #2 (susunan barisnya berbeda), jadi perbaikan penuh ditolak. Padahal yang
 * perlu dibetulkan hanya harga satuan yang kosong, dan untuk item-item itu
 * volume serta jumlahnya cocok.
 */
describe("bandingKoreksiBaca – berkas tidak sama persis: harga kosong tetap bisa diisi", () => {
  it("item ber-harga kosong yang volume & jumlahnya cocok ikut ditawarkan, perbedaan lain tidak", () => {
    const h = bandingKoreksiBaca(
      aktif,
      baru((ns) => {
        ns[1].volume = 3; // beda isi kontrak di item lain
        ns.push({ ...ns[2], lineageKey: "I#9", code: "9", name: "Pagar", amount: 0n });
      }),
    );
    expect(h.boleh).toBe(false);
    if (h.boleh) return;
    expect(h.hargaKosong).toEqual([
      expect.objectContaining({ id: "i2", unitPrice: { dari: null, ke: 110_000 } }),
    ]);
  });

  it("identitas baris berbeda: dicocokkan lewat nama + volume + jumlah, bila tunggal", () => {
    const h = bandingKoreksiBaca(
      aktif,
      baru((ns) => {
        ns[2].lineageKey = "I#2b";
        ns[2].code = "2b";
      }),
    );
    expect(h.boleh).toBe(false);
    if (h.boleh) return;
    expect(h.hargaKosong.map((p) => p.id)).toEqual(["i2"]);
  });

  it("volume atau jumlah item itu sendiri berbeda – tidak diisi", () => {
    const h = bandingKoreksiBaca(aktif, baru((ns) => (ns[2].volume = 11)));
    expect(h.boleh).toBe(false);
    if (h.boleh) return;
    expect(h.hargaKosong).toEqual([]);
  });

  it("dua calon kembar (nama, volume, jumlah sama) – tidak ditebak", () => {
    const h = bandingKoreksiBaca(
      aktif,
      baru((ns) => {
        ns[2].lineageKey = "I#2b";
        ns.push({ ...ns[2], lineageKey: "I#2c", code: "2c" });
      }),
    );
    expect(h.boleh).toBe(false);
    if (h.boleh) return;
    expect(h.hargaKosong).toEqual([]);
  });
});
