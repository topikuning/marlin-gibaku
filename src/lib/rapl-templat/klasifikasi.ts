/**
 * PENGENAL URAIAN → TEMPLAT RAPL (DECISIONS 801) – murni.
 *
 * Ditulis ulang dari prototipe referensi user 2026-11-28 (`rapl-referensi`,
 * `lib.py` `classify` + `lib2.py` `classify2`), yang dipakai menyusun RAPL
 * enam lokasi Bolaang Mongondow Timur. URUTAN aturan dipertahankan persis:
 * aturan pertama yang cocok yang dipakai, dan beberapa aturan sengaja
 * mendahului yang lain ("pemadatan beton" sebelum "pemadatan", "urugan tanah
 * kembali" sebelum "urugan tanah").
 *
 * Hasilnya salah satu dari:
 * - id templat (`templat.json`) – item diurai menjadi bahan, upah, dan alat;
 * - `K3` – perlengkapan K3 yang dibeli jadi;
 * - `FIX` – biaya resmi, sewa, mobilisasi alat (satu baris, harga RAB);
 * - `FB` – pengiriman barang (ongkos kirim);
 * - `GEN` – barang jadi yang tidak dikenali (satu baris pengadaan).
 */

export type HasilKlasifikasi = string;

const SATUAN_PANJANG = new Set(["m", "m¹", "m'", "m1"]);

/** Uraian dirapikan seperti referensi: huruf kecil, tanpa tilde/spasi di depan. */
export function rapikanUraian(uraian: string): string {
  return uraian.toLowerCase().trim().replace(/^[~ ]+/, "").trim();
}

/** `classify` referensi (lib.py) – urutan aturan dipertahankan. */
function klasifikasiDasar(uraian: string, satuan: string): HasilKlasifikasi {
  const s = rapikanUraian(uraian);
  const u = satuan.trim();
  const ada = (k: string) => s.includes(k);
  if (
    /^(sepatu keselamatan|topi pelindung|rompi|pelindung pernapasan|sarung tangan|rambu|apar|alat pemadam|bendera k3|lampu darurat|pembatas area|jalur evakuasi|peralatan p3k|papan nama|rambuncis)/.test(
      s,
    )
  )
    return "K3";
  if (
    /^(bpjs|pembuatan manual|pembuatan kartu|induksi|pengarahan|pelaporan k3|pendaftaran nidi|biaya pasang baru|pekerjaan sondir|pekerjaan penyelidikan geolistrik|pengeboran lubang awal|bulldozer|roller vibrator|excavator|concrete mixer|stamper|mesin las|petugas k3|pekerjaan sewa rumah|listrik kerja)/.test(
      s,
    )
  )
    return "FIX";
  if (ada("pengiriman") && !ada("tiang")) return "FB";
  if (ada("bedeng")) return "bedeng";
  if (ada("pagar sementara")) return "pagar";
  if (ada("land clearing")) return "clearing";
  if (ada("stake out")) return "stakeout";
  if (ada("perancah") || ada("scafolding") || ada("scaffolding")) return ada("bongkar") ? "bongkar" : "perancah";
  if (ada("bekesting pasangan batako") || ada("bekisting pasangan batako")) return "batako_bek";
  if (ada("bekesting") || ada("bekisting")) {
    if (ada("lantai")) return "bek_lantai";
    if (/sloof|pondasi|kayu/.test(s) && !ada("kolom") && !ada("balok")) return "bek_kayu";
    return "bek_kolom";
  }
  if (ada("wiremes") || ada("wiremseh")) return "wiremesh";
  if (/pembesian|besi beton|dowel|angkur|tul\. pokok|ties/.test(s)) return "rebar";
  if (ada("pemadatan beton") || ada("concrete vibrator")) return "vibrator";
  if (ada("langsir")) return "langsir";
  if (/cerucuk|dolken|pancang/.test(s)) return "dolken";
  if (ada("aanstamping") || ada("batu kosong")) return "batu_kosong";
  if (ada("pasangan batu 1 : 2") || ada("pasangan batu 1:2")) return "batu_12";
  if (ada("batu belah") || ada("batu kali")) return "batu_belah";
  if (ada("pemadatan")) return ada("alat berat") ? "pad_alat" : "stamper";
  if (ada("buang tanah")) return "buang_tanah";
  if (ada("galian")) {
    if (/s\/?\.?d\.? ?2 m|sampai dengan 2 m|1-2 m|sampai 2/.test(s) || ada("dalam")) return "galian_dlm";
    return ada("keras") ? "galian_keras" : "galian";
  }
  if (ada("urugan tanah kembali")) return "urug_kembali";
  if (ada("urugan tanah")) return "urug_dtg";
  if (ada("pasir urug") || ada("urugan pasir") || ada("urugan gravel")) return "pasir_urug";
  if (ada("makadam")) return "makadam";
  if (ada("sirtu")) return "sirtu";
  if (/lantai kerja|rabat beton/.test(s)) return "k100";
  if (ada("rolaag") || ada("roolag")) return "rolaag";
  if (/bata merah|pasangan bata|dinding bata|dinding pasangan bata/.test(s)) return "bata";
  if (ada("plesteran")) return "plester";
  if (ada("skonengan")) return "skonengan";
  if (ada("acian")) return "acian";
  if (ada("screeding")) return "screed";
  if (ada("floor hardener")) return "hardener";
  if (ada("paving")) return "paving";
  if (ada("kanstin")) return "kanstin";
  if (ada("geotextile")) return "geotex";
  if (ada("plastik cor")) return "plastik";
  if (ada("joint sealer")) return "jsealer";
  if (ada("keramik") && ada("dinding")) return "keramik_d";
  if (ada("keramik")) return ada("matte") ? "keramik_m" : "keramik_p";
  if (ada("waterproofing")) return "wproof";
  if (ada("tekstur")) return "tekstur";
  if (/cat plafond|pengecatan plafond|cat plafon/.test(s)) return "cat_plafon";
  if (/cat dinding \(interior\)/.test(s)) return "cat_dalam";
  if (/^cat |pengecatan|cat dinding|^pekerjaan cat/.test(s)) return "cat_luar";
  if (/rangka atap baja ringan|baja ringan \(canai/.test(s) && !ada("reng")) return "baja_ringan";
  if (ada("reng baja ringan")) return "reng";
  if (ada("nok spandek")) return "nok";
  if (ada("atap spandek")) return "spandek";
  if (ada("plafond grc")) return "plafon_grc";
  if (ada("listplank") && !ada("cat") && !ada("pengecatan")) return "listplank";
  if (ada("beton") && /fc|f'c|site mix|semi mekanis|mpa/.test(s))
    return /fc\s*=?\s*25|25 mpa|k.?300/.test(s) ? "beton25" : "beton20";
  if (/pipa pvc|pipa pvc aw|instalasi air|saluran pipa pvc|instalasi drainase/.test(s) && SATUAN_PANJANG.has(u))
    return "pvc_in";
  if (
    /instalasi penerangan nym|1 titik instalasi penerangan|instalasi penerangan, kabel nym/.test(s) ||
    (s.startsWith("instalasi penerangan") && ada("nym"))
  )
    return "inst_nym_t";
  if (/stop kontak.*nym|instalasi stop kontak/.test(s) && u === "ttk") return "inst_stop_t";
  if (ada("tarik kabel nyy 2 x 4")) return "nyy2x4";
  if (ada("tarik kabel distribusi nyy 4 x 6")) return "nyy4x6";
  if (ada("sparing pipa pvc")) return "sparing";
  return "FALLBACK";
}

/** Aturan tambahan `classify2` (lib2.py) – dicoba HANYA bila aturan dasar tidak cocok. */
const ATURAN_LANJUT: readonly [RegExp, string][] = [
  [/pompa air submersible/, "sumur_pompa"],
  [/setting pipa galvanis/, "gip6"],
  [/tiang pju 7 meter.*single arm/, "pju7s"],
  [/tiang pju 7 meter.*(dobel|double) arm/, "pju7d"],
  [/tiang pju 4 meter/, "pju4d"],
  [/pengiriman tiang lampu/, "kirim_pju"],
  [/pintu dobel besi/, "pintu_besi"],
  [/rumput gajah/, "rumput"],
  [/pohon sedang mangga/, "pohon_m"],
  [/pohon sedang lengkeng/, "pohon_l"],
  [/pohon sedang rambutan/, "pohon_r"],
  [/pohon sedang alpukat/, "pohon_a"],
  [/^pekerjaan roster|dinding roster/, "roster"],
  [/pipa isap\/hantar/, "pvc2_ih"],
  [/rangka atap kanopi/, "kanopi"],
  [/jendela jalusi aluminium|jalusi aluminium/, "jalusi"],
  [/instalasi penerangan jalan, kabel nyy 4/, "pnyy_pju"],
  [/instalasi penerangan, kabel nyy 2/, "pnyy_15"],
  [/flange gate valve/, "gate2"],
  [/tangki air frp/, "tangki18"],
  [/toren kap\.2000/, "toren2000"],
  [/toren kap\.600/, "toren600"],
  [/bio-?tech 1 m/, "bf1"],
  [/ipal biotech/, "ipal2"],
  [/panel box 3 phase/, "panel3"],
  [/panel kontrol pompa/, "panel_pompa"],
  [/panel distribusi$/, "panel_dist"],
  [/panel kontroler/, "panel_ctrl"],
  [/lvmdp/, "lvmdp"],
  [/kabel elektroda nyyhy 3 x 2/, "nyyhy25"],
  [/kabel pompa nyyhy 3 x 1/, "nyyhy15"],
  [/water level switch/, "float"],
  [/dynabolt m8/, "dynab8"],
  [/dynabolt/, "dynab10"],
  [/rod coupling/, "rodcpl"],
  [/closet duduk/, "wc"],
  [/jet washer/, "jet"],
  [/kran air/, "kran"],
  [/floor drain/, "fdrain"],
  [/pompa dorong/, "pdorong"],
  [/tangga monyet/, "tangga"],
  [/tutup rumah pompa/, "kanopi_pompa"],
  [/huruf timbul/, "huruf"],
  [/logo kkp/, "logo"],
  [/perfoated screen/, "screen3"],
  [/kusen aluminium/, "kusen_alu"],
  [/daun jendela aluminium/, "daun_jendela"],
  [/rooling door|rolling door/, "rolling"],
  [/dinding grc motif/, "dinding_grc"],
  [/sopi-sopi grc/, "sopi"],
  [/downlight/, "downlight"],
  [/kipas angin/, "kipas"],
  [/kusen pintu upvc/, "pintu_upvc"],
  [/engineering door/, "eng_door"],
  [/ac split/, "ac"],
  [/mcb 2 ampere/, "mcb2"],
  [/box panel listrik \(mcb\) 8/, "box8"],
  [/box panel listrik \(mcb\) 4/, "box4"],
  [/grounding/, "grounding"],
  [/gravel pack/, "gravel"],
  [/sambungan pipa, sock.*(pvc)/, "sock_pvc"],
  [/sambungan pipa, sock/, "sock"],
  [/tee pipa galvanis/, "tee"],
  [/kaca es/, "kaca_es"],
  [/kaca polos/, "kaca5"],
  [/^casement/, "casement"],
  [/engsel jendela/, "hinge3"],
  [/engsel pintu/, "hinge4"],
  [/door closer/, "closer"],
  [/handel \+ kunci/, "kunci"],
  [/instalasi tv/, "tv"],
  [/stop kontak/, "stop"],
  [/saklar (tunggal)/, "saklar1"],
  [/saklar (ganda|double|dobel)|saklar dobel/, "saklar2"],
  [/pengelasan sambungan pipa/, "las_pipa"],
  [/semen grouting/, "grout"],
  [/bouwplank/, "bouwplank"],
  [/pengukuran/, "ukur"],
  [/^c$/, "bouwplank"],
  [/pelabuhan|shelter pendaratan ikan - |bangunan kantor - /, "bouwplank"],
];

/**
 * Templat untuk satu item RAB. `induk` = judul kelompok tepat di atas item
 * (dipakai baris "Pengadaan barang" di bawah judul toren/tiang menara).
 */
export function klasifikasiItem(uraian: string, satuan: string, induk = ""): HasilKlasifikasi {
  const dasar = klasifikasiDasar(uraian, satuan);
  if (dasar !== "FALLBACK") return dasar;
  const s = rapikanUraian(uraian);
  for (const [pola, templat] of ATURAN_LANJUT) if (pola.test(s)) return templat;
  if (s === "pengadaan barang") {
    const p = induk.toLowerCase();
    return p.includes("toren") || p.includes("tiang menara") ? "toren_tiang" : "GEN";
  }
  return "GEN";
}
