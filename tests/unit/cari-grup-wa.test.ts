/*
 * PENCARIAN DI DAFTAR GRUP WHATSAPP (DECISIONS 747).
 *
 * Keluhan user 2026-11-06: *"muat data group ini juga menyusahkan pencarian,
 * jika jumlah group sudah banyak."* Nomor MARLIN ikut di banyak grup (antar
 * provinsi, PSC, koordinasi), dan daftar "Cara 1" hanya bisa digulung.
 *
 * Nama grup ditulis bebas oleh orang: "KNMP JAWA - CV. WAPIKE BALI - DESA
 * SUMBEREJO, KAB. JEMBER, PROV. JAWA TIMUR". Pencarian harus cocok per KATA,
 * dalam urutan apa pun, tanpa peduli huruf besar dan tanda baca – mengetik
 * "jember sumberejo" wajib menemukannya.
 */
import { describe, expect, it } from "vitest";
import { kataKunciKabupaten, saringGrupWa } from "@/lib/waha/cari-grup";

const g = (name: string, id = `1203${Math.random().toString().slice(2, 14)}@g.us`) => ({ id, name });

const DAFTAR = [
  g("KNMP JAWA - CV. WAPIKE BALI - DESA SUMBEREJO, KAB. JEMBER, PROV. JAWA TIMUR", "120363412508143247@g.us"),
  g("[Grup Inti] PSC KKP KAb LINGGA", "120363410443924779@g.us"),
  g("Koordinasi WSP KNMP Bitung", "120363428839680470@g.us"),
  g("KNMP JAWA - CV. MITRA ERACO - DESA BUNIASIH, SUKABUMI, JAWA BARAT", "120363410235750065@g.us"),
  g("KNMP Minahasa Utara – Progres", "120363400000000001@g.us"),
];

describe("saringGrupWa – cocok per kata, urutan bebas", () => {
  it("kata dalam urutan terbalik tetap cocok", () => {
    const hasil = saringGrupWa(DAFTAR, "jember sumberejo");
    expect(hasil.map((x) => x.id)).toEqual(["120363412508143247@g.us"]);
  });

  it("huruf besar & tanda baca tidak menghalangi", () => {
    expect(saringGrupWa(DAFTAR, "kab lingga")).toHaveLength(1);
    expect(saringGrupWa(DAFTAR, "KAB. LINGGA")).toHaveLength(1);
    expect(saringGrupWa(DAFTAR, "cv mitra-eraco")).toHaveLength(1);
  });

  it("SEMUA kata wajib ada – bukan salah satu", () => {
    // "knmp" saja cocok empat grup; "knmp bitung" hanya satu.
    expect(saringGrupWa(DAFTAR, "knmp")).toHaveLength(4);
    expect(saringGrupWa(DAFTAR, "knmp bitung").map((x) => x.name)).toEqual(["Koordinasi WSP KNMP Bitung"]);
  });

  it("potongan ID grup juga bisa dicari", () => {
    expect(saringGrupWa(DAFTAR, "4108443924779")).toHaveLength(0);
    expect(saringGrupWa(DAFTAR, "10443924779").map((x) => x.id)).toEqual(["120363410443924779@g.us"]);
  });

  it("kotak kosong = semua grup, diurutkan menurut nama", () => {
    const semua = saringGrupWa(DAFTAR, "   ");
    expect(semua).toHaveLength(DAFTAR.length);
    expect(semua[0].name.startsWith("[Grup Inti]")).toBe(true);
    expect(semua.at(-1)!.name).toBe("Koordinasi WSP KNMP Bitung");
  });

  it("tidak mengubah daftar aslinya", () => {
    const salinan = DAFTAR.map((x) => x.id);
    saringGrupWa(DAFTAR, "");
    expect(DAFTAR.map((x) => x.id)).toEqual(salinan);
  });
});

describe("kataKunciKabupaten – isian awal pencarian di form grup kabupaten", () => {
  it("awalan Kabupaten/Kab./Kota dibuang, sisanya dipertahankan", () => {
    expect(kataKunciKabupaten("Kabupaten Minahasa Utara")).toBe("Minahasa Utara");
    expect(kataKunciKabupaten("Kab. Jember")).toBe("Jember");
    expect(kataKunciKabupaten("KAB LINGGA")).toBe("LINGGA");
    expect(kataKunciKabupaten("Kota Bitung")).toBe("Bitung");
    expect(kataKunciKabupaten("Kota Administrasi Jakarta Utara")).toBe("Jakarta Utara");
  });

  it("nama tanpa awalan dipakai apa adanya", () => {
    expect(kataKunciKabupaten("Minahasa Utara")).toBe("Minahasa Utara");
    expect(kataKunciKabupaten("  Bolaang Mongondow  ")).toBe("Bolaang Mongondow");
  });

  it("dan isian itu memang menemukan grupnya", () => {
    expect(saringGrupWa(DAFTAR, kataKunciKabupaten("Kota Bitung"))).toHaveLength(1);
    expect(saringGrupWa(DAFTAR, kataKunciKabupaten("Kabupaten Minahasa Utara"))).toHaveLength(1);
  });
});
