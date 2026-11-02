import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ProgressStrip,
  ProgressStripPonsel,
  type JalurStrip,
  type NilaiStrip,
  type WaktuStrip,
} from "@/components/knmp/progress-strip";

/**
 * PROGRESS STRIP (DECISIONS 737) – pengganti kartu enam sel header lokasi,
 * desain "Progress Strip 2a" (user 2026-11-02). Angka per JALUR, rencana vs
 * realisasi dalam satu bar.
 */

const WAKTU: WaktuStrip = { mingguKe: 13, totalMinggu: 26, lebarPct: 50, sisaHari: 90, periode: "8 Agt 2026 – 30 Jan 2027" };
const NILAI: NilaiStrip = {
  judul: "Nilai lokasi · Sukamaju",
  nilai: 6_148_250_000n,
  paket: { nilai: 24_263_578_577n, porsiPct: 25.3 },
};
const MARLIN: JalurStrip = {
  kunci: "marlin",
  label: "MARLIN",
  href: "/lokasi/x/progress",
  realisasi: 57.6,
  rencana: 63.9,
  deviasi: -6.3,
  draft: { nomor: 2, realisasi: 54.6, href: "/lokasi/x/progress" },
};
const KAWAL: JalurStrip = {
  kunci: "kawal",
  label: "KAWAL",
  href: "/lokasi/x/kawal",
  realisasi: 24.1,
  rencana: 25,
  deviasi: -0.9,
};

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("ProgressStrip", () => {
  it("satu bar per jalur: progressbar beraria lengkap, status deviasi tidak hanya warna", () => {
    const h = html(<ProgressStrip nilai={NILAI} waktu={WAKTU} jalur={[MARLIN, KAWAL]} />);
    expect(h.match(/role="progressbar"/g)).toHaveLength(2);
    expect(h).toContain('aria-label="Realisasi MARLIN 57,6% dari rencana 63,9% – Terlambat"');
    expect(h).toContain('aria-label="Realisasi KAWAL 24,1% dari rencana 25,0% – Sesuai jadwal"');
    // Ambang deviasi KANONIK (stat-delta): −0,9 hijau, −6,3 amber.
    expect(h).toMatch(/bg-warning-soft text-warning[^"]*"[^>]*>-6,3%/);
    expect(h).toMatch(/bg-success-soft text-success[^"]*"[^>]*>-0,9%/);
  });

  it("arsir ketertinggalan selebar −deviasi, mulai dari ujung realisasi; garis rencana di posisi rencana", () => {
    const h = html(<ProgressStrip nilai={NILAI} waktu={WAKTU} jalur={[MARLIN]} />);
    expect(h).toContain("left:57.6%;width:6.3%");
    expect(h).toContain("left:63.9%");
    // Penanda draft adendum di posisi realisasi menurut draft + chip-nya.
    expect(h).toContain("left:54.6%");
    expect(h).toContain("Draft 54,6%");
    expect(h).toContain('title="Draft adendum #2 · Realisasi MARLIN 54,6% · Belum resmi"');
  });

  it("jalur yang tidak tertinggal tidak diberi arsir", () => {
    const h = html(<ProgressStrip nilai={NILAI} waktu={WAKTU} jalur={[{ ...KAWAL, realisasi: 30, deviasi: 5 }]} />);
    expect(h).not.toContain("repeating-linear-gradient");
  });

  it("nilai lokasi + konteks paket; tanpa nilai (Pelaksana) tidak ada rupiah sama sekali", () => {
    const dengan = html(<ProgressStrip nilai={NILAI} waktu={WAKTU} jalur={[MARLIN, KAWAL]} />);
    expect(dengan).toMatch(/Rp[\s ]6\.148\.250\.000/);
    expect(dengan).toContain("25,3%");
    const tanpa = html(<ProgressStrip nilai={null} waktu={WAKTU} jalur={[MARLIN, KAWAL]} />);
    expect(tanpa).not.toMatch(/\bRp\b/);
    // Kisi menyesuaikan: tanpa sel nilai, kolom 270 px tidak dipesan.
    expect(tanpa).toContain("xl:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]");
    expect(dengan).toContain("xl:grid-cols-[270px_220px_minmax(0,1fr)_minmax(0,1fr)]");
  });

  it("kontrak lewat: sisa hari ditulis 'lewat', berwarna bahaya", () => {
    const h = html(<ProgressStrip nilai={null} waktu={{ ...WAKTU, sisaHari: -4 }} jalur={[MARLIN]} />);
    expect(h).toContain("lewat 4 hari");
  });

  it("belum ada SPMK: tanpa bar waktu, keterangannya tetap disebut", () => {
    const h = html(
      <ProgressStrip
        nilai={null}
        waktu={{ mingguKe: 0, totalMinggu: 0, lebarPct: 0, sisaHari: null, periode: "180 hari – menunggu SPMK" }}
        jalur={[{ ...MARLIN, rencana: null, deviasi: null, draft: null }]}
      />,
    );
    expect(h).toContain("menunggu SPMK");
    expect(h).toContain("Waktu kontrak");
  });
});

describe("ProgressStripPonsel", () => {
  it("blok bertumpuk: minggu, jalur, teks draft; seluruh blok jalur = satu tautan", () => {
    const h = html(<ProgressStripPonsel nilai={NILAI} waktu={WAKTU} jalur={[MARLIN, KAWAL]} />);
    expect(h).toContain("13/26 mg");
    expect(h).toContain("sisa 90 hari");
    expect(h).toContain("Draft adendum #2 · ");
    const tautanKawal = h.match(/<a [^>]*href="\/lokasi\/x\/kawal"[^>]*>/)?.[0] ?? "";
    expect(tautanKawal).toContain('class="flex flex-col');
  });

  it("bar di wadah kolom TIDAK memakai flex-1 (tingginya jadi 0 di ponsel – render 2026-11-02)", () => {
    const h = html(<ProgressStripPonsel nilai={NILAI} waktu={WAKTU} jalur={[MARLIN]} />);
    const bar = h.match(/<div role="progressbar"[^>]*>/)?.[0] ?? "";
    expect(bar).toContain("w-full");
    expect(bar).not.toContain("flex-1");
  });

  it("tanpa nilai: periode menggantikan sel nilai, tanpa rupiah", () => {
    const h = html(<ProgressStripPonsel nilai={null} waktu={WAKTU} jalur={[MARLIN]} />);
    expect(h).not.toMatch(/\bRp\b/);
    expect(h).toContain("8 Agt 2026 – 30 Jan 2027");
  });
});
