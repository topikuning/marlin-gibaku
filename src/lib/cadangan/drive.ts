import "server-only";
import { CadanganError, simpanFolderCadangan, tampilanAkunCadangan, tokenCadangan } from "./akun";

/**
 * Operasi Google Drive untuk akun CADANGAN (DECISIONS 650).
 *
 * Terpisah dari `lib/gdrive/client.ts` (akun KKP) karena memakai token akun
 * yang lain, dan karena unggahannya selalu RESUMABLE: cadangan database bisa
 * ratusan MB dan dialirkan langsung dari pg_dump, tidak pernah ditampung utuh
 * di memori.
 */

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Kelipatan 256 KiB, syarat unggahan resumable Drive. */
export const UKURAN_POTONGAN = 8 * 1024 * 1024;
export const NAMA_FOLDER_AKAR = "MARLIN Cadangan";

async function galat(res: Response, apa: string): Promise<CadanganError> {
  const teks = await res.text().catch(() => "");
  let pesan = teks.slice(0, 200);
  try {
    pesan = (JSON.parse(teks) as { error?: { message?: string } }).error?.message ?? pesan;
  } catch {
    /* teks apa adanya */
  }
  if (res.status === 403 && /quota|storage/i.test(pesan) && !/rate/i.test(pesan)) {
    return new CadanganError("Ruang Google Drive akun cadangan sudah penuh.", res.status);
  }
  return new CadanganError(`${apa} gagal (HTTP ${res.status}): ${pesan || "tanpa keterangan"}`, res.status);
}

/** Google menyuruh pelan-pelan – putaran harus berhenti, bukan mengulang sampai diblok. */
export function batasLaju(err: unknown): boolean {
  return err instanceof CadanganError && (err.status === 429 || (err.status === 403 && /rate|limit/i.test(err.message)));
}

async function minta(url: string, init: RequestInit = {}, apa = "Permintaan ke Google Drive"): Promise<Response> {
  const token = await tokenCadangan();
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
  if (!res.ok && res.status !== 308) throw await galat(res, apa);
  return res;
}

const kutip = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const cacheFolder = new Map<string, string>();

export async function pastikanFolder(indukId: string, nama: string): Promise<string> {
  const k = `${indukId}/${nama}`;
  const ada = cacheFolder.get(k);
  if (ada) return ada;
  const q = `name = '${kutip(nama)}' and mimeType = '${FOLDER_MIME}' and '${indukId}' in parents and trashed = false`;
  const cari = await minta(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, {}, `Mencari folder "${nama}"`);
  const id = ((await cari.json()) as { files?: { id: string }[] }).files?.[0]?.id;
  if (id) {
    cacheFolder.set(k, id);
    return id;
  }
  const buat = await minta(
    `${API}/files?fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nama, mimeType: FOLDER_MIME, parents: [indukId] }),
    },
    `Membuat folder "${nama}"`,
  );
  const baru = ((await buat.json()) as { id: string }).id;
  cacheFolder.set(k, baru);
  return baru;
}

/** Folder akar "MARLIN Cadangan" di My Drive akun cadangan; dibuat sekali, diingat. */
export async function folderAkar(): Promise<string> {
  const { folderId } = await tampilanAkunCadangan();
  if (folderId) {
    const res = await fetch(`${API}/files/${encodeURIComponent(folderId)}?fields=id,trashed`, {
      headers: { Authorization: `Bearer ${await tokenCadangan()}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok && !((await res.json()) as { trashed?: boolean }).trashed) return folderId;
    // Folder dihapus atau dibuang ke sampah oleh pemilik akun – buat yang baru.
  }
  const id = await pastikanFolder("root", NAMA_FOLDER_AKAR);
  await simpanFolderCadangan(id);
  return id;
}

export async function alamatFolder(id: string): Promise<string> {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
}

export type HasilUnggah = { id: string; bytes: number; md5: string | null };

/**
 * Unggah RESUMABLE dari aliran apa pun. Potongan 8 MiB dikirim satu per satu;
 * potongan yang gagal karena jaringan ditanyakan dulu posisinya ke Drive lalu
 * dilanjutkan, tidak diulang dari awal.
 */
export async function unggahResumable(
  meta: { induk: string; nama: string; mime: string; deskripsi?: string; properti?: Record<string, string> },
  sumber: AsyncIterable<Buffer | Uint8Array> | Buffer,
): Promise<HasilUnggah> {
  const mulai = await minta(
    `${UPLOAD}?uploadType=resumable&fields=id,size,md5Checksum`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": meta.mime },
      body: JSON.stringify({
        name: meta.nama,
        parents: [meta.induk],
        mimeType: meta.mime,
        ...(meta.deskripsi ? { description: meta.deskripsi } : {}),
        ...(meta.properti ? { appProperties: meta.properti } : {}),
      }),
    },
    `Memulai unggahan "${meta.nama}"`,
  );
  const sesi = mulai.headers.get("location");
  if (!sesi) throw new CadanganError("Google Drive tidak memberi alamat unggahan.");

  let terkirim = 0;
  let tampung = Buffer.alloc(0);
  let hasil: HasilUnggah | null = null;

  const kirim = async (potongan: Buffer, akhir: boolean): Promise<void> => {
    for (let coba = 0; ; coba++) {
      const total = akhir ? String(terkirim + potongan.length) : "*";
      const range =
        potongan.length === 0 ? `bytes */${total}` : `bytes ${terkirim}-${terkirim + potongan.length - 1}/${total}`;
      try {
        const res = await fetch(sesi, {
          method: "PUT",
          headers: { "Content-Range": range, "Content-Length": String(potongan.length) },
          body: potongan.length ? new Uint8Array(potongan) : undefined,
          signal: AbortSignal.timeout(300_000),
        });
        if (res.status === 308) {
          // Drive boleh menerima SEBAGIAN potongan – yang belum diterima dikirim lagi.
          const r = res.headers.get("range");
          const sampai = r ? Number(r.split("-")[1]) + 1 : terkirim + potongan.length;
          const diterima = Math.max(0, Math.min(potongan.length, sampai - terkirim));
          terkirim += diterima;
          potongan = potongan.subarray(diterima);
          if (potongan.length === 0) return;
          continue;
        }
        if (res.ok) {
          const j = (await res.json()) as { id: string; size?: string; md5Checksum?: string };
          terkirim += potongan.length;
          hasil = { id: j.id, bytes: Number(j.size ?? terkirim), md5: j.md5Checksum ?? null };
          return;
        }
        if (res.status < 500 || coba >= 3) throw await galat(res, `Mengunggah "${meta.nama}"`);
      } catch (err) {
        if (err instanceof CadanganError || coba >= 3) throw err;
      }
      // Tanya Drive sudah sampai mana, lanjutkan dari situ.
      await new Promise((r) => setTimeout(r, 1000 * 2 ** coba));
      const st = await fetch(sesi, {
        method: "PUT",
        headers: { "Content-Range": "bytes */*", "Content-Length": "0" },
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      if (st?.status === 308) {
        const r = st.headers.get("range");
        const sampai = r ? Number(r.split("-")[1]) + 1 : 0;
        const maju = sampai - terkirim;
        if (maju > 0 && maju <= potongan.length) {
          terkirim = sampai;
          potongan = potongan.subarray(maju);
          if (potongan.length === 0 && !akhir) return;
        }
      }
    }
  };

  const aliran = Buffer.isBuffer(sumber) ? [sumber] : sumber;
  for await (const c of aliran) {
    tampung = tampung.length ? Buffer.concat([tampung, Buffer.from(c)]) : Buffer.from(c);
    while (tampung.length > UKURAN_POTONGAN) {
      await kirim(tampung.subarray(0, UKURAN_POTONGAN), false);
      tampung = tampung.subarray(UKURAN_POTONGAN);
    }
  }
  await kirim(tampung, true);
  if (!hasil) throw new CadanganError(`Unggahan "${meta.nama}" tidak dikonfirmasi Google Drive.`);
  return hasil;
}

export async function daftarDiFolder(induk: string): Promise<{ id: string; name: string; size: number }[]> {
  const out: { id: string; name: string; size: number }[] = [];
  let halaman: string | undefined;
  do {
    const q = `'${induk}' in parents and trashed = false`;
    const res = await minta(
      `${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,size)&pageSize=1000` +
        (halaman ? `&pageToken=${encodeURIComponent(halaman)}` : ""),
      {},
      "Membaca isi folder cadangan",
    );
    const j = (await res.json()) as { nextPageToken?: string; files?: { id: string; name: string; size?: string }[] };
    for (const f of j.files ?? []) out.push({ id: f.id, name: f.name, size: Number(f.size ?? 0) });
    halaman = j.nextPageToken;
  } while (halaman);
  return out;
}

/** Berkas bernama `nama` di folder `induk` (yang tidak di sampah), beserta md5-nya. */
export async function cariDiFolder(induk: string, nama: string): Promise<{ id: string; md5: string | null }[]> {
  const q = `name = '${kutip(nama)}' and '${induk}' in parents and trashed = false`;
  const res = await minta(
    `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,md5Checksum)&pageSize=10`,
    {},
    `Mencari "${nama}" di cadangan`,
  );
  const j = (await res.json()) as { files?: { id: string; md5Checksum?: string }[] };
  return (j.files ?? []).map((f) => ({ id: f.id, md5: f.md5Checksum ?? null }));
}

export async function hapusDiDrive(id: string): Promise<void> {
  await minta(`${API}/files/${encodeURIComponent(id)}`, { method: "DELETE" }, "Menghapus cadangan lama");
}

/** Ruang akun cadangan, untuk layar Sistem. */
export async function ruangDrive(): Promise<{ terpakai: number; batas: number | null } | null> {
  const res = await minta(`${API}/about?fields=storageQuota`, {}, "Membaca ruang Drive");
  const q = ((await res.json()) as { storageQuota?: { usage?: string; limit?: string } }).storageQuota;
  if (!q) return null;
  return { terpakai: Number(q.usage ?? 0), batas: q.limit ? Number(q.limit) : null };
}
