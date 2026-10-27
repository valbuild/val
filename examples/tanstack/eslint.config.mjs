/**
 * The Val lint rules, run against this example.
 *
 * `@valbuild/eslint-plugin` still ships only an eslintrc-style
 * `configs.recommended` (`plugins: ["@valbuild"]`, a legacy string array), so
 * the plugin is registered here and only its rules are taken from that config —
 * the same shape as `examples/next/eslint.config.cjs`.
 *
 * What these catch is the class of mistake that otherwise only surfaces at
 * publish time: a `c.define` whose first argument is not the file's own path, a
 * module missing from `val.modules.ts`, an export shape the server's AST
 * rewrite cannot write back.
 *
 * The TypeScript parser is here because the rules read `.val.ts` files and
 * ESLint's default parser cannot. The Next example gets one from
 * `eslint-config-next`; a TanStack app has to bring its own.
 */
import tseslint from "typescript-eslint";
import valbuild from "@valbuild/eslint-plugin";

export default [
  {
    ignores: [
      "dist/**",
      ".output/**",
      ".nitro/**",
      ".tanstack/**",
      "src/routeTree.gen.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "@valbuild": valbuild },
    rules: valbuild.configs.recommended.rules,
  },
];
