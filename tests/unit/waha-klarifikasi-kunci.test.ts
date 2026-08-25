import { describe, expect, it } from "vitest";
import { bacaPilihan, kunciPengirim } from "@/lib/waha/klarifikasi-kunci";

/**
 * KLARIFIKASI TERTUNDA — bagian MURNI (DECISIONS 376).
 *
 * Dua keputusan yang tidak boleh longgar: siapa yang boleh menjawab tawaran,
 * dan apa yang dihitung sebagai jawaban.
 */

describe("kunciPengirim", () => {
  it("JID pengirim menang atas apa pun", () => {
    expect(
      kunciPengirim({
        senderJid: "628111@c.us",
        senderLid: "7771",
        fromNumber: "628999",
        chatId: "120@g.us",
      }),
    ).toBe("628111@c.us");
  });

  it("@lid dipakai bila JID tidak ada – dan TIDAK dicampur dengan nomor", () => {
    // Angka di dalam LID bukan nomor telepon (DECISIONS 347). Kalau keduanya
    // ditulis ke kunci yang sama, dua orang berbeda bisa bertabrakan.
    expect(
      kunciPengirim({ senderJid: null, senderLid: "7771", fromNumber: null, chatId: "120@g.us" }),
    ).toBe("7771@lid");
  });

  it("di GRUP tanpa identitas pengirim → null, JANGAN menawarkan pilihan", () => {
    /*
     * Inilah pagar yang menentukan. Kalau grup dikunci per CHAT saja, siapa pun
     * bisa mengambil alih klarifikasi orang lain dengan mengetik "1" — dan
     * jawabannya akan tampak seolah menjawab pertanyaan si penanya asli.
     */
    expect(
      kunciPengirim({ senderJid: null, senderLid: null, fromNumber: null, chatId: "120@g.us" }),
    ).toBeNull();
  });

  it("chat PRIBADI tanpa identitas masih aman – chat = orangnya", () => {
    expect(
      kunciPengirim({ senderJid: null, senderLid: null, fromNumber: null, chatId: "628111@c.us" }),
    ).toBe("628111@c.us");
  });

  it("dua orang di grup yang sama TIDAK berbagi kunci", () => {
    const grup = "120@g.us";
    const a = kunciPengirim({ senderJid: "628111@c.us", senderLid: null, fromNumber: null, chatId: grup });
    const b = kunciPengirim({ senderJid: "628222@c.us", senderLid: null, fromNumber: null, chatId: grup });
    expect(a).not.toBe(b);
  });
});

describe("bacaPilihan", () => {
  it("angka telanjang dan imbuhan pendek diterima", () => {
    expect(bacaPilihan("1")).toBe(0);
    expect(bacaPilihan("2")).toBe(1);
    expect(bacaPilihan(" 3 ")).toBe(2);
    expect(bacaPilihan("pilih 2")).toBe(1);
    expect(bacaPilihan("opsi 1.")).toBe(0);
    expect(bacaPilihan("no 3")).toBe(2);
  });

  it("kalimat yang KEBETULAN memuat angka BUKAN jawaban pilihan", () => {
    /*
     * Pagar terpenting di fungsi ini. "laporan tanggal 2" adalah pertanyaan
     * sungguhan; memperlakukannya sebagai pilihan berarti membajaknya dan
     * menjawab hal yang sama sekali berbeda — tanpa penanya bisa tahu kenapa.
     */
    expect(bacaPilihan("laporan tanggal 2")).toBeNull();
    expect(bacaPilihan("progress 2 hari lalu")).toBeNull();
    expect(bacaPilihan("2 lokasi mana saja")).toBeNull();
    expect(bacaPilihan("kirim 1 laporan")).toBeNull();
  });

  it("angka di luar 1–9 dan bukan-angka ditolak", () => {
    expect(bacaPilihan("0")).toBeNull();
    expect(bacaPilihan("12")).toBeNull();
    expect(bacaPilihan("satu")).toBeNull();
    expect(bacaPilihan("")).toBeNull();
  });
});
