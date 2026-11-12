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
  siapaMenekenApa,
  slotPenandatanganKosong,
  MEDAN_SLOT,
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
      { jabatan: "Koordinator Team Leader", pihak: "koordinator_tl", dokumen: ["Laporan progres mingguan", "Kurva S lokasi"] },
      {
        jabatan: "Manajer Proyek",
        pihak: "manajer_proyek",
        dokumen: ["Laporan progres mingguan", "Laporan progres bulanan", "Kurva S lokasi"],
      },
      { jabatan: "Pelaksana Lapangan", pihak: "pelaksana", dokumen: ["Laporan harian"] },
    ]);
  });

  /*
   * DECISIONS 758 – permintaan user 2026-11-11: *"ini yang belum terisi
   * seharusnya tinggal klik yang mana, lalu masuk pilihan inputan nama dan
   * ttdnya"*. Tiap slot kosong membawa PIHAK-nya, dan tiap pihak tahu kolom
   * nama + tanda tangannya – supaya isian cepat menulis ke kolom yang SAMA
   * dengan yang dibaca cetakannya.
   */
  it("tiap pihak punya kolom nama & tanda tangan yang dibaca cetakan", () => {
    const kosongSemua = Object.fromEntries(Object.keys(LENGKAP).map((k) => [k, null])) as unknown as NamaPenandatangan;
    const slot = slotPenandatanganKosong({ ...kosongSemua, vendorName: "PT X" });
    expect(slot.length).toBeGreaterThan(0);
    for (const s of slot) expect(MEDAN_SLOT[s.pihak], s.jabatan).toBeDefined();
    // Nama yang ditulis isian cepat = nama yang dibaca cetakan.
    for (const s of slot) {
      const terisi = { ...kosongSemua, vendorName: "PT X", [MEDAN_SLOT[s.pihak].nama]: "Orang Uji" } as NamaPenandatangan;
      expect(slotPenandatanganKosong(terisi).map((x) => x.pihak), s.jabatan).not.toContain(s.pihak);
    }
    expect(MEDAN_SLOT.pelaksana.di).toBe("paket");
    expect(MEDAN_SLOT.team_leader).toEqual({ nama: "teamLeaderName", ttd: "teamLeaderTtdKey", di: "kontrak" });
  });

  it("semua terisi → tidak ada peringatan", () => {
    expect(slotPenandatanganKosong(LENGKAP)).toEqual([]);
  });
});

/*
 * KURVA S PAKET – gabungan seluruh lokasi (DECISIONS 764). Keberatan user
 * 2026-11-12: *"kenapa kumulatif seluruh lokasi dalam satu kontrak pakai satu
 * wsp, kalau betul satu wsp tidak masalah, tapi kalau banyak orang kan jadi
 * kendala. seharusnya cukup pelaksana dan ppk saja."*
 */
describe("Kurva S paket: PPK dan penyedia saja", () => {
  it("PPK kontrak (bukan Wakil Sah lokasi), Manajer Proyek kontrak, TANPA konsultan", () => {
    expect(pihakKkp("kurva_paket")).toBe("ppk");
    expect(pihakPenyedia("kurva_paket")).toBe("manajer_proyek");
    expect(pihakKonsultan("kurva_paket")).toBeNull();
    const t = penandatanganDokumen("kurva_paket", LENGKAP);
    expect(t.kkp).toMatchObject({ pihak: "Pejabat Pembuat Komitmen", nama: "Ir. Pejabat Komitmen", sub: "NIP. 19700101" });
    expect(t.konsultan).toBeNull();
    expect(t.penyedia).toMatchObject({ nama: "Manajer Proyek Satu", sub: "Manajer Proyek" });
    expect(labelPihakKkp("kurva_paket")).toBe("PEJABAT PEMBUAT KOMITMEN");
  });

  it("Kurva S LOKASI tidak berubah: tetap Wakil Sah – Koordinator TL – Manajer Proyek", () => {
    const t = penandatanganDokumen("jadwal", LENGKAP);
    expect([t.kkp.nama, t.konsultan.nama, t.penyedia.nama]).toEqual(["Wakil Sah Satu", "Koordinator Wilayah", "Manajer Proyek Satu"]);
  });

  it("gambar: coretan PPK, tidak ada gambar konsultan", () => {
    const k = pilihKunciTtd({
      wakilSahTtdKey: "ttd-wsp",
      pelaksanaTtdKey: "ttd-pelaksana",
      ppkTtdKey: "ttd-ppk",
      ppkStempelKey: "stempel-kkp",
      supervisorTtdKey: "ttd-pengawas",
      supervisorStempelKey: "stempel-pengawas",
      supervisorStempelKontrakKey: "stempel-banusa",
      coTeamLeaderTtdKey: "ttd-kortl",
      teamLeaderTtdKey: "ttd-tl",
      projectManagerTtdKey: "ttd-pm",
      contractorTtdKey: "ttd-direktur",
      contractorStempelKey: "stempel-cv",
      vendorStempelKey: null,
      kkp: pihakKkp("kurva_paket"),
      konsultan: pihakKonsultan("kurva_paket"),
      penyedia: pihakPenyedia("kurva_paket"),
    });
    expect(k.ppk).toEqual({ ttd: "ttd-ppk", stempel: "stempel-kkp" });
    expect(k.pengawas).toEqual({ ttd: null, stempel: null });
    expect(k.penyedia).toEqual({ ttd: "ttd-pm", stempel: "stempel-cv" });
  });

  it("tampil di tabel siapa meneken apa, kolom konsultan '–'", () => {
    expect(siapaMenekenApa().find((r) => r.label.startsWith("Kurva S paket"))).toEqual({
      label: "Kurva S paket (gabungan lokasi)",
      kkp: "PPK",
      konsultan: "–",
      penyedia: "Manajer Proyek",
    });
  });

  it("peringatan penanda tangan kosong tetap hanya dari dokumen lokasi", () => {
    const kosong = slotPenandatanganKosong({ ...LENGKAP, coTeamLeaderName: null });
    expect(kosong.flatMap((s) => s.dokumen)).not.toContain("Kurva S paket (gabungan lokasi)");
  });
});

