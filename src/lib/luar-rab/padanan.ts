import { rapiSatuan } from "@/lib/daily-report/impor-pelaksana/baca-angka";
import { skorCocok, token, type KandidatItem } from "@/lib/daily-report/impor-pelaksana/cocok";

/**
 * PEKERJAAN DI LUAR RAB → item draft adendum (DECISIONS 738). MURNI – dipakai
 * server (usulan awal) DAN klien (status dihitung ulang saat orang mengganti
 * pilihan).
 *
 * Ketetapan user 2026-11-04: saran padanan dibuat sistem, *"tapi sifatnya
 * saran"*, tetap bisa diubah sebelum digabung. Karena itu usulannya HATI-HATI:
 * item dipilih otomatis hanya bila jelas unggul, satuannya sama, dan namanya
 * tidak kembar. Sisanya dibiarkan kosong dengan daftar saran – memilih yang
 * salah lebih mahal daripada tidak memilih.
 */

export type CatatanPadan = {
  id: string;
  /** Laporan harian tempat catatan dicatat – baris hasil gabung masuk ke sini. */
  reportId: string;
  tanggal: string;
  uraian: string;
  satuan: string;
  volume: number;
};

export type KandidatDraft = {
  id: string;
  lineageKey: string;
  kode: string;
  nama: string;
  jalur: string[];
  satuan: string | null;
  volumeDraft: number | null;
  /**
   * Volume draft yang masih kosong: volume draft − seluruh baris laporan
   * lineage ini (semua status, kedua basis). Semua status, bukan hanya yang
   * terhitung: baris yang masuk ke laporan draft akan ikut terhitung begitu
   * laporannya dikirim, dan penjaga kirim akan menolaknya di sana – jauh dari
   * orang yang memadankannya.
   */
  sisa: number | null;
  /** Item baru di draft (lineage-nya tidak ada di RAB aktif). */
  baru: boolean;
};

export type Saran = { id: string; skor: number };

export type UsulanCatatan = { kandidatId: string | null; skor: number; saran: Saran[]; alasanKosong: string | null };

const SKOR_YAKIN = 0.55;
const SELISIH_YAKIN = 0.08;
const SKOR_SARAN = 0.2;

const sebagaiKandidat = (k: KandidatDraft): KandidatItem => ({
  id: k.id,
  lineageKey: k.lineageKey,
  kode: k.kode,
  nama: k.nama,
  jalur: k.jalur,
  satuan: k.satuan,
  volumeRab: k.volumeDraft,
  sisa: k.sisa,
  basis: "draft_adendum",
  diLaporan: null,
});

const kunciNama = (nama: string) => token(nama).join(" ");

/**
 * Usulan item draft untuk satu catatan. `alasanKosong` menyebut kenapa tidak
 * ada yang dipilih otomatis – supaya "kosong" tidak terbaca "tidak ada yang
 * mirip".
 */
export function usulkanPadanan(c: Pick<CatatanPadan, "uraian" | "satuan">, kandidat: readonly KandidatDraft[]): UsulanCatatan {
  const nilai = kandidat
    .map((k) => ({ id: k.id, skor: skorCocok(c.uraian, c.satuan, sebagaiKandidat(k)) }))
    .filter((s) => s.skor > SKOR_SARAN)
    .sort((a, b) => b.skor - a.skor);
  const saran = nilai.slice(0, 6);
  const [a, b] = nilai;
  if (!a) return { kandidatId: null, skor: 0, saran, alasanKosong: "Tidak ada item draft yang mirip." };

  const byId = new Map(kandidat.map((k) => [k.id, k]));
  const unggul = byId.get(a.id)!;
  const kembar = kandidat.filter((k) => kunciNama(k.nama) === kunciNama(unggul.nama)).length > 1;
  if (kembar) {
    return { kandidatId: null, skor: a.skor, saran, alasanKosong: `Ada beberapa item bernama "${unggul.nama}" – pilih sendiri yang benar.` };
  }
  const sc = rapiSatuan(c.satuan);
  const sk = rapiSatuan(unggul.satuan);
  if (!sc || !sk || sc !== sk) {
    return { kandidatId: null, skor: a.skor, saran, alasanKosong: "Satuan item yang paling mirip berbeda – pilih sendiri." };
  }
  const persis = kunciNama(c.uraian) === kunciNama(unggul.nama);
  const yakin = persis || (a.skor >= SKOR_YAKIN && (!b || a.skor - b.skor >= SELISIH_YAKIN));
  if (!yakin) return { kandidatId: null, skor: a.skor, saran, alasanKosong: "Beberapa item sama miripnya – pilih sendiri." };
  return { kandidatId: a.id, skor: persis ? Math.max(a.skor, 1) : a.skor, saran, alasanKosong: null };
}

/* ── Status pilihan (dihitung ulang tiap kali orang mengubah pilihan) ───── */

export type PilihanPadan = { catatanId: string; kandidatId: string | null; terimaSatuanBeda: boolean };

/**
 * Baris laporan yang SUDAH ada untuk (laporan, lineage). `dariCatatan` = isinya
 * seluruhnya berasal dari catatan di luar RAB yang dipadankan (volumenya sama
 * dengan jumlah catatannya) – catatan berikutnya boleh menumpang di baris itu.
 * Baris yang diisi langsung tidak disentuh: menjumlahkan diam-diam berarti
 * mengubah angka yang ditulis orang lain.
 */
export type BarisAda = { volume: number; dariCatatan: boolean };

export type StatusPadan = "pilih_item" | "siap" | "satuan_beda" | "melebihi" | "bentrok";

export type HasilStatus = { status: StatusPadan; pesan: string | null };

const EPS = 1e-6;
const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

export function kunciBaris(reportId: string, lineageKey: string): string {
  return `${reportId}|${lineageKey}`;
}

export function statusPadanan(
  catatan: readonly CatatanPadan[],
  pilihan: readonly PilihanPadan[],
  kandidat: readonly KandidatDraft[],
  barisAda: ReadonlyMap<string, BarisAda>,
): Map<string, HasilStatus> {
  const byId = new Map(kandidat.map((k) => [k.id, k]));
  const pilih = new Map(pilihan.map((p) => [p.catatanId, p]));
  // Catatan yang menunjuk item yang sama dijumlahkan; jumlahnya yang diadu
  // dengan sisa draft.
  const total = new Map<string, number>();
  for (const c of catatan) {
    const k = pilih.get(c.id)?.kandidatId;
    if (k && byId.has(k)) total.set(k, (total.get(k) ?? 0) + c.volume);
  }
  const hasil = new Map<string, HasilStatus>();
  for (const c of catatan) {
    const p = pilih.get(c.id);
    const k = p?.kandidatId ? byId.get(p.kandidatId) : undefined;
    if (!p || !k) {
      hasil.set(c.id, { status: "pilih_item", pesan: null });
      continue;
    }
    const ada = barisAda.get(kunciBaris(c.reportId, k.lineageKey));
    if (ada && !ada.dariCatatan) {
      hasil.set(c.id, {
        status: "bentrok",
        pesan:
          `Laporan ${c.tanggal} sudah punya baris "${k.nama}" (${fmt(ada.volume)} ${k.satuan ?? ""}) yang diisi langsung. ` +
          "Tambahkan volumenya di laporan itu, atau pilih item lain.",
      });
      continue;
    }
    const jumlah = total.get(k.id) ?? c.volume;
    if (k.sisa != null && jumlah > k.sisa + EPS) {
      hasil.set(c.id, {
        status: "melebihi",
        pesan:
          `Melebihi sisa volume draft: ${fmt(jumlah)} ${k.satuan ?? ""} > sisa ${fmt(Math.max(0, k.sisa))} ${k.satuan ?? ""}. ` +
          "Naikkan volume item ini di draft, atau pilih item lain.",
      });
      continue;
    }
    const sc = rapiSatuan(c.satuan);
    const sk = rapiSatuan(k.satuan);
    if (sc && sk && sc !== sk && !p.terimaSatuanBeda) {
      hasil.set(c.id, {
        status: "satuan_beda",
        pesan: `Satuan beda: catatan "${c.satuan}", item draft "${k.satuan}". Centang bila memang benar.`,
      });
      continue;
    }
    hasil.set(c.id, { status: "siap", pesan: null });
  }
  return hasil;
}

/* ── Rencana penulisan: satu baris laporan per (laporan, item) ──────────── */

export type RencanaBaris = { reportId: string; kandidatId: string; lineageKey: string; catatanIds: string[]; volume: number };

/**
 * Catatan berstatus `siap` dikelompokkan per (laporan, item): laporan harian
 * hanya punya satu baris per item, jadi dua catatan di hari yang sama untuk
 * item yang sama menjadi satu baris berisi jumlahnya.
 */
export function rencanaGabung(
  catatan: readonly CatatanPadan[],
  pilihan: readonly PilihanPadan[],
  kandidat: readonly KandidatDraft[],
  status: ReadonlyMap<string, HasilStatus>,
): RencanaBaris[] {
  const byId = new Map(kandidat.map((k) => [k.id, k]));
  const pilih = new Map(pilihan.map((p) => [p.catatanId, p]));
  const grup = new Map<string, RencanaBaris>();
  for (const c of catatan) {
    if (status.get(c.id)?.status !== "siap") continue;
    const k = byId.get(pilih.get(c.id)!.kandidatId!)!;
    const kunci = kunciBaris(c.reportId, k.lineageKey);
    const g = grup.get(kunci);
    if (g) {
      g.catatanIds.push(c.id);
      g.volume = Math.round((g.volume + c.volume) * 1000) / 1000;
    } else {
      grup.set(kunci, { reportId: c.reportId, kandidatId: k.id, lineageKey: k.lineageKey, catatanIds: [c.id], volume: c.volume });
    }
  }
  return [...grup.values()];
}
