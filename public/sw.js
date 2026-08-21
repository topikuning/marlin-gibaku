/**
 * SERVICE WORKER MARLIN — supaya aplikasinya bisa DIBUKA saat tidak ada sinyal
 * (DECISIONS 398, menutup butir OPEN_ISSUES "PWA offline penuh").
 *
 * Sebelum berkas ini: foto yang SUDAH dijepret selamat melewati sinyal putus
 * (antrean IndexedDB, DECISIONS 257), tapi aplikasinya sendiri harus sekali
 * terbuka lebih dulu. Di lapangan itu berarti mandor yang HP-nya baru menyala
 * di luar jangkauan tidak bisa memotret sama sekali — bukti hilang bukan karena
 * sistemnya gagal, melainkan karena halamannya tak bisa dimuat.
 *
 * Yang DIJANJIKAN: `/foto-cepat` terbuka tanpa jaringan, memakai HTML kunjungan
 * terakhir, dengan pemberitahuan terang-terangan bahwa isinya simpanan.
 * Yang TIDAK dijanjikan: data segar, halaman lain, atau pemeriksaan sesi saat
 * luring — lihat DECISIONS 398 bagian "Yang TIDAK dijanjikan".
 *
 * Keputusan "boleh disimpan / tidak" ada di sw-kebijakan.js supaya bisa diuji.
 */
importScripts("/sw-kebijakan.js");

var K = self.KEBIJAKAN_SW;

/**
 * Navigasi terakhir yang DIJAWAB DARI SIMPANAN — `{url, pada}` atau null.
 *
 * Umurnya sependek proses service worker, dan itu memang cukup: yang bertanya
 * adalah halaman yang baru saja dijawab, beberapa ratus milidetik sesudahnya.
 */
var terakhirLuring = null;

/**
 * Jawaban darurat kalau halaman /offline sendiri belum sempat tersimpan
 * (pemasangan terjadi saat sinyal sudah putus). Sengaja tanpa gaya: yang
 * penting orangnya tahu ini keadaan jaringan, bukan aplikasinya rusak.
 */
var HTML_DARURAT =
  '<!doctype html><html lang="id"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>Tidak ada jaringan</title></head><body style=\"font-family:system-ui;padding:24px;line-height:1.5\">" +
  "<h1 style=\"font-size:18px\">Tidak ada jaringan</h1>" +
  "<p>Halaman ini belum pernah tersimpan di HP, jadi belum bisa dibuka tanpa sinyal. " +
  "Cari sinyal sebentar, lalu buka lagi.</p>" +
  "<p>Foto yang sudah terlanjur dijepret tetap aman di antrean dan terkirim sendiri begitu ada jaringan.</p>" +
  "</body></html>";

self.addEventListener("install", function (event) {
  event.waitUntil(prapasang());
});

self.addEventListener("activate", function (event) {
  event.waitUntil(aktifkan());
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  var rencana = K.rencana({
    metode: req.method,
    url: req.url,
    asal: self.location.origin,
    mode: req.mode,
    // Dua-duanya menandai muatan RSC: navigasi sisi-klien membawa `RSC`,
    // prefetch tautan membawa `Next-Router-Prefetch`.
    rsc: req.headers.has("RSC") || req.headers.has("Next-Router-Prefetch"),
  });

  if (rencana === "lewati") return;
  if (rencana === "aset-statis") {
    event.respondWith(asetDuluSimpanan(req));
    return;
  }
  event.respondWith(jaringanDulu(req, rencana === "navigasi-luring"));
});

self.addEventListener("message", function (event) {
  var pesan = event.data;
  if (!pesan || typeof pesan !== "object") return;
  if (pesan.jenis === "halo") {
    event.waitUntil(halo(String(pesan.pemilik || ""), String(pesan.build || "")));
  } else if (pesan.jenis === "siapkan-luring") {
    event.waitUntil(siapkanLuring(String(pesan.jalur || "")));
  } else if (pesan.jenis === "bersihkan-halaman") {
    event.waitUntil(caches.delete(K.NAMA.halaman));
  } else if (pesan.jenis === "info-simpanan") {
    event.waitUntil(jawabInfo(event, String(pesan.url || "")));
  }
});

/**
 * Pasang kerangka luring: halaman /offline BESERTA css/js yang dirujuknya.
 *
 * Menyimpan HTML-nya saja tidak cukup — berkas gayanya ber-nama hash yang tidak
 * bisa ditebak dari sini, dan halaman luring yang tampil tanpa gaya terbaca
 * "aplikasinya rusak", persis kesan yang sedang dihindari. Jadi HTML-nya dibaca
 * lalu rujukan /_next/static di dalamnya ikut dijemput.
 */
async function prapasang() {
  var kerangka = await caches.open(K.NAMA.kerangka);
  await Promise.all(
    K.PRAPASANG.map(function (jalur) {
      // Satu berkas gagal (sinyal putus saat pemasangan) tidak boleh
      // menggagalkan seluruh pendaftaran — sisanya masih berguna.
      return kerangka.add(new Request(jalur, { cache: "reload" })).catch(function () {});
    }),
  );
  await simpanAsetHalaman(await kerangka.match(K.HALAMAN_OFFLINE));
  await self.skipWaiting();
}

/** Jemput rujukan /_next/static di dalam sebuah HTML ke cache aset. */
async function simpanAsetHalaman(jawaban) {
  if (!jawaban) return;
  var html = await jawaban.clone().text();
  var jalur = [];
  // Wajib berakhiran berkas (`.js`, `.css`, `.woff2`): tanpa itu, potongan
  // alamat yang kebetulan berawalan sama ikut terjemput dan menghuni simpanan
  // sebagai entri yang tak pernah dipakai siapa pun.
  var pola = /["'(](\/_next\/static\/[^"')\s]+\.[a-zA-Z0-9]+)["')]/g;
  var cocok;
  while ((cocok = pola.exec(html)) !== null) {
    if (jalur.indexOf(cocok[1]) < 0) jalur.push(cocok[1]);
  }
  if (jalur.length === 0) return;
  var aset = await caches.open(K.NAMA.aset);
  await Promise.all(
    jalur.map(function (j) {
      return aset.add(j).catch(function () {});
    }),
  );
}

async function aktifkan() {
  var nama = await caches.keys();
  await Promise.all(
    nama.map(function (n) {
      return K.cacheUsang(n) ? caches.delete(n) : Promise.resolve(false);
    }),
  );
  await self.clients.claim();
}

/**
 * Aset ber-hash: simpanan dulu. Isi berkas dan namanya terikat, jadi "lama"
 * di sini tidak berarti "salah" — build baru meminta nama baru.
 */
async function asetDuluSimpanan(req) {
  var aset = await caches.open(K.NAMA.aset);
  var tersimpan = await aset.match(req);
  if (tersimpan) return tersimpan;
  var jawaban = await fetch(req);
  if (jawaban && jawaban.ok && jawaban.type === "basic") {
    await aset.put(req, jawaban.clone());
  }
  return jawaban;
}

/**
 * Navigasi: JARINGAN DULU, selalu. Simpanan hanya dipakai kalau jaringannya
 * benar-benar gagal.
 *
 * Urutan sebaliknya (simpanan dulu) akan membuat halaman terasa lebih cepat dan
 * menampilkan data kemarin kepada orang yang sedang online — persis jenis
 * kebohongan diam-diam yang paling mahal di sistem pengendalian proyek.
 */
async function jaringanDulu(req, simpan) {
  try {
    var jawaban = await fetch(req);
    if (simpan && jawaban && layakSimpan(jawaban, K.kunciHalaman(req.url))) {
      var halaman = await caches.open(K.NAMA.halaman);
      await halaman.put(K.kunciHalaman(req.url), await salinanBercap(jawaban.clone()));
    }
    return jawaban;
  } catch (_) {
    if (simpan) {
      var simpananHalaman = await caches.open(K.NAMA.halaman);
      var lama = await simpananHalaman.match(K.kunciHalaman(req.url));
      if (lama) {
        // Dicatat supaya halamannya bisa MENGAKU dirinya simpanan. Tanpa ini,
        // klien hanya bisa menebak dari `navigator.onLine` — dan nilai itu
        // `true` juga saat HP menempel ke menara tanpa data sama sekali
        // (DECISIONS 257), jadi tebakannya akan meleset persis di keadaan yang
        // paling sering terjadi di lapangan.
        terakhirLuring = { url: req.url, pada: Date.now() };
        return lama;
      }
    }
    var luring = await caches.match(K.HALAMAN_OFFLINE);
    return (
      luring ||
      new Response(HTML_DARURAT, {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );
  }
}

/** Jawaban ini boleh disimpan sebagai halaman `kunci`? (kebijakannya diuji) */
function layakSimpan(jawaban, kunci) {
  return K.bolehSimpanHalaman({
    kunci: kunci,
    urlAkhir: jawaban.url || kunci,
    redirected: jawaban.redirected === true,
    status: jawaban.status,
    tipe: jawaban.type,
  });
}

/**
 * SIAPKAN LURING: jemput halaman lapangan lalu simpan, tanpa menunggu orangnya
 * membukanya.
 *
 * Ini yang membuat mode pesawat benar-benar bisa dipakai. Tanpa penyiapan,
 * simpanan hanya lahir dari kunjungan yang sudah terjadi — jadi mandor yang
 * memasang MARLIN di kantor lalu berangkat ke lokasi tanpa pernah menekan menu
 * Foto Cepat akan menemukan aplikasinya kosong persis saat dibutuhkan. Cukup
 * aplikasinya terbuka sekali di tempat ada sinyal.
 *
 * Sekaligus menjaga simpanannya SEGAR: tiap kali aplikasi dibuka online,
 * rekamannya diperbarui — jadi yang tampil saat luring adalah keadaan terakhir
 * kali HP ini punya sinyal, bukan keadaan kunjungan entah kapan.
 */
async function siapkanLuring(jalur) {
  // Hanya rute yang memang boleh disimpan. Pesan dari halaman tidak boleh bisa
  // memperluas daftar putih.
  if (K.RUTE_LURING.indexOf(jalur) < 0) return;

  var halaman = await caches.open(K.NAMA.halaman);
  var lama = await halaman.match(jalur);
  if (lama) {
    var cap = Date.parse(lama.headers.get(K.CAP_SIMPAN) || "");
    if (!isNaN(cap) && Date.now() - cap < K.JEDA_SIAP_MS) return;
  }

  var jawaban;
  try {
    jawaban = await fetch(
      new Request(jalur, {
        credentials: "same-origin",
        headers: { accept: "text/html" },
      }),
    );
  } catch (_) {
    // Tidak ada sinyal saat menyiapkan. Simpanan lama (kalau ada) tetap utuh.
    return;
  }

  if (!layakSimpan(jawaban, jalur)) return;
  await halaman.put(jalur, await salinanBercap(jawaban.clone()));
  // Tanpa berkas gaya & skripnya, halaman tersimpan itu terbuka sebagai teks
  // polos tanpa kamera — tersimpan tapi tidak bisa dipakai.
  await simpanAsetHalaman(jawaban);
}

/**
 * Salinan HTML untuk disimpan: header dibangun ULANG, bukan disalin.
 *
 * Jawaban halaman ber-sesi membawa header yang tidak boleh ikut menetap di
 * perangkat (Set-Cookie, cache-control server). Yang disimpan cuma jenis isi +
 * cap waktu, dan cap itulah yang dipakai memberi tahu pembacanya bahwa yang
 * dilihatnya simpanan tanggal sekian.
 */
async function salinanBercap(jawaban) {
  var isi = await jawaban.blob();
  var header = { "content-type": jawaban.headers.get("content-type") || "text/html; charset=utf-8" };
  header[K.CAP_SIMPAN] = new Date().toISOString();
  return new Response(isi, { status: 200, statusText: "OK", headers: header });
}

/**
 * Jawab pertanyaan klien: halaman yang sedang dibaca ini datang dari simpanan
 * atau dari server, dan simpanannya bertanggal berapa.
 */
async function jawabInfo(event, url) {
  var disimpanPada = null;
  try {
    var halaman = await caches.open(K.NAMA.halaman);
    var tersimpan = await halaman.match(K.kunciHalaman(url));
    if (tersimpan) disimpanPada = tersimpan.headers.get(K.CAP_SIMPAN);
  } catch (_) {
    disimpanPada = null;
  }
  var dariSimpanan =
    !!terakhirLuring &&
    K.kunciHalaman(terakhirLuring.url) === K.kunciHalaman(url) &&
    Date.now() - terakhirLuring.pada < 60000;
  var balasan = {
    jenis: "info-simpanan",
    url: url,
    dariSimpanan: dariSimpanan,
    disimpanPada: disimpanPada,
  };
  if (event.ports && event.ports[0]) event.ports[0].postMessage(balasan);
  else if (event.source) event.source.postMessage(balasan);
}

/**
 * Sapaan klien: siapa yang sedang memakai HP ini, dan build mana.
 *
 * Ganti pemilik = buang HTML ber-sesi. Satu HP dipakai bergantian di lapangan;
 * tanpa ini, orang berikutnya yang membuka aplikasi tanpa sinyal akan melihat
 * halaman milik orang sebelumnya, lengkap dengan daftar lokasinya.
 *
 * Ganti build = buang aset lama. Berkas ber-hash tidak pernah salah, tapi
 * menumpuk; deploy adalah saat yang wajar untuk menyapunya.
 */
async function halo(pemilik, build) {
  var kerangka = await caches.open(K.NAMA.kerangka);
  var meta = { pemilik: "", build: "" };
  try {
    var tersimpan = await kerangka.match(K.KUNCI_META);
    if (tersimpan) meta = await tersimpan.json();
  } catch (_) {
    meta = { pemilik: "", build: "" };
  }

  if (meta.pemilik && meta.pemilik !== pemilik) await caches.delete(K.NAMA.halaman);

  if (meta.build && build && meta.build !== build) {
    // Kerangka luring diperbarui DULU, baru aset lama dibuang. Urutan
    // sebaliknya akan meninggalkan HP tanpa halaman luring sama sekali kalau
    // sapaan ini kebetulan terjadi di luar jangkauan — dan sapaan pertama
    // sesudah deploy justru sering terjadi di lapangan.
    var segar = false;
    try {
      await kerangka.add(new Request(K.HALAMAN_OFFLINE, { cache: "reload" }));
      segar = true;
    } catch (_) {
      segar = false;
    }
    if (segar) {
      await caches.delete(K.NAMA.aset);
      await simpanAsetHalaman(await kerangka.match(K.HALAMAN_OFFLINE));
    } else {
      // Penanda build lama DIPERTAHANKAN supaya penyapuan dicoba lagi pada
      // sapaan berikutnya, saat sinyalnya ada.
      build = meta.build;
    }
  }

  await kerangka.put(
    K.KUNCI_META,
    new Response(JSON.stringify({ pemilik: pemilik, build: build }), {
      headers: { "content-type": "application/json" },
    }),
  );
}
