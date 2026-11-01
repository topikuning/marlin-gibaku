import type { WorkerRole } from "@/generated/prisma/enums";
import type { BacaanLaporan, BahanDibaca, PekerjaanDibaca, TenagaDibaca } from "./bentuk";
import { angkaId, hariId, namaHari, rapiSatuan, satuanSesudahAngka, tanggalId } from "./baca-angka";

/**
 * Hasil bacaan laporan pelaksana → usulan isi draft (DECISIONS 733). MURNI –
 * dipakai server (pratinjau) DAN klien (status dihitung ulang saat orang
 * mengganti item atau volume).
 *
 * Pilihan user 2026-11-01 untuk volume di atas RAB: *"Tahan + peringatan"* –
 * barisnya ditandai dengan sisa RAB-nya; orang mengubah volumenya,
 * mengarahkannya ke item draft adendum, atau melewatinya. Aturan "volume
 * melebihi kontrak ditolak" tetap berlaku (penjaga di layanan laporan harian
 * memeriksanya lagi saat disimpan).
 */

export type KandidatItem = {
  id: string;
  lineageKey: string;
  kode: string;
  nama: string;
  /** Nama kategori induk dari atas ke bawah – ikut dicocokkan. */
  jalur: string[];
  satuan: string | null;
  volumeRab: number | null;
  /** Sisa yang masih bisa dilaporkan (volume RAB − realisasi terhitung). */
  sisa: number | null;
  basis: "aktif" | "draft_adendum";
  /** Volume item ini yang SUDAH ada di laporan tanggal ini (akan diganti). */
  diLaporan: number | null;
};

export type StatusBaris = "siap" | "melebihi" | "pilih_item" | "satuan_beda" | "tanpa_volume" | "dilewati";

export type BarisUsulan = {
  idx: number;
  no: string | null;
  uraian: string;
  satuanBerkas: string | null;
  catatan: string | null;
  /** Volume yang akan disimpan – awalnya dari berkas, boleh diubah orang. */
  volume: number | null;
  kandidatId: string | null;
  skor: number;
  saran: { id: string; skor: number }[];
  lewati: boolean;
};

/* ── Pencocokan uraian ↔ item RAB ───────────────────────────────────────── */

const KATA_UMUM = new Set([
  "pekerjaan", "pek", "pkj", "dan", "untuk", "dengan", "yang", "di", "ke", "dari", "pada", "atas",
  "menggunakan", "memakai", "secara", "termasuk", "the", "of",
]);

export function token(teks: string): string[] {
  return teks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !KATA_UMUM.has(t));
}

/**
 * Skor 0–1: seberapa banyak kata uraian tertutup nama item (plus nama
 * kategori induknya), dan seberapa banyak kata nama item yang disebut.
 * Satuan yang sama menambah sedikit; satuan yang jelas beda mengurangi.
 */
export function skorCocok(uraian: string, satuanBerkas: string | null, k: KandidatItem): number {
  const u = new Set(token(uraian));
  if (u.size === 0) return 0;
  const namaSaja = new Set(token(k.nama));
  const jalur = new Set(k.jalur.flatMap(token));
  const kena = (s: Set<string>) => [...u].filter((t) => s.has(t)).length;
  const tutupNama = kena(namaSaja) / u.size;
  const tutupSemua = [...u].filter((t) => namaSaja.has(t) || jalur.has(t)).length / u.size;
  const tepat = namaSaja.size ? kena(namaSaja) / namaSaja.size : 0;
  // Nama item RAB KNMP berulang di banyak bangunan ("Galian Tanah" di
  // Shelter, Gudang Beku, Pabrik Es…). Yang membedakannya kategori induk yang
  // ikut disebut di uraian ("… Dinding Penahan Tanah"), jadi cakupan nama +
  // jalur diberi bobot terbesar dan ketepatan nama pendek yang terkecil.
  let skor = 0.55 * tutupSemua + 0.25 * tutupNama + 0.2 * tepat;
  const sb = rapiSatuan(satuanBerkas);
  const sk = rapiSatuan(k.satuan);
  if (sb && sk) skor += sb === sk ? 0.08 : -0.15;
  return Math.max(0, Math.min(1, Math.round(skor * 1000) / 1000));
}

const SKOR_YAKIN = 0.55;
const SELISIH_YAKIN = 0.08;

/** Usulan item untuk satu baris: dipilih otomatis hanya bila jelas unggul. */
export function usulkanItem(
  uraian: string,
  satuanBerkas: string | null,
  kandidat: readonly KandidatItem[],
): { kandidatId: string | null; skor: number; saran: { id: string; skor: number }[] } {
  // Pilihan otomatis hanya dari RAB AKTIF; item draft adendum dipilih orang.
  const nilai = kandidat
    .filter((k) => k.basis === "aktif")
    .map((k) => ({ id: k.id, skor: skorCocok(uraian, satuanBerkas, k) }))
    .filter((s) => s.skor > 0.2)
    .sort((a, b) => b.skor - a.skor);
  const [a, b] = nilai;
  // Nama yang PERSIS sama dengan uraian dipilih bila hanya satu item yang begitu.
  const kunci = token(uraian).join(" ");
  const persis = kandidat.filter((k) => k.basis === "aktif" && token(k.nama).join(" ") === kunci);
  if (persis.length === 1) {
    return { kandidatId: persis[0].id, skor: Math.max(a?.skor ?? 0, 1), saran: nilai.slice(0, 6) };
  }
  const yakin = !!a && a.skor >= SKOR_YAKIN && (!b || a.skor - b.skor >= SELISIH_YAKIN);
  return { kandidatId: yakin ? a.id : null, skor: a?.skor ?? 0, saran: nilai.slice(0, 6) };
}

export function susunUsulan(pekerjaan: readonly PekerjaanDibaca[], kandidat: readonly KandidatItem[]): BarisUsulan[] {
  return pekerjaan.map((p, idx) => {
    const u = usulkanItem(p.uraian, p.satuan, kandidat);
    return {
      idx,
      no: p.no,
      uraian: p.uraian,
      satuanBerkas: p.satuan,
      catatan: p.catatan,
      volume: p.volume != null && p.volume > 0 ? p.volume : null,
      kandidatId: u.kandidatId,
      skor: u.skor,
      saran: u.saran,
      lewati: p.volume == null || p.volume <= 0,
    };
  });
}

/* ── Status baris (dihitung ulang tiap kali orang mengubah sesuatu) ─────── */

const EPS = 1e-6;

export type StatusTerhitung = { status: StatusBaris; pesan: string | null; total: number | null };

/**
 * Status tiap baris. Baris yang menunjuk item yang SAMA dijumlahkan (laporan
 * hanya punya satu baris per item), dan jumlahnya yang diadu dengan sisa RAB.
 */
export function hitungStatus(baris: readonly BarisUsulan[], kandidat: readonly KandidatItem[]): StatusTerhitung[] {
  const byId = new Map(kandidat.map((k) => [k.id, k]));
  const total = new Map<string, number>();
  for (const b of baris) {
    if (b.lewati || !b.kandidatId || b.volume == null || b.volume <= 0) continue;
    total.set(b.kandidatId, (total.get(b.kandidatId) ?? 0) + b.volume);
  }
  return baris.map((b) => {
    if (b.lewati) {
      return {
        status: b.volume == null ? "tanpa_volume" : "dilewati",
        pesan: b.volume == null ? "Berkas tidak menyebut volume – tidak bisa dimasukkan." : "Dilewati.",
        total: null,
      };
    }
    if (b.volume == null || b.volume <= 0) return { status: "tanpa_volume", pesan: "Isi volume dulu.", total: null };
    const k = b.kandidatId ? byId.get(b.kandidatId) : undefined;
    if (!k) return { status: "pilih_item", pesan: "Pilih item RAB-nya.", total: null };
    const jumlah = total.get(k.id) ?? b.volume;
    const sb = rapiSatuan(b.satuanBerkas);
    const sk = rapiSatuan(k.satuan);
    if (k.sisa != null && jumlah > k.sisa + EPS) {
      const draft = k.basis === "aktif" ? " Ubah volumenya, arahkan ke item draft adendum, atau lewati." : "";
      return {
        status: "melebihi",
        pesan: `Melebihi sisa RAB: ${fmt(jumlah)} ${k.satuan ?? ""} > sisa ${fmt(k.sisa)} ${k.satuan ?? ""}.${draft}`.replace(/\s+\./g, "."),
        total: jumlah,
      };
    }
    if (sb && sk && sb !== sk) {
      return { status: "satuan_beda", pesan: `Satuan beda: berkas "${b.satuanBerkas}", RAB "${k.satuan}". Pastikan itemnya benar.`, total: jumlah };
    }
    return { status: "siap", pesan: null, total: jumlah };
  });
}

/** Baris yang boleh disimpan: siap, atau satuan beda yang sudah diterima orangnya. */
export function bolehDisimpan(s: StatusTerhitung, terimaSatuanBeda: boolean): boolean {
  return s.status === "siap" || (s.status === "satuan_beda" && terimaSatuanBeda);
}

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

/* ── Tenaga kerja ───────────────────────────────────────────────────────── */

const JABATAN: { pola: RegExp; role: WorkerRole }[] = [
  { pola: /^penanggung ?jawab( lap(angan)?)?$|^site ?manager$|^sm$/, role: "site_manager" },
  { pola: /^pelaksana( lapangan)?$/, role: "pelaksana" },
  { pola: /^mandor$/, role: "mandor" },
  { pola: /^kepala tukang$/, role: "kepala_tukang" },
  { pola: /^tukang bongkar$/, role: "tukang_bongkar" },
  { pola: /^tukang batu$/, role: "tukang_batu" },
  { pola: /^tukang besi$/, role: "tukang_besi" },
  { pola: /^tukang kayu$/, role: "tukang_kayu" },
  { pola: /^tukang pipa$/, role: "tukang_pipa" },
  { pola: /^tukang listrik$/, role: "tukang_listrik" },
  { pola: /^tukang cat$/, role: "tukang_cat" },
  { pola: /^operator( .*)?$/, role: "operator" },
  { pola: /^(pekerja( terampil)?|tenaga( kerja)?|buruh|kenek|laden)$/, role: "tenaga" },
  { pola: /^logistik$/, role: "logistik" },
];

export type TenagaUsulan = {
  rincian: { jabatan: string; pagi: number | null; siang: number | null; jumlah: number; role: WorkerRole | null }[];
  workers: { role: WorkerRole; count: number }[];
  /** Jabatan berkas tanpa padanan di MARLIN – disebut, tidak dimasukkan diam-diam. */
  tanpaPadanan: string[];
};

export function petakanTenaga(tenaga: readonly TenagaDibaca[]): TenagaUsulan {
  const jumlahRole = new Map<WorkerRole, number>();
  const rincian: TenagaUsulan["rincian"] = [];
  const tanpaPadanan: string[] = [];
  for (const t of tenaga) {
    // Pagi dan siang orang yang sama: yang dicatat jumlah terbesar, bukan dijumlah.
    const jumlah = Math.max(t.pagi ?? 0, t.siang ?? 0);
    if (jumlah <= 0) continue;
    const kunci = t.jabatan.toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
    const role = JABATAN.find((j) => j.pola.test(kunci))?.role ?? null;
    rincian.push({ jabatan: t.jabatan, pagi: t.pagi, siang: t.siang, jumlah, role });
    if (role) jumlahRole.set(role, (jumlahRole.get(role) ?? 0) + jumlah);
    else tanpaPadanan.push(`${t.jabatan} (${jumlah})`);
  }
  return { rincian, workers: [...jumlahRole].map(([role, count]) => ({ role, count })), tanpaPadanan };
}

/* ── Bahan / alat yang datang ───────────────────────────────────────────── */

const ALAT = /excavator|ekskavator|backhoe|loader|bulldozer|dozer|dump ?truck|truk|truck|crane|molen|mixer|concrete pump|vibrator|stamper|genset|generator|compactor|wales|roller|pompa|alat berat|scaffold/i;

export type BahanUsulan = {
  idx: number;
  nama: string;
  merk: string | null;
  jenis: "bahan" | "alat";
  qty: number | null;
  satuan: string | null;
  /** Teks volume diterima apa adanya (mis. "✓" = diterima tanpa jumlah). */
  teksTerima: string | null;
  ditolak: string | null;
  pakai: boolean;
};

export function petakanBahan(bahan: readonly BahanDibaca[]): BahanUsulan[] {
  return bahan.map((b, idx) => {
    const qty = b.teksTerima && b.teksTerima !== "✓" ? angkaId(b.teksTerima) : null;
    const satuan = b.teksTerima && b.teksTerima !== "✓" ? satuanSesudahAngka(b.teksTerima) : null;
    const alat = ALAT.test(b.nama) || /^unit$/i.test(satuan ?? "");
    const nama = b.merk ? `${b.nama} (${b.merk})` : b.nama;
    return {
      idx,
      nama,
      merk: b.merk,
      jenis: alat ? "alat" : "bahan",
      qty,
      satuan,
      teksTerima: b.teksTerima,
      ditolak: b.teksTolak,
      // Barang yang hanya ditolak tidak dihitung masuk.
      pakai: !(b.teksTolak && !b.teksTerima),
    };
  });
}

/* ── Kecocokan berkas dengan laporan yang dituju ────────────────────────── */

export function periksaKonteks(
  bacaan: Pick<BacaanLaporan, "tanggalTeks" | "hariTeks" | "lokasiTeks" | "tahunAnggaran">,
  tujuan: { dateKey: string; namaLokasi: string; desa: string | null },
): { tanggalBerkas: string | null; peringatan: string[] } {
  const peringatan: string[] = [];
  const tanggalBerkas = tanggalId(bacaan.tanggalTeks, bacaan.tahunAnggaran ?? Number(tujuan.dateKey.slice(0, 4)));
  if (!bacaan.tanggalTeks) peringatan.push("Tanggal di berkas tidak terbaca – pastikan berkas ini untuk tanggal laporan yang dibuka.");
  else if (!tanggalBerkas) peringatan.push(`Tanggal di berkas ("${bacaan.tanggalTeks}") tidak terbaca sebagai tanggal.`);
  else if (tanggalBerkas !== tujuan.dateKey) {
    peringatan.push(`Tanggal di berkas ${tglPanjang(tanggalBerkas)}, sedangkan laporan yang dibuka ${tglPanjang(tujuan.dateKey)}. Pastikan berkasnya benar sebelum memasukkan.`);
  }
  const hari = hariId(bacaan.hariTeks);
  if (tanggalBerkas && hari && namaHari(tanggalBerkas) !== hari) {
    peringatan.push(`Di berkas tertulis hari ${besar(hari)}, padahal ${tglPanjang(tanggalBerkas)} jatuh pada hari ${besar(namaHari(tanggalBerkas))}.`);
  }
  const lok = (bacaan.lokasiTeks ?? "").toLowerCase();
  const cocok = [tujuan.desa, tujuan.namaLokasi]
    .filter((s): s is string => !!s && s.trim().length > 2)
    .some((s) => lok.includes(s.toLowerCase().trim()));
  if (bacaan.lokasiTeks && !cocok) {
    peringatan.push(`Lokasi di berkas "${bacaan.lokasiTeks}" tidak menyebut ${tujuan.namaLokasi}. Pastikan berkas ini untuk lokasi ini.`);
  }
  return { tanggalBerkas, peringatan };
}

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const tglPanjang = (k: string) => `${Number(k.slice(8, 10))} ${BULAN[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
const besar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
