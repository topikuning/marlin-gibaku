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
  diajakBicara,
  lingkupJawaban,
  niatLintasLokasi,
  type AsalPesan,
} from "@/lib/waha/tanya-izin";

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
