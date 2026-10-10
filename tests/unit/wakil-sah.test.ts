/*
 * WAKIL SAH (user 2026-08-24): penanda tangan pihak KKP untuk laporan MINGGUAN
 * & BULANAN – dokumen lain tetap PPK. Bisa ditimpa per lokasi.
 *
 * Yang dijaga sama dengan DECISIONS 402/409: dokumen resmi tidak boleh
 * menyatakan orang yang tidak menekennya – blok diambil UTUH (nama + NIP +
 * coretan), tidak dicampur antar orang, dan coretan PPK tidak pernah dipakai
 * di slot Wakil Sah.
 */
import { describe, expect, it, vi } from "vitest";
import {
  asalWakilSah,
  labelPihakKkp,
  pihakKkp,
  pilihWakilSah,
  type SumberWakilSah,
} from "@/lib/laporan/penandatangan";

// ttd-laporan menyeret db → env wajib ada walau fungsinya murni.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});
const { pilihKunciTtd } = await import("@/lib/export/ttd-laporan");

const kontrak: SumberWakilSah = {
  wakilSahName: "Drs. Hartono",
  wakilSahNip: "19750101 200003 1 001",
  wakilSahTtdKey: "kontrak/x/wakilSahTtdKey.webp",
};

describe("pihak KKP per jenis dokumen", () => {
  // BANUSA 2026-10-10 (DECISIONS 662): harian, mingguan, Kurva S lokasi =
  // Wakil Sah PPK; bulanan kembali PPK.
  it("harian, mingguan, Kurva S lokasi = Wakil Sah PPK; lainnya PPK", () => {
    for (const jenis of ["harian", "mingguan", "jadwal"] as const) {
      expect(pihakKkp(jenis)).toBe("wakil_sah");
    }
    for (const jenis of ["bulanan", "mc", "cco", "rencana"] as const) {
      expect(pihakKkp(jenis)).toBe("ppk");
    }
  });

  it("labelnya mengikuti pihaknya", () => {
    expect(labelPihakKkp("mingguan")).toBe("WAKIL SAH PPK");
    expect(labelPihakKkp("bulanan")).toBe("PEJABAT PEMBUAT KOMITMEN");
  });
});

describe("pilihWakilSah – blok utuh, nama penentu", () => {
  it("lokasi tanpa nama sendiri mengikuti kontrak", () => {
    expect(pilihWakilSah(null, kontrak)).toEqual({
      nama: "Drs. Hartono",
      nip: "19750101 200003 1 001",
      ttdKey: "kontrak/x/wakilSahTtdKey.webp",
    });
    expect(asalWakilSah(null, kontrak)).toBe("kontrak");
  });

  it("lokasi yang menyebut nama sendiri membawa SELURUH bloknya – termasuk ketiadaan ttd", () => {
    const lokasi: SumberWakilSah = { wakilSahName: "Ibu Ratna", wakilSahNip: null, wakilSahTtdKey: null };
    expect(pilihWakilSah(lokasi, kontrak)).toEqual({ nama: "Ibu Ratna", nip: null, ttdKey: null });
    expect(asalWakilSah(lokasi, kontrak)).toBe("lokasi");
  });

  it("kosong di mana pun = blok kosong, bukan jatuh ke nama PPK", () => {
    expect(pilihWakilSah(null, null)).toEqual({ nama: null, nip: null, ttdKey: null });
    expect(asalWakilSah(null, null)).toBe("belum diisi");
  });
});

describe("pilihKunciTtd – slot KKP mengikuti pihaknya", () => {
  const dasar = {
    penyedia: "direktur" as const,
    konsultan: "pengawas_lapangan" as const,
    supervisorStempelKontrakKey: null,
    coTeamLeaderTtdKey: null,
    teamLeaderTtdKey: null,
    projectManagerTtdKey: null,
    pelaksanaTtdKey: null,
    ppkTtdKey: "kontrak/x/ppkTtdKey.webp",
    ppkStempelKey: "kontrak/x/ppkStempelKey.webp",
    wakilSahTtdKey: "kontrak/x/wakilSahTtdKey.webp",
    supervisorTtdKey: null,
    supervisorStempelKey: null,
    contractorTtdKey: null,
    contractorStempelKey: null,
    vendorStempelKey: null,
  };

  it("wakil_sah: coretan milik Wakil Sah, stempel tetap milik instansi (PPK)", () => {
    const k = pilihKunciTtd({ ...dasar, kkp: "wakil_sah" });
    expect(k.ppk.ttd).toBe("kontrak/x/wakilSahTtdKey.webp");
    expect(k.ppk.stempel).toBe("kontrak/x/ppkStempelKey.webp");
  });

  it("ppk: coretan PPK – dan coretan PPK tidak pernah dipinjam saat Wakil Sah kosong", () => {
    const k = pilihKunciTtd({ ...dasar, kkp: "ppk" });
    expect(k.ppk.ttd).toBe("kontrak/x/ppkTtdKey.webp");
    const tanpa = pilihKunciTtd({ ...dasar, kkp: "wakil_sah", wakilSahTtdKey: null });
    expect(tanpa.ppk.ttd).toBeNull();
  });
});
