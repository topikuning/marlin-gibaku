import { describe, expect, it } from "vitest";
import {
  EMPTY_DIRECTORY,
  isLidJid,
  normalizePhone,
  resolveSender,
  senderKeyOf,
  type SenderDirectory,
} from "@/lib/waha/sender-identity";

/** Identitas pengirim chat grup — ringkasan ke pimpinan harus menyebut orang. DECISIONS 138. */

const dir: SenderDirectory = {
  aliasByKey: new Map([["99887766554433@lid", { displayName: "Rheza", role: "PM" }]]),
  userByPhone: new Map([["628123456789", { fullName: "Prio Yulianto", role: "site_manager" }]]),
  contactByPhone: new Map([["628999888777", "Direksi"]]),
};

describe("normalizePhone", () => {
  it("menyeragamkan format Indonesia", () => {
    expect(normalizePhone("0812-3456-789")).toBe("628123456789");
    expect(normalizePhone("+62 812 3456 789")).toBe("628123456789");
    expect(normalizePhone("8123456789")).toBe("628123456789");
    expect(normalizePhone("628123456789")).toBe("628123456789");
  });
  it("membuang kode negara ganda & menolak yang terlalu pendek", () => {
    expect(normalizePhone("6262812345678")).toBe("62812345678");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("isLidJid & senderKeyOf", () => {
  it("mengenali JID privasi @lid", () => {
    expect(isLidJid("86350418202744@lid")).toBe(true);
    expect(isLidJid("628123456789@c.us")).toBe(false);
    expect(isLidJid(null)).toBe(false);
  });
  it("kunci alias: JID mentah bila ada, jika tidak nomor ternormalisasi", () => {
    expect(senderKeyOf({ senderJid: "ABC@LID", fromNumber: null })).toBe("abc@lid");
    expect(senderKeyOf({ senderJid: null, fromNumber: "0812-3456-789" })).toBe("628123456789");
    expect(senderKeyOf({ senderJid: null, fromNumber: null })).toBeNull();
  });
});

describe("resolveSender – prioritas berlapis", () => {
  it("1. alias manual menang (menyelesaikan kasus @lid)", () => {
    const r = resolveSender(
      { senderJid: "99887766554433@lid", fromNumber: null, fromName: null, fromMe: false },
      dir,
    );
    expect(r.displayName).toBe("Rheza (PM)");
    expect(r.source).toBe("alias");
    expect(r.needsAlias).toBe(false);
  });

  it("2. pengguna MARLIN dicocokkan lewat nomor (format bebas)", () => {
    const r = resolveSender(
      { senderJid: "628123456789@c.us", fromNumber: "08123456789", fromName: null, fromMe: false },
      dir,
    );
    expect(r.displayName).toBe("Prio Yulianto (site_manager)");
    expect(r.source).toBe("pengguna");
  });

  it("3. kontak WA tersimpan", () => {
    const r = resolveSender(
      { senderJid: null, fromNumber: "628999888777", fromName: null, fromMe: false },
      dir,
    );
    expect(r.displayName).toBe("Direksi");
    expect(r.source).toBe("kontak");
  });

  it("4. nama tampilan WhatsApp dipakai bila benar-benar nama", () => {
    const r = resolveSender(
      { senderJid: "628111@c.us", fromNumber: "628111222333", fromName: "Budi Santoso", fromMe: false },
      dir,
    );
    expect(r.displayName).toBe("Budi Santoso");
    expect(r.source).toBe("whatsapp");
  });

  it("pushName yang isinya cuma nomor TIDAK dipakai sebagai nama", () => {
    const r = resolveSender(
      { senderJid: "628111@c.us", fromNumber: "628111222333", fromName: "+62 811 1222 333", fromMe: false },
      dir,
    );
    expect(r.source).toBe("anonim");
    expect(r.displayName).toContain("…");
  });

  it("5a. LID tanpa nama → label anonim, TIDAK pernah menampilkan kode mentah", () => {
    const r = resolveSender(
      { senderJid: "86350418202744@lid", fromNumber: null, fromName: null, fromMe: false },
      dir,
    );
    expect(r.displayName).toBe("Anggota grup (belum dikenali)");
    expect(r.displayName).not.toContain("86350418202744");
    expect(r.needsAlias).toBe(true);
    expect(r.senderKey).toBe("86350418202744@lid");
  });

  it("5b. nomor tanpa nama → label anonim berakhiran 4 digit (masih bisa dibedakan)", () => {
    const r = resolveSender(
      { senderJid: "628777666555@c.us", fromNumber: "628777666555", fromName: null, fromMe: false },
      dir,
    );
    expect(r.displayName).toBe("Anggota (…6555)");
    expect(r.needsAlias).toBe(true);
  });

  it("kiriman MARLIN sendiri ditandai sistem", () => {
    const r = resolveSender({ senderJid: null, fromNumber: null, fromName: null, fromMe: true }, dir);
    expect(r.displayName).toBe("MARLIN (sistem)");
    expect(r.source).toBe("sistem");
    expect(r.needsAlias).toBe(false);
  });

  it("tanpa direktori tetap aman (tidak melempar)", () => {
    const r = resolveSender(
      { senderJid: "111@lid", fromNumber: null, fromName: null, fromMe: false },
      EMPTY_DIRECTORY,
    );
    expect(r.needsAlias).toBe(true);
  });
});
