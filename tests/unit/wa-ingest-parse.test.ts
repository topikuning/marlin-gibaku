import { describe, expect, it } from "vitest";
import {
  parseWaEvent,
  isWaMessageEvent,
  medanJidPayload,
  kerangkaPayload,
  normalizeChatId,
  varianChatId,
} from "@/lib/waha/ingest-parse";

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
describe("parseWaEvent – pengirim @lid", () => {
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

describe("medanJidPayload – diagnosa, bukan tebakan", () => {
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

/**
 * SATU CHAT, SATU TULISAN (DECISIONS 348).
 *
 * Chat yang sama datang dengan tulisan berbeda tergantung engine WAHA, padahal
 * `Package.waGroupId` dicocokkan sebagai TEKS dan tujuan kirim dipakai apa
 * adanya. Satu huruf beda = tidak pernah cocok, tanpa galat apa pun.
 */
describe("normalizeChatId", () => {
  it("NOWEB dan WEBJS menulis kontak yang sama → satu bentuk", () => {
    for (const raw of [
      "6281234757999@c.us",
      "6281234757999@s.whatsapp.net",
      "6281234757999@S.WhatsApp.net",
      " 6281234757999@c.us ",
      "+6281234757999@c.us",
    ]) {
      expect(normalizeChatId(raw), raw).toBe("6281234757999@c.us");
    }
  });

  it("sufiks PERANGKAT dibuang – kalau tidak, nomornya jadi salah", () => {
    /*
     * Diukur sebelum perbaikan: "6281234757999:12@s.whatsapp.net" menghasilkan
     * nomor 628123475799912. Bukan sekadar tidak cocok — itu nomor orang lain.
     */
    expect(normalizeChatId("6281234757999:12@s.whatsapp.net")).toBe("6281234757999@c.us");
    expect(normalizeChatId("6281234757999:3@c.us")).toBe("6281234757999@c.us");
  });

  it("angka telanjang: nomor jadi @c.us, id grup jadi @g.us", () => {
    expect(normalizeChatId("6281234757999")).toBe("6281234757999@c.us");
    expect(normalizeChatId("081234757999")).toBe("6281234757999@c.us");
    // ID grup panjang, atau bentuk lama berstrip — bukan nomor telepon.
    expect(normalizeChatId("120363000000000001")).toBe("120363000000000001@g.us");
    expect(normalizeChatId("6281234757999-1600000000")).toBe("6281234757999-1600000000@g.us");
  });

  it("ruang identitas LAIN tidak diseret jadi @c.us", () => {
    // @lid bukan nomor (DECISIONS 347); grup/siaran/newsletter punya ruangnya
    // sendiri. Menyeretnya ke @c.us berarti mengirim ke alamat yang salah.
    expect(normalizeChatId("143026840146095@lid")).toBe("143026840146095@lid");
    expect(normalizeChatId("120363000@g.us")).toBe("120363000@g.us");
    expect(normalizeChatId("status@broadcast")).toBe("status@broadcast");
  });

  it("kosong / tak berbentuk → null atau apa adanya, TIDAK ditebak", () => {
    expect(normalizeChatId(null)).toBeNull();
    expect(normalizeChatId("   ")).toBeNull();
    expect(normalizeChatId("@c.us")).toBeNull();
    // Angka yang bukan nomor & bukan id grup dibiarkan — mengaku tidak tahu.
    expect(normalizeChatId("12345")).toBe("12345");
  });

  it("idempoten: menormalkan hasil normalisasi tidak mengubah apa pun", () => {
    for (const raw of ["6281234757999@s.whatsapp.net", "120363000@g.us", "143026840146095@lid"]) {
      const sekali = normalizeChatId(raw)!;
      expect(normalizeChatId(sekali), raw).toBe(sekali);
    }
  });
});

describe("varianChatId – data LAMA tetap cocok", () => {
  it("mencakup bentuk yang mungkin sudah tersimpan sebelum kanonikalisasi", () => {
    const v = varianChatId("6281234757999@s.whatsapp.net");
    expect(v).toContain("6281234757999@c.us");
    expect(v).toContain("6281234757999@s.whatsapp.net");
    expect(v).toContain("6281234757999");
  });

  it("grup: bentuk kanonik dan telanjang", () => {
    const v = varianChatId("120363000@g.us");
    expect(v).toContain("120363000@g.us");
    expect(v).toContain("120363000");
  });

  it("tidak pernah mencampur ruang identitas", () => {
    // Kalau @lid ikut melebar jadi @c.us, satu LID bisa menautkan grup orang lain.
    expect(varianChatId("143026840146095@lid")).toEqual(["143026840146095@lid"]);
  });

  it("kosong → daftar kosong, bukan [null] yang mencocokkan segalanya", () => {
    expect(varianChatId(null)).toEqual([]);
    expect(varianChatId("  ")).toEqual([]);
  });
});

describe("parseWaEvent – bentuk MENTAH NOWEB (payload.key)", () => {
  it("chatId di key.remoteJid: dibaca, bukan dibuang", () => {
    // Diukur sebelum perbaikan: seluruh pesan berbentuk ini dikembalikan null.
    const m = parseWaEvent({
      event: "message",
      payload: {
        key: { remoteJid: "6281234757999@s.whatsapp.net", fromMe: false, id: "abc" },
        body: "halo",
        timestamp: 1_690_000_000,
      },
    });
    expect(m).not.toBeNull();
    expect(m!.chatId).toBe("6281234757999@c.us");
    expect(m!.fromNumber).toBe("6281234757999");
  });

  it("grup: key.participant adalah pengirim sebenarnya, bukan grupnya", () => {
    const m = parseWaEvent({
      event: "message",
      payload: {
        id: "g1",
        key: { remoteJid: "120363000@g.us", fromMe: false, participant: "6281234757999@s.whatsapp.net" },
        body: "halo",
        timestamp: 1_690_000_000,
      },
    });
    expect(m!.chatId).toBe("120363000@g.us");
    expect(m!.fromNumber).toBe("6281234757999");
  });

  it("key.fromMe dikenali – kalau tidak, MARLIN membalas dirinya sendiri", () => {
    const m = parseWaEvent({
      event: "message",
      payload: {
        id: "x1",
        key: { remoteJid: "120363000@g.us", fromMe: true },
        body: "balasan MARLIN",
        timestamp: 1_690_000_000,
      },
    });
    expect(m!.fromMe).toBe(true);
  });

  it("id pesan boleh datang dari key.id saja", () => {
    const m = parseWaEvent({
      event: "message",
      payload: { key: { remoteJid: "6281234757999@c.us", id: "hanya-di-key" }, body: "hai", timestamp: 1 },
    });
    expect(m!.waMessageId).toBe("hanya-di-key");
  });
});

describe("kerangkaPayload – diagnosa tanpa membocorkan chat", () => {
  it("menyebut medan bersarang, termasuk key.remoteJid", () => {
    const s = kerangkaPayload({
      payload: { key: { remoteJid: "6281234757999@s.whatsapp.net", fromMe: false } },
    });
    expect(s).toContain("key.remoteJid=6281234757999@s.whatsapp.net");
    expect(s).toContain("key.fromMe=false");
  });

  it("ISI pesan hanya panjangnya, tidak pernah isinya", () => {
    /*
     * User meminta "log full raw payload". Untuk log server itu benar; untuk log
     * hit di Sistem — yang dibaca admin lain — payload utuh berarti setiap chat
     * pribadi yang gagal diproses ikut terbit di sana.
     */
    const s = kerangkaPayload({ payload: { body: "gaji saya belum dibayar", caption: "rahasia" } });
    expect(s).not.toContain("gaji");
    expect(s).not.toContain("rahasia");
    expect(s).toContain("body:str(23)");
  });

  it("teks panjang apa pun namanya tetap dipotong", () => {
    const s = kerangkaPayload({ payload: { catatan: "x".repeat(200) } });
    expect(s).toContain("catatan:str(200)");
    expect(s).not.toContain("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  });

  it("dipotong pada batas, tidak membanjiri log", () => {
    const besar: Record<string, string> = {};
    for (let i = 0; i < 200; i++) besar[`m${i}`] = "1";
    expect(kerangkaPayload({ payload: besar }).length).toBeLessThanOrEqual(401);
  });
});

describe("mention & balasan di payload bersarang (DECISIONS 349)", () => {
  /*
   * Mention grup tidak selalu ada di permukaan payload. Engine NOWEB menaruhnya
   * di `message.extendedTextMessage.contextInfo.mentionedJid`; WEBJS kadang di
   * `_data.contextInfo`. Selama itu tidak dibaca, mention terlihat seperti tidak
   * ada — dan MARLIN diam pada pesan yang jelas memanggilnya.
   */
  const grup = (extra: Record<string, unknown>) =>
    parseWaEvent({
      event: "message",
      payload: {
        id: "gm1",
        from: "120363410571149972@g.us",
        author: "6285700000001@c.us",
        body: "@marlin progress?",
        timestamp: 1_690_000_000,
        ...extra,
      },
    })!;

  it("contextInfo.mentionedJid NOWEB terbaca", () => {
    const m = grup({
      message: { extendedTextMessage: { contextInfo: { mentionedJid: ["77712345678901@lid"] } } },
    });
    expect(m.mentionedJids).toEqual(["77712345678901@lid"]);
  });

  it("_data.contextInfo.mentionedJid WEBJS terbaca", () => {
    const m = grup({ _data: { contextInfo: { mentionedJid: ["6281200000000@c.us"] } } });
    expect(m.mentionedJids).toEqual(["6281200000000@c.us"]);
  });

  it("mention pada pesan bergambar juga terbaca", () => {
    const m = grup({ message: { imageMessage: { contextInfo: { mentionedJid: ["628120@c.us"] } } } });
    expect(m.mentionedJids).toEqual(["628120@c.us"]);
  });

  it("pemilik pesan yang DIBALAS terbaca dan dikanonikkan", () => {
    const m = grup({
      message: { extendedTextMessage: { contextInfo: { participant: "6281200000000@s.whatsapp.net" } } },
    });
    // Dikanonikkan supaya bisa dibandingkan langsung dengan identitas MARLIN.
    expect(m.balasanKepada).toBe("6281200000000@c.us");
  });

  it("balasan lewat bentuk WEBJS (_data.quotedParticipant)", () => {
    const m = grup({ _data: { quotedParticipant: "6281200000000@c.us" } });
    expect(m.balasanKepada).toBe("6281200000000@c.us");
  });

  it("bukan balasan → null, bukan tebakan", () => {
    // Kalau ini mengembalikan pengirimnya sendiri, setiap pesan grup akan
    // terlihat seperti balasan ke seseorang.
    expect(grup({}).balasanKepada).toBeNull();
    expect(grup({}).mentionedJids).toEqual([]);
  });

  it("mention dari beberapa sumber digabung tanpa duplikat", () => {
    const m = grup({
      mentionedIds: ["6281200000000@c.us"],
      message: { extendedTextMessage: { contextInfo: { mentionedJid: ["6281200000000@c.us", "628999@c.us"] } } },
    });
    expect(m.mentionedJids.sort()).toEqual(["6281200000000@c.us", "628999@c.us"]);
  });
});

describe("nomor pasangan @lid dari payload ASLI (DECISIONS 350)", () => {
  /*
   * Payload PERSIS seperti yang tertangkap log Sistem 2026-08-17 16.06 — nilai
   * ini bukan karangan, melainkan salinan dari layar user:
   *
   *   from=143026840146095@lid
   *   key.remoteJid=143026840146095@lid
   *   key.remoteJidAlt=6281234757999@s.whatsapp.net
   *
   * `key.remoteJidAlt` tidak ada di daftar tebakan DECISIONS 347, DAN tidak
   * berada di permukaan payload. Dua sebab kenapa versi itu tetap meleset.
   */
  const asli = {
    event: "message.any",
    payload: {
      id: "asli-1",
      timestamp: 1_690_000_000,
      body: "ada tanya",
      from: "143026840146095@lid",
      key: {
        remoteJid: "143026840146095@lid",
        remoteJidAlt: "6281234757999@s.whatsapp.net",
        fromMe: false,
        id: "asli-1",
      },
    },
  };

  it("nomor terbaca dari key.remoteJidAlt", () => {
    const m = parseWaEvent(asli)!;
    expect(m.fromNumber).toBe("6281234757999");
  });

  it("LID tetap direkam terpisah – keduanya, bukan salah satu", () => {
    const m = parseWaEvent(asli)!;
    expect(m.senderLid).toBe("143026840146095@lid");
  });

  it("remoteJid yang ber-@lid tidak keliru dipungut sebagai nomor", () => {
    // Penjaga inti: `remoteJid` dan `remoteJidAlt` duduk bersebelahan, dan
    // hanya salah satunya nomor telepon.
    expect(parseWaEvent(asli)!.fromNumber).not.toContain("143026840146095");
  });

  it("POLA nama medan, bukan daftar nama – bertahan melewati penggantian", () => {
    /*
     * Menambah satu nama per temuan berarti menunggu satu pesan asli per rilis
     * WAHA. Yang dicari sekarang polanya: akhiran `Pn` / `Alt`.
     */
    for (const medan of ["senderPn", "participantPn", "participantAlt", "remoteJidAlt", "authorAlt"]) {
      const m = parseWaEvent({
        event: "message",
        payload: {
          id: `p-${medan}`,
          timestamp: 1,
          from: "143026840146095@lid",
          key: { remoteJid: "143026840146095@lid", [medan]: "6281234757999@s.whatsapp.net" },
        },
      })!;
      expect(m.fromNumber, medan).toBe("6281234757999");
    }
  });

  it("medan pasangan di _data juga terbaca", () => {
    const m = parseWaEvent({
      event: "message",
      payload: {
        id: "d1",
        timestamp: 1,
        from: "143026840146095@lid",
        _data: { senderPn: "6281234757999@c.us" },
      },
    })!;
    expect(m.fromNumber).toBe("6281234757999");
  });

  it("sufiks perangkat pada nomor pasangan ikut dibuang", () => {
    const m = parseWaEvent({
      event: "message",
      payload: {
        id: "d2",
        timestamp: 1,
        from: "143026840146095@lid",
        key: { remoteJidAlt: "6281234757999:47@s.whatsapp.net" },
      },
    })!;
    expect(m.fromNumber).toBe("6281234757999");
  });

  it("tanpa medan pasangan: null, JATUH ke pemetaan admin – bukan menebak", () => {
    const m = parseWaEvent({
      event: "message",
      payload: { id: "d3", timestamp: 1, from: "143026840146095@lid" },
    })!;
    expect(m.fromNumber).toBeNull();
    expect(m.senderLid).toBe("143026840146095@lid");
  });

  it("medan berakhiran Alt yang ISINYA @lid tidak dipungut", () => {
    const m = parseWaEvent({
      event: "message",
      payload: {
        id: "d4",
        timestamp: 1,
        from: "143026840146095@lid",
        key: { remoteJidAlt: "99900000000000@lid" },
      },
    })!;
    expect(m.fromNumber).toBeNull();
  });

  it("diagnosa tetap menyebut key.remoteJidAlt – itu yang menemukan cacat ini", () => {
    // Kalau baris diagnosa ini hilang, temuan berikutnya kembali jadi tebakan.
    expect(medanJidPayload(asli)).toContain("key.remoteJidAlt=6281234757999@s.whatsapp.net");
  });
});

/* ── Lampiran berkas: LINTAS ENGINE (DECISIONS 440) ──────────────────────
 *
 * Laporan user 2026-08-26: PDF ke grup TIDAK tertangkap, sementara stiker di
 * menit yang sama tertangkap. Sebabnya di sini: `hasMedia` hanya dibaca dari
 * `payload.hasMedia`/`payload.media`.
 *
 * Ketetapan user: *"kenapa harus bingung noweb atau bukan... seharusnya apa
 * pun enginenya kamu bisa handle"*. Jadi yang diuji BUKAN satu engine,
 * melainkan setiap bentuk payload yang pernah membawa berkas — WEBJS (yang
 * dipakai sekarang) maupun NOWEB — dan penanda `type` yang ada di keduanya.
 */
describe("lampiran lintas engine", () => {
  const bungkus = (p: Record<string, unknown>) => ({
    event: "message",
    payload: { id: "x1", from: "628@g.us", timestamp: 1, ...p },
  });

  it("PDF polos di _data.message.documentMessage terbaca sebagai media", () => {
    const m = parseWaEvent(
      bungkus({
        _data: {
          message: {
            documentMessage: {
              mimetype: "application/pdf",
              fileName: "Surat Teguran 12.pdf",
              url: "https://mmg.whatsapp.net/enc-jangan-dipakai",
            },
          },
        },
      }),
    );
    expect(m!.hasMedia).toBe(true);
    expect(m!.mediaType).toBe("application/pdf");
    expect(m!.mediaFileName).toBe("Surat Teguran 12.pdf");
    // URL terenkripsi WhatsApp TIDAK dipakai — menyimpannya berarti berkas
    // rusak yang terlihat berhasil.
    expect(m!.mediaUrl).toBeNull();
  });

  it("PDF BERKETERANGAN (documentWithCaptionMessage) juga terbaca", () => {
    const m = parseWaEvent(
      bungkus({
        _data: {
          message: {
            documentWithCaptionMessage: {
              message: {
                documentMessage: { mimetype: "application/pdf", fileName: "RAB revisi.pdf" },
              },
            },
          },
        },
      }),
    );
    expect(m!.hasMedia).toBe(true);
    expect(m!.mediaFileName).toBe("RAB revisi.pdf");
  });

  it("WEBJS: dokumen dengan hasMedia + _data.mimetype/filename", () => {
    const m = parseWaEvent(
      bungkus({
        hasMedia: true,
        type: "document",
        _data: { type: "document", mimetype: "application/pdf", filename: "Adendum 1.pdf" },
      }),
    );
    expect(m!.hasMedia).toBe(true);
    expect(m!.mediaType).toBe("application/pdf");
    expect(m!.mediaFileName).toBe("Adendum 1.pdf");
  });

  it("WEBJS: hasMedia TIDAK diset pun tetap terbaca dari _data.type", () => {
    const m = parseWaEvent(bungkus({ _data: { type: "document", mimetype: "application/pdf" } }));
    expect(m!.hasMedia).toBe(true);
    expect(m!.mediaType).toBe("application/pdf");
  });

  it("jenis pesan saja sudah cukup jadi penanda media", () => {
    const m = parseWaEvent(bungkus({ type: "document" }));
    expect(m!.hasMedia).toBe(true);
  });

  it("pesan teks biasa TIDAK ikut dianggap membawa berkas", () => {
    const m = parseWaEvent(bungkus({ type: "chat", body: "pagi pak" }));
    expect(m!.hasMedia).toBe(false);
  });

  it("URL media yang benar (dari WAHA) tetap dipakai", () => {
    const m = parseWaEvent(
      bungkus({
        hasMedia: true,
        media: { url: "https://waha.local/api/files/a.pdf", mimetype: "application/pdf" },
      }),
    );
    expect(m!.mediaUrl).toBe("https://waha.local/api/files/a.pdf");
  });
});
