/**
 * Identitas pengirim chat grup — MURNI (tanpa DB). Ringkasan untuk pimpinan
 * harus menyebut ORANG, bukan nomor/kode. Prioritas resolusi berlapis karena
 * WhatsApp tidak selalu memberi nama:
 *   1. Alias manual (dipetakan admin) — paling akurat, mengatasi kasus @lid.
 *   2. Pengguna MARLIN yang nomornya cocok (nama + peran).
 *   3. Kontak WA tersimpan.
 *   4. Nama tampilan WhatsApp (pushName/notifyName) dari webhook.
 *   5. Label anonim aman — TIDAK PERNAH menampilkan LID/kode panjang mentah.
 * DECISIONS 138.
 */

export type SenderInput = {
  senderJid: string | null;
  fromNumber: string | null;
  fromName: string | null;
  fromMe: boolean;
};

export type SenderDirectory = {
  /** senderKey (JID mentah atau nomor ternormalisasi) → nama alias manual. */
  aliasByKey: ReadonlyMap<string, { displayName: string; role: string | null }>;
  /** nomor ternormalisasi → pengguna MARLIN. */
  userByPhone: ReadonlyMap<string, { fullName: string; role: string }>;
  /** nomor ternormalisasi → nama kontak WA tersimpan. */
  contactByPhone: ReadonlyMap<string, string>;
};

export const EMPTY_DIRECTORY: SenderDirectory = {
  aliasByKey: new Map(),
  userByPhone: new Map(),
  contactByPhone: new Map(),
};

/** JID privasi WhatsApp (@lid) — tidak memuat nomor telepon yang bisa dicocokkan. */
export function isLidJid(jid: string | null | undefined): boolean {
  return !!jid && /@lid$/i.test(jid);
}

/**
 * Normalisasi nomor Indonesia agar bisa dicocokkan lintas format:
 * "0812-3456-7890", "+62 812 3456 7890", "62812…" → "62812345678890"-style.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (d.startsWith("8")) d = `62${d}`;
  // Buang kode negara ganda "6262…".
  d = d.replace(/^62(62)+/, "62");
  return d.length >= 9 ? d : null;
}

/** Kunci alias: JID mentah bila ada (menangani @lid), jika tidak nomor ternormalisasi. */
export function senderKeyOf(input: Pick<SenderInput, "senderJid" | "fromNumber">): string | null {
  if (input.senderJid) return input.senderJid.toLowerCase();
  const p = normalizePhone(input.fromNumber);
  return p;
}

/** Empat digit terakhir nomor — untuk label anonim yang tetap bisa dibedakan. */
function tailOf(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export type ResolvedSender = {
  /** Nama yang aman ditampilkan/dikirim ke pimpinan. */
  displayName: string;
  /** Sumber nama — untuk UI & keputusan "perlu dipetakan manual atau tidak". */
  source: "alias" | "pengguna" | "kontak" | "whatsapp" | "sistem" | "anonim";
  /** Perlu dipetakan manual (belum punya nama sungguhan). */
  needsAlias: boolean;
  /** Kunci utk membuat alias (null bila tak ada identitas sama sekali). */
  senderKey: string | null;
};

/** Nama tampilan WhatsApp yang sebenarnya cuma nomor/kode → jangan dipakai. */
function isUselessName(name: string | null): boolean {
  if (!name) return true;
  const t = name.trim();
  if (t.length === 0) return true;
  // Hanya digit / +digit / spasi-strip → itu nomor, bukan nama.
  return /^[+\d][\d\s\-()]*$/.test(t);
}

/** Resolusi nama pengirim berlapis. MURNI & unit-tested. */
export function resolveSender(input: SenderInput, dir: SenderDirectory = EMPTY_DIRECTORY): ResolvedSender {
  const key = senderKeyOf(input);

  if (input.fromMe) {
    return { displayName: "MARLIN (sistem)", source: "sistem", needsAlias: false, senderKey: key };
  }

  // 1. Alias manual.
  if (key) {
    const alias = dir.aliasByKey.get(key);
    if (alias) {
      return {
        displayName: alias.role ? `${alias.displayName} (${alias.role})` : alias.displayName,
        source: "alias",
        needsAlias: false,
        senderKey: key,
      };
    }
  }

  const phone = normalizePhone(input.fromNumber);

  // 2. Pengguna MARLIN dgn nomor cocok.
  if (phone) {
    const user = dir.userByPhone.get(phone);
    if (user) {
      return { displayName: `${user.fullName} (${user.role})`, source: "pengguna", needsAlias: false, senderKey: key };
    }
    // 3. Kontak WA tersimpan.
    const contact = dir.contactByPhone.get(phone);
    if (contact) {
      return { displayName: contact, source: "kontak", needsAlias: false, senderKey: key };
    }
  }

  // 4. Nama tampilan WhatsApp (bila benar-benar nama, bukan nomor).
  if (!isUselessName(input.fromName)) {
    return { displayName: input.fromName!.trim(), source: "whatsapp", needsAlias: false, senderKey: key };
  }

  // 5. Label anonim — JANGAN pernah menampilkan LID/kode panjang mentah.
  if (isLidJid(input.senderJid)) {
    return { displayName: "Anggota grup (belum dikenali)", source: "anonim", needsAlias: true, senderKey: key };
  }
  const tail = tailOf(phone);
  return {
    displayName: tail ? `Anggota (…${tail})` : "Anggota grup (belum dikenali)",
    source: "anonim",
    needsAlias: true,
    senderKey: key,
  };
}
