// ESLint flat config for the Vite + React app (modelled on the official Vite React template).
// Only JavaScript files are linted (.js/.jsx/.mjs/.cjs); the few .ts/.tsx files in src/ are
// not linted because typescript-eslint is not installed.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "dist/**",
    "build/**",
    "out/**",
    "coverage/**",
    ".vite/**",
    ".next/**", // leftover output from the old Next.js version
    ".claude/**", // agent worktrees are separate checkouts
    "node_modules/**",
    "public/**",
    "src/integrations/supabase/types.ts",
    // Supabase Edge Functions run on Deno (TypeScript); they are not part of the Vite app.
    "supabase/functions/**",
  ]),

  // Browser app code.
  {
    files: ["src/**/*.{js,jsx,mjs}"],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Same as the Vite React (JS) template: capitalised names are JSX components/constants.
      "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^[A-Z_]", ignoreRestSiblings: true }],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // Node-side code: scripts, tests, tool configs.
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "tests/**/*.{js,mjs,cjs}", "*.config.{js,mjs,cjs}", "*.{mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },
]);
