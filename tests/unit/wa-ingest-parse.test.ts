import { describe, expect, it } from "vitest";
import { parseWaEvent, isWaMessageEvent, medanJidPayload } from "@/lib/waha/ingest-parse";

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

/**
 * Pengirim ber-identitas privasi `@lid` (DECISIONS 347).
 *
 * WhatsApp mengirim sebagian chat pribadi dengan JID `…@lid`, bukan JID
 * bernomor. Angka di dalamnya BUKAN nomor telepon. Blok ini menjaga dua hal
 * yang harus tetap benar bersamaan: LID tidak pernah diselundupkan jadi nomor,
 * DAN nomor pasangannya tetap dipakai kalau memang ada di payload.
 */
describe("parseWaEvent — pengirim @lid", () => {
  const dm = (payload: Record<string, unknown>) => ({
    event: "message",
    session: "default",
    payload: {
      id: "false_143026840146095@lid_XYZ",
      timestamp: 1_690_000_000,
      from: "143026840146095@lid",
      fromMe: false,
      body: "ada tanya",
      hasMedia: false,
      ...payload,
    },
  });

  it("LID direkam terpisah, dan TIDAK dijadikan nomor", () => {
    const m = parseWaEvent(dm({}));
    expect(m!.senderLid).toBe("143026840146095@lid");
    // Kalau baris berikut jadi "143026840146095", MARLIN akan menjawab siapa pun
    // yang kebetulan bernomor sama — salah orang, lewat saluran yang di-forward.
    expect(m!.fromNumber).toBeNull();
  });

  it("nomor pasangan dipakai bila payload memuatnya", () => {
    for (const medan of ["senderPn", "participantPn", "authorPn", "participantAlt"]) {
      const m = parseWaEvent(dm({ [medan]: "6281234757999@c.us" }));
      expect(m!.fromNumber, medan).toBe("6281234757999");
      expect(m!.senderLid, medan).toBe("143026840146095@lid");
    }
  });

  it("nomor pasangan juga dibaca dari _data (bentuk engine lama)", () => {
    const m = parseWaEvent(dm({ _data: { senderPn: "6281234757999@c.us" } }));
    expect(m!.fromNumber).toBe("6281234757999");
  });

  it("medan pasangan yang ISINYA @lid lagi tidak dianggap nomor", () => {
    expect(parseWaEvent(dm({ senderPn: "143026840146095@lid" }))!.fromNumber).toBeNull();
  });

  it("JID bernomor biasa tidak menyisakan senderLid", () => {
    const m = parseWaEvent(dm({ from: "6281234757999@c.us", id: "false_x_Y" }));
    expect(m!.senderLid).toBeNull();
    expect(m!.fromNumber).toBe("6281234757999");
  });
});

describe("medanJidPayload — diagnosa, bukan tebakan", () => {
  /*
   * Dokumentasi WAHA tidak terjangkau dari lingkungan kerja ini, dan nama medan
   * pasangan LID berubah antar rilis. Tanpa jejak ini, menutup celahnya berarti
   * menebak satu nama medan per pesan asli — satu percobaan per hari.
   */
  it("menyebut medan berbentuk JID beserta nilainya", () => {
    const s = medanJidPayload({
      payload: { from: "143026840146095@lid", senderPn: "6281234757999@c.us", body: "ada tanya" },
    });
    expect(s).toContain("from=143026840146095@lid");
    expect(s).toContain("senderPn=6281234757999@c.us");
  });

  it("ISI PESAN tidak pernah ikut tercatat", () => {
    // Log hit dibaca admin lain; diagnosa tidak boleh berubah jadi penyadapan.
    const s = medanJidPayload({
      payload: { from: "143026840146095@lid", body: "gaji saya belum dibayar" },
    });
    expect(s).not.toContain("gaji");
  });

  it("medan di _data ditandai asalnya", () => {
    const s = medanJidPayload({ payload: { _data: { senderPn: "6281234757999@c.us" } } });
    expect(s).toContain("_data.senderPn=6281234757999@c.us");
  });

  it("payload kosong / bukan objek → teks kosong, bukan galat", () => {
    expect(medanJidPayload({})).toBe("");
    expect(medanJidPayload(null)).toBe("");
    expect(medanJidPayload({ payload: {} })).toBe("");
  });
});
