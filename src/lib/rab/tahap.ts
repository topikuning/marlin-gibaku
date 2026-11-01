import type { RabRevisionSource, RevisionStatus } from "@/generated/prisma/enums";

/**
 * TAHAP REVISI RAB: Kontrak → MC-0 → CCO-01 → CCO-02 … (DECISIONS 728).
 *
 * Ketetapan user 2026-11-01: *"kamu harus bedakan mana itu perbaikan, mana
 * adendum, lalu sebelum adendum ada namanya MC-0/CCO-0"* dan *"ini soal
 * keseluruhan lokasi dan proses, jadi jangan kamu perbaiki case by case"*.
 *
 * Nomor tahap DITURUNKAN dari riwayat, tidak disimpan dan tidak dipilih orang:
 * - `hps_awal` = RAB kontrak;
 * - `koreksi`  = perbaikan oleh super admin, BUKAN tahap – tidak menggeser
 *   nomor apa pun;
 * - `adendum`  = perubahan kontrak: yang PERTAMA sesudah kontrak adalah MC-0
 *   (Mutual Check 0% = CCO-0), sesudahnya CCO-01, CCO-02, … menurut urutan
 *   nomor revisi.
 *
 * Dulu nomor CCO dihitung dari nomor revisi dikurangi satu. Revisi apa pun
 * yang bukan adendum – koreksi lewat "Jadikan RAB AKTIF" – ikut terhitung, dan
 * draft adendum pertama sebuah lokasi tercetak CCO-02 (laporan user Buyat
 * Tengah). Tahap MC-0 juga tidak ada sama sekali.
 *
 * MURNI: tanpa DB.
 */

export type RevisiUntukTahap = {
  id: string;
  revisionNo: number;
  source: RabRevisionSource;
  status: RevisionStatus;
};

export type Tahap =
  | { jenis: "kontrak"; label: string; labelDokumen: string }
  | { jenis: "koreksi"; label: string }
  | { jenis: "mc0"; label: string; labelDokumen: string }
  | { jenis: "cco"; ke: number; label: string; labelDokumen: string };

const dua = (n: number) => String(n).padStart(2, "0");

/** Tahap tiap revisi lokasi, menurut riwayatnya sendiri. */
export function tahapRevisi(daftar: readonly RevisiUntukTahap[]): Map<string, Tahap> {
  const hasil = new Map<string, Tahap>();
  let perubahan = 0;
  for (const r of [...daftar].sort((a, b) => a.revisionNo - b.revisionNo)) {
    if (r.source === "hps_awal") {
      hasil.set(r.id, { jenis: "kontrak", label: "RAB kontrak", labelDokumen: "KONTRAK" });
    } else if (r.source === "koreksi") {
      hasil.set(r.id, { jenis: "koreksi", label: "Koreksi" });
    } else {
      if (perubahan === 0) hasil.set(r.id, { jenis: "mc0", label: "MC-0", labelDokumen: "MC - 0" });
      else hasil.set(r.id, { jenis: "cco", ke: perubahan, label: `CCO-${dua(perubahan)}`, labelDokumen: `CCO - ${dua(perubahan)}` });
      perubahan++;
    }
  }
  return hasil;
}

/**
 * Label dokumen tahap yang BERLAKU pada revisi `revisiId`: koreksi bukan
 * tahap, jadi yang dipakai tahap terakhir sebelum (atau pada) revisi itu.
 * Dipakai sebagai blok DASAR dokumen MC-0/CCO.
 */
export function labelTahapBerlaku(daftar: readonly RevisiUntukTahap[], revisiId: string): string {
  const tahap = tahapRevisi(daftar);
  const urut = [...daftar].sort((a, b) => a.revisionNo - b.revisionNo);
  const batas = urut.find((r) => r.id === revisiId)?.revisionNo ?? Number.POSITIVE_INFINITY;
  let label = "KONTRAK";
  for (const r of urut) {
    if (r.revisionNo > batas) break;
    const t = tahap.get(r.id);
    if (t && t.jenis !== "koreksi") label = t.labelDokumen;
  }
  return label;
}
