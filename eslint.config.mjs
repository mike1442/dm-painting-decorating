import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["components/admin/**/*.tsx", "app/admin/**/*.tsx"],
    ignores: ["components/admin/AdminLink.tsx"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "next/link", message: "Use components/admin/AdminLink: prefetching admin routes costs Supabase Auth calls per link." }] }],
    },
  },
];
