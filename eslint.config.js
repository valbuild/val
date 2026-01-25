const { defineConfig, globalIgnores } = require("eslint/config");

const globals = require("globals");
const tsParser = require("@typescript-eslint/parser");
const react = require("eslint-plugin-react");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const js = require("@eslint/js");

const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = defineConfig([
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },

      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {},
    },

    extends: compat.extends(
      "eslint:recommended",
      "plugin:react/jsx-runtime",
      "plugin:@typescript-eslint/recommended",
      "prettier",
    ),

    plugins: {
      react,
      "@typescript-eslint": typescriptEslint,
    },

    rules: {
      // Fix for @typescript-eslint/no-unused-expressions rule compatibility with flat config
      "@typescript-eslint/no-unused-expressions": [
        "error",
        {
          allowShortCircuit: false,
          allowTernary: false,
          allowTaggedTemplates: false,
        },
      ],
    },

    settings: {
      react: {
        version: "detect",
      },
    },
  },
  globalIgnores([
    "examples/next*",
    "**/trials",
    "**/dist",
    "**/out",
    "**/tsconfig.tsbuildinfo",
    "**/*.js",
  ]),
]);
