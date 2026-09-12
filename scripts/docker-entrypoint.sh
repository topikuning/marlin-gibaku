#!/bin/sh
set -e

# ENTRYPOINT MARLIN — menyiapkan simpanan lampiran SEBELUM hak akses dilepas.
#
# Kenapa ada berkas ini (kejadian produksi 2026-09-03: *"kenapa file masih
# hilang saat deploy ulang? padahal di production sudah ada volume khusus?!"*).
#
# Volume Railway dipasang ke kontainer sebagai milik ROOT dengan mode 755.
# Prosesnya berjalan sebagai `marlin` (uid 1001), jadi `mkdir /data/lampiran`
# GAGAL dengan EACCES — dan kegagalannya tidak terlihat: aplikasi punya
# cadangan `/tmp`, yang justru dibersihkan tiap kontainer diganti. Hasilnya
# persis keluhannya: volume terpasang, berkas tetap hilang tiap deploy.
#
# Tidak bisa diperbaiki dari Dockerfile: `chown /data` saat BUILD ditimpa oleh
# pemasangan volume saat RUNTIME. Tidak bisa pula diperbaiki dari aplikasi:
# `marlin` tidak berhak mengubah pemilik direktori root. Satu-satunya tempat
# yang berhak adalah di sini — dijalankan root, sebelum turun ke `marlin`.
#
# Prinsipnya tetap sama: prosesnya TIDAK berjalan sebagai root. Root hanya
# dipakai untuk satu `mkdir` + satu `chown`, lalu dilepas lewat `gosu`.

# BATAS HEAP V8 — disebut, bukan dibiarkan ditebak.
#
# V8 memilih sendiri batas old-space dari ukuran kontainer dan berhenti di
# ~256 MB pada kontainer 512 MB, menyisakan separuh RAM tidak terpakai.
# Sementara satu kali pratinjau impor RAB KKP memakan +44…57 MB heap. Kadang
# muat, kadang tidak; ketika tidak, PROSESNYA mati — dan yang terbaca user cuma
# "An unexpected response was received from the server", karena server sudah
# hidup lagi sebelum sempat dicek. DECISIONS 297 dan 567.
#
# Hitungannya di scripts/batas-heap.mjs (diuji tersendiri). Ia menolak memberi
# angka untuk kontainer kecil atau yang ukurannya tak diketahui — di situ
# bawaan V8 memang pilihan yang lebih aman. NODE_OPTIONS yang sudah diisi orang
# TIDAK pernah ditimpa.
if [ -z "$NODE_OPTIONS" ] && [ -f /app/scripts/batas-heap.mjs ]; then
  HEAP_MB="$(node /app/scripts/batas-heap.mjs 2>/dev/null || true)"
  if [ -n "$HEAP_MB" ]; then
    export NODE_OPTIONS="--max-old-space-size=$HEAP_MB"
    echo "[entrypoint] batas heap V8 disetel $HEAP_MB MB (mengikuti ukuran kontainer)."
  fi
fi

DIR_LAMPIRAN="${LAMPIRAN_DIR:-/app/.data/lampiran}"

# Peta dasar (.pmtiles) tinggal di volume yang sama, dengan alasan yang sama:
# volume Railway dipasang milik root, dan aplikasi berjalan sebagai `marlin`.
#
# URUTANNYA WAJIB SAMA PERSIS dengan `pilihDirPeta()` di src/lib/peta/berkas.ts.
# Kalau berbeda, root menyiapkan satu direktori sementara aplikasi menulis ke
# direktori lain — dan yang ditulis `marlin` di atas volume milik root GAGAL
# dengan EACCES. Itu bukan dugaan: persis begitu lampiran hilang tiap deploy
# pada 2026-09-03, dan versi pertama berkas ini mengulanginya untuk peta
# (entrypoint memakai /app/.data/peta, aplikasi memilih /data/peta).
if [ -n "$PETA_DIR" ]; then
  DIR_PETA_DASAR="$PETA_DIR"
elif [ -n "$LAMPIRAN_DIR" ]; then
  DIR_PETA_DASAR="$(dirname "$LAMPIRAN_DIR")/peta"
elif [ -d /data ]; then
  DIR_PETA_DASAR="/data/peta"
else
  DIR_PETA_DASAR="/app/.data/peta"
fi

if [ "$(id -u)" = "0" ]; then
  if mkdir -p "$DIR_PETA_DASAR" 2>/dev/null; then
    chown marlin:marlin "$DIR_PETA_DASAR" 2>/dev/null ||
      echo "[entrypoint] tidak bisa mengubah pemilik \"$DIR_PETA_DASAR\" – peta dasar tidak akan bisa diunduh; layar Sistem akan menyebutkannya." >&2
  else
    echo "[entrypoint] tidak bisa membuat \"$DIR_PETA_DASAR\" – peta dasar tidak akan bisa diunduh; layar Sistem akan menyebutkannya." >&2
  fi
fi

if [ "$(id -u)" = "0" ]; then
  # `mkdir -p` juga membuat induknya (mis. `/data` yang belum berisi apa-apa).
  if mkdir -p "$DIR_LAMPIRAN" 2>/dev/null; then
    # Hanya direktorinya, TIDAK rekursif: isinya sudah ditulis `marlin` sendiri,
    # dan volume berisi ribuan berkas akan membuat setiap boot lambat tanpa
    # menambah satu pun perbaikan.
    chown marlin:marlin "$DIR_LAMPIRAN" 2>/dev/null ||
      echo "[entrypoint] tidak bisa mengubah pemilik \"$DIR_LAMPIRAN\" – aplikasi akan memberi tahu di layar Lampiran Masuk." >&2
  else
    echo "[entrypoint] tidak bisa membuat \"$DIR_LAMPIRAN\" – aplikasi akan memberi tahu di layar Lampiran Masuk." >&2
  fi

  # Turun ke pengguna aplikasi. `exec` supaya sinyal (SIGTERM dari Railway)
  # sampai ke proses Node, bukan berhenti di skrip ini.
  exec gosu marlin "$@"
fi

# Sudah non-root (mis. dijalankan platform lain dengan UID sendiri): tidak ada
# yang bisa disiapkan, jalankan apa adanya. Aplikasi punya cadangan + peringatan.
exec "$@"
