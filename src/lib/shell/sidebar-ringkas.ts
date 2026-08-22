/**
 * SIDEBAR YANG BISA DIRINGKAS (DECISIONS 413).
 *
 * Permintaan user 2026-08-22: *"sidebar yang bisa di collapsible, jadi bisa
 * memperlebar pandangan di desktop"* — lalu ditegaskan: *"tidak perlu ramping,
 * collapsible saja."* Jadi lebar sidebar yang TERBENTANG tidak diubah sama
 * sekali; yang ditambah cuma kemampuan melipatnya.
 *
 * Berkas ini sengaja MURNI — tanpa `window`, tanpa React — supaya aturannya
 * bisa diuji tanpa peramban, dan supaya kunci penyimpanannya cuma ditulis di
 * satu tempat. Skrip pra-lukis di root layout dan komponen sidebar sama-sama
 * memakainya, jadi keduanya tidak mungkin memakai kunci atau nilai yang beda.
 */

/** Kunci `localStorage`. Per peramban, per orang – bukan setelan bersama. */
export const KUNCI_RINGKAS = "marlin.sidebar.ringkas";

/** Nilai atribut pada `<html>` saat sidebar sedang diringkas. */
export const NILAI_RINGKAS = "ringkas";

/** Nama atribut data pada `<html>` yang dibaca CSS. */
export const ATRIBUT_NAV = "data-nav";

/**
 * Baca nilai tersimpan jadi boolean.
 *
 * Apa pun selain `"1"` berarti TERBENTANG. Sengaja tidak memakai
 * "ada isinya = true": penyimpanan bisa berisi sisa versi lama, string kosong,
 * atau nilai yang disunting orang lewat devtools — dan yang gagal harus
 * mendarat pada keadaan yang paling tidak mengagetkan, yaitu sidebar seperti
 * biasa.
 */
export function ringkasDariSimpanan(nilai: string | null | undefined): boolean {
  return nilai === "1";
}

/** Nilai yang ditulis ke penyimpanan. */
export function keSimpanan(ringkas: boolean): string {
  return ringkas ? "1" : "0";
}

/**
 * Skrip yang dijalankan SEBELUM halaman dilukis.
 *
 * Tanpa ini sidebar selalu terbentang dulu pada muat pertama, lalu melompat
 * menyempit begitu React hidup — kedipan yang terjadi di SETIAP perpindahan
 * halaman, dan justru paling terasa bagi orang yang memilih meringkasnya.
 *
 * Ditulis sebagai string karena memang harus jadi `<script>` sebaris di
 * `<head>`; komponen React mana pun terlambat.
 */
export const SKRIP_PRA_LUKIS = `(function(){try{
  if (localStorage.getItem(${JSON.stringify(KUNCI_RINGKAS)}) === "1") {
    document.documentElement.setAttribute(${JSON.stringify(ATRIBUT_NAV)}, ${JSON.stringify(NILAI_RINGKAS)});
  }
}catch(e){}})();`;
