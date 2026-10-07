import { connect, type Socket } from "node:net";

/**
 * KLIEN FTP MINIMAL untuk server data hujan JAXA GSMaP (DECISIONS baru 2026-10-07).
 *
 * JAXA hanya membagikan GSMaP lewat FTP. Yang dibutuhkan cuma: masuk, ambil
 * berkas, dan lihat isi folder – jadi ditulis sendiri di atas `node:net`
 * (mode pasif) daripada menambah pustaka. Satu sesi dipakai untuk banyak
 * berkas, supaya 15 jam data tidak berarti 15 kali masuk.
 */

export class FtpError extends Error {
  constructor(
    message: string,
    readonly kode?: number,
  ) {
    super(message);
  }
}

export type SesiFtp = {
  /** Isi berkas, atau null bila server menjawab berkas tidak ada (550). */
  ambil(path: string): Promise<Buffer | null>;
  /** Nama isi folder; folder yang tidak ada → []. */
  daftar(path: string): Promise<string[]>;
  tutup(): Promise<void>;
};

type Balasan = { kode: number; teks: string };

export async function bukaFtp(o: {
  host: string;
  port?: number;
  user: string;
  pass: string;
  timeoutMs?: number;
}): Promise<SesiFtp> {
  const batas = o.timeoutMs ?? 30_000;
  const kendali = await sambung(o.host, o.port ?? 21, batas);
  let sisa = "";
  const antre: Balasan[] = [];
  const menunggu: { ok: (b: Balasan) => void; gagal: (e: Error) => void }[] = [];
  let mati: Error | null = null;
  let kumpul: { kode: number; baris: string[] } | null = null;

  kendali.setEncoding("latin1");
  kendali.on("data", (potong: string) => {
    sisa += potong;
    let i: number;
    while ((i = sisa.indexOf("\n")) >= 0) {
      const baris = sisa.slice(0, i).replace(/\r$/, "");
      sisa = sisa.slice(i + 1);
      const m = /^(\d{3})([ -])(.*)$/.exec(baris);
      if (!kumpul) {
        if (!m) continue;
        kumpul = { kode: Number(m[1]), baris: [m[3]] };
        if (m[2] === "-") continue;
      } else {
        kumpul.baris.push(m ? m[3] : baris);
        // Balasan multi-baris berakhir di baris "kode<spasi>" yang sama.
        if (!(m && Number(m[1]) === kumpul.kode && m[2] === " ")) continue;
      }
      const b = { kode: kumpul.kode, teks: kumpul.baris.join("\n") };
      kumpul = null;
      const w = menunggu.shift();
      if (w) w.ok(b);
      else antre.push(b);
    }
  });
  const akhiri = (e: Error) => {
    mati ??= e;
    while (menunggu.length) menunggu.shift()!.gagal(e);
  };
  kendali.on("error", (e) => akhiri(new FtpError(`Sambungan FTP terputus: ${e.message}`)));
  kendali.on("close", () => akhiri(new FtpError("Sambungan FTP ditutup server.")));

  const balasan = (): Promise<Balasan> => {
    const ada = antre.shift();
    if (ada) return Promise.resolve(ada);
    if (mati) return Promise.reject(mati);
    return denganBatas(
      new Promise<Balasan>((ok, gagal) => menunggu.push({ ok, gagal })),
      batas,
      "Server FTP tidak menjawab.",
    );
  };
  const kirim = async (perintah: string): Promise<Balasan> => {
    kendali.write(`${perintah}\r\n`);
    return balasan();
  };
  const harus = (b: Balasan, ...kode: number[]) => {
    if (!kode.includes(b.kode)) throw new FtpError(`Server FTP menolak: ${b.kode} ${b.teks.split("\n")[0]}`, b.kode);
    return b;
  };

  try {
    harus(await balasan(), 220);
    const u = await kirim(`USER ${o.user}`);
    if (u.kode === 331) {
      const p = await kirim(`PASS ${o.pass}`);
      if (p.kode === 530) throw new FtpError("Akun FTP ditolak server (nama atau sandi salah).", 530);
      harus(p, 230, 202);
    } else {
      harus(u, 230);
    }
    harus(await kirim("TYPE I"), 200);
  } catch (e) {
    kendali.destroy();
    throw e;
  }

  /** Buka sambungan data pasif: EPSV dulu, PASV bila tidak didukung. */
  const sambunganData = async (): Promise<Socket> => {
    const e = await kirim("EPSV");
    if (e.kode === 229) {
      const m = /\|\|\|(\d+)\|/.exec(e.teks);
      if (m) return sambung(o.host, Number(m[1]), batas);
    }
    const p = harus(await kirim("PASV"), 227);
    const m = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(p.teks);
    if (!m) throw new FtpError("Balasan PASV server FTP tidak dikenali.");
    // Alamat IP di balasan PASV sering alamat dalam (NAT) – pakai host yang sama.
    return sambung(o.host, Number(m[5]) * 256 + Number(m[6]), batas);
  };

  const transfer = async (perintah: string): Promise<Buffer | null> => {
    const data = await sambunganData();
    const isi: Buffer[] = [];
    const selesaiData = new Promise<void>((ok, gagal) => {
      data.on("data", (b: Buffer) => isi.push(b));
      data.on("end", () => ok());
      data.on("error", (e) => gagal(new FtpError(`Sambungan data FTP terputus: ${e.message}`)));
    });
    // Pada jalur 550 janji ini tidak ditunggu – jangan sampai jadi galat tak tertangkap.
    selesaiData.catch(() => undefined);
    const mulai = await kirim(perintah);
    if (mulai.kode === 550 || mulai.kode === 450) {
      data.destroy();
      return null;
    }
    try {
      harus(mulai, 150, 125);
      await denganBatas(selesaiData, batas * 4, "Pengunduhan FTP terlalu lama.");
      harus(await balasan(), 226, 250);
    } catch (e) {
      data.destroy();
      throw e;
    }
    return Buffer.concat(isi);
  };

  return {
    ambil: (path) => transfer(`RETR ${path}`),
    async daftar(path) {
      const isi = await transfer(`NLST ${path}`);
      if (!isi) return [];
      return isi
        .toString("latin1")
        .split(/\r?\n/)
        .map((s) => s.trim().split("/").pop() ?? "")
        .filter(Boolean);
    },
    async tutup() {
      try {
        if (!mati) await denganBatas(kirim("QUIT"), 3000, "");
      } catch {
        // QUIT yang tidak dijawab tidak penting.
      } finally {
        kendali.destroy();
      }
    },
  };
}

function sambung(host: string, port: number, batas: number): Promise<Socket> {
  return new Promise((ok, gagal) => {
    const s = connect({ host, port });
    const t = setTimeout(() => {
      s.destroy();
      gagal(new FtpError(`Tidak bisa tersambung ke ${host}:${port} (batas waktu).`));
    }, batas);
    s.once("connect", () => {
      clearTimeout(t);
      ok(s);
    });
    s.once("error", (e) => {
      clearTimeout(t);
      gagal(new FtpError(`Tidak bisa tersambung ke ${host}:${port}: ${e.message}`));
    });
  });
}

function denganBatas<T>(p: Promise<T>, ms: number, pesan: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, gagal) => {
      t = setTimeout(() => gagal(new FtpError(pesan)), ms);
    }),
  ]);
}
