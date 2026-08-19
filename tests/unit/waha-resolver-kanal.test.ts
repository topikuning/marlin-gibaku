import { describe, expect, it } from "vitest";
import { putuskanLayanan, peranIstimewa, type MasukanKeputusan } from "@/lib/waha/resolver-kanal";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * MATRIKS KANAL × IDENTITAS × SCOPE (DECISIONS 371, brief 5A 2026-08-19).
 *
 * Ini bagian paling berbahaya dari tanya-jawab WhatsApp: satu kesalahan di sini
 * bukan cacat tampilan, melainkan angka kontrak orang lain yang terkirim ke
 * grup yang salah — lewat saluran yang di-screenshot dan diteruskan.
 *
 * Seluruh invarian dari `lingkupJawaban()` yang lama dipindahkan ke sini apa
 * adanya, TERMASUK yang sengaja dibalik DECISIONS 351. Aturannya sekarang hidup
 * di satu tempat; kalau ujinya ditinggal di tempat lama, yang tersisa hanyalah
 * uji terhadap fungsi yang sudah tidak dipakai siapa pun.
 */

const dasar = (o: Partial<MasukanKeputusan> = {}): MasukanKeputusan => ({
  grup: false,
  diajakBicara: true,
  penanya: null,
  alasanIdentitas: "nomor tidak cocok dengan pengguna mana pun",
  paketGrup: null,
  ...o,
});

const orang = (role: UserRole, orgId = "org-1") => ({ id: `u-${role}`, orgId, role });

const PAKET = {
  id: "pkg-1",
  nama: "Paket Jateng 1",
  orgId: "org-1",
  lokasiIds: ["a", "b"],
};

describe("tidak diajak bicara", () => {
  it("grup tanpa mention → diam", () => {
    const k = putuskanLayanan(dasar({ grup: true, diajakBicara: false, paketGrup: PAKET }));
    expect(k.jenis).toBe("diam");
  });
});

describe("chat pribadi", () => {
  it("nomor TIDAK dikenal → DIAM, bukan 'Anda belum terdaftar'", () => {
    /*
     * Balasan apa pun mengonfirmasi bahwa nomor ini milik sistem proyek dan
     * mengundang percobaan berikutnya. Aturan 5A TIDAK mengubah ini.
     */
    const k = putuskanLayanan(dasar());
    expect(k.jenis).toBe("diam");
  });

  it("pengguna biasa → dijawab sesuai penugasannya", () => {
    const k = putuskanLayanan(dasar({ penanya: orang("site_manager") }));
    expect(k.jenis === "jawab" && k.asalScope).toBe("pengguna");
    // null = "hitung dari penugasannya", bukan "semua".
    expect(k.jenis === "jawab" && k.lokasiIds).toBeNull();
    expect(k.jenis === "jawab" && k.peranDipakai).toBeNull();
  });

  it("super admin & program director → dijawab, ditandai istimewa", () => {
    for (const role of ["super_admin", "program_director"] as UserRole[]) {
      const k = putuskanLayanan(dasar({ penanya: orang(role) }));
      expect(k.jenis === "jawab" && k.asalScope, role).toBe("privileged_user");
      expect(k.jenis === "jawab" && k.peranDipakai, role).toBe(role);
    }
  });

  it("scope peran istimewa TETAP dibatasi organisasinya", () => {
    // `super_admin` di MARLIN berarti "seluruh lokasi dalam organisasinya",
    // BUKAN seluruh basis data (brief 5A, ketentuan teknis).
    const k = putuskanLayanan(dasar({ penanya: orang("super_admin", "org-9") }));
    expect(k.jenis === "jawab" && k.orgId).toBe("org-9");
  });
});

describe("grup TERTAUT paket", () => {
  const grupTertaut = (o: Partial<MasukanKeputusan> = {}) =>
    putuskanLayanan(dasar({ grup: true, paketGrup: PAKET, ...o }));

  it("anggota TAK TERDAFTAR tetap dijawab – sesuai paket grup", () => {
    // DECISIONS 351: balasannya dikirim ke GRUP dan dibaca seluruh anggotanya,
    // jadi identitas si pengetik tidak menentukan siapa yang melihat jawabannya.
    const k = grupTertaut();
    expect(k.jenis === "jawab" && k.asalScope).toBe("package_group");
    expect(k.jenis === "jawab" && k.lokasiIds).toEqual(["a", "b"]);
  });

  it("pengguna biasa: scope TIDAK melebar diam-diam", () => {
    const k = grupTertaut({ penanya: orang("site_manager") });
    expect(k.jenis === "jawab" && k.lokasiIds).toEqual(["a", "b"]);
  });

  it("SUPER ADMIN pun tetap dipotong ke paket grup", () => {
    /*
     * Pagar yang paling gampang jebol saat aturan 5A ditambahkan. Melebarkan
     * jawaban hanya karena yang bertanya seorang direktur berarti data paket
     * lain terbaca oleh vendor paket ini — di grup yang sama persis.
     */
    for (const role of ["super_admin", "program_director"] as UserRole[]) {
      const k = grupTertaut({ penanya: orang(role) });
      expect(k.jenis === "jawab" && k.asalScope, role).toBe("package_group");
      expect(k.jenis === "jawab" && k.lokasiIds, role).toEqual(["a", "b"]);
      expect(k.jenis === "jawab" && k.penandaLingkup, role).toBeNull();
    }
  });

  it("pemotongan SELALU disebut, dan menyebut nama paketnya", () => {
    const k = grupTertaut();
    expect(k.jenis === "jawab" && k.catatanPemotongan).toContain("Paket Jateng 1");
    expect(k.jenis === "jawab" && k.catatanPemotongan).toContain("chat pribadi");
  });

  it("orgId berasal dari PAKET grup, bukan dari penanya", () => {
    // Penanya bisa dari organisasi lain (mis. salah petakan nomor). Yang
    // menentukan data apa yang boleh keluar adalah grupnya.
    const k = grupTertaut({ penanya: orang("super_admin", "org-lain") });
    expect(k.jenis === "jawab" && k.orgId).toBe("org-1");
  });

  it("scope grup SELALU persis paket grupnya – tidak kurang, tidak lebih", () => {
    // Invarian pengganti dari DECISIONS 351, dipindahkan apa adanya.
    for (const penanya of [
      null,
      orang("site_manager"),
      orang("project_manager"),
      orang("super_admin"),
      orang("wakil_ppk"),
    ]) {
      const k = grupTertaut({ penanya });
      expect(k.jenis === "jawab" && k.lokasiIds, String(penanya?.role)).toEqual(PAKET.lokasiIds);
    }
  });

  it("terdaftar TIDAK boleh melihat lebih sedikit daripada tak terdaftar", () => {
    // Pembalikan yang dihapus DECISIONS 351.
    const takTerdaftar = grupTertaut();
    const terdaftarTanpaTugas = grupTertaut({ penanya: orang("site_manager") });
    expect(terdaftarTanpaTugas.jenis === "jawab" && terdaftarTanpaTugas.lokasiIds).toEqual(
      takTerdaftar.jenis === "jawab" ? takTerdaftar.lokasiIds : null,
    );
  });
});

describe("grup TIDAK tertaut paket – aturan baru 5A", () => {
  const grupLepas = (o: Partial<MasukanKeputusan> = {}) =>
    putuskanLayanan(dasar({ grup: true, paketGrup: null, ...o }));

  it("anggota tak dikenal → ditolak, tanpa membuka data proyek", () => {
    const k = grupLepas();
    expect(k.jenis).toBe("tolak");
    expect(k.jenis === "tolak" && k.pesan).toContain("belum tertaut paket");
  });

  it("pengguna BIASA terdaftar pun ditolak", () => {
    // Pengecualian hanya untuk dua peran; terdaftar saja tidak cukup.
    for (const role of [
      "site_manager",
      "project_manager",
      "regional_manager",
      "exec_viewer",
      "field_supervisor",
      "wakil_ppk",
    ] as UserRole[]) {
      expect(grupLepas({ penanya: orang(role) }).jenis, role).toBe("tolak");
    }
  });

  it("super admin & program director TERVERIFIKASI dijawab, dengan lingkup organisasinya", () => {
    for (const role of ["super_admin", "program_director"] as UserRole[]) {
      const k = grupLepas({ penanya: orang(role, "org-7") });
      expect(k.jenis, role).toBe("jawab");
      expect(k.jenis === "jawab" && k.asalScope, role).toBe("privileged_user");
      expect(k.jenis === "jawab" && k.orgId, role).toBe("org-7");
      expect(k.jenis === "jawab" && k.lokasiIds, role).toBeNull();
    }
  });

  it("penanda lingkup WAJIB ada, dan menyebut perannya", () => {
    /*
     * Anggota grup lain melihat data proyek muncul di grup yang tidak tertaut
     * paket apa pun. Tanpa penanda, satu-satunya kesimpulan yang masuk akal
     * bagi mereka adalah "bot ini membocorkan data ke grup mana saja".
     */
    const k = grupLepas({ penanya: orang("program_director") });
    expect(k.jenis === "jawab" && k.penandaLingkup).toContain("Program Director");
    expect(k.jenis === "jawab" && k.penandaLingkup).toContain("tidak tertaut paket");
  });

  it("identitas yang TIDAK pasti tidak pernah jadi peran istimewa", () => {
    /*
     * `penanya: null` mewakili semua keadaan yang bukan identitas: nomor tak
     * dikenal, nomor dipakai dua pengguna, pengguna nonaktif, LID tak
     * terpetakan — dan juga nama tampilan WhatsApp yang meniru direktur, karena
     * nama tampilan tidak pernah sampai ke sini sebagai identitas.
     */
    expect(grupLepas({ penanya: null }).jenis).toBe("tolak");
  });
});

describe("peranIstimewa", () => {
  it("hanya super_admin dan program_director", () => {
    const semua: UserRole[] = [
      "super_admin",
      "program_director",
      "regional_manager",
      "project_manager",
      "site_manager",
      "field_supervisor",
      "exec_viewer",
      "wakil_ppk",
    ];
    expect(semua.filter(peranIstimewa)).toEqual(["super_admin", "program_director"]);
  });
});
