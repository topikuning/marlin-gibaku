// SIAPA MENEKEN DOKUMEN MANA – menurut Team Leader pengawas BANUSA (2026-10-10).
//
//   1. Laporan Harian            : Wakil Sah PPK – Pengawas Lapangan – Pelaksana
//   2. Laporan Progres Mingguan  : Wakil Sah PPK – Koordinator Team Leader – Manajer Proyek
//   3. Laporan Progres Bulanan   : PPK – Team Leader – Manajer Proyek
//   4. Kurva S per desa/lokasi   : Wakil Sah PPK – Koordinator Team Leader – Manajer Proyek
//
// User: "WSP itu Wakil Sah PPK, PM Project Manager (ganti istilah resmi
// Indonesia), CoTL Koordinator Team Leader, TL Team Leader".
import { describe, expect, it } from "vitest";
import {
  labelPihakKkp,
  penandatanganDokumen,
  pihakKkp,
  pihakKonsultan,
  pihakPenyedia,
  pilihKoordinatorTl,
  slotPenandatanganKosong,
  type NamaPenandatangan,
} from "@/lib/laporan/penandatangan";
import { pilihKunciTtd } from "@/lib/export/ttd-laporan";

const LENGKAP: NamaPenandatangan = {
  ppkName: "Ir. Pejabat Komitmen",
  ppkNip: "19700101",
  wakilSahName: "Wakil Sah Satu",
  wakilSahNip: "19800202",
  supervisorName: "Pengawas Desa",
  supervisorFirm: "PT Banusa",
  supervisorFirmKontrak: "PT Banusa",
  coTeamLeaderName: "Koordinator Wilayah",
  teamLeaderName: "Ketua Tim",
  vendorName: "CV Bumijaya",
  contractorSignerName: "Direktur Utama",
  contractorSignerTitle: "Direktur",
  projectManagerName: "Manajer Proyek Satu",
  pelaksanaName: "Pak Pelaksana",
  pelaksanaTitle: "Pelaksana Lapangan",
};

describe("pihak per dokumen (BANUSA)", () => {
  it.each([
    ["harian", "wakil_sah", "pengawas_lapangan", "pelaksana"],
    ["mingguan", "wakil_sah", "koordinator_tl", "manajer_proyek"],
    ["bulanan", "ppk", "team_leader", "manajer_proyek"],
    ["jadwal", "wakil_sah", "koordinator_tl", "manajer_proyek"],
  ] as const)("%s → %s · %s · %s", (jenis, kkp, konsultan, penyedia) => {
    expect(pihakKkp(jenis)).toBe(kkp);
    expect(pihakKonsultan(jenis)).toBe(konsultan);
    expect(pihakPenyedia(jenis)).toBe(penyedia);
  });

  it("dokumen di luar daftar BANUSA tidak berubah", () => {
    expect([pihakKkp("rencana"), pihakPenyedia("rencana")]).toEqual(["ppk", "direktur"]);
    expect([pihakKkp("cco"), pihakPenyedia("cco")]).toEqual(["ppk", "direktur"]);
    expect([pihakKkp("mc"), pihakPenyedia("mc")]).toEqual(["ppk", "direktur"]);
  });

  it("slot KKP menyebut Wakil Sah PPK", () => {
    expect(labelPihakKkp("harian")).toBe("WAKIL SAH PPK");
    expect(labelPihakKkp("bulanan")).toBe("PEJABAT PEMBUAT KOMITMEN");
  });
});

describe("penandatanganDokumen", () => {
  it("laporan harian: Wakil Sah PPK – Pengawas Lapangan – Pelaksana", () => {
    const t = penandatanganDokumen("harian", LENGKAP);
    expect(t.kkp).toMatchObject({ pihak: "Wakil Sah PPK", nama: "Wakil Sah Satu", sub: "NIP. 19800202" });
    expect(t.konsultan).toMatchObject({ pihak: "Konsultan Pengawas", instansi: "PT Banusa", nama: "Pengawas Desa", sub: "Pengawas Lapangan" });
    expect(t.penyedia).toMatchObject({ pihak: "Penyedia Jasa", instansi: "CV Bumijaya", nama: "Pak Pelaksana", sub: "Pelaksana Lapangan" });
  });

  it("laporan mingguan dan Kurva S lokasi: Wakil Sah PPK – Koordinator Team Leader – Manajer Proyek", () => {
    for (const jenis of ["mingguan", "jadwal"] as const) {
      const t = penandatanganDokumen(jenis, LENGKAP);
      expect(t.kkp.nama).toBe("Wakil Sah Satu");
      expect(t.konsultan).toMatchObject({ nama: "Koordinator Wilayah", sub: "Koordinator Team Leader", instansi: "PT Banusa" });
      expect(t.penyedia).toMatchObject({ nama: "Manajer Proyek Satu", sub: "Manajer Proyek" });
    }
  });

  it("laporan bulanan: PPK – Team Leader – Manajer Proyek", () => {
    const t = penandatanganDokumen("bulanan", LENGKAP);
    expect(t.kkp).toMatchObject({ pihak: "Pejabat Pembuat Komitmen", nama: "Ir. Pejabat Komitmen", sub: "NIP. 19700101" });
    expect(t.konsultan).toMatchObject({ nama: "Ketua Tim", sub: "Team Leader" });
    expect(t.penyedia).toMatchObject({ nama: "Manajer Proyek Satu", sub: "Manajer Proyek" });
  });

  it("yang belum diisi tercetak kosong untuk ditandatangani tangan – tidak pernah jatuh ke orang lain", () => {
    const t = penandatanganDokumen("mingguan", { ...LENGKAP, coTeamLeaderName: null, projectManagerName: "  " });
    // Bukan pengawas lapangan, bukan pelaksana, bukan direktur.
    expect(t.konsultan).toMatchObject({ nama: null, sub: "Koordinator Team Leader" });
    expect(t.penyedia).toMatchObject({ nama: null, sub: "Manajer Proyek" });
  });

  it("Team Leader & Koordinator TL atas nama firma kontrak, bukan firma pengawas lokasi", () => {
    const t = penandatanganDokumen("bulanan", { ...LENGKAP, supervisorFirm: "PT Lain" });
    expect(t.konsultan.instansi).toBe("PT Banusa");
    expect(penandatanganDokumen("harian", { ...LENGKAP, supervisorFirm: "PT Lain" }).konsultan.instansi).toBe("PT Lain");
  });
});

describe("Koordinator Team Leader per lokasi", () => {
  const kontrak = { coTeamLeaderName: "Koordinator Kontrak", coTeamLeaderTtdKey: "ttd-kontrak" };
  it("lokasi menimpa kontrak sebagai SATU BLOK – coretan tidak pernah dipinjam", () => {
    expect(pilihKoordinatorTl({ coTeamLeaderName: "Koordinator Lokasi", coTeamLeaderTtdKey: null }, kontrak)).toEqual({
      nama: "Koordinator Lokasi",
      ttdKey: null,
    });
    expect(pilihKoordinatorTl({ coTeamLeaderName: "", coTeamLeaderTtdKey: "x" }, kontrak)).toEqual({
      nama: "Koordinator Kontrak",
      ttdKey: "ttd-kontrak",
    });
    expect(pilihKoordinatorTl(null, null)).toEqual({ nama: null, ttdKey: null });
  });
});

describe("gambar tanda tangan mengikuti orangnya", () => {
  const dasar = {
    wakilSahTtdKey: "ttd-wsp",
    pelaksanaTtdKey: "ttd-pelaksana",
    ppkTtdKey: "ttd-ppk",
    ppkStempelKey: "stempel-kkp",
    supervisorTtdKey: "ttd-pengawas",
    supervisorStempelKey: null,
    supervisorStempelKontrakKey: "stempel-banusa",
    coTeamLeaderTtdKey: "ttd-kortl",
    teamLeaderTtdKey: "ttd-tl",
    projectManagerTtdKey: "ttd-pm",
    contractorTtdKey: "ttd-direktur",
    contractorStempelKey: "stempel-cv",
    vendorStempelKey: null,
  };
  it.each([
    ["harian", "ttd-wsp", "ttd-pengawas", null, "ttd-pelaksana"],
    ["mingguan", "ttd-wsp", "ttd-kortl", "stempel-banusa", "ttd-pm"],
    ["bulanan", "ttd-ppk", "ttd-tl", "stempel-banusa", "ttd-pm"],
    ["jadwal", "ttd-wsp", "ttd-kortl", "stempel-banusa", "ttd-pm"],
  ] as const)("%s", (jenis, kkp, konsultan, stempelKonsultan, penyedia) => {
    const k = pilihKunciTtd({ ...dasar, kkp: pihakKkp(jenis), konsultan: pihakKonsultan(jenis), penyedia: pihakPenyedia(jenis) });
    expect(k.ppk.ttd).toBe(kkp);
    expect(k.pengawas).toEqual({ ttd: konsultan, stempel: stempelKonsultan });
    expect(k.penyedia).toEqual({ ttd: penyedia, stempel: "stempel-cv" });
  });
});

describe("peringatan penanda tangan yang belum diisi", () => {
  it("menyebut jabatan yang kosong berikut dokumen yang terdampak", () => {
    expect(
      slotPenandatanganKosong({ ...LENGKAP, coTeamLeaderName: null, projectManagerName: "", pelaksanaName: null }),
    ).toEqual([
      { jabatan: "Koordinator Team Leader", dokumen: ["Laporan progres mingguan", "Kurva S lokasi"] },
      { jabatan: "Manajer Proyek", dokumen: ["Laporan progres mingguan", "Laporan progres bulanan", "Kurva S lokasi"] },
      { jabatan: "Pelaksana Lapangan", dokumen: ["Laporan harian"] },
    ]);
  });

  it("semua terisi → tidak ada peringatan", () => {
    expect(slotPenandatanganKosong(LENGKAP)).toEqual([]);
  });
});
