/**
 * Manajemen Kontak — util MURNI (tanpa DB), supaya bisa diuji tanpa env.
 * DECISIONS 150.
 *
 * MARLIN menyimpan dua jenis "kontak" yang sering tertukar:
 *
 *  1. KONTAK TUJUAN (`WaContact`) — ke mana laporan dikirim. Milik akun
 *     masing-masing; super admin bisa melihat semuanya.
 *  2. NAMA PENGIRIM (`WaSenderAlias`) — nomor/LID di grup itu siapa. Ini fakta
 *     yang sama untuk semua orang, jadi sengaja dipakai bersama se-organisasi:
 *     sekali dinamai, semua ringkasan siapa pun langsung menyebut nama itu.
 */

export type ContactKind = "tujuan" | "pengirim";

export const CONTACT_KIND_LABEL: Record<ContactKind, string> = {
  tujuan: "Kontak tujuan kirim",
  pengirim: "Nama pengirim grup",
};

/** Bentuk `senderKey` yang tersimpan — menentukan apa yang layak ditampilkan. */
export type SenderKeyKind = "lid" | "kontak" | "grup" | "nomor";

export function senderKeyKind(key: string): SenderKeyKind {
  const k = key.toLowerCase();
  if (k.endsWith("@lid")) return "lid";
  if (k.endsWith("@g.us")) return "grup";
  if (k.endsWith("@c.us")) return "kontak";
  return "nomor";
}

export const SENDER_KEY_LABEL: Record<SenderKeyKind, string> = {
  lid: "ID privasi WhatsApp",
  kontak: "Kontak WhatsApp",
  grup: "Grup WhatsApp",
  nomor: "Nomor WhatsApp",
};

/**
 * Tampilan kunci pengirim yang ramah dibaca. LID adalah kode panjang tak
 * bermakna — dipendekkan supaya tabel tidak berantakan, tetapi TIDAK dibuang
 * karena admin butuh membedakan dua LID yang mirip.
 */
export function formatSenderKey(key: string): string {
  const kind = senderKeyKind(key);
  if (kind === "nomor") return `+${key.replace(/^\+/, "")}`;
  const [local, domain] = key.split("@");
  // LID = kode panjang tak bermakna; dipendekkan tapi ujungnya dipertahankan
  // supaya dua LID mirip masih bisa dibedakan.
  if (kind === "lid" && local.length > 12) return `${local.slice(0, 6)}…${local.slice(-4)}@${domain}`;
  // "…@c.us" isinya nomor telepon; "…@g.us" ID grup (bukan nomor, jangan diberi +).
  return kind === "kontak" ? `+${local}@${domain}` : key;
}

/** Pencarian bebas di halaman kontak — satu kotak untuk semua kolom. */
export function matchesQuery(
  row: { name: string; detail: string; note?: string | null; owner?: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [row.name, row.detail, row.note ?? "", row.owner ?? ""].join(" ").toLowerCase();
  // Semua kata harus ada (AND), supaya "prio mandor" menyempit, bukan melebar.
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/**
 * Nomor Indonesia → format internasional tanpa tanda apa pun.
 * WhatsApp HANYA mengenal bentuk ini; "0812…" yang disimpan apa adanya tidak
 * akan pernah terkirim, dan gagalnya baru ketahuan saat kirim.
 */
export function toInternationalId(digitsRaw: string): string {
  let d = digitsRaw.replace(/[^0-9]/g, "");
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (d.startsWith("8")) d = `62${d}`;
  // Kode negara ganda hasil salin-tempel ("62628…").
  return d.replace(/^62(62)+/, "62");
}

/**
 * Normalisasi tujuan WA ke format yang dimengerti WAHA. Nomor polos apa pun
 * bentuknya ("0812-3456-7890", "+62 812…", "812…") jadi "628…@c.us"; ID
 * grup/kontak yang sudah lengkap dibiarkan apa adanya.
 */
export function normalizeWaTarget(raw: string): string {
  const t = raw.trim();
  if (!t) throw new Error("Tujuan WA kosong.");
  if (t.endsWith("@g.us") || t.endsWith("@c.us") || t.endsWith("@s.whatsapp.net")) return t;
  const digits = t.replace(/[^0-9]/g, "");
  if (digits.length >= 8) return `${toInternationalId(digits)}@c.us`;
  throw new Error(`Format tujuan WA tidak dikenal: ${raw} (pakai nomor WA, atau id grup …@g.us).`);
}

/** Urutan tampil: nama (Indonesia, case-insensitive), stabil. */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, "id", { sensitivity: "base" });
}
