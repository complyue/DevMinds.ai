/* Flat config (CJS) for root + webapp */
const js = require("@eslint/js");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const reactPlugin = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");
const importPlugin = require("eslint-plugin-import");
const unusedImports = require("eslint-plugin-unused-imports");
const globals = require("globals");

module.exports = [
  // ignore patterns
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "webapp/dist/**",
      "webapp/node_modules/**",
      ".minds/**",
      ".tasklogs/**"
    ]
  },

  // base JS recommended
  js.configs.recommended,

  // TS/React rules applied to all code
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooks,
      import: importPlugin,
      "unused-imports": unusedImports
    },
    settings: { react: { version: "detect" } },
    rules: {
      // TS, React, Hooks recommended
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // Baseline adjustments to pass on existing code
      "@typescript-eslint/no-explicit-any": "warn",
      "no-undef": "off",
      "no-empty": "error",
      "unused-imports/no-unused-imports": "error",

      // Common ergonomics
      "react/react-in-jsx-scope": "off"
    }
  },

  // scripts (CommonJS) overrides
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off"
    }
  }
];
