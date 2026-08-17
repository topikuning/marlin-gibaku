// IZIN TANYA-JAWAB WHATSAPP BEBAS (DECISIONS 338).
//
// Berkas ini menjaga bagian paling berbahaya dari fitur itu. Kebocoran di sini
// bukan kesalahan tampilan: ia mengirim angka kontrak orang lain ke telepon
// yang salah, lewat saluran yang di-screenshot dan diteruskan — dan tidak ada
// cara menariknya kembali.
//
// Tiga pertanyaan yang dijaga TERPISAH:
//
//  1. Apakah MARLIN diajak bicara? (grup: hanya bila di-mention)
//  2. Siapa penanyanya? (nomor, BUKAN nama tampilan)
//  3. Apa yang boleh disebut di sana? — pertanyaan yang TIDAK selesai oleh (1).
//     Mention menjawab "kapan membalas", bukan "apa yang boleh dibocorkan".
import { describe, expect, it } from "vitest";
import {
  bersihkanMention,
  cocokkanNomorPengguna,
  diajakBicara,
  lingkupJawaban,
  niatLintasLokasi,
  type AsalPesan,
} from "@/lib/waha/tanya-izin";
import { normalizeWaTarget, nomorWaUntukTampil } from "@/lib/contacts/model";

const MARLIN = { nomor: "6281200000000" };

function pesan(p: Partial<AsalPesan> = {}): AsalPesan {
  return {
    grup: false,
    senderJid: "6281999@c.us",
    fromNumber: "6281999",
    mentionedJids: [],
    body: "ada kendala apa hari ini",
    ...p,
  };
}

describe("kapan MARLIN menjawab", () => {
  it("chat pribadi: selalu dilayani", () => {
    expect(diajakBicara(pesan({ grup: false }), MARLIN)).toBe(true);
  });

  it("grup tanpa mention: DIAM", () => {
    // Tanpa ini MARLIN akan menjawab setiap obrolan grup — dan grup lapangan
    // ramai sepanjang hari.
    expect(diajakBicara(pesan({ grup: true, mentionedJids: [] }), MARLIN)).toBe(false);
  });

  it("grup dengan mention ke MARLIN: dilayani", () => {
    expect(
      diajakBicara(pesan({ grup: true, mentionedJids: ["6281200000000@c.us"] }), MARLIN),
    ).toBe(true);
  });

  it("mention ke orang LAIN tidak menghitung", () => {
    expect(
      diajakBicara(pesan({ grup: true, mentionedJids: ["6285711111111@c.us"] }), MARLIN),
    ).toBe(false);
  });

  it("format nomor berbeda tetap cocok", () => {
    // WAHA bisa mengirim JID dengan/ tanpa suffix, dan nomor tersimpan bisa
    // ber-format lokal. Perbandingan lewat normalizePhone.
    for (const j of ["6281200000000@c.us", "6281200000000@s.whatsapp.net", "6281200000000"]) {
      expect(diajakBicara(pesan({ grup: true, mentionedJids: [j] }), MARLIN), j).toBe(true);
    }
  });

  it("menulis '@marlin' di teks TIDAK cukup — penyebutan dibaca dari JID", () => {
    // Nama tampilan bisa diubah siapa saja; JID tidak. Kalau teks yang dipercaya,
    // siapa pun bisa memancing balasan dengan mengetik nama.
    expect(
      diajakBicara(pesan({ grup: true, body: "@marlin ada kendala apa", mentionedJids: [] }), MARLIN),
    ).toBe(false);
  });

  it("nomor MARLIN belum diketahui → grup TIDAK dilayani", () => {
    // Lebih baik diam daripada membalas setiap pesan grup.
    expect(diajakBicara(pesan({ grup: true, mentionedJids: ["628@c.us"] }), { nomor: null })).toBe(
      false,
    );
    // Chat pribadi tetap jalan — di sana tidak ada ambiguitas "diajak bicara".
    expect(diajakBicara(pesan({ grup: false }), { nomor: null })).toBe(true);
  });
});

describe("membersihkan penyebutan dari badan pesan", () => {
  it("nomor yang di-mention dibuang, pertanyaannya utuh", () => {
    expect(bersihkanMention("@6281200000000 ada kendala apa hari ini")).toBe(
      "ada kendala apa hari ini",
    );
  });

  it("beberapa mention sekaligus", () => {
    expect(bersihkanMention("@628120000 @628579999 progress hari ini")).toBe("progress hari ini");
  });

  it("tidak merusak pesan tanpa mention", () => {
    expect(bersihkanMention("kendala di Kedung Mutih")).toBe("kendala di Kedung Mutih");
  });

  it("angka biasa TIDAK ikut terbuang", () => {
    // "minggu 12" bukan mention. Kalau ikut terbuang, niatnya jadi salah.
    expect(bersihkanMention("progress minggu 12 di Tengket")).toBe("progress minggu 12 di Tengket");
  });
});

describe("apa yang boleh disebut — TIDAK selesai oleh mention", () => {
  it("chat pribadi: seluruh lingkup penggunanya", () => {
    const l = lingkupJawaban({
      grup: false,
      lokasiPengguna: ["a", "b"],
      lokasiGrup: null,
      namaPaketGrup: null,
    });
    expect(l).toEqual({ boleh: true, lokasiIds: ["a", "b"], catatanPemotongan: null });
  });

  it("chat pribadi super admin: lintas lokasi", () => {
    const l = lingkupJawaban({
      grup: false,
      lokasiPengguna: null,
      lokasiGrup: null,
      namaPaketGrup: null,
    });
    expect(l.boleh && l.lokasiIds).toBeNull();
  });

  it("GRUP: jawaban dipotong ke lokasi paket grup itu saja", () => {
    // Inti pagar ini. Tanpa potongan, pertanyaan "mana yang deviasinya negatif"
    // di grup Paket A akan menyebut Paket B dan C ke seluruh anggota grup A —
    // termasuk vendornya.
    const l = lingkupJawaban({
      grup: true,
      lokasiPengguna: ["a", "b", "c", "d"],
      lokasiGrup: ["a", "b"],
      namaPaketGrup: "Paket Jateng 1",
    });
    expect(l.boleh && l.lokasiIds).toEqual(["a", "b"]);
  });

  it("super admin pun DIPOTONG di grup", () => {
    // Izin penanya tidak menaikkan apa yang pantas dibaca ANGGOTA GRUP.
    const l = lingkupJawaban({
      grup: true,
      lokasiPengguna: null,
      lokasiGrup: ["a"],
      namaPaketGrup: "Paket X",
    });
    expect(l.boleh && l.lokasiIds).toEqual(["a"]);
  });

  it("pemotongan SELALU disebutkan di balasan", () => {
    // Jawaban sebagian yang tidak mengaku sebagian akan dibaca lengkap.
    const l = lingkupJawaban({
      grup: true,
      lokasiPengguna: null,
      lokasiGrup: ["a"],
      namaPaketGrup: "Paket X",
    });
    expect(l.boleh && l.catatanPemotongan).toContain("Paket X");
    expect(l.boleh && l.catatanPemotongan).toContain("chat pribadi");
  });

  it("grup yang tidak tertaut paket TIDAK dilayani", () => {
    // Tanpa tautan, tidak ada dasar memutuskan apa yang pantas dibaca anggotanya.
    for (const lokasiGrup of [null, []]) {
      const l = lingkupJawaban({
        grup: true,
        lokasiPengguna: null,
        lokasiGrup,
        namaPaketGrup: null,
      });
      expect(l.boleh).toBe(false);
    }
  });

  it("penanya tanpa akses ke paket grup: ditolak, bukan dijawab sebagian", () => {
    const l = lingkupJawaban({
      grup: true,
      lokasiPengguna: ["z"],
      lokasiGrup: ["a", "b"],
      namaPaketGrup: "Paket X",
    });
    expect(l.boleh).toBe(false);
  });

  it("lingkup akhir SELALU himpunan bagian dari izin penanya", () => {
    // Invarian yang paling penting: tiap lapis boleh MEMPERSEMPIT, tidak pernah
    // melebarkan. Diuji atas banyak kombinasi sekaligus.
    const kombinasi = [
      { pengguna: ["a", "b"], grupL: ["b", "c"] },
      { pengguna: ["a"], grupL: ["a"] },
      { pengguna: ["a", "b", "c"], grupL: ["a"] },
    ];
    for (const k of kombinasi) {
      const l = lingkupJawaban({
        grup: true,
        lokasiPengguna: k.pengguna,
        lokasiGrup: k.grupL,
        namaPaketGrup: "P",
      });
      if (l.boleh && l.lokasiIds) {
        for (const id of l.lokasiIds) {
          expect(k.pengguna).toContain(id);
          expect(k.grupL).toContain(id);
        }
      }
    }
  });
});

describe("niat lintas lokasi", () => {
  it("tanpa lokasi disebut = lintas lokasi", () => {
    expect(niatLintasLokasi(null)).toBe(true);
    expect(niatLintasLokasi([])).toBe(true);
  });

  it("menyebut lokasi = bukan lintas lokasi", () => {
    expect(niatLintasLokasi(["a"])).toBe(false);
  });
});

describe("mencocokkan nomor pengirim ke pengguna", () => {
  const u = (id: string, waNumber: string | null, phone: string | null = null) => ({
    id,
    waNumber,
    phone,
  });

  it("COCOK dengan bentuk yang BENAR-BENAR disimpan sistem (…@c.us)", () => {
    /*
     * Inti berkas ini, dan cacat yang membuat fitur ini diam total di produksi.
     * `waNumber` ditulis lewat `normalizeWaTarget`, yang menghasilkan
     * "628…@c.us" — LENGKAP DENGAN SUFIKS. Versi pertama pencocok ini merakit
     * varian teks polos ("62…", "+62…", "0…") lalu mencarinya dengan `IN`,
     * sehingga TIDAK PERNAH cocok. Seluruh pengguna jadi tak dikenali, dan chat
     * pribadi dari nomor tak dikenal memang sengaja didiamkan — gejalanya
     * "tidak ada respon sama sekali", tanpa satu pun galat.
     *
     * Nilai harapannya sengaja dihitung lewat `normalizeWaTarget` yang ASLI,
     * bukan ditulis tangan: kalau bentuk simpanannya berubah suatu saat, uji
     * ini ikut berubah bersamanya alih-alih membeku pada bentuk lama.
     */
    const tersimpan = normalizeWaTarget("0812-3456-7890");
    expect(tersimpan, "bentuk simpanan berubah — periksa pencocok").toContain("@c.us");
    const r = cocokkanNomorPengguna([u("a", tersimpan)], "6281234567890");
    expect(r).toEqual({ jenis: "tepat", id: "a" });
  });

  it("cocok lintas SEGALA bentuk penulisan, di kedua kolom", () => {
    // Nomor telepon tidak pernah boleh dibandingkan sebagai teks.
    for (const disimpan of [
      "6281234567890",
      "+6281234567890",
      "081234567890",
      "0812-3456-7890",
      "+62 812 3456 7890",
      "6281234567890@c.us",
      "6281234567890@s.whatsapp.net",
    ]) {
      expect(cocokkanNomorPengguna([u("a", disimpan)], "6281234567890"), disimpan).toEqual({
        jenis: "tepat",
        id: "a",
      });
      // Kolom `phone` sama sekali tidak dinormalisasi saat disimpan, jadi ia
      // justru yang paling beragam bentuknya.
      expect(cocokkanNomorPengguna([u("b", null, disimpan)], "081234567890"), disimpan).toEqual({
        jenis: "tepat",
        id: "b",
      });
    }
  });

  it("nomor yang BERBEDA tidak boleh cocok", () => {
    // Penjaga arah sebaliknya: pencocok yang terlalu longgar akan mengirim
    // angka kontrak ke orang lain.
    expect(cocokkanNomorPengguna([u("a", "6281234567890@c.us")], "6289999999999").jenis).toBe(
      "tidak_ada",
    );
    // Ekor yang sama tapi kepala berbeda juga BUKAN nomor yang sama.
    expect(cocokkanNomorPengguna([u("a", "6285734567890")], "6281234567890").jenis).toBe(
      "tidak_ada",
    );
  });

  it("tanpa nomor pengirim → tidak ada, bukan asal pilih", () => {
    for (const n of [null, "", "   ", "abc"]) {
      expect(cocokkanNomorPengguna([u("a", "6281234567890@c.us")], n).jenis, String(n)).toBe(
        "tidak_ada",
      );
    }
  });

  it("dua pengguna aktif bernomor sama → TIDAK dijawab", () => {
    // Menjawab berarti memilih lingkup lokasi salah satunya; kalau keduanya
    // orang berbeda, jawabannya benar untuk orang yang salah.
    const r = cocokkanNomorPengguna(
      [u("a", "6281234567890@c.us"), u("b", null, "081234567890")],
      "6281234567890",
    );
    expect(r.jenis).toBe("ganda");
    expect(r.jenis === "ganda" && r.ids.sort()).toEqual(["a", "b"]);
  });

  it("pengguna tanpa nomor sama sekali diabaikan", () => {
    expect(cocokkanNomorPengguna([u("a", null, null)], "6281234567890").jenis).toBe("tidak_ada");
  });
});

describe("nomor yang DILIHAT orang vs yang DISIMPAN", () => {
  it("sufiks alamat WAHA dibuang untuk ditampilkan", () => {
    /*
     * Keluhan user 2026-08-17: kolom berlabel "Nomor WhatsApp" menampilkan
     * "6281234757999@c.us". Nilai itu BENAR — ia alamat tujuan kirim — tapi
     * menampilkannya membuat orang mengira datanya rusak, tepat ketika ia
     * sedang memeriksa apakah nomornya sudah tersimpan.
     */
    expect(nomorWaUntukTampil("6281234757999@c.us")).toBe("6281234757999");
    expect(nomorWaUntukTampil("6281234757999@s.whatsapp.net")).toBe("6281234757999");
    expect(nomorWaUntukTampil("6281234757999")).toBe("6281234757999");
    expect(nomorWaUntukTampil(null)).toBe("");
  });

  it("bolak-balik AMAN: menyimpan ulang hasil tampilan tidak mengubah apa pun", () => {
    // Kolomnya bisa disunting; kalau bentuk tampilan disimpan lagi apa adanya,
    // hasilnya harus persis sama dengan sebelumnya.
    const disimpan = normalizeWaTarget("0812-3475-7999");
    expect(normalizeWaTarget(nomorWaUntukTampil(disimpan))).toBe(disimpan);
  });

  it("ID GRUP tidak dipotong — sufiksnya bagian dari identitas", () => {
    expect(nomorWaUntukTampil("12036300000000001@g.us")).toBe("12036300000000001@g.us");
  });

  it("yang ditampilkan tetap bisa dicocokkan ke pengirimnya", () => {
    // Penjaga silang: bentuk tampilan dan bentuk simpanan harus sama-sama
    // menormalkan ke nomor yang sama.
    const disimpan = "6281234757999@c.us";
    expect(
      cocokkanNomorPengguna([{ id: "a", waNumber: disimpan, phone: null }], nomorWaUntukTampil(disimpan)),
    ).toEqual({ jenis: "tepat", id: "a" });
  });
});

describe("pengirim ber-@lid (DECISIONS 347)", () => {
  /*
   * Gejalanya identik dengan cacat nomor di DECISIONS 345 — "tidak ada respon
   * sama sekali" — tapi sebabnya lain, dan itu yang membuatnya mahal.
   *
   * Log Sistem user 2026-08-17:
   *   diabaikan — chat pribadi · tanya: diam — didiamkan — nomor ? tidak cocok
   *   143026840146095@lid
   *
   * `@lid` adalah identitas PRIVASI WhatsApp: angkanya BUKAN nomor telepon.
   * Memperlakukannya sebagai nomor akan menautkan pesan ke orang lain yang
   * kebetulan bernomor sama — kegagalan yang jauh lebih buruk daripada diam.
   * Jadi ia dicocokkan lewat kolomnya sendiri, dan hanya SESUDAH nomor.
   */
  const p = (id: string, waLid: string | null, waNumber: string | null = null) => ({
    id,
    waNumber,
    phone: null,
    waLid,
  });

  it("LID pengirim cocok dengan pemetaan admin", () => {
    expect(
      cocokkanNomorPengguna([p("a", "143026840146095")], null, "143026840146095@lid"),
    ).toEqual({ jenis: "tepat", id: "a" });
  });

  it("salinan tangan admin dirapikan: sufiks, spasi, huruf besar", () => {
    // Admin MENYALIN nilai ini dari layar. Kalau bentuk salinannya harus persis,
    // kolomnya akan gagal diam-diam persis seperti nomor telepon dulu.
    for (const disimpan of ["143026840146095@lid", " 143026840146095 ", "143026840146095@LID"]) {
      expect(
        cocokkanNomorPengguna([p("a", disimpan)], null, "143026840146095@lid").jenis,
        disimpan,
      ).toBe("tepat");
    }
  });

  it("LID BUKAN nomor telepon — tidak pernah dicocokkan ke kolom nomor", () => {
    /*
     * Penjaga terpenting di blok ini. Pengguna "a" bernomor sama persis dengan
     * angka LID pengirim; menjawabnya berarti mengirim data orang lain.
     */
    expect(
      cocokkanNomorPengguna(
        [{ id: "a", waNumber: "143026840146095@c.us", phone: null, waLid: null }],
        null,
        "143026840146095@lid",
      ).jenis,
    ).toBe("tidak_ada");
  });

  it("nomor DIUTAMAKAN atas LID bila keduanya ada", () => {
    // Nomor dinormalkan sistem; LID hanya sekuat ketikan admin.
    const r = cocokkanNomorPengguna(
      [p("bernomor", null, "6281234757999@c.us"), p("berlid", "143026840146095")],
      "6281234757999",
      "143026840146095@lid",
    );
    expect(r).toEqual({ jenis: "tepat", id: "bernomor" });
  });

  it("dua pengguna dengan LID sama → TIDAK dijawab", () => {
    const r = cocokkanNomorPengguna(
      [p("a", "143026840146095"), p("b", "143026840146095@lid")],
      null,
      "143026840146095@lid",
    );
    expect(r.jenis).toBe("ganda");
  });

  it("LID kosong / terlalu pendek diabaikan, tidak memancing kecocokan", () => {
    for (const l of [null, "", "@lid", "12@lid", "abc@lid"]) {
      expect(cocokkanNomorPengguna([p("a", "143026840146095")], null, l).jenis, String(l)).toBe(
        "tidak_ada",
      );
    }
  });

  it("pengguna tanpa pemetaan LID tidak ikut tersapu", () => {
    expect(
      cocokkanNomorPengguna([p("a", null, "6281234757999@c.us")], null, "143026840146095@lid").jenis,
    ).toBe("tidak_ada");
  });

  it("pengguna berkolom LID kosong tidak cocok dengan LID kosong pengirim", () => {
    // Dua "tidak diketahui" bukan kecocokan.
    expect(cocokkanNomorPengguna([p("a", "")], null, "").jenis).toBe("tidak_ada");
  });
});

describe("mention MARLIN yang ber-@lid (DECISIONS 349)", () => {
  /*
   * Laporan user 2026-08-17 dengan tangkapan layar: pesan grup yang JELAS
   * me-mention MARLIN tercatat "diam — grup tanpa mention ke MARLIN".
   *
   * Sejak WhatsApp memakai identitas privasi, yang masuk daftar mention adalah
   * @lid MARLIN, bukan JID bernomornya. Mencocokkan lewat nomor saja berarti
   * membandingkan LID dengan nomor telepon — tidak pernah sama, sehingga SETIAP
   * mention terbaca "tidak ada mention" dan tanya-jawab grup mati diam-diam.
   */
  const LID = "77712345678901";
  const AKU = { nomor: "6281200000000", lid: LID };

  it("mention berisi @lid MARLIN: dilayani", () => {
    expect(diajakBicara(pesan({ grup: true, mentionedJids: [`${LID}@lid`] }), AKU)).toBe(true);
  });

  it("@lid orang lain tetap TIDAK menghitung", () => {
    expect(diajakBicara(pesan({ grup: true, mentionedJids: ["99900000000000@lid"] }), AKU)).toBe(
      false,
    );
  });

  it("LID TIDAK PERNAH dibandingkan dengan nomor, dan sebaliknya", () => {
    /*
     * Penjaga paling penting di blok ini. Kalau perbandingannya bersilang, LID
     * yang angkanya kebetulan sama dengan nomor MARLIN akan memicu jawaban —
     * dan LID itu milik orang lain sepenuhnya.
     */
    const samar = { nomor: "6281200000000", lid: "6281200000000" };
    // @lid berangka sama dengan NOMOR kita, tapi LID kita berbeda → bukan kita.
    expect(
      diajakBicara(pesan({ grup: true, mentionedJids: ["6281200000000@lid"] }), AKU),
    ).toBe(false);
    // Kebalikannya: JID bernomor sama dengan LID kita → tetap dicocokkan sebagai
    // nomor, dan di sini nomornya memang kita.
    expect(diajakBicara(pesan({ grup: true, mentionedJids: [`${LID}@c.us`] }), samar)).toBe(false);
  });

  it("sesi yang hanya punya LID (tanpa nomor) tetap bisa dikenali", () => {
    expect(
      diajakBicara(pesan({ grup: true, mentionedJids: [`${LID}@lid`] }), { nomor: null, lid: LID }),
    ).toBe(true);
  });

  it("identitas belum diketahui SAMA SEKALI → grup tetap tidak dilayani", () => {
    // Lebih baik diam daripada membalas setiap pesan grup.
    expect(
      diajakBicara(pesan({ grup: true, mentionedJids: [`${LID}@lid`] }), { nomor: null, lid: null }),
    ).toBe(false);
  });

  it("MEMBALAS pesan MARLIN dihitung sebagai diajak bicara", () => {
    // Cara orang benar-benar meneruskan percakapan; WhatsApp tidak selalu
    // menyertakan mention pada balasan.
    expect(diajakBicara(pesan({ grup: true, balasanKepada: `${LID}@lid` }), AKU)).toBe(true);
    expect(diajakBicara(pesan({ grup: true, balasanKepada: "6281200000000@c.us" }), AKU)).toBe(true);
  });

  it("membalas pesan ORANG LAIN tidak memancing jawaban", () => {
    // Kalau ini lolos, MARLIN ikut menyahut setiap balasan di grup.
    expect(diajakBicara(pesan({ grup: true, balasanKepada: "6285711111111@c.us" }), AKU)).toBe(
      false,
    );
  });

  it("chat pribadi tidak terpengaruh aturan mention", () => {
    expect(diajakBicara(pesan({ grup: false, mentionedJids: [] }), AKU)).toBe(true);
  });
});
