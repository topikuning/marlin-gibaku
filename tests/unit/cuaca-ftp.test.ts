// KLIEN FTP MINIMAL untuk GSMaP (DECISIONS baru 2026-10-07).
//
// Diuji terhadap server FTP palsu di mesin ini: sapaan multi-baris, masuk,
// EPSV lalu jatuh ke PASV, ambil berkas, berkas tidak ada (550), isi folder,
// sandi salah (530), dan banyak berkas dalam SATU sesi.
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { bukaFtp, FtpError } from "@/lib/weather/ftp";

type Opsi = { tanpaEpsv?: boolean };
const BERKAS: Record<string, Buffer> = {
  "/realtime_ver/v8/hourly_G/2026/10/06/a.dat.gz": Buffer.from([1, 2, 3, 255, 0, 7]),
  "/b.bin": Buffer.alloc(200_000, 9),
};
const FOLDER: Record<string, string[]> = { realtime_ver: ["v6", "v7", "v8", "README.txt"] };

const server: Server[] = [];
afterEach(async () => {
  await Promise.all(server.splice(0).map((s) => new Promise((ok) => s.close(ok))));
});

async function jalankan(opsi: Opsi = {}): Promise<{ port: number; perintah: string[] }> {
  const perintah: string[] = [];
  const srv = createServer((c: Socket) => {
    let dataSrv: Server | null = null;
    let dataSock: Promise<Socket> | null = null;
    const tulis = (s: string) => c.write(`${s}\r\n`);
    tulis("220-Selamat datang");
    tulis("220-di server uji");
    tulis("220 siap");
    let sisa = "";
    c.on("data", async (b) => {
      sisa += b.toString();
      let i: number;
      while ((i = sisa.indexOf("\r\n")) >= 0) {
        const baris = sisa.slice(0, i);
        sisa = sisa.slice(i + 2);
        const [cmd, ...arg] = baris.split(" ");
        const a = arg.join(" ");
        perintah.push(cmd === "PASS" ? "PASS ***" : baris);
        const bukaData = async () => {
          dataSrv = createServer();
          server.push(dataSrv);
          dataSock = new Promise((ok) => dataSrv!.once("connection", ok));
          await new Promise<void>((ok) => dataSrv!.listen(0, "127.0.0.1", ok));
          return (dataSrv.address() as { port: number }).port;
        };
        if (cmd === "USER") tulis(a === "rainmap" ? "331 sandi?" : "530 tidak dikenal");
        else if (cmd === "PASS") tulis(a === "rahasia" ? "230 masuk" : "530 Login incorrect.");
        else if (cmd === "TYPE") tulis("200 ok");
        else if (cmd === "EPSV") {
          if (opsi.tanpaEpsv) tulis("500 tidak dikenal");
          else tulis(`229 Entering Extended Passive Mode (|||${await bukaData()}|)`);
        } else if (cmd === "PASV") {
          const p = await bukaData();
          tulis(`227 Entering Passive Mode (10,0,0,9,${Math.floor(p / 256)},${p % 256})`);
        } else if (cmd === "RETR" || cmd === "NLST") {
          const isi = cmd === "RETR" ? BERKAS[a] : FOLDER[a] ? Buffer.from(FOLDER[a].join("\r\n") + "\r\n") : undefined;
          const s = await dataSock!;
          if (!isi) {
            s.destroy();
            tulis("550 No such file or directory.");
            continue;
          }
          tulis("150 membuka sambungan data");
          s.end(isi, () => tulis("226 selesai"));
        } else if (cmd === "QUIT") {
          tulis("221 dah");
          c.end();
        } else tulis("502 belum");
      }
    });
  });
  server.push(srv);
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  return { port: (srv.address() as { port: number }).port, perintah };
}

describe("bukaFtp", () => {
  it("masuk, ambil beberapa berkas dalam satu sesi, dan lihat isi folder", async () => {
    const { port, perintah } = await jalankan();
    const f = await bukaFtp({ host: "127.0.0.1", port, user: "rainmap", pass: "rahasia", timeoutMs: 5000 });
    expect(await f.ambil("/realtime_ver/v8/hourly_G/2026/10/06/a.dat.gz")).toEqual(BERKAS["/realtime_ver/v8/hourly_G/2026/10/06/a.dat.gz"]);
    expect((await f.ambil("/b.bin"))!.length).toBe(200_000);
    expect(await f.daftar("realtime_ver")).toEqual(["v6", "v7", "v8", "README.txt"]);
    await f.tutup();
    expect(perintah.filter((p) => p.startsWith("USER"))).toHaveLength(1);
    expect(perintah).toContain("PASS ***");
  });

  it("berkas atau folder yang tidak ada → null / [] tanpa menutup sesi", async () => {
    const { port } = await jalankan();
    const f = await bukaFtp({ host: "127.0.0.1", port, user: "rainmap", pass: "rahasia", timeoutMs: 5000 });
    expect(await f.ambil("/tidak/ada.gz")).toBeNull();
    expect(await f.daftar("tidak_ada")).toEqual([]);
    expect((await f.ambil("/b.bin"))!.length).toBe(200_000);
    await f.tutup();
  });

  it("server tanpa EPSV: jatuh ke PASV dan memakai host yang sama, bukan IP di balasan", async () => {
    const { port, perintah } = await jalankan({ tanpaEpsv: true });
    const f = await bukaFtp({ host: "127.0.0.1", port, user: "rainmap", pass: "rahasia", timeoutMs: 5000 });
    expect((await f.ambil("/b.bin"))!.length).toBe(200_000);
    await f.tutup();
    expect(perintah).toContain("PASV");
  });

  it("sandi salah ditolak dengan pesan yang jelas", async () => {
    const { port } = await jalankan();
    const gagal = bukaFtp({ host: "127.0.0.1", port, user: "rainmap", pass: "salah", timeoutMs: 5000 });
    await expect(gagal).rejects.toThrow(FtpError);
    await expect(gagal).rejects.toThrow(/sandi salah/);
  });

  it("host yang tidak bisa dihubungi gagal dengan FtpError, bukan menggantung", async () => {
    await expect(bukaFtp({ host: "127.0.0.1", port: 1, user: "a", pass: "b", timeoutMs: 2000 })).rejects.toThrow(FtpError);
  });
});
