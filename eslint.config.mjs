import next from "eslint-config-next";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "next-env.d.ts",
      "src/generated/**",
      "prisma/migrations/**",
      "artifacts/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...next,
];

export default eslintConfig;
