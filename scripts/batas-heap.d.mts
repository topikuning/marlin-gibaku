/**
 * Tipe untuk `batas-heap.mjs` — skrip itu sengaja JavaScript polos karena
 * dijalankan entrypoint SEBELUM ada tooling apa pun, tapi hitungannya diuji
 * dari TypeScript. Pola yang sama dipakai `ci-perlu.d.mts`.
 */
export declare function batasKontainerMb(baca?: (p: string) => string): number | null;
export declare function hitungBatasHeapMb(kontainerMb: number | null): number | null;
