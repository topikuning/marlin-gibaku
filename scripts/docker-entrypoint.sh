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

DIR_LAMPIRAN="${LAMPIRAN_DIR:-/app/.data/lampiran}"

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
