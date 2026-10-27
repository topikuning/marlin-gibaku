import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formatNumber } from "@/lib/format";
import { activateRevision, regenerateBaseline } from "@/lib/rab/import";
import { kalimatKurvaAdendum, kurvaSesudahAdendum } from "@/lib/baseline";
import type { RingkasanPersetujuan } from "@/lib/rab/persetujuan";
import type { RabRevisionSource } from "@/generated/prisma/enums";

/**
 * MENGAKTIFKAN DRAFT REVISI – satu jalan untuk tombol Aktifkan di web dan
 * balasan SETUJU Program Director di WhatsApp (DECISIONS 714).
 *
 * Dipindah dari `activateDraftAction` apa adanya. Dua jalur yang menyalin
 * langkah aktivasi sendiri-sendiri akan berbeda pada langkah yang paling
 * mudah terlewat: penanda CCO, kurva-S adendum, dan kabar penurunan realisasi.
 *
 * GERBANG EMPAT MATA BUKAN di sini: pemanggil wajib sudah melewati
 * `pastikanBolehAktivasi` (atau jalan pintas super admin utama, DECISIONS
 * 682), beserta capability dan akses lokasinya.
 *
 * Melempar bila aktivasinya sendiri gagal (revisi belum berubah). Kegagalan
 * SESUDAH revisi aktif – kurva-S – dikembalikan sebagai `ok: false` dengan
 * kalimat yang menyebut bahwa revisinya SUDAH aktif (audit 2026-07-27, B17).
 */
export async function jalankanAktivasi(o: {
  rev: { id: string; locationId: string; revisionNo: number; source: RabRevisionSource };
  userId: string;
  /** Ada RAB aktif = ini adendum (dihitung pemanggil sebelum gerbang). */
  adendum: boolean;
  /** Terisi = diaktifkan TANPA dua persetujuan oleh super admin utama. */
  persetujuanSaatItu: RingkasanPersetujuan | null;
  /** Untuk jejak audit jalan pintas: dari mana aktivasinya diminta. */
  jalur: string;
}): Promise<{ ok: true; kabar: string } | { ok: false; error: string }> {
  const { rev, userId, adendum, persetujuanSaatItu } = o;
  const aktif = await activateRevision(rev.id, userId);
  if (persetujuanSaatItu) {
    await audit(userId, "rab.aktivasi_tanpa_persetujuan", "rab_revision", rev.id, {
      locationId: rev.locationId,
      revisionNo: rev.revisionNo,
      jalur: o.jalur,
      // Siapa yang SUDAH menyetujui dan apa yang dilewati – supaya jejaknya
      // menyebut persis gerbang mana yang tidak ditunggu.
      sudahSetuju: persetujuanSaatItu.berlaku.map((p) => ({ nama: p.nama, role: p.role })),
      dilewati: persetujuanSaatItu.kurang,
    });
  }
  // Ditandai SESUDAH aktif: menyentuh draft sebelumnya menggeser updatedAt
  // dan menggugurkan suara persetujuan yang baru diperiksa.
  if (adendum) await db.rabRevision.update({ where: { id: rev.id }, data: { awaitingCco: true } });
  // Revisi sudah aktif — kegagalan baseline TIDAK boleh tampil sebagai error
  // generik seolah aktivasi batal (audit 2026-07-27, B17).
  //
  // ADENDUM tidak mengatur ulang kurva-S (DECISIONS 698): bobot mingguannya
  // dibawa apa adanya. Regenerate hanya untuk RAB pertama lokasi.
  let kalimatKurva = "Baseline kurva-S sudah dibuat ulang.";
  try {
    if (adendum) {
      kalimatKurva = kalimatKurvaAdendum(
        await kurvaSesudahAdendum(rev.locationId, rev.id, {
          userId,
          asal: `aktivasi revisi #${rev.revisionNo}`,
        }),
      );
    } else {
      await regenerateBaseline(rev.locationId, {
        source: rev.source === "adendum" ? "adendum" : "auto",
        rabRevisionId: rev.id,
        note: `Regenerate otomatis (aktivasi revisi #${rev.revisionNo})`,
        userId,
      });
    }
  } catch (e) {
    console.error("[rab] baseline gagal diperbarui (revisi sudah aktif):", e);
    return {
      ok: false,
      error:
        `Revisi #${rev.revisionNo} sudah aktif, tetapi kurva-S gagal ` +
        `${adendum ? "disambungkan ke revisi ini" : "dibuat"} ` +
        `(${e instanceof Error ? e.message : "kesalahan tak dikenal"}). ` +
        `Buka Progress › Kurva-S & Baseline untuk memeriksanya.`,
    };
  }
  /*
   * PENYESUAIAN REALISASI DIKATAKAN, bukan cuma masuk audit log.
   *
   * Aktivasi bisa MENURUNKAN volume laporan harian yang sudah dikirim orang —
   * termasuk yang sudah FINAL — ketika volume kontraknya turun di bawah
   * realisasi. DECISIONS 203: penyesuaian angka pengguna wajib dikatakan di
   * UI. Sebelumnya layar hanya bilang "realisasi tersambung otomatis via
   * lineage". Audit 2026-09-15 (E-2).
   */
  const p = aktif.penyesuaian;
  let kabar =
    `Revisi #${rev.revisionNo} aktif` +
    (persetujuanSaatItu ? ` tanpa persetujuan (super admin utama, tercatat di jejak audit)` : "") +
    `. ${kalimatKurva}`;
  if (adendum) kabar += ` Nomor CCO-nya dicatat nanti di Paket › Kontrak & Adendum.`;
  if (p.item > 0) {
    const contoh = p.rincian
      .slice(0, 3)
      .map((x) => `${x.item} ${formatNumber(x.dari)} → ${formatNumber(x.ke)}`)
      .join("; ");
    const adaFinal = p.rincian.some((x) => x.adaFinal);
    kabar +=
      ` PERHATIAN: realisasi ${p.item} item DITURUNKAN mengikuti volume kontrak barunya` +
      ` (${contoh}${p.rincian.length > 3 ? `; +${p.rincian.length - 3} lainnya` : ""})` +
      (adaFinal ? `, termasuk laporan yang sudah FINAL` : "") +
      `. ${p.snapshotDibangunUlang} blanko harian final ikut diperbarui.` +
      ` Rinciannya ada di jejak audit.`;
  }
  return { ok: true, kabar };
}
