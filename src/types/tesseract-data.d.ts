// Paket data bahasa Tesseract tidak membawa tipe. Bentuknya dibaca dari
// node_modules/@tesseract.js-data/eng/index.js (DECISIONS 617).
declare module "@tesseract.js-data/eng" {
  const data: { code: string; gzip: boolean; langPath: string };
  export default data;
}
