import next from "eslint-config-next";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "next-env.d.ts",
      "src/generated/**",
      "prisma/migrations/**",
      "assets/**",
      "artifacts/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...next,
  {
    // DECISIONS 094 → 115 → 174: SEMUA dropdown form pakai <Combobox> yang bisa
    // diketik-cari, bukan <select> native. Aturan ini sudah tiga kali dilanggar
    // karena hanya hidup di decision log, jadi sekarang lint yang menjaganya.
    // Pengecualian: primitive `ui/field.tsx` (basis Combobox & halaman cetak).
    files: ["src/**/*.tsx"],
    ignores: ["src/components/ui/field.tsx", "src/components/ui/combobox.tsx", "src/app/cetak/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message:
            "Dropdown form wajib <Combobox> (bisa diketik-cari), bukan <select> native — DECISIONS 094/115/174.",
        },
      ],
    },
  },
];

export default eslintConfig;
