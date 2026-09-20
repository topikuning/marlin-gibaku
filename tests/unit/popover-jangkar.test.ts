/*
 * POPOVER YANG MENGAMBANG JAUH DARI TOMBOLNYA (produksi 2026-09-19).
 *
 * Panel konfirmasi "Hitung ulang kurva-S" muncul di tepi KANAN kartu sambil
 * menimpa tabel, sementara tombol pemicunya ada di kiri atas. User menanyakannya
 * persis begitu: *"tombol dimana, munculnya dimana"*.
 *
 * Sebabnya satu baris CSS. `absolute left-0/right-0` menjangkar ke pembungkus
 * `relative` TERDEKAT, bukan ke tombolnya. Kalau pembungkus itu `div` biasa, ia
 * elemen BLOK yang melar selebar induknya — jadi `right-0` berarti "tepi kanan
 * kartu", bukan "tepi kanan tombol". Selama tombolnya kebetulan duduk di header
 * yang sempit, keduanya tampak sama; begitu tombolnya pindah ke dalam section
 * selebar kartu, panelnya melompat.
 *
 * Maka pembungkus popover WAJIB menyusut ke ukuran pemicunya
 * (`inline-flex` / `inline-block` / `w-fit`). Dua popover lain di repo ini
 * (`ui/unduh.tsx`, `location-switcher.tsx`) sudah begitu sejak awal; yang ini
 * satu-satunya yang tidak, dan itulah yang terlihat di layar.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const AKAR = join(import.meta.dirname, "..", "..");

/** Kelas yang membuat sebuah pembungkus menyusut ke isinya. */
const MENYUSUT = ["inline-flex", "inline-block", "inline-grid", "w-fit", "max-w-fit"];

function berkasTsx(): string[] {
  return execFileSync("git", ["ls-files", "src/**/*.tsx"], { cwd: AKAR, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** Semua isi className="..." / className={cn("...")} beserta posisinya. */
function kelasBerposisi(isi: string): { idx: number; kelas: string }[] {
  const out: { idx: number; kelas: string }[] = [];
  const re = /"([^"\n]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(isi)) !== null) out.push({ idx: m.index, kelas: m[1]! });
  return out;
}

describe("popover absolut dijangkar ke pemicunya, bukan ke kartunya", () => {
  it("tiap pembungkus `relative` milik popover menyusut ke ukuran tombolnya", () => {
    const pelanggar: string[] = [];

    for (const f of berkasTsx()) {
      const isi = readFileSync(join(AKAR, f), "utf8");
      if (!isi.includes("top-full")) continue;

      const kelas = kelasBerposisi(isi);
      for (const { idx, kelas: k } of kelas) {
        if (!k.includes("top-full") || !k.includes("absolute")) continue;

        // Pembungkus `relative` terdekat SEBELUM panel ini.
        const bungkus = kelas
          .filter((c) => c.idx < idx && /(^|\s)relative(\s|$)/.test(c.kelas))
          .at(-1);

        if (!bungkus) {
          pelanggar.push(`${f}: panel \`absolute top-full\` tanpa pembungkus \`relative\``);
          continue;
        }
        if (!MENYUSUT.some((m) => bungkus.kelas.includes(m))) {
          pelanggar.push(
            `${f}: pembungkus "${bungkus.kelas}" melar selebar induknya, ` +
              `jadi panelnya menjangkar ke kartu, bukan ke tombol`,
          );
        }
      }
    }

    expect(pelanggar).toEqual([]);
  });
});
