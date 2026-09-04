/**
 * MENERJEMAHKAN GALAT JADI KALIMAT YANG BISA DITINDAKLANJUTI.
 *
 * Keluhan user 2026-09-04: *"yang kupermasalahkan kenapa errornya gak kamu
 * jelaskan!"* — di layar berhenti yang cuma menyalin kalimat Next mentah-mentah:
 *
 *     Error: An unexpected response was received from the server.
 *
 * Kalimat itu tidak menjelaskan apa pun kepada orang yang membacanya. Ia tidak
 * menyebut apa yang terjadi, tidak menyebut apakah kerjanya hilang, dan tidak
 * menyebut apa yang harus dilakukan sekarang. Untuk mandor yang memegang ponsel
 * di lokasi, itu sama saja dengan layar kosong — dan panel galat memang dibuat
 * justru supaya keadaan itu tidak terjadi (DECISIONS 290).
 *
 * Lapisan ini MURNI: tidak menyentuh DOM, jaringan, atau DB, supaya tiap
 * terjemahan bisa diuji dari string galat yang sebenarnya muncul di lapangan.
 *
 * ATURAN: yang tidak dikenali TIDAK dikarang. Menebak sebab lebih buruk
 * daripada mengaku tidak tahu — orang akan mengikuti langkah yang salah dan
 * kehilangan waktu, lalu berhenti memercayai layar ini. Galat asing dijawab
 * dengan langkah yang aman dan permintaan melapor.
 */

export type PenjelasanGalat = {
  /** Satu kalimat: APA yang terjadi, dalam bahasa orang. */
  sebab: string;
  /** Apakah kerja yang sudah tersimpan aman. */
  tentangData: string;
  /** Langkah berurut yang benar-benar bisa dikerjakan sekarang. */
  langkah: string[];
  /** Kunci golongan — untuk uji dan telemetri, bukan untuk ditampilkan. */
  golongan:
    | "balasan-bukan-aksi"
    | "tab-basi"
    | "jaringan"
    | "muatan-terlalu-besar"
    | "berkas-aplikasi-gagal-dimuat"
    | "penyimpanan-penuh"
    | "izin"
    | "tak-dikenal";
};

/** Cocokkan pada NAMA + PESAN sekaligus: keduanya bisa berubah antar versi. */
function cocok(teks: string, pola: RegExp[]): boolean {
  return pola.some((p) => p.test(teks));
}

export function jelaskanGalat(nama: string, pesan: string): PenjelasanGalat {
  const teks = `${nama}: ${pesan}`;

  // Tab lebih tua daripada servernya. Diperiksa LEBIH DULU daripada
  // "balasan bukan aksi" karena gejalanya mirip tapi jalan keluarnya berbeda:
  // yang ini tidak akan pernah berhasil kalau hanya ditekan ulang.
  if (
    cocok(teks, [
      /UnrecognizedActionError/i,
      /was not found on the server/i,
      /failed to find server action/i,
    ])
  ) {
    return {
      golongan: "tab-basi",
      sebab:
        "MARLIN sudah diperbarui sejak halaman ini dibuka, jadi kiriman dari halaman lama ini ditolak servernya.",
      tentangData: "Yang sudah tersimpan aman. Yang belum sempat terkirim masih ada di layar ini.",
      langkah: [
        "Catat atau foto dulu isian yang belum sempat tersimpan.",
        "Muat ulang halaman – menekan tombolnya lagi tanpa memuat ulang tidak akan berhasil.",
        "Isi ulang lalu simpan. Foto perlu dilampirkan ulang.",
      ],
    };
  }

  if (
    cocok(teks, [
      /an unexpected response was received from the server/i,
      /server action.*(failed|error)/i,
    ])
  ) {
    return {
      golongan: "balasan-bukan-aksi",
      sebab:
        "Kiriman sampai ke server, tapi yang dibalas bukan hasil penyimpanan – biasanya karena kirimannya terlalu besar/terlalu lama (foto banyak, sinyal lemah) atau server sedang di-restart.",
      tentangData:
        "Tidak ada yang tersimpan setengah jalan: penyimpanannya tidak pernah berjalan. Yang sudah tersimpan sebelumnya aman.",
      langkah: [
        "Tekan “Coba lagi”. Kalau isian masih di layar, tidak perlu diketik ulang.",
        "Kalau gagal lagi, kurangi foto per kiriman – simpan beberapa dulu, sisanya menyusul.",
        "Kalau tetap gagal, salin rincian di bawah dan laporkan.",
      ],
    };
  }

  if (cocok(teks, [/\b413\b/, /payload too large/i, /request entity too large/i, /body exceeded/i])) {
    return {
      golongan: "muatan-terlalu-besar",
      sebab: "Kiriman ini melebihi batas ukuran yang diterima server – hampir selalu karena fotonya.",
      tentangData: "Tidak ada yang tersimpan dari kiriman ini. Yang sudah tersimpan sebelumnya aman.",
      langkah: [
        "Kirim fotonya beberapa dulu, jangan sekaligus.",
        "Kalau ditawari mengecilkan foto, terima – ukurannya turun tanpa mengubah isinya.",
      ],
    };
  }

  if (
    cocok(teks, [
      /ChunkLoadError/i,
      /loading chunk \S+ failed/i,
      /failed to fetch dynamically imported module/i,
      /importing a module script failed/i,
    ])
  ) {
    return {
      golongan: "berkas-aplikasi-gagal-dimuat",
      sebab:
        "Sebagian berkas aplikasi gagal diunduh – biasanya sinyal putus di tengah, atau MARLIN baru saja diperbarui saat halaman ini terbuka.",
      tentangData: "Data di server tidak tersentuh sama sekali.",
      langkah: ["Muat ulang halaman.", "Kalau sinyal sedang buruk, tunggu sebentar lalu muat ulang lagi."],
    };
  }

  if (
    cocok(teks, [
      /NetworkError/i,
      /failed to fetch/i,
      /network request failed/i,
      /ERR_INTERNET_DISCONNECTED/i,
      /The Internet connection appears to be offline/i,
    ])
  ) {
    return {
      golongan: "jaringan",
      sebab: "Perangkat ini tidak berhasil menghubungi server – sambungan internetnya terputus atau sangat lemah.",
      tentangData: "Kiriman ini tidak pernah sampai, jadi tidak ada yang berubah di server.",
      langkah: [
        "Periksa sinyal atau pindah ke tempat yang lebih baik.",
        "Coba lagi. Isian di layar tidak hilang.",
      ],
    };
  }

  if (cocok(teks, [/QuotaExceededError/i, /storage.*(full|quota)/i])) {
    return {
      golongan: "penyimpanan-penuh",
      sebab: "Penyimpanan peramban di perangkat ini penuh, jadi halaman tidak bisa menyimpan data sementaranya.",
      tentangData: "Data di server aman.",
      langkah: [
        "Kosongkan ruang di perangkat (hapus foto/berkas yang tidak perlu), lalu muat ulang.",
      ],
    };
  }

  if (cocok(teks, [/\b(401|403)\b/, /Forbidden/i, /tidak berwenang/i, /Unauthorized/i])) {
    return {
      golongan: "izin",
      sebab: "Sesi Anda sudah berakhir atau akun ini tidak berwenang untuk tindakan tersebut.",
      tentangData: "Data di server tidak berubah.",
      langkah: ["Muat ulang halaman lalu masuk kembali.", "Kalau tetap ditolak, hubungi admin MARLIN."],
    };
  }

  return {
    golongan: "tak-dikenal",
    sebab: "Halaman berhenti karena galat yang belum kami kenali – jadi kami belum bisa menyebut sebabnya.",
    tentangData: "Yang sudah tersimpan tidak hilang. Yang belum sempat disimpan perlu diisi ulang.",
    langkah: [
      "Coba lagi, atau muat ulang halaman.",
      "Salin rincian di bawah dan laporkan – itu yang membuat sebabnya bisa ditemukan.",
    ],
  };
}
