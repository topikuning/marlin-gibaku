import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { COUNTED_REPORT_STATUSES, REPORT_STATUS_LABEL } from "@/lib/lifecycle";
import { balasFileWa, balasWa } from "./kirim";
import { potongPesan } from "./potong-pesan";
import type { LokasiKatalog } from "./tanya-niat";
import { formatKey, type PeriodeDiminta, type PeriodeTerbaca } from "./tanya-tanggal";
import {
  bagiBatasBerkas,
  kepalaBerkasKkp,
  mingguKkpDiminta,
  sebutRentang,
  type JenisBerkasKkp,
  type MingguKkp,
  type RencanaBerkas,
} from "./berkas-kkp";

/**
 * PENGIRIM BERKAS KKP PER LOKASI dari Tanya MARLIN (DECISIONS 752).
 *
 * Urutannya: kalimat pembuka (yang dikirim + yang tidak, dengan sebabnya) →
 * berkas satu per lokasi → penutup HANYA bila ada yang gagal atau tidak
 * sempat. Kegagalan satu lokasi tidak menghentikan lokasi lain dan tidak
 * melempar: pekerjaan antrean yang melempar diulang, dan pengulangan mengirim
 * ulang berkas yang sudah sampai.
 *
 * Renderer-nya renderer yang sudah ada – berkasnya sama dengan unduhan web dan
 * unggahan Drive. Tanpa otorisasi di sini: `sasaran` sudah dipotong resolver
 * kanal (lingkup grup / penugasan penanya).
 */

/**
 * Tenggat render. Antrean jawaban menganggap pekerjaan > 10 menit mati dan
 * mengulangnya (DECISIONS 635); lewat tenggat ini sisa lokasi DISEBUT, tidak
 * dikirim, supaya grup tidak menerima berkas yang sama dua kali.
 */
const TENGGAT_MS = 5 * 60_000;

const PDF = "application/pdf";
const keTanggal = (k: string) => new Date(`${k}T00:00:00.000Z`);
const terhitung = (s: string) => (COUNTED_REPORT_STATUSES as readonly string[]).includes(s);

export type JejakBerkasKkp = {
  jenis: JenisBerkasKkp;
  terkirim: { lokasiId: string; berkas: string }[];
  dilewati: { lokasiId: string; sebab: string }[];
  kelebihan: string[];
  gagal: { lokasiId: string; galat: string }[];
  tertunda: string[];
};

export async function kirimBerkasKkp(a: {
  chatId: string;
  jenis: JenisBerkasKkp;
  sasaran: readonly LokasiKatalog[];
  periodeDiminta: PeriodeDiminta;
  periode: PeriodeTerbaca;
  hariIniKey: string;
  catatan: string | null;
  /** Baris tafsir AI + penanda lingkup – ditaruh di depan, seperti balasan lain. */
  pembuka: readonly (string | null)[];
  userId: string | null;
  waMessageId: string;
}): Promise<{ teks: string; jejak: JejakBerkasKkp }> {
  const ids = a.sasaran.map((l) => l.id);
  const dateKey = a.periode.akhir;
  const lokasi = await db.location.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      slug: true,
      package: { select: { contract: { select: { startDate: true, endDate: true, weekMode: true } } } },
    },
  });
  const dataLokasi = new Map(lokasi.map((l) => [l.id, l]));

  const rencana: RencanaBerkas[] = [];
  if (a.jenis === "harian") {
    const laporan = await db.dailyReport.findMany({
      where: { locationId: { in: ids }, reportDate: keTanggal(dateKey) },
      select: { locationId: true, status: true },
    });
    const statusDi = new Map(laporan.map((r) => [r.locationId, r.status]));
    for (const l of a.sasaran) {
      const s = statusDi.get(l.id);
      if (!s) rencana.push({ lokasiId: l.id, nama: l.nama, kirim: false, sebab: "belum ada laporan", kelompok: "belum_ada" });
      else if (!terhitung(s)) {
        rencana.push({ lokasiId: l.id, nama: l.nama, kirim: false, sebab: REPORT_STATUS_LABEL[s].toLowerCase(), kelompok: "belum_dikirim" });
      } else rencana.push({ lokasiId: l.id, nama: l.nama, kirim: true, keterangan: REPORT_STATUS_LABEL[s] });
    }
  } else {
    const rabAktif =
      a.jenis === "mingguan"
        ? new Set(
            (
              await db.rabRevision.findMany({
                where: { locationId: { in: ids }, status: "aktif" },
                select: { locationId: true },
              })
            ).map((r) => r.locationId),
          )
        : null;
    for (const l of a.sasaran) {
      const kontrak = dataLokasi.get(l.id)?.package.contract ?? null;
      const lewati = (sebab: string) =>
        rencana.push({ lokasiId: l.id, nama: l.nama, kirim: false, sebab, kelompok: "lain" });
      if (!kontrak) {
        lewati("paketnya belum berkontrak");
        continue;
      }
      const mk = mingguKkpDiminta(kontrak, a.periodeDiminta, a.periode, a.hariIniKey);
      if ("sebab" in mk) {
        lewati(mk.sebab);
        continue;
      }
      if (rabAktif && !rabAktif.has(l.id)) {
        lewati("belum punya RAB aktif");
        continue;
      }
      if (a.jenis === "rekap_harian") {
        const ada = await db.dailyReport.count({
          where: {
            locationId: l.id,
            reportDate: { gte: keTanggal(mk.mulai), lte: keTanggal(mk.akhir) },
            status: { in: [...COUNTED_REPORT_STATUSES] },
          },
        });
        // Tujuh blanko kosong bukan berkas – hanya menambah lampiran di grup.
        if (ada === 0) {
          lewati("belum ada laporan yang dikirim pelapor minggu itu");
          continue;
        }
      }
      rencana.push({ lokasiId: l.id, nama: l.nama, kirim: true, keterangan: "", minggu: mk });
    }
  }

  const { dikirim, kelebihan, dilewati } = bagiBatasBerkas(rencana);
  const kepala = kepalaBerkasKkp({ jenis: a.jenis, tanggalKey: dateKey, dikirim, dilewati, kelebihan, catatan: a.catatan });
  const teks = [...a.pembuka, kepala].filter(Boolean).join("\n\n");
  for (const b of potongPesan(teks).bagian) await balasWa(a.chatId, b);

  const jejak: JejakBerkasKkp = {
    jenis: a.jenis,
    terkirim: [],
    dilewati: dilewati.map((d) => ({ lokasiId: d.lokasiId, sebab: d.sebab })),
    kelebihan: kelebihan.map((d) => d.lokasiId),
    gagal: [],
    tertunda: [],
  };
  const gagalNama: string[] = [];
  const tertundaNama: string[] = [];
  const mulai = Date.now();
  for (const r of dikirim) {
    if (Date.now() - mulai > TENGGAT_MS) {
      jejak.tertunda.push(r.lokasiId);
      tertundaNama.push(r.nama);
      continue;
    }
    const slug = dataLokasi.get(r.lokasiId)?.slug;
    try {
      const berkas = slug ? await bentukBerkas(a.jenis, r, slug, dateKey) : null;
      if (!berkas) throw new Error("renderer tidak menghasilkan berkas");
      await balasFileWa(a.chatId, { mimetype: PDF, filename: berkas.nama, data: berkas.buffer.toString("base64") }, berkas.keterangan);
      jejak.terkirim.push({ lokasiId: r.lokasiId, berkas: berkas.nama });
    } catch (err) {
      console.error(`[waha/berkas-kkp] berkas ${a.jenis} ${r.nama} gagal:`, err);
      jejak.gagal.push({ lokasiId: r.lokasiId, galat: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
      gagalNama.push(r.nama);
    }
  }

  // Kalimat TETAP, bukan pesan galat: rinciannya untuk log dan audit, bukan grup PPK.
  const penutup = [
    gagalNama.length > 0
      ? `Maaf, berkas untuk ${gagalNama.join(", ")} gagal saya buat. Coba minta lagi dengan nama lokasinya, atau unduh dari MARLIN.`
      : null,
    tertundaNama.length > 0
      ? `Waktu kirim habis sebelum berkas untuk ${tertundaNama.join(", ")} sempat dibuat. Minta lagi dengan nama lokasinya.`
      : null,
  ].filter(Boolean);
  if (penutup.length > 0) {
    try {
      await balasWa(a.chatId, penutup.join("\n"));
    } catch (err) {
      console.error("[waha/berkas-kkp] pemberitahuan kegagalan ikut gagal:", err);
    }
  }

  await audit(a.userId, "waha.tanya.berkas_kkp", "wa_message", a.waMessageId, { chatId: a.chatId, ...jejak });
  return { teks, jejak };
}

async function bentukBerkas(
  jenis: JenisBerkasKkp,
  r: Extract<RencanaBerkas, { kirim: true }>,
  slug: string,
  dateKey: string,
): Promise<{ buffer: Buffer; nama: string; keterangan: string } | null> {
  if (jenis === "harian") {
    const { renderHarianKkpPdf } = await import("@/lib/pdf/harian-kkp");
    const hasil = await renderHarianKkpPdf(slug, dateKey);
    if (!hasil) return null;
    return {
      buffer: hasil.buffer,
      // Nama sama dengan jalur "versi kkp" lama: satu dokumen, satu nama.
      nama: `laporan-harian-kkp-${slug}-${dateKey}.pdf`,
      keterangan: `Laporan harian KKP ${r.nama}, ${formatKey(dateKey)} · status ${r.keterangan}`,
    };
  }
  const m = r.minggu as MingguKkp;
  const rentang = sebutRentang(m.mulai, m.akhir);
  if (jenis === "mingguan") {
    const { renderPeriodikKkpPdf } = await import("@/lib/pdf/periodik-kkp");
    const hasil = await renderPeriodikKkpPdf(r.lokasiId, "mingguan", m.n);
    if (!hasil) return null;
    return {
      buffer: hasil.buffer,
      // Nama sama dengan kiriman dari web (`sendPeriodReportPdfToWaAction`).
      nama: `laporan-mingguan-${slug}-${m.n}.pdf`,
      keterangan: `Laporan mingguan KKP ${r.nama} · minggu ke-${m.n} (${rentang})${m.berjalan ? " · minggu berjalan" : ""}`,
    };
  }
  const { renderMingguanKkpPdf } = await import("@/lib/pdf/mingguan-kkp");
  const hasil = await renderMingguanKkpPdf(slug, m.n, { hanyaStatus: COUNTED_REPORT_STATUSES });
  if (!hasil) return null;
  // Hari yang belum tiba bukan "belum lapor" – dipisah supaya angkanya tidak menuduh.
  const belumTiba = hasil.hariBelumTiba;
  const kosong = hasil.hariKosong - belumTiba;
  return {
    buffer: hasil.buffer,
    // Nama sama dengan kiriman dari web (`sendWeeklyBundleToWaAction`).
    nama: `laporan-harian-minggu-${m.n}-${slug}.pdf`,
    keterangan: [
      `Rekap laporan harian ${r.nama} · minggu ke-${m.n} (${rentang})`,
      kosong > 0 ? `${kosong} hari belum ada laporan terkirim` : null,
      belumTiba > 0 ? `${belumTiba} hari belum tiba` : null,
      hasil.fotoDipotong > 0 ? `${hasil.fotoDipotong} foto tidak dimuat (batas berkas)` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
