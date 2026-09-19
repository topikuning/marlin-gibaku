import "server-only";
import type { TemaDeckKey } from "@/lib/paparan/tema";
import type { LaporanLokasiLengkap } from "./jenis";

/**
 * DECK 16:9 LAPORAN LENGKAP LOKASI — dibangun di atas primitif deck bertema
 * (`lib/pdf/deck-primitives.ts`) yang sama dengan Paparan KKP.
 *
 * Berkas ini sengaja diisi belakangan (tahap 2): renderer deck menunggu
 * primitif bertema selesai. Sampai saat itu pemanggil (unduhan `?bentuk=deck`,
 * balasan WhatsApp "deck <lokasi>") mendapat galat yang JUJUR, bukan PDF
 * kosong.
 */
export class DeckBelumTersediaError extends Error {}

export async function renderLaporanLokasiDeck(
  _l: LaporanLokasiLengkap,
  _opts: { tema?: TemaDeckKey } = {},
): Promise<Buffer> {
  throw new DeckBelumTersediaError("Deck laporan lengkap lokasi belum tersedia.");
}
