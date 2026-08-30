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
  {
    /**
     * A focus ring names `--border-focus`, and never a shadcn token.
     *
     * `--ring`, `--background` and `--input` are declared under `:root` and
     * `.dark` in `index.css`, and NEITHER selector matches in the Studio: it
     * mounts inside a shadow root, where `:root` matches nothing, and dark mode
     * is `[data-mode="dark"]`, not a `dark` class. So `hsl(var(--ring))`
     * resolves to `hsl()` — invalid at computed-value time, which in a
     * `box-shadow` takes the whole declaration down. Every focus ring in the
     * Studio painted nothing, and Storybook hid it by importing the stylesheet
     * into the document, where `:root` does match.
     *
     * `ring-offset-*` goes too, and not only for the colour: measured in
     * Chromium, a stale `ring-offset-background` invalidates the shadow even at
     * a 0px offset width. An offset would also have to match whichever surface
     * the control sits on, and they sit on three.
     *
     * A lint rather than a test, following the e2e rule above: a ban on a
     * pattern in source is what `no-restricted-syntax` is for, and it reports
     * at the call site instead of as a list of paths. What CANNOT be expressed
     * here — that the token is declared per theme, and that every ring colour
     * names a token the shadow root can see — stays in
     * `packages/ui/spa/focusRingTokens.test.ts`, because it has to read
     * `index.css` to know.
     */
    files: ["packages/ui/spa/**/*.{ts,tsx}"],
    ignores: [
      // Vendored shadcn calendars, kept as they came. Their `has-focus:` and
      // `ring-ring/50` are Tailwind v4 syntax this v3 config never compiles,
      // so they are inert rather than wrong.
      "packages/ui/spa/components/designSystem/calendar.tsx",
      "packages/ui/spa/components/designSystem/ui/calendar.tsx",
      // Names the forbidden classes in order to look for them.
      "packages/ui/spa/focusRingTokens.test.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/\\b(ring-ring|ring-offset-background|ring-offset-[0-9])/]",
          message:
            "Focus rings name `--border-focus` (`ring-border-focus`), with no ring offset. `--ring`/`--background` are dead inside the shadow root, and an invalid colour voids the whole box-shadow. See packages/ui/spa/index.css.",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b(ring-ring|ring-offset-background|ring-offset-[0-9])/]",
          message:
            "Focus rings name `--border-focus` (`ring-border-focus`), with no ring offset. `--ring`/`--background` are dead inside the shadow root, and an invalid colour voids the whole box-shadow. See packages/ui/spa/index.css.",
        },
      ],
    },
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
