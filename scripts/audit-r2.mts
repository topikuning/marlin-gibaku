/**
 * Audit penyimpanan R2 dari terminal — CADANGAN, bukan jalan utama.
 *
 * Jalan utamanya LAYAR: Sistem → Integrasi → "Isi penyimpanan R2", satu tombol
 * Periksa dan satu tombol Bersihkan. Teguran user 2026-09-09 atas versi pertama
 * yang cuma berupa skrip: *"sejak kapan harus buka console lalu harus jalankan
 * perintah itu! kalau kamu ngasih solusi yang praktis!"* — betul, alat
 * pemeliharaan yang menuntut orang membuka terminal produksi bukan alat.
 *
 * Yang tersisa di sini gunanya sempit dan nyata: menjalankan audit yang SAMA
 * PERSIS (`@/lib/r2-audit`, satu implementasi untuk keduanya) saat layarnya
 * tidak bisa dipakai — aplikasi mati, atau bucket terlalu besar sehingga
 * pembacaannya melebihi batas waktu satu permintaan HTTP.
 *
 * Tidak menghapus apa pun. Penghapusan ada di layar, dengan konfirmasi dan
 * jejak audit.
 *
 * Pakai:  railway run pnpm audit:r2
 */
import { auditR2 } from "@/lib/r2-audit";
import { isR2Configured } from "@/lib/r2";

const ukuran = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`;

async function main() {
  if (!isR2Configured()) {
    console.error("✗ R2 belum dikonfigurasi (R2_ENDPOINT dkk kosong).");
    process.exit(1);
  }
  console.log("\nAUDIT PENYIMPANAN R2\n");
  const h = await auditR2();

  console.log("KELOMPOK                      OBYEK        UKURAN     YATIM   UKURAN YATIM");
  for (const p of h.perPrefix)
    console.log(
      `${p.prefix.padEnd(28)} ${String(p.obyek).padStart(7)} ${ukuran(p.bytes).padStart(11)} ` +
        `${String(p.yatim).padStart(9)} ${(p.yatimBytes ? ukuran(p.yatimBytes) : "–").padStart(14)}`,
    );
  console.log(
    `${"TOTAL".padEnd(28)} ${String(h.totalObyek).padStart(7)} ${ukuran(h.totalBytes).padStart(11)} ` +
      `${String(h.yatimObyek).padStart(9)} ${(h.yatimBytes ? ukuran(h.yatimBytes) : "–").padStart(14)}`,
  );
  const persen = h.totalBytes > 0 ? ((h.yatimBytes / h.totalBytes) * 100).toFixed(1) : "0.0";
  console.log(`\n→ ${persen}% isi bucket tidak dirujuk satu baris pun di DB (${h.kolomDipindai} kolom dipindai).`);
  if (h.terpotong) console.log("⚠ Bucket terpotong – angka di atas baru sebagian.");

  if (h.healthcheck.obyek > 0)
    console.log(`\n⚠ ${h.healthcheck.obyek} sisa "healthcheck/" (${ukuran(h.healthcheck.bytes)}).`);

  if (h.yatimTerbesar.length > 0) {
    console.log("\nYATIM TERBESAR:");
    for (const o of h.yatimTerbesar.slice(0, 20))
      console.log(
        `  ${ukuran(o.bytes).padStart(10)}  ${(o.umurHari == null ? "?" : `${o.umurHari}h`).padStart(6)}  ${o.key}`,
      );
  }

  if (h.rujukanHilang.length > 0) {
    console.log("\n⚠ RUJUKAN MENGGANTUNG – baris DB menunjuk berkas yang TIDAK ADA di R2:");
    for (const r of h.rujukanHilang) console.log(`  ${r.label}: ${r.hilang} – contoh: ${r.contoh.join(", ")}`);
    console.log("  Ini bukan sampah, ini kehilangan.");
  } else {
    console.log("\n✓ Tidak ada rujukan menggantung.");
  }

  console.log(
    "\nPenghapusannya ada di layar Sistem → Integrasi → Isi penyimpanan R2,\n" +
      "supaya ada konfirmasi dan jejak audit. Skrip ini tidak menghapus apa pun.\n",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
