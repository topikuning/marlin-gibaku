import type { Peristiwa } from "@/lib/kronologi/susun";
import { AMBANG } from "@/lib/ews/rules";
import type { BabakKronologiLokasi, LaporanLokasiLengkap } from "./jenis";

/**
 * KESIMPULAN LOKASI — templat DETERMINISTIK, MURNI (tanpa DB, tanpa
 * "server-only", tanpa model AI).
 *
 * Permintaan user 2026-09-19: "kalau aku minta kronologi atau kesimpulan atas
 * satu lokasi … buatkan laporan lengkap". Kesimpulannya dipakai tiga tempat
 * sekaligus — balasan WhatsApp, pembuka PDF, kepala layar — jadi ia disusun
 * SEKALI dari snapshot yang sama; renderer tidak boleh punya kalimatnya
 * sendiri. Tidak ada angka yang dihitung di sini: setiap angka dibaca apa
 * adanya dari `LaporanLokasiLengkap`, berkas ini hanya memformatnya.
 *
 * Bentuknya tiga kalimat, tiap kalimat ≤ 220 karakter (WhatsApp memotong dari
 * bawah; kalimat panjang justru hilang bagian akhirnya):
 *   1. nama lokasi + posisi progres (atau kejujuran: belum berkontrak / belum
 *      ada RAB / belum punya kurva-S);
 *   2. apa yang menahannya — atau "tidak ada penahan" bila memang tidak ada;
 *   3. kondisi terkini (laporan/kegiatan terakhir, konsumsi waktu bila mencolok)
 *      — boleh kosong HANYA bila memang tidak ada bahannya.
 */

export const MAKS_KARAKTER_KALIMAT = 220;

const NAMA_BULAN = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/** Angka Indonesia: koma desimal, satu digit. */
function angka(n: number, digit = 1): string {
  return n.toLocaleString("id-ID", { minimumFractionDigits: digit, maximumFractionDigits: digit });
}

function persen(n: number): string {
  return `${angka(n)}%`;
}

/** Deviasi bertanda: "+3,4 pp" / "-6,5 pp" / "0,0 pp". */
function pp(n: number): string {
  const s = angka(n);
  return `${n > 0 && !/^[-0,]+$/.test(s) ? "+" : ""}${s} pp`;
}

/**
 * Potong di batas kata bila melewati batas karakter. Batas karakter, bukan
 * batas kalimat: `potongKalimat` (lib/kalimat) memotong per KALIMAT, sedangkan
 * satu kalimat templat di sini bisa saja kepanjangan karena judul kendala yang
 * panjang.
 */
function batasi(teks: string, maks = MAKS_KARAKTER_KALIMAT): string {
  const rapi = teks.replace(/\s+/g, " ").trim();
  if (rapi.length <= maks) return rapi;
  const potong = rapi.slice(0, maks - 1);
  const spasi = potong.lastIndexOf(" ");
  return `${(spasi > maks * 0.6 ? potong.slice(0, spasi) : potong).replace(/[,;:(–-]+$/, "")}…`;
}

/** Ringkas judul supaya kalimat tidak dikuasai satu judul kendala yang panjang. */
function judulRingkas(judul: string, maks = 60): string {
  const rapi = judul.replace(/\s+/g, " ").trim();
  return rapi.length <= maks ? rapi : `${rapi.slice(0, maks - 1).trimEnd()}…`;
}

/* ── Kalimat 1: posisi progres ─────────────────────────────────────────── */

function kalimatPosisi(l: Omit<LaporanLokasiLengkap, "kesimpulan">): string {
  const nama = l.identitas.nama;
  const p = l.progres;

  if (!l.identitas.kontrak) {
    // Tanpa SPMK tidak ada minggu kontrak; angka realisasi hanya disebut bila
    // memang ada RAB yang bisa dilaporkan.
    const ekor = !p.punyaRab
      ? "belum ada RAB"
      : p.realisasiPct > 0
        ? `realisasi tercatat ${persen(p.realisasiPct)}`
        : "belum ada realisasi tercatat";
    return `${nama} belum berkontrak (SPMK belum ada), jadi posisi minggu kontraknya belum bisa dihitung; ${ekor}.`;
  }
  if (!p.punyaRab) {
    return `${nama} berada pada minggu ke-${p.mingguKe} kontrak tetapi belum ada RAB aktif, jadi realisasi dan rencananya belum bisa dihitung.`;
  }
  if (!p.punyaKurva || p.rencanaPct == null || p.deviasiPp == null) {
    return `${nama} berada pada minggu ke-${p.mingguKe} kontrak dengan realisasi ${persen(p.realisasiPct)}, tetapi belum punya kurva-S sehingga deviasinya belum bisa diukur.`;
  }
  return `${nama} ${posisiMinggu(p.mingguKe, p.totalMinggu)} dengan realisasi ${persen(p.realisasiPct)} terhadap rencana ${persen(p.rencanaPct)} (deviasi ${pp(p.deviasiPp)}).`;
}

/**
 * Posisi minggu yang MASUK AKAL DIBACA ORANG.
 *
 * Minggu berjalan dihitung dari SPMK dan tidak berhenti di akhir kontrak, jadi
 * kontrak yang sudah lewat menghasilkan "minggu ke-23 dari 22" — kalimat yang
 * membuat pembaca berhenti dan bertanya-tanya alih-alih menangkap keadaannya
 * (laporan produksi 2026-09-19). Angkanya tidak diubah; yang diperbaiki cara
 * mengatakannya, dan keterlambatannya justru disebut.
 */
export function posisiMinggu(mingguKe: number, totalMinggu: number): string {
  if (totalMinggu <= 0) return `berada pada minggu ke-${mingguKe} kontrak`;
  if (mingguKe > totalMinggu) {
    const lewat = mingguKe - totalMinggu;
    return `sudah melewati akhir masa kontrak ${totalMinggu} minggu (kini minggu ke-${mingguKe}, lewat ${lewat} minggu)`;
  }
  return `berada pada minggu ke-${mingguKe} dari ${totalMinggu}`;
}

/** Nilai + keterangan kartu "Minggu kontrak" — dipakai PDF dan layar. */
export function kartuMinggu(
  mingguKe: number,
  totalMinggu: number,
  punyaKontrak: boolean,
): { nilai: string; sub: string } {
  if (!punyaKontrak) return { nilai: "–", sub: "belum berkontrak" };
  if (totalMinggu <= 0) return { nilai: `ke-${mingguKe}`, sub: "kurva-S belum ada" };
  if (mingguKe > totalMinggu) {
    return { nilai: `ke-${mingguKe}`, sub: `lewat ${mingguKe - totalMinggu} minggu dari ${totalMinggu}` };
  }
  return { nilai: `ke-${mingguKe} / ${totalMinggu}`, sub: "dari panjang kurva-S" };
}

/* ── Kalimat 2: penahan ────────────────────────────────────────────────── */

function kalimatPenahan(l: Omit<LaporanLokasiLengkap, "kesimpulan">): string {
  const bagian: string[] = [];
  const r = l.kendala.ringkas;

  if (r.terbuka > 0) {
    // Yang disebut namanya: kendala terbuka yang lewat tenggat TERTUA; kalau
    // tidak ada yang lewat tenggat, kendala terbuka tertua (daftar sudah
    // terlama dulu dari snapshot).
    const contoh = l.kendala.terbuka.find((k) => k.lewatTenggat) ?? l.kendala.terbuka[0] ?? null;
    let s = `${r.terbuka} kendala terbuka`;
    if (r.lewatTenggat > 0) s += `, ${r.lewatTenggat} di antaranya lewat tenggat`;
    if (contoh) s += ` (${judulRingkas(contoh.judul)}, ${contoh.umurHari} hari)`;
    bagian.push(s);
  }

  const t = l.temuan.ringkas;
  if (t.kritis > 0) bagian.push(`${t.kritis} temuan kritis belum ditutup`);
  if (t.lewatTenggat > 0) bagian.push(`${t.lewatTenggat} temuan lewat tenggat tindak lanjut`);

  const k = l.kelengkapan;
  if (k && k.hariTanpaLaporan > 0) {
    bagian.push(`${k.hariTanpaLaporan} hari tanpa laporan harian dari ${k.hariDiharapkan} hari yang diharapkan`);
  }

  if (bagian.length === 0) {
    return "Tidak ada penahan yang tercatat: tidak ada kendala terbuka, temuan kritis atau lewat tenggat, maupun hari tanpa laporan.";
  }
  return `Yang menahan: ${bagian.join("; ")}.`;
}

/* ── Kalimat 3: kondisi terkini ────────────────────────────────────────── */

function kalimatKondisi(l: Omit<LaporanLokasiLengkap, "kesimpulan">): string | null {
  const bagian: string[] = [];

  const k = l.kelengkapan;
  if (k) {
    if (k.laporanTerakhirKey && k.hariSejakLaporanTerakhir != null) {
      bagian.push(
        k.hariSejakLaporanTerakhir <= 0
          ? "laporan harian terakhir masuk hari ini"
          : `laporan harian terakhir ${k.hariSejakLaporanTerakhir} hari lalu (${k.laporanTerakhirKey})`,
      );
    } else if (k.hariDiharapkan > 0) {
      bagian.push("belum ada satu pun laporan harian terhitung sejak SPMK");
    }
  }

  const g = l.kegiatan.terakhir[0];
  if (g) bagian.push(`kegiatan lapangan terakhir ${judulRingkas(g.judul, 48)} (${g.tanggalKey})`);

  // Konsumsi waktu vs realisasi — disebut hanya bila MENCOLOK, dengan ambang
  // yang SAMA dengan EWS (`konsumsi_waktu`), bukan ambang baru.
  const d = l.durasi;
  if (d && l.progres.punyaRab && d.pctWaktu - l.progres.realisasiPct > AMBANG.konsumsiWaktuSenjangPp) {
    bagian.push(
      `waktu kontrak sudah terpakai ${angka(d.pctWaktu, 0)}% (sisa ${d.sisaHari} hari) sementara realisasi baru ${persen(l.progres.realisasiPct)}`,
    );
  }

  if (bagian.length === 0) return null;
  const teks = bagian.join("; ");
  return `${teks.charAt(0).toUpperCase()}${teks.slice(1)}.`;
}

/**
 * 2–3 kalimat kesimpulan. Deterministik: masukan yang sama selalu menghasilkan
 * teks yang sama, jadi WhatsApp, PDF, dan layar tidak pernah berbeda.
 */
export function kesimpulanLokasi(l: Omit<LaporanLokasiLengkap, "kesimpulan">): string[] {
  const kalimat = [kalimatPosisi(l), kalimatPenahan(l), kalimatKondisi(l)];
  return kalimat.filter((s): s is string => s != null && s.length > 0).map((s) => batasi(s));
}

/* ── Kronologi per babak bulan ─────────────────────────────────────────── */

/** "2026-09" → "September 2026". Kunci di luar bentuk itu dikembalikan apa adanya. */
export function labelBulan(bulanKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(bulanKey);
  if (!m) return bulanKey;
  const idx = Number(m[2]) - 1;
  const nama = NAMA_BULAN[idx];
  return nama ? `${nama} ${m[1]}` : bulanKey;
}

/**
 * Kelompokkan peristiwa per BULAN (dari `tanggal` "YYYY-MM-DD"), terbaru dulu.
 * Urutan di dalam satu bulan dipertahankan dari masukan — `susunKronologi`
 * sudah mengurutkannya (terbaru dulu, yang berjalan lebih dulu), dan aturan
 * urutan itu tidak ditulis ulang di sini.
 */
export function babakBulanan(peristiwa: Peristiwa[]): BabakKronologiLokasi[] {
  const peta = new Map<string, Peristiwa[]>();
  for (const p of peristiwa) {
    const key = p.tanggal.slice(0, 7);
    const daftar = peta.get(key);
    if (daftar) daftar.push(p);
    else peta.set(key, [p]);
  }
  return [...peta.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([bulanKey, daftar]) => ({ bulanKey, label: labelBulan(bulanKey), peristiwa: daftar }));
}
