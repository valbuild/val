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
      /**
       * `_`-prefixed means "named for the signature, not used in the body".
       *
       * typescript-eslint 8.68 started reporting parameters that only appear in
       * a type position, which is every `z.string().refine((_p): _p is Id =>
       * ...)` predicate in the repo: the name is required to write the type
       * guard and can never be read. The convention was already there in the
       * code — `_path`, `_id` — it just was not configured, so the rule flagged
       * those too.
       */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },

    settings: {
      react: {
        version: "detect",
      },
    },
  },
  /**
   * An e2e assertion reads a BOUNDARY, never the client's own internals.
   *
   * The rule, and why it is a rule, is in `e2e/README.md`. In short: the DOM,
   * an HTTP response and an outgoing request are all things a user or another
   * process can observe, and they stay true across refactors. `chainLength()`,
   * `__VAL_STORES__` and friends are this client's private state — asserting on
   * them re-tests, non-deterministically and in a browser, properties that jest
   * already pins on an injectable clock. Both flakes that survived into CI were
   * of exactly that shape, and both were already covered:
   * `announcedNotDelivered.test.ts` and `useDebouncedFieldWrite.test.tsx`.
   *
   * Reaching into the store to ARRANGE a state is fine and stays — a `move` op
   * is not something a Playwright drag can produce, and a discard is teardown.
   * The ban is on assertions, which is where the flakes were.
   */
  {
    files: ["e2e/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='expect'] CallExpression[callee.name=/^(chainLength|peekThroughStore|probe|uploadedRefs|moduleSource)$/]",
          message:
            "e2e assertions read the DOM, an HTTP response or an outgoing request — not the client's own store. See e2e/README.md.",
        },
        {
          selector:
            "CallExpression[callee.property.name='poll'] CallExpression[callee.name=/^(chainLength|peekThroughStore|probe|uploadedRefs|moduleSource)$/]",
          message:
            "e2e assertions read the DOM, an HTTP response or an outgoing request — not the client's own store. See e2e/README.md.",
        },
      ],
    },
  },
  {
    /**
     * The helper modules, permanently exempt — they ARE the arrange/teardown.
     *
     * `discardAll` drives the client to a state and has to watch the client to
     * know when it is there; that is teardown, not a claim about the product.
     * The rule cannot tell the two apart because both spell it `expect.poll`,
     * so the distinction is drawn per FILE: specs assert, helpers arrange.
     */
    files: ["e2e/studio.ts", "e2e/http/httpMode.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    /**
     * The specs still to convert. This list only ever SHRINKS.
     *
     * A rule that cannot be switched on until everything is clean never gets
     * switched on. So it is on for every other spec from today — new violations
     * are blocked outright — and these are the backlog, counted when it landed.
     *
     * `studio.spec.ts` is nearly out. Retiring the probe test took it from 21
     * store assertions to two: `pending.length` after a flush (a "the client
     * finished syncing" wait written as an assertion), and `parentRef` in the
     * StrictMode-remount test. The latter is the one worth keeping in a browser
     * until it is expressed as a jsdom test with `wrapper: StrictMode` — see
     * `usePickingDefault.test.tsx` for the pattern.
     *
     * Note the rule only sees the FIRST of those: it matches a store call nested
     * inside `expect(...)`/`.poll(...)`, and `const seen = await probe(page)`
     * followed by `expect(seen.parentRef)` reads a variable. A syntactic rule
     * cannot chase that, which is worth knowing before trusting a clean lint as
     * proof a spec is converted.
     */
    files: [
      "e2e/media.spec.ts",
      "e2e/studio-ui.spec.ts",
      "e2e/studio.spec.ts",
      "e2e/gallery-backed-image.spec.ts",
      "e2e/http/users.spec.ts",
      "e2e/http/remoteFiles.spec.ts",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
  globalIgnores([
    /**
     * Git worktrees checked out inside the repo.
     *
     * The fourth place that has to know, after `.gitignore`, `.prettierignore`
     * and `jest.config.js`: a worktree under `.claude/worktrees/` is a complete
     * second copy of the repo, so `eslint .` lints someone else's branch —
     * including its built `examples/next/.next` output, which the
     * `examples/next*` pattern below does not match at that depth. The result is
     * 182 errors in files that are not yours.
     */
    ".claude/worktrees/",
    "examples/next*",
    "**/trials",
    "**/dist",
    "**/out",
    "**/tsconfig.tsbuildinfo",
    "**/*.js",
    // Unzipped `val debug` snapshots: customer source, not ours to lint.
    "debug/*/",
  ]),
]);
