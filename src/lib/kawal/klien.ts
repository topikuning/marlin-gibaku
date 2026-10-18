import { bacaFormulirMasuk, isiFormulirMasuk } from "./form-masuk";

/**
 * KLIEN KAWAL KNMP – masuk lewat formulir, lalu ambil `/api/knmp/locations`
 * (DECISIONS 689).
 *
 * Kawal tidak menyediakan API resmi; yang ada aplikasi PHP yang memakai sesi
 * cookie. Klien ini meniru peramban seperlunya: membaca formulir masuk dari
 * halamannya sendiri (nama kolom & token CSRF tidak ditebak), menyimpan cookie,
 * mengikuti pengalihan satu per satu, dan menolak keras bila yang kembali
 * bukan JSON – itu tanda sesi tidak diterima, bukan "data kosong".
 *
 * Satu permintaan pada satu waktu, tanpa paralel, dengan User-Agent yang jelas.
 * `fetch` bisa disuntikkan untuk uji.
 */

export const JALUR_LOKASI = "/api/knmp/locations";
const USER_AGENT = "MARLIN-SinkronKawal/1.0 (pengendalian proyek KNMP)";
const BATAS_PENGALIHAN = 6;
const BATAS_WAKTU_MS = 30_000;

export type AkunKawal = { alamat: string; akun: string; sandi: string };

/** Satu permintaan, untuk laporan uji. Hanya jalur (tanpa query) – query bisa memuat token. */
export type LangkahKawal = { langkah: string; metode: string; jalur: string; status: number; jenis: string | null };

export type RingkasFormulir = {
  jalurKirim: string;
  metode: "GET" | "POST";
  kolom: { nama: string; tipe: string }[];
  namaKolomAkun: string | null;
  namaKolomSandi: string;
  adaCsrfMeta: boolean;
};

export class KawalGalat extends Error {
  constructor(
    message: string,
    readonly langkah: LangkahKawal[],
    readonly formulir: RingkasFormulir | null = null,
  ) {
    super(message);
  }
}

type FetchFn = typeof fetch;

/** Alamat dasar Kawal yang sah (http/https), tanpa garis miring di akhir. */
export function normalisasiAlamat(alamat: string): string {
  let u: URL;
  try {
    u = new URL(alamat.trim());
  } catch {
    throw new Error("Alamat Kawal tidak sah. Contoh: https://kawal.contoh.go.id");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Alamat Kawal harus diawali https:// atau http://");
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

class Sesi {
  private cookie = new Map<string, string>();
  readonly langkah: LangkahKawal[] = [];

  constructor(private readonly fetchFn: FetchFn) {}

  private simpanCookie(res: Response) {
    const daftar =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,\s]+=)/);
    for (const baris of daftar) {
      const pasang = baris.split(";")[0] ?? "";
      const i = pasang.indexOf("=");
      if (i <= 0) continue;
      const nama = pasang.slice(0, i).trim();
      const nilai = pasang.slice(i + 1).trim();
      if (nilai === "" || /deleted/i.test(nilai)) this.cookie.delete(nama);
      else this.cookie.set(nama, nilai);
    }
  }

  private headerCookie(): string {
    return [...this.cookie.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
  }

  /** Satu permintaan + pengalihan (POST yang dialihkan menjadi GET, seperti peramban). */
  async ambil(
    langkah: string,
    url: URL,
    init: { method?: string; body?: URLSearchParams; headers?: Record<string, string> } = {},
  ): Promise<{ res: Response; url: URL }> {
    let kini = url;
    let metode = init.method ?? "GET";
    let body: URLSearchParams | undefined = init.body;
    for (let i = 0; i <= BATAS_PENGALIHAN; i++) {
      const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        ...(init.headers ?? {}),
      };
      const c = this.headerCookie();
      if (c) headers.Cookie = c;
      if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
      const res = await this.fetchFn(kini, {
        method: metode,
        headers,
        body: body?.toString(),
        redirect: "manual",
        signal: AbortSignal.timeout(BATAS_WAKTU_MS),
      });
      this.simpanCookie(res);
      this.langkah.push({
        langkah: i === 0 ? langkah : `${langkah} (pengalihan ${i})`,
        metode,
        jalur: kini.pathname,
        status: res.status,
        jenis: res.headers.get("content-type"),
      });
      const tujuan = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && tujuan) {
        kini = new URL(tujuan, kini);
        if (res.status !== 307 && res.status !== 308) {
          metode = "GET";
          body = undefined;
        }
        continue;
      }
      return { res, url: kini };
    }
    throw new KawalGalat(`Terlalu banyak pengalihan saat ${langkah}.`, this.langkah);
  }
}

function ringkasFormulir(f: NonNullable<ReturnType<typeof bacaFormulirMasuk>>, jalurKirim: string): RingkasFormulir {
  return {
    jalurKirim,
    metode: f.metode,
    // Nilai kolom (token CSRF dll.) tidak ikut – hanya nama dan tipe.
    kolom: f.kolom.map((k) => ({ nama: k.nama, tipe: k.tipe })),
    namaKolomAkun: f.namaKolomAkun,
    namaKolomSandi: f.namaKolomSandi,
    adaCsrfMeta: f.csrfMeta != null,
  };
}

const jenisHtml = (res: Response) => (res.headers.get("content-type") ?? "").includes("text/html");

/**
 * Masuk ke Kawal lalu ambil daftar lokasi. Mengembalikan JSON mentah (belum
 * disaring) beserta jejak langkahnya. Melempar `KawalGalat` dengan pesan yang
 * bisa dibaca orang bila satu langkah gagal.
 */
export async function ambilLokasiKawal(
  akun: AkunKawal,
  fetchFn: FetchFn = fetch,
): Promise<{ body: unknown; langkah: LangkahKawal[]; formulir: RingkasFormulir }> {
  const dasar = normalisasiAlamat(akun.alamat);
  const sesi = new Sesi(fetchFn);

  // 1. Cari halaman masuk: halaman depan (biasanya mengalihkan ke formulir), lalu /login.
  let halaman: { html: string; url: URL } | null = null;
  for (const jalur of ["/", "/login"]) {
    const { res, url } = await sesi.ambil("Buka halaman masuk", new URL(`${dasar}${jalur}`));
    const html = jenisHtml(res) || res.ok ? await res.text() : "";
    if (bacaFormulirMasuk(html)) {
      halaman = { html, url };
      break;
    }
  }
  if (!halaman) {
    throw new KawalGalat("Halaman masuk Kawal tidak ditemukan (tidak ada formulir dengan kolom sandi).", sesi.langkah);
  }
  const f = bacaFormulirMasuk(halaman.html)!;
  const tujuanKirim = new URL(f.action || halaman.url.href, halaman.url);
  const formulir = ringkasFormulir(f, tujuanKirim.pathname);
  if (!f.namaKolomAkun) {
    throw new KawalGalat("Formulir masuk Kawal tidak punya kolom nama akun yang dikenali.", sesi.langkah, formulir);
  }

  // 2. Kirim formulir.
  const isian = isiFormulirMasuk(f, akun.akun, akun.sandi);
  const kirim =
    f.metode === "POST"
      ? await sesi.ambil("Kirim formulir masuk", tujuanKirim, {
          method: "POST",
          body: isian,
          headers: {
            Referer: halaman.url.href,
            ...(f.csrfMeta ? { "X-CSRF-TOKEN": f.csrfMeta } : {}),
          },
        })
      : await sesi.ambil("Kirim formulir masuk", new URL(`${tujuanKirim.pathname}?${isian}`, tujuanKirim));
  const sesudah = jenisHtml(kirim.res) ? await kirim.res.text() : "";
  if (bacaFormulirMasuk(sesudah)) {
    throw new KawalGalat(
      "Kawal menolak masuk: sesudah formulir dikirim, halaman masuk muncul lagi. Periksa nama akun dan sandi.",
      sesi.langkah,
      formulir,
    );
  }

  // 3. Ambil data lokasi dengan sesi itu.
  const { res } = await sesi.ambil("Ambil data lokasi", new URL(`${dasar}${JALUR_LOKASI}`), {
    headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
  });
  const teks = await res.text();
  if (!res.ok) {
    throw new KawalGalat(`Kawal menjawab status ${res.status} saat data lokasi diambil.`, sesi.langkah, formulir);
  }
  let body: unknown;
  try {
    body = JSON.parse(teks);
  } catch {
    throw new KawalGalat(
      bacaFormulirMasuk(teks)
        ? "Kawal mengembalikan halaman masuk, bukan data: sesi tidak diterima."
        : "Kawal tidak mengirim JSON untuk data lokasi.",
      sesi.langkah,
      formulir,
    );
  }
  return { body, langkah: sesi.langkah, formulir };
}
