/**
 * `heic-decode` tidak membawa tipenya sendiri. Yang dideklarasikan di sini
 * SEBATAS yang dipakai `src/lib/photos.ts` — bukan seluruh permukaan pustaka,
 * supaya deklarasi ini tidak berumur lebih panjang daripada kebenarannya.
 *
 * Alasan pustaka ini ada di proyek: libvips bawaan sharp membaca WADAH HEIF
 * tapi tidak punya dekoder HEVC-nya, sehingga HEIC iPhone tersimpan mentah dan
 * tampil sebagai petak kosong. `libheif-js` di balik pustaka ini membawa
 * libde265 — dekoder yang justru hilang itu.
 */
declare module "heic-decode" {
  type HasilDekode = { width: number; height: number; data: ArrayBufferLike };
  function decode(input: { buffer: Buffer | Uint8Array }): Promise<HasilDekode>;
  namespace decode {
    function all(input: { buffer: Buffer | Uint8Array }): Promise<{ decode(): Promise<HasilDekode> }[]>;
  }
  export default decode;
}
