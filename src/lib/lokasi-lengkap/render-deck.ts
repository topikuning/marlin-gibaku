import "server-only";
import sharp from "sharp";
import { isR2Configured, r2GetBuffer } from "@/lib/r2";
import { DECK_169, PDF_FONT, createDeck169Doc, docToBuffer, sanitizeText } from "@/lib/pdf/document";
import {
  barBand,
  bingkaiGelap,
  buatDeckCtx,
  butirList,
  footerSlide,
  gambarKurva,
  judulSlide,
  kartuAngka,
  kartuBernomor,
  latarSlide,
  potongTeks,
  renderPenutupDeck,
  renderSampulDeck,
  slideGelap,
  tabel,
  warnaGaris,
  warnaRedup,
  warnaSamar,
  warnaTeks,
  type DeckCtx,
} from "@/lib/pdf/deck-primitives";
// Ambang band bar status dipinjam dari paparan, tidak disalin: dua ambang yang
// sama-sama "70/40/20" akan berbeda pada perubahan berikutnya.
import { bandStatus } from "@/lib/paparan/susun";
import { temaDeck, type TemaDeckKey } from "@/lib/paparan/tema";
import { EWS_KATEGORI_LABEL, EWS_SEVERITY_LABEL, type EwsSeverity } from "@/lib/ews/rules";
import { ISSUE_SEVERITY_LABEL } from "@/lib/lifecycle";
import { formatPct, formatRupiah, formatTanggal, parseDateKey } from "@/lib/format";
import type { LaporanLokasiLengkap } from "./jenis";

/**
 * DECK 16:9 LAPORAN LENGKAP LOKASI — dibangun di atas primitif deck bertema
 * (`lib/pdf/deck-primitives.ts`) yang sama dengan Paparan KKP, jadi keempat
 * tema (`lib/paparan/tema.ts`) berlaku di sini tanpa satu pun hex tetap.
 *
 * Isinya SNAPSHOT `LaporanLokasiLengkap` apa adanya: berkas ini memformat dan
 * menata, tidak menghitung. Tidak ada penjumlahan, rata-rata, maupun selisih di
 * sini — angka yang belum ada di snapshot tidak boleh muncul di slide.
 *
 * Bagian yang datanya tidak ada DILEWATI, bukan dicetak sebagai nol: deck tanpa
 * kurva-S tidak memuat slide kurva, dan lokasi tanpa kendala tidak memuat slide
 * kendala kosong yang terbaca seperti "sudah beres".
 */

/**
 * Dipertahankan walau tidak dilempar lagi: route unduhan dan jalur WhatsApp
 * masih menangkapnya, dan mencabutnya dari sini akan mematahkan keduanya pada
 * saat yang sama. Deck-nya sendiri sudah ada (DECISIONS 590).
 */
export class DeckBelumTersediaError extends Error {}

const W = DECK_169.width;
const H = DECK_169.height;
const MX = 52;
const CW = W - MX * 2;

const s = sanitizeText;

/* ── Pemformat kecil — sama dengan PDF A4 lokasi supaya angkanya terbaca sama ─ */

function tgl(key: string | null | undefined): string {
  if (!key) return "–";
  const d = parseDateKey(key);
  return d ? formatTanggal(d) : key;
}

function pctAtau(v: number | null | undefined, kosong = "–"): string {
  return v == null ? kosong : formatPct(v);
}

function pp(v: number | null | undefined): string {
  if (v == null) return "–";
  const teks = v.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${v > 0 ? "+" : ""}${teks} pp`;
}

function rupiah(v: string): string {
  try {
    return formatRupiah(BigInt(v));
  } catch {
    return v;
  }
}

/** Pecah daftar jadi potongan berukuran `n` (untuk slide bersambung). */
function potong<T>(daftar: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < daftar.length; i += n) out.push(daftar.slice(i, i + n));
  return out;
}

/** Judul slide bersambung: "Judul (2/3)" bila lebih dari satu bagian. */
function judulBagian(judul: string, bagian: number, total: number): string {
  return total > 1 ? `${judul} (${bagian}/${total})` : judul;
}

/* ── Foto ───────────────────────────────────────────────────────────────── */

/**
 * Foto sebagai DATA URI base64 — bukan Buffer — karena bundle pdfkit yang
 * di-vendor menstub `fs` (jebakan DECISIONS 129; pola sama dengan
 * `paparan/render-pdf.ts`). null = R2 mati/gagal → placeholder, bukan deck
 * gagal.
 */
async function ambilFoto(r2Key: string): Promise<string | null> {
  if (!isR2Configured()) return null;
  try {
    const raw = await r2GetBuffer(r2Key);
    const jpeg = await sharp(raw)
      .rotate()
      .resize(1400, 900, { fit: "cover", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

/* ── Warna per severity (dari palet tema, bukan hex tetap) ──────────────── */

function warnaSeverity(ctx: DeckCtx, severity: EwsSeverity): string {
  const p = ctx.tema.palet;
  if (severity === "kritis") return p.merah;
  if (severity === "tinggi") return p.oranye;
  return p.biru;
}

/** Teks kecil satu baris di bawah isi slide — catatan, bukan angka baru. */
function catatan(ctx: DeckCtx, teks: string, y: number, gelap: boolean): void {
  ctx.doc.font(PDF_FONT.regular).fontSize(9).fillColor(warnaRedup(ctx, gelap));
  ctx.doc.text(s(teks), MX, y, { width: CW });
}

/* ── Slide: sampul ──────────────────────────────────────────────────────── */

function slideSampul(ctx: DeckCtx, l: LaporanLokasiLengkap): void {
  const p = ctx.tema.palet;
  const g = l.progres;
  const id = l.identitas;
  const wilayah = [id.desa, id.kecamatan ? `Kec. ${id.kecamatan}` : null, id.kabupaten, id.provinsi]
    .filter(Boolean)
    .join(", ");
  renderSampulDeck(ctx, {
    eyebrow: `LAPORAN LENGKAP LOKASI  ·  s.d. ${l.asOfKey}`,
    judul: id.nama,
    subJudul: id.kontrak?.judulKerja ?? id.paket.nama,
    meta: [
      { label: "Realisasi", nilai: g.punyaRab ? formatPct(g.realisasiPct) : "belum ada RAB" },
      { label: "Rencana", nilai: g.punyaKurva ? pctAtau(g.rencanaPct) : "belum ada kurva-S" },
      {
        label: "Deviasi",
        nilai: g.punyaKurva ? pp(g.deviasiPp) : "–",
        warna: g.deviasiPp == null ? undefined : g.deviasiPp < 0 ? p.merah : p.hijau,
      },
      {
        label: "Minggu",
        nilai: id.kontrak ? `ke-${g.mingguKe}${g.totalMinggu > 0 ? ` / ${g.totalMinggu}` : ""}` : "belum berkontrak",
      },
    ],
    barisBawah: [
      `${id.paket.nama} · ${id.paket.instansi}`,
      id.kontrak ? `${id.kontrak.nomor} · ${id.kontrak.vendor}` : "Belum berkontrak / SPMK belum terbit",
      wilayah,
    ],
    draf: false,
  });
}

/* ── Slide: kesimpulan ──────────────────────────────────────────────────── */

function slideKesimpulan(ctx: DeckCtx, l: LaporanLokasiLengkap, gelap: boolean): void {
  const { doc } = ctx;
  const p = ctx.tema.palet;
  const g = l.progres;
  latarSlide(ctx, gelap);
  const y0 = judulSlide(ctx, "Kesimpulan", gelap);
  const teks = l.kesimpulan.length > 0 ? l.kesimpulan.join(" ") : "Kesimpulan belum tersusun.";
  doc.font(PDF_FONT.regular).fontSize(15).fillColor(warnaTeks(ctx, gelap)).text(s(teks), MX, y0, {
    width: CW,
    lineGap: 4,
  });
  // Kartu tidak boleh terdorong ke bawah footer oleh kesimpulan yang panjang.
  const y = Math.min(doc.y + 20, H - 140);
  kartuAngka(
    ctx,
    [
      { label: "Rencana", nilai: g.punyaKurva ? pctAtau(g.rencanaPct) : "belum ada kurva-S", warna: warnaTeks(ctx, gelap) },
      { label: "Realisasi", nilai: g.punyaRab ? formatPct(g.realisasiPct) : "belum ada RAB" },
      {
        label: "Deviasi",
        nilai: g.punyaKurva ? pp(g.deviasiPp) : "–",
        warna: g.deviasiPp == null ? warnaRedup(ctx, gelap) : g.deviasiPp < 0 ? p.merah : p.hijau,
      },
      {
        label: "Terverifikasi",
        nilai: g.punyaRab ? formatPct(g.terverifikasiPct) : "–",
        warna: warnaTeks(ctx, gelap),
      },
    ],
    y,
    gelap,
  );
}

/* ── Slide: kurva-S penuh + durasi ──────────────────────────────────────── */

function slideKurva(ctx: DeckCtx, l: LaporanLokasiLengkap, gelap: boolean): void {
  const k = l.kurva;
  if (!k) return;
  latarSlide(ctx, gelap);
  const y0 = judulSlide(ctx, "Kurva-S rencana vs realisasi", gelap);
  const d = l.durasi;
  const gx = MX + 34;
  const gy = y0 + 14;
  const gh = (d ? H - 150 : H - 70) - gy;
  gambarKurva(
    ctx,
    {
      x: gx,
      y: gy,
      w: CW - 44,
      h: gh,
      planPct: k.planPct,
      actualPct: k.actualPct,
      mingguSekarang: k.mingguBerjalan,
      labelRencana: "Rencana kumulatif",
      labelRealisasi: "Realisasi kumulatif",
    },
    gelap,
  );
  if (d) {
    kartuAngka(
      ctx,
      [
        { label: "Total hari", nilai: `${d.totalHari} hari`, warna: warnaTeks(ctx, gelap) },
        { label: "Hari berjalan", nilai: `${d.hariBerjalan} hari`, warna: warnaTeks(ctx, gelap) },
        { label: "Sisa waktu", nilai: `${d.sisaHari} hari` },
        { label: "Waktu terpakai", nilai: formatPct(d.pctWaktu) },
      ],
      H - 122,
      gelap,
    );
  }
}

/* ── Slide: perkembangan mingguan ───────────────────────────────────────── */

function slideMingguan(
  ctx: DeckCtx,
  baris: LaporanLokasiLengkap["mingguan"],
  bagian: number,
  total: number,
  gelap: boolean,
): void {
  latarSlide(ctx, gelap);
  const y = judulSlide(ctx, judulBagian("Perkembangan mingguan", bagian, total), gelap);
  tabel(
    ctx,
    [
      { label: "Minggu", w: 80 },
      { label: "Periode", w: 260 },
      { label: "Rencana", w: 96, align: "right" },
      { label: "Realisasi", w: 96, align: "right" },
      { label: "Kenaikan", w: 96, align: "right" },
      { label: "Deviasi", w: 96, align: "right" },
      { label: "Laporan", w: CW - 80 - 260 - 96 * 4, align: "right" },
    ],
    baris.map((m) => [
      `ke-${m.minggu}`,
      `${tgl(m.mulaiKey)} – ${tgl(m.akhirKey)}`,
      pctAtau(m.rencanaPct),
      pctAtau(m.realisasiPct),
      pp(m.kenaikanPp),
      pp(m.deviasiPp),
      String(m.laporanTerhitung),
    ]),
    y,
    gelap,
  );
}

/* ── Slide: status per kategori RAB ─────────────────────────────────────── */

function slideKategori(
  ctx: DeckCtx,
  baris: LaporanLokasiLengkap["kategori"],
  bagian: number,
  total: number,
  gelap: boolean,
): void {
  latarSlide(ctx, gelap);
  const y0 = judulSlide(ctx, judulBagian("Status pekerjaan per kategori RAB", bagian, total), gelap);
  const kolW = (CW - 48) / 2;
  const tiapKol = Math.ceil(baris.length / 2);
  baris.forEach((k, i) => {
    const kol = tiapKol > 0 ? Math.floor(i / tiapKol) : 0;
    const x = MX + kol * (kolW + 48);
    const y = y0 + (i % Math.max(1, tiapKol)) * 46;
    barBand(
      ctx,
      {
        x,
        y,
        w: kolW,
        label: `${k.lineageKey} ${k.nama}`,
        nilai: formatPct(k.realisasiPct),
        pct: k.realisasiPct,
        band: bandStatus(k.realisasiPct),
        catatan: `bobot ${formatPct(k.bobotPct)} · ${rupiah(k.nilai)}`,
      },
      gelap,
    );
  });
  catatan(
    ctx,
    "Bar = realisasi kategori terhadap nilai kategorinya; bobot = nilai kategori terhadap total RAB lokasi.",
    H - 52,
    gelap,
  );
}

/* ── Slide: kelengkapan laporan harian ──────────────────────────────────── */

function slideKelengkapan(ctx: DeckCtx, l: LaporanLokasiLengkap, gelap: boolean): void {
  const k = l.kelengkapan;
  if (!k) return;
  const p = ctx.tema.palet;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, "Kelengkapan laporan harian", gelap);
  y = kartuAngka(
    ctx,
    [
      { label: "Hari diharapkan", nilai: String(k.hariDiharapkan), warna: warnaTeks(ctx, gelap) },
      { label: "Final", nilai: String(k.final), warna: warnaTeks(ctx, gelap) },
      { label: "Disetujui / dikirim", nilai: `${k.disetujui} / ${k.dikirim}`, warna: warnaTeks(ctx, gelap) },
      {
        label: "Draft / perlu koreksi",
        nilai: `${k.draft} / ${k.perluKoreksi}`,
        warna: k.perluKoreksi > 0 ? p.oranye : warnaTeks(ctx, gelap),
      },
    ],
    y,
    gelap,
  );
  y = kartuAngka(
    ctx,
    [
      { label: "Hari nihil", nilai: String(k.hariNihil), warna: warnaTeks(ctx, gelap) },
      {
        label: "Hari tanpa laporan",
        nilai: String(k.hariTanpaLaporan),
        warna: k.hariTanpaLaporan > 0 ? p.merah : p.hijau,
      },
      { label: "Laporan terakhir", nilai: k.laporanTerakhirKey ? tgl(k.laporanTerakhirKey) : "belum ada" },
      {
        label: "Sejak laporan terakhir",
        nilai:
          k.hariSejakLaporanTerakhir == null
            ? "–"
            : k.hariSejakLaporanTerakhir === 0
              ? "hari ini"
              : `${k.hariSejakLaporanTerakhir} hari`,
        warna: warnaTeks(ctx, gelap),
      },
    ],
    y + 8,
    gelap,
  );
  catatan(ctx, "Hari diharapkan dihitung sejak SPMK sampai posisi data, hanya hari kerja dalam masa kontrak.", y + 16, gelap);
}

/* ── Slide: kendala ─────────────────────────────────────────────────────── */

function slideKendala(
  ctx: DeckCtx,
  l: LaporanLokasiLengkap,
  baris: LaporanLokasiLengkap["kendala"]["terbuka"],
  bagian: number,
  total: number,
  gelap: boolean,
): void {
  const { doc } = ctx;
  const p = ctx.tema.palet;
  const r = l.kendala.ringkas;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, judulBagian("Kendala", bagian, total), gelap);
  if (bagian === 1) {
    y = kartuAngka(
      ctx,
      [
        { label: "Terbuka", nilai: String(r.terbuka), warna: r.terbuka > 0 ? p.oranye : warnaTeks(ctx, gelap) },
        { label: "Kritis", nilai: String(r.kritis), warna: r.kritis > 0 ? p.merah : warnaTeks(ctx, gelap) },
        {
          label: "Lewat tenggat",
          nilai: String(r.lewatTenggat),
          warna: r.lewatTenggat > 0 ? p.merah : warnaTeks(ctx, gelap),
        },
        { label: "Selesai", nilai: String(r.selesai), warna: warnaTeks(ctx, gelap) },
      ],
      y,
      gelap,
    );
  }
  if (baris.length > 0) {
    y = tabel(
      ctx,
      [
        { label: "Kendala", w: CW - 96 - 108 - 116 - 72 - 132 - 116 },
        { label: "Tingkat", w: 96 },
        { label: "Status", w: 108 },
        { label: "Dibuka", w: 116 },
        { label: "Umur", w: 72, align: "right" },
        { label: "PIC", w: 132 },
        { label: "Tenggat", w: 116 },
      ],
      baris.map((k) => [
        k.judul,
        ISSUE_SEVERITY_LABEL[k.tingkat],
        k.status,
        tgl(k.dibukaKey),
        `${k.umurHari} hr`,
        k.pic ?? "belum ada PIC",
        k.tenggatKey ? `${tgl(k.tenggatKey)}${k.lewatTenggat ? " (lewat)" : ""}` : "–",
      ]),
      y,
      gelap,
    );
  } else {
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(warnaRedup(ctx, gelap));
    doc.text("Tidak ada kendala terbuka.", MX, y, { width: CW });
    y = doc.y + 10;
  }
  // Ringkas kendala selesai hanya di bagian TERAKHIR, supaya tidak berulang.
  if (bagian === total && l.kendala.selesaiTerbaru.length > 0) {
    doc.font(PDF_FONT.bold).fontSize(11).fillColor(gelap ? p.aksen : p.aksenTua);
    doc.text("Kendala selesai terbaru", MX, Math.min(y + 4, H - 92), { width: CW });
    const ringkas = l.kendala.selesaiTerbaru
      .slice(0, 3)
      .map((k) => `${k.judul} (${tgl(k.dibukaKey)} – ${tgl(k.ditutupKey)}, ${k.umurHari} hr)`)
      .join("  ·  ");
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(warnaRedup(ctx, gelap));
    doc.text(potongTeks(ctx, ringkas, CW), MX, doc.y + 4, { width: CW, lineBreak: false });
  }
  if (bagian === 1 && r.tertuaHari != null) {
    catatan(ctx, `Kendala terbuka tertua berumur ${r.tertuaHari} hari.`, H - 52, gelap);
  }
}

/* ── Slide: kronologi per babak bulan ───────────────────────────────────── */

function slideKronologi(
  ctx: DeckCtx,
  babakLabel: string,
  peristiwa: LaporanLokasiLengkap["kronologi"]["babak"][number]["peristiwa"],
  bagian: number,
  total: number,
  gelap: boolean,
): void {
  const { doc } = ctx;
  const p = ctx.tema.palet;
  latarSlide(ctx, gelap);
  const y0 = judulSlide(ctx, judulBagian(`Kronologi – ${babakLabel}`, bagian, total), gelap);
  peristiwa.forEach((e, i) => {
    const y = y0 + i * 56;
    const warna =
      e.jenis === "kendala_dibuka" ? p.merah : e.jenis === "kendala_ditutup" ? p.hijau : warnaRedup(ctx, gelap);
    const jenis =
      e.jenis === "kendala_dibuka" ? "Kendala muncul" : e.jenis === "kendala_ditutup" ? "Kendala selesai" : "Kegiatan";
    doc.moveTo(MX, y - 8).lineTo(MX + CW, y - 8).lineWidth(0.5).strokeColor(warnaGaris(ctx, gelap)).stroke();
    doc.font(PDF_FONT.bold).fontSize(9.5).fillColor(warna).text(tgl(e.tanggal), MX, y + 2, {
      width: 104,
      lineBreak: false,
    });
    doc.font(PDF_FONT.regular).fontSize(8.5).fillColor(warnaSamar(ctx, gelap)).text(jenis, MX, y + 16, {
      width: 104,
      lineBreak: false,
    });
    const x = MX + 116;
    const w = CW - 116;
    const tanda = `${e.berjalan ? " (masih berjalan)" : ""}${e.lewatTenggat ? " (lewat tenggat)" : ""}`;
    doc.font(PDF_FONT.bold).fontSize(11.5).fillColor(warnaTeks(ctx, gelap));
    doc.text(potongTeks(ctx, `${e.judul}${tanda}`, w), x, y, { width: w, lineBreak: false });
    if (e.rincian.length > 0) {
      doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(warnaRedup(ctx, gelap));
      doc.text(potongTeks(ctx, e.rincian.join("; "), w), x, y + 18, { width: w, lineBreak: false });
    }
  });
}

/* ── Slide: kegiatan terakhir ───────────────────────────────────────────── */

function slideKegiatan(ctx: DeckCtx, l: LaporanLokasiLengkap, gelap: boolean): void {
  latarSlide(ctx, gelap);
  const y = judulSlide(ctx, `Kegiatan lapangan (${l.kegiatan.total} tercatat)`, gelap);
  tabel(
    ctx,
    [
      { label: "Tanggal", w: 128 },
      { label: "Jenis", w: 180 },
      { label: "Kegiatan", w: CW - 128 - 180 - 104 - 80 },
      { label: "Status", w: 104 },
      { label: "Foto", w: 80, align: "right" },
    ],
    l.kegiatan.terakhir
      .slice(0, 12)
      .map((g) => [tgl(g.tanggalKey), g.jenis, g.judul, g.status === "final" ? "Final" : "Draft", String(g.jumlahFoto)]),
    y,
    gelap,
  );
}

/* ── Slide: temuan & inspeksi ───────────────────────────────────────────── */

function slideTemuan(ctx: DeckCtx, l: LaporanLokasiLengkap, gelap: boolean): void {
  const { doc } = ctx;
  const p = ctx.tema.palet;
  const t = l.temuan.ringkas;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, "Temuan pemeriksa & inspeksi", gelap);
  y = kartuAngka(
    ctx,
    [
      {
        label: "Temuan terbuka",
        nilai: `${t.terbuka} / ${t.total}`,
        warna: t.terbuka > 0 ? p.oranye : warnaTeks(ctx, gelap),
      },
      { label: "Kritis terbuka", nilai: String(t.kritis), warna: t.kritis > 0 ? p.merah : warnaTeks(ctx, gelap) },
      {
        label: "Lewat tenggat",
        nilai: String(t.lewatTenggat),
        warna: t.lewatTenggat > 0 ? p.merah : warnaTeks(ctx, gelap),
      },
      {
        label: "Inspeksi",
        nilai: t.inspeksiTerakhirKey ? `${t.inspeksi} · ${tgl(t.inspeksiTerakhirKey)}` : String(t.inspeksi),
        warna: warnaTeks(ctx, gelap),
      },
    ],
    y,
    gelap,
  );
  if (l.temuan.terbuka.length > 0) {
    tabel(
      ctx,
      [
        { label: "Temuan", w: CW - 120 - 96 - 128 - 120 - 132 },
        { label: "Kategori", w: 120 },
        { label: "Tingkat", w: 96 },
        { label: "Status", w: 128 },
        { label: "Tenggat", w: 120 },
        { label: "Penanggung jawab", w: 132 },
      ],
      l.temuan.terbuka
        .slice(0, 8)
        .map((x) => [
          x.judul,
          x.kategori,
          ISSUE_SEVERITY_LABEL[x.tingkat],
          x.statusLabel,
          x.tenggatKey ? `${tgl(x.tenggatKey)}${x.lewatTenggat ? " (lewat)" : ""}` : "–",
          x.penanggungJawab ?? "belum ditetapkan",
        ]),
      y,
      gelap,
    );
  } else {
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(warnaRedup(ctx, gelap));
    doc.text("Tidak ada temuan terbuka.", MX, y, { width: CW });
  }
}

/* ── Slide: administrasi ────────────────────────────────────────────────── */

function slideAdministrasi(ctx: DeckCtx, l: LaporanLokasiLengkap, gelap: boolean): void {
  const { doc } = ctx;
  const p = ctx.tema.palet;
  const a = l.administrasi;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, "Administrasi: milestone, dokumen, surat", gelap);
  y = kartuAngka(
    ctx,
    [
      { label: "Dokumen aktif", nilai: String(a.dokumen.total), warna: warnaTeks(ctx, gelap) },
      {
        label: "Kedaluwarsa",
        nilai: String(a.dokumen.kedaluwarsa),
        warna: a.dokumen.kedaluwarsa > 0 ? p.merah : warnaTeks(ctx, gelap),
      },
      {
        label: "Segera kedaluwarsa",
        nilai: String(a.dokumen.segeraKedaluwarsa),
        warna: a.dokumen.segeraKedaluwarsa > 0 ? p.oranye : warnaTeks(ctx, gelap),
      },
      { label: "Surat masuk / keluar", nilai: `${a.surat.masuk} / ${a.surat.keluar}`, warna: warnaTeks(ctx, gelap) },
    ],
    y,
    gelap,
  );
  if (a.milestone.length > 0) {
    y = tabel(
      ctx,
      [
        { label: "Fase milestone", w: CW - 120 - 120 - 140 },
        { label: "Total", w: 120, align: "right" },
        { label: "Selesai", w: 120, align: "right" },
        { label: "Terlambat", w: 140, align: "right" },
      ],
      a.milestone.slice(0, 6).map((m) => [m.label, String(m.total), String(m.selesai), String(m.terlambat)]),
      y,
      gelap,
    );
  } else {
    doc.font(PDF_FONT.regular).fontSize(11).fillColor(warnaRedup(ctx, gelap));
    doc.text("Milestone administrasi belum ditetapkan.", MX, y, { width: CW });
    y = doc.y + 10;
  }
  const baris: string[] = [];
  if (a.surat.perluBalas > 0 || a.surat.lewatTenggatBalas > 0) {
    baris.push(`Surat perlu balas ${a.surat.perluBalas}, lewat tenggat balas ${a.surat.lewatTenggatBalas}.`);
  }
  if (a.dokumen.perFase.length > 0) {
    baris.push(`Dokumen per fase: ${a.dokumen.perFase.map((f) => `${f.label} ${f.jumlah}`).join(" · ")}.`);
  }
  for (const sr of a.surat.terakhir.slice(0, 2)) {
    baris.push(`${sr.arah === "masuk" ? "Surat masuk" : "Surat keluar"} ${tgl(sr.tanggalKey)}: ${sr.perihal}`);
  }
  if (baris.length > 0) {
    butirList(ctx, baris, MX, Math.min(y + 4, H - 110), CW, gelap, { fontSize: 9.5, warna: warnaRedup(ctx, gelap) });
  }
}

/* ── Slide: perhatian (EWS) ─────────────────────────────────────────────── */

function slidePerhatian(
  ctx: DeckCtx,
  baris: LaporanLokasiLengkap["perhatian"],
  bagian: number,
  total: number,
  gelap: boolean,
): void {
  latarSlide(ctx, gelap);
  const y = judulSlide(ctx, judulBagian("Perhatian – peringatan dini", bagian, total), gelap);
  kartuBernomor(
    ctx,
    baris.map((w) => ({
      judul: `${EWS_SEVERITY_LABEL[w.severity].toUpperCase()}  ·  ${EWS_KATEGORI_LABEL[w.kategori]}  ·  ${w.objek}`,
      teks: `${w.alasan} Tindakan: ${w.tindakan}`,
      warna: warnaSeverity(ctx, w.severity),
    })),
    y,
    gelap,
    { fontSize: 11 },
  );
}

/* ── Slide: rencana minggu depan ────────────────────────────────────────── */

function slideRencana(ctx: DeckCtx, l: LaporanLokasiLengkap, gelap: boolean): void {
  const { doc } = ctx;
  const r = l.rencanaMingguDepan;
  if (!r) return;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, `Rencana minggu ke-${r.mingguKe}`, gelap);
  if (r.catatan) {
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(warnaRedup(ctx, gelap));
    doc.text(s(r.catatan), MX, y, { width: CW });
    y = doc.y + 12;
  }
  if (r.item.length > 0) {
    tabel(
      ctx,
      [
        { label: "Pekerjaan", w: CW - 160 - 200 },
        { label: "Satuan", w: 160 },
        { label: "Target volume", w: 200, align: "right" },
      ],
      r.item
        .slice(0, 10)
        .map((it) => [
          it.nama,
          it.unit ?? "–",
          it.targetVolume.toLocaleString("id-ID", { maximumFractionDigits: 3 }),
        ]),
      y,
      gelap,
    );
  } else {
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(warnaRedup(ctx, gelap));
    doc.text("Belum ada item pekerjaan yang ditargetkan.", MX, y, { width: CW });
  }
}

/* ── Slide: foto (dua per slide) ────────────────────────────────────────── */

function slideFoto(
  ctx: DeckCtx,
  l: LaporanLokasiLengkap,
  pasangan: LaporanLokasiLengkap["foto"]["kandidat"],
  gambar: Map<string, string | null>,
  bagian: number,
  total: number,
  gelap: boolean,
): void {
  const { doc, tema } = ctx;
  const p = tema.palet;
  latarSlide(ctx, gelap);
  const y0 = judulSlide(ctx, judulBagian(`Dokumentasi foto (${l.foto.total} tersimpan)`, bagian, total), gelap);
  const gap = 22;
  const n = pasangan.length;
  const fw = n === 1 ? Math.min(CW, 620) : (CW - gap) / 2;
  const fh = H - y0 - 78;
  const x0 = n === 1 ? (W - fw) / 2 : MX;
  const sudut = Math.min(8, tema.sudutKartu);
  pasangan.forEach((f, i) => {
    const x = x0 + i * (fw + gap);
    const uri = gambar.get(f.id) ?? null;
    let terpasang = false;
    if (uri) {
      doc.save();
      try {
        doc.roundedRect(x, y0, fw, fh, sudut).clip();
        doc.image(uri, x, y0, { cover: [fw, fh], align: "center", valign: "center" } as never);
        terpasang = true;
      } catch {
        terpasang = false;
      } finally {
        doc.restore();
      }
    }
    if (!terpasang) {
      doc.roundedRect(x, y0, fw, fh, sudut).fillColor(gelap ? p.gelapKartu : p.kartuTerang).fill();
      doc.font(PDF_FONT.regular).fontSize(11).fillColor(warnaRedup(ctx, gelap));
      doc.text("Foto tidak dapat dimuat", x, y0 + fh / 2 - 6, { width: fw, align: "center" });
    }
    doc.roundedRect(x, y0, fw, fh, sudut).lineWidth(1).strokeColor(warnaGaris(ctx, gelap)).stroke();
    const cy = y0 + fh + 8;
    doc.rect(x, cy + 2, 3, 11).fillColor(p.aksen).fill();
    doc.font(PDF_FONT.bold).fontSize(9.5).fillColor(warnaTeks(ctx, gelap));
    doc.text(
      potongTeks(ctx, `${f.tanggalKey ? tgl(f.tanggalKey) : "tanpa tanggal"} · ${f.keterangan ?? "tanpa keterangan"}`, fw - 10),
      x + 8,
      cy,
      { width: fw - 8, lineBreak: false },
    );
  });
}

/* ── Slide: lampiran ────────────────────────────────────────────────────── */

function slideLampiran(ctx: DeckCtx, l: LaporanLokasiLengkap, gelap: boolean): void {
  const { doc } = ctx;
  const p = ctx.tema.palet;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, "Lampiran – keterbatasan data & sumber", gelap);
  doc.font(PDF_FONT.bold).fontSize(11).fillColor(gelap ? p.aksen : p.aksenTua);
  doc.text("Keterbatasan data", MX, y, { width: CW });
  y = doc.y + 6;
  if (l.limitations.length > 0) {
    y = butirList(ctx, l.limitations.slice(0, 5), MX, y, CW, gelap, {
      fontSize: 9.5,
      warna: warnaRedup(ctx, gelap),
    });
  } else {
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(warnaRedup(ctx, gelap));
    doc.text("Tidak ada keterbatasan yang perlu dicatat.", MX, y, { width: CW });
    y = doc.y + 8;
  }
  doc.font(PDF_FONT.bold).fontSize(11).fillColor(gelap ? p.aksen : p.aksenTua);
  doc.text("Sumber data", MX, Math.min(y + 6, H - 150), { width: CW });
  y = doc.y + 6;
  const sumber = l.sumber.slice(0, 6).map((r) => `${r.label}${r.value ? ` – ${r.value}` : ""}`);
  if (sumber.length > 0) {
    for (const baris of sumber) {
      if (y > H - 76) break;
      doc.font(PDF_FONT.regular).fontSize(9).fillColor(warnaSamar(ctx, gelap));
      doc.text(potongTeks(ctx, baris, CW), MX, y, { width: CW, lineBreak: false });
      y += 14;
    }
    if (l.sumber.length > sumber.length) {
      doc.font(PDF_FONT.regular).fontSize(9).fillColor(warnaSamar(ctx, gelap));
      doc.text(`… dan ${l.sumber.length - sumber.length} sumber lain.`, MX, y, { width: CW, lineBreak: false });
    }
  } else {
    doc.font(PDF_FONT.regular).fontSize(9).fillColor(warnaSamar(ctx, gelap));
    doc.text("–", MX, y, { width: CW, lineBreak: false });
  }
  catatan(
    ctx,
    `Seluruh angka dihitung MARLIN dari laporan harian, kurva-S, RAB, kegiatan, temuan, dan kendala yang tercatat · posisi data s.d. ${l.asOfKey} · disusun ${formatTanggal(new Date(l.dibuatPada), "d MMM yyyy HH.mm")} WIB.`,
    H - 52,
    gelap,
  );
}

/* ── Slide: penutup ─────────────────────────────────────────────────────── */

function slidePenutup(ctx: DeckCtx, l: LaporanLokasiLengkap): void {
  const { doc, tema } = ctx;
  const gelap = bingkaiGelap(tema);
  renderPenutupDeck(ctx, { judul: "Terima Kasih", sub: l.identitas.nama });
  doc.font(PDF_FONT.regular).fontSize(10).fillColor(warnaSamar(ctx, gelap));
  doc.text(
    s(
      `${l.identitas.paket.nama}  ·  ${l.identitas.kontrak ? l.identitas.kontrak.nomor : "belum berkontrak"}  ·  posisi data s.d. ${l.asOfKey}`,
    ),
    0,
    doc.y + 26,
    { width: W, align: "center" },
  );
}

/* ── Entry ──────────────────────────────────────────────────────────────── */

export async function renderLaporanLokasiDeck(
  l: LaporanLokasiLengkap,
  opts: { tema?: TemaDeckKey } = {},
): Promise<Buffer> {
  const tema = temaDeck(opts.tema);
  const doc = createDeck169Doc({ title: `Deck laporan lengkap ${l.identitas.nama}` });
  const ctx = buatDeckCtx(doc, tema);

  // Foto diambil lebih dulu: alir slide tidak boleh menunggu jaringan di tengah.
  const fotoTerpilih = l.foto.kandidat.slice(0, 6);
  const gambar = new Map<string, string | null>();
  for (const f of fotoTerpilih) gambar.set(f.id, await ambilFoto(f.thumbnailKey ?? f.r2Key));

  /*
   * Slide ISI dirakit sebagai daftar penggambar — jumlahnya baru diketahui
   * setelah bagian yang datanya kosong dilewati, dan nomor halaman di footer
   * butuh totalnya sebelum slide pertama digambar.
   */
  const isi: ((gelap: boolean) => void)[] = [];

  isi.push((gelap) => slideKesimpulan(ctx, l, gelap));
  if (l.kurva && l.kurva.totalMinggu > 0) isi.push((gelap) => slideKurva(ctx, l, gelap));

  const mingguan = potong(l.mingguan, 12);
  mingguan.forEach((baris, i) => isi.push((gelap) => slideMingguan(ctx, baris, i + 1, mingguan.length, gelap)));

  const kategori = potong(l.kategori, 16);
  kategori.forEach((baris, i) => isi.push((gelap) => slideKategori(ctx, baris, i + 1, kategori.length, gelap)));

  if (l.kelengkapan) isi.push((gelap) => slideKelengkapan(ctx, l, gelap));

  const adaKendala =
    l.kendala.terbuka.length > 0 || l.kendala.selesaiTerbaru.length > 0 || l.kendala.ringkas.selesai > 0;
  if (adaKendala) {
    const kendala = l.kendala.terbuka.length > 0 ? potong(l.kendala.terbuka, 8) : [[]];
    kendala.forEach((baris, i) =>
      isi.push((gelap) => slideKendala(ctx, l, baris, i + 1, kendala.length, gelap)),
    );
  }

  for (const b of l.kronologi.babak) {
    const babak = potong(b.peristiwa, 6);
    babak.forEach((peristiwa, i) =>
      isi.push((gelap) => slideKronologi(ctx, b.label, peristiwa, i + 1, babak.length, gelap)),
    );
  }

  if (l.kegiatan.terakhir.length > 0) isi.push((gelap) => slideKegiatan(ctx, l, gelap));
  if (l.temuan.ringkas.total > 0 || l.temuan.ringkas.inspeksi > 0) {
    isi.push((gelap) => slideTemuan(ctx, l, gelap));
  }

  const a = l.administrasi;
  if (a.milestone.length > 0 || a.dokumen.total > 0 || a.surat.masuk + a.surat.keluar > 0) {
    isi.push((gelap) => slideAdministrasi(ctx, l, gelap));
  }

  const perhatian = potong(l.perhatian, 4);
  perhatian.forEach((baris, i) => isi.push((gelap) => slidePerhatian(ctx, baris, i + 1, perhatian.length, gelap)));

  if (l.rencanaMingguDepan) isi.push((gelap) => slideRencana(ctx, l, gelap));

  const foto = potong(fotoTerpilih, 2);
  foto.forEach((pasangan, i) =>
    isi.push((gelap) => slideFoto(ctx, l, pasangan, gambar, i + 1, foto.length, gelap)),
  );

  isi.push((gelap) => slideLampiran(ctx, l, gelap));

  const total = isi.length + 2;
  const footKiri = `Laporan lengkap ${l.identitas.nama} · ${l.identitas.paket.nama} · posisi data s.d. ${l.asOfKey}`;

  slideSampul(ctx, l);
  footerSlide(ctx, footKiri, 1, total, bingkaiGelap(tema));

  isi.forEach((gambarSlide, i) => {
    doc.addPage();
    const gelap = slideGelap(tema, i);
    gambarSlide(gelap);
    footerSlide(ctx, footKiri, i + 2, total, gelap);
  });

  doc.addPage();
  slidePenutup(ctx, l);
  footerSlide(ctx, footKiri, total, total, bingkaiGelap(tema));

  return docToBuffer(doc);
}
