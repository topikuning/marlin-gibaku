import { describe, expect, it } from "vitest";
import { parseWaEvent, isWaMessageEvent } from "@/lib/waha/ingest-parse";

/** Parser event webhook WAHA (murni, tanpa DB). DECISIONS 119. */
describe("parseWaEvent", () => {
  const groupEvent = {
    event: "message",
    session: "default",
    payload: {
      id: "false_120363000@g.us_ABC123",
      timestamp: 1_690_000_000,
      from: "120363000@g.us",
      fromMe: false,
      body: "Progres hari ini 40%",
      hasMedia: false,
      author: "628123456789@c.us",
      notifyName: "Budi Mandor",
    },
  };

  it("pesan grup → id, chatId, pengirim, isi, waktu", () => {
    const m = parseWaEvent(groupEvent);
    expect(m).not.toBeNull();
    expect(m!.waMessageId).toBe("false_120363000@g.us_ABC123");
    expect(m!.chatId).toBe("120363000@g.us");
    expect(m!.fromNumber).toBe("628123456789"); // dari author, suffix dibuang
    expect(m!.fromName).toBe("Budi Mandor");
    expect(m!.body).toBe("Progres hari ini 40%");
    expect(m!.fromMe).toBe(false);
    expect(m!.timestamp.toISOString()).toBe("2023-07-22T04:26:40.000Z");
  });

  it("event message.any juga diterima", () => {
    expect(isWaMessageEvent({ event: "message.any" })).toBe(true);
    expect(parseWaEvent({ ...groupEvent, event: "message.any" })).not.toBeNull();
  });

  it("event non-pesan → null", () => {
    expect(isWaMessageEvent({ event: "session.status" })).toBe(false);
    expect(parseWaEvent({ event: "session.status", payload: {} })).toBeNull();
  });

  it("tanpa id atau chatId → null", () => {
    expect(parseWaEvent({ event: "message", payload: { from: "x@g.us" } })).toBeNull();
    expect(parseWaEvent({ event: "message", payload: { id: "x" } })).toBeNull();
  });

  it("hasMedia terdeteksi dari media.mimetype + mediaType", () => {
    const m = parseWaEvent({
      event: "message",
      payload: { id: "m1", from: "1@g.us", timestamp: 1_690_000_000, media: { mimetype: "image/jpeg" } },
    });
    expect(m!.hasMedia).toBe(true);
    expect(m!.mediaType).toBe("image/jpeg");
  });

  it("fromMe (pesan keluar kita) tetap terparse dengan flag", () => {
    const m = parseWaEvent({ ...groupEvent, payload: { ...groupEvent.payload, fromMe: true } });
    expect(m!.fromMe).toBe(true);
  });

  // REGRESI: kiriman MARLIN sendiri ke grup. WAHA mengisi `from` = nomor kita
  // dan `to` = grup; membaca `from` membuat chatId salah → pesan dibuang karena
  // tak cocok Package.waGroupId, sehingga ringkasan harian tidak utuh.
  it("pesan KELUAR ke grup: chatId diambil dari `to`, bukan `from`", () => {
    const m = parseWaEvent({
      event: "message.any",
      payload: {
        id: "out-1",
        from: "628111222333@c.us", // nomor kita sendiri
        to: "120363000111222@g.us", // grup tujuan
        fromMe: true,
        body: "Laporan harian Purwahamba 26 Juli",
        timestamp: 1_690_000_000,
      },
    });
    expect(m).not.toBeNull();
    expect(m!.chatId).toBe("120363000111222@g.us");
    expect(m!.fromMe).toBe(true);
    expect(m!.body).toContain("Laporan harian");
  });

  it("pesan MASUK tetap memakai `from` sebagai chatId (tidak berubah)", () => {
    const m = parseWaEvent({
      event: "message",
      payload: {
        id: "in-1",
        from: "120363000111222@g.us",
        to: "628111222333@c.us",
        author: "628999@c.us",
        body: "Material sudah datang",
        timestamp: 1_690_000_000,
      },
    });
    expect(m!.chatId).toBe("120363000111222@g.us");
    expect(m!.fromMe).toBe(false);
    expect(m!.fromNumber).toBe("628999");
  });
});
