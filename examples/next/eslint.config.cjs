/**
 * Flat config, because Next 16 removed `next lint`.
 *
 * Up to Next 15 the example was linted by `next lint`, which found the
 * `.eslintrc.json` here and supplied ESLint itself. With that command gone the
 * app runs ESLint directly, and ESLint 9 only reads flat config — so the
 * eslintrc file is replaced by this one.
 *
 * `eslint-config-next/core-web-vitals` is a flat config array in v16, so it can
 * be spread as-is. `@valbuild/eslint-plugin` still ships only an eslintrc-style
 * `configs.recommended` (`plugins: ["@valbuild"]`, a legacy string array), so
 * the plugin is registered here and only its rules are taken from that config.
 */
const nextCoreWebVitals = require("eslint-config-next/core-web-vitals");
const valbuildPlugin = require("@valbuild/eslint-plugin");

// Interop: the plugin is ESM source built to CJS, so `require` yields the module
// namespace with the plugin on `default` — except when the entry is already the
// plugin object itself.
const valbuild = valbuildPlugin.default ?? valbuildPlugin;

module.exports = [
  {
    ignores: [".next/**", ".next-http/**", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  {
    plugins: {
      "@valbuild": valbuild,
    },
    rules: valbuild.configs.recommended.rules,
  },
];
