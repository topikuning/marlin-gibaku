/**
 * PEMBACA FORMULIR MASUK KAWAL KNMP (DECISIONS 689).
 *
 * Alur masuk Kawal belum terdokumentasi, jadi nama kolomnya TIDAK ditebak:
 * formulir yang memuat kolom sandi dibaca dari halamannya sendiri – alamat
 * kirim, metode, semua kolom (termasuk token CSRF tersembunyi), dan token CSRF
 * di `<meta>` bila ada. Murni, tanpa jaringan, supaya bisa diuji dengan HTML
 * buatan.
 *
 * Sengaja tanpa pustaka HTML: yang dibutuhkan hanya satu formulir, dan
 * dependensi baru untuk itu tidak sepadan. Polanya toleran terhadap urutan
 * atribut, kutip tunggal/ganda, dan huruf besar.
 */

export type KolomFormulir = { nama: string; tipe: string; nilai: string };

export type FormulirMasuk = {
  /** Alamat kirim apa adanya dari atribut `action` (bisa relatif / kosong). */
  action: string;
  metode: "GET" | "POST";
  kolom: KolomFormulir[];
  /** Nama kolom akun (teks/email pertama sebelum kolom sandi). */
  namaKolomAkun: string | null;
  namaKolomSandi: string;
  /** Token dari `<meta name="csrf-token">`, bila ada. */
  csrfMeta: string | null;
};

function atribut(tag: string, nama: string): string | null {
  const m = tag.match(new RegExp(`\\s${nama}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!m) return null;
  return decodeEntitas(m[1] ?? m[2] ?? m[3] ?? "");
}

function decodeEntitas(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function csrfDariMeta(html: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const nama = (atribut(m[0], "name") ?? "").toLowerCase();
    if (nama === "csrf-token" || nama === "_token" || nama === "csrf_token") {
      return atribut(m[0], "content");
    }
  }
  return null;
}

/** Formulir pertama yang memuat kolom sandi, atau null bila halaman tidak punya. */
export function bacaFormulirMasuk(html: string): FormulirMasuk | null {
  for (const f of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const tagForm = `<form ${f[1]}>`;
    const isi = f[2];
    const kolom: KolomFormulir[] = [];
    for (const i of isi.matchAll(/<input\b[^>]*>/gi)) {
      const nama = atribut(i[0], "name");
      if (!nama) continue;
      const tipe = (atribut(i[0], "type") ?? "text").toLowerCase();
      if (tipe === "submit" || tipe === "button" || tipe === "image" || tipe === "reset") continue;
      if ((tipe === "checkbox" || tipe === "radio") && !/\schecked\b/i.test(i[0])) continue;
      kolom.push({ nama, tipe, nilai: atribut(i[0], "value") ?? "" });
    }
    const iSandi = kolom.findIndex((k) => k.tipe === "password");
    if (iSandi < 0) continue;
    const akun = kolom
      .slice(0, iSandi)
      .reverse()
      .find((k) => k.tipe === "text" || k.tipe === "email" || k.tipe === "tel");
    const metode = (atribut(tagForm, "method") ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
    return {
      action: atribut(tagForm, "action") ?? "",
      metode,
      kolom,
      namaKolomAkun: akun?.nama ?? null,
      namaKolomSandi: kolom[iSandi].nama,
      csrfMeta: csrfDariMeta(html),
    };
  }
  return null;
}

/**
 * Isi formulir untuk dikirim: kolom tersembunyi (CSRF dll.) apa adanya, akun &
 * sandi diganti isian kita. Urutan kolom dipertahankan.
 */
export function isiFormulirMasuk(f: FormulirMasuk, akun: string, sandi: string): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of f.kolom) {
    if (k.nama === f.namaKolomSandi) p.append(k.nama, sandi);
    else if (k.nama === f.namaKolomAkun) p.append(k.nama, akun);
    else p.append(k.nama, k.nilai);
  }
  return p;
}
