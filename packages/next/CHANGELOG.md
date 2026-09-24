# @valbuild/next

## 0.136.5

### Patch Changes

- Updated dependencies [[`28a71c3`](https://github.com/valbuild/val/commit/28a71c3beb40d15d628b99959c5161cee09d1871)]:
  - @valbuild/ui@0.136.5
  - @valbuild/react@0.136.5
  - @valbuild/server@0.136.5
  - @valbuild/language-server@0.136.5
  - @valbuild/mcp@0.136.5

## 0.136.4

### Patch Changes

- Updated dependencies [[`d19b1f6`](https://github.com/valbuild/val/commit/d19b1f67360b057e63536ac020f7109bd2496389)]:
  - @valbuild/ui@0.136.4
  - @valbuild/react@0.136.4
  - @valbuild/server@0.136.4
  - @valbuild/language-server@0.136.4
  - @valbuild/mcp@0.136.4

## 0.136.3

### Patch Changes

- Updated dependencies [[`38d24f7`](https://github.com/valbuild/val/commit/38d24f723639ee109d1007854507c4571bc82575), [`3b19534`](https://github.com/valbuild/val/commit/3b19534bb7aa16452a104906d9594083c3bc3e89), [`fa28164`](https://github.com/valbuild/val/commit/fa28164dfd1e05ff53eccf375334741d857fd2ef)]:
  - @valbuild/ui@0.136.3
  - @valbuild/server@0.136.3
  - @valbuild/shared@0.136.3
  - @valbuild/react@0.136.3
  - @valbuild/language-server@0.136.3
  - @valbuild/mcp@0.136.3

## 0.136.2

### Patch Changes

- Updated dependencies [[`f76cd56`](https://github.com/valbuild/val/commit/f76cd56b9f1c1bcc0a608a7a4de24b1e776adccb)]:
  - @valbuild/ui@0.136.2
  - @valbuild/server@0.136.2
  - @valbuild/shared@0.136.2
  - @valbuild/react@0.136.2
  - @valbuild/language-server@0.136.2
  - @valbuild/mcp@0.136.2

## 0.136.1

### Patch Changes

- [#697](https://github.com/valbuild/val/pull/697) [`5c82928`](https://github.com/valbuild/val/commit/5c82928992d29f133f81cf0704a273c0449b18f1) Thanks [@freekh](https://github.com/freekh)! - Read draft content once per request instead of once per `fetchVal`

  In draft mode, `fetchVal` resolves its selector by asking the Val server for the
  whole module tree. It did that on every call, so a page with three reads made
  three requests for three identical answers — and `fetchValRouteUrl` added a
  fourth by calling `fetchVal` again on top of the caller's own. The answer cannot
  differ between reads in one request, so it is now read once and shared. On a
  60-module project a three-read draft render goes from ~187ms to ~70ms.

  The memo is scoped to the request and nothing wider, because the response it
  holds contains the caller's own unpublished patches: React's `cache()` in a
  Next RSC, a `WeakMap` keyed on the `Request` in TanStack Start, and no caching
  at all where neither is available.

  What this does **not** change:

  - **Production is untouched.** With Val disabled the reader never calls the
    server; it resolves against the statically imported module, as before.
  - **What a draft shows is unchanged.** Same query, same patch scoping — a draft
    still shows the caller's own staged work and nobody else's.
  - **The client readers are untouched.** `useVal` already subscribed to exactly
    the modules its selector names.
  - **The server still evaluates every module per request.** Narrowing the
    request's path was measured and does not help: `/sources/~` evaluates,
    previews and validates everything and only then filters the response, so a
    narrow path returns less for the same milliseconds. That remains open.

- Updated dependencies [[`cf89e74`](https://github.com/valbuild/val/commit/cf89e7429a79c4304ecbedd4f8b571a0de0f145f), [`c219574`](https://github.com/valbuild/val/commit/c21957498f3c7f4f47cef197c5dc0d591aa744ca), [`e673b43`](https://github.com/valbuild/val/commit/e673b43feaf48b7f30881d6786c858a0cb6a44a2), [`5c82928`](https://github.com/valbuild/val/commit/5c82928992d29f133f81cf0704a273c0449b18f1), [`4450be5`](https://github.com/valbuild/val/commit/4450be570ec3a66d7d98ba273c333ca2d2f163d9), [`d2f385a`](https://github.com/valbuild/val/commit/d2f385a04978992a5036379235e447ba7775faef)]:
  - @valbuild/ui@0.136.1
  - @valbuild/shared@0.136.1
  - @valbuild/server@0.136.1
  - @valbuild/core@0.136.1
  - @valbuild/react@0.136.1
  - @valbuild/language-server@0.136.1
  - @valbuild/mcp@0.136.1

## 0.136.0

### Patch Changes

- Updated dependencies [[`f3a4bb7`](https://github.com/valbuild/val/commit/f3a4bb7aea604943b92545c122243798c759715c), [`1d72d00`](https://github.com/valbuild/val/commit/1d72d00a1b036959ae0f1540121701cbb2694dcb)]:
  - @valbuild/ui@0.136.0
  - @valbuild/core@0.136.0
  - @valbuild/server@0.136.0
  - @valbuild/shared@0.136.0
  - @valbuild/language-server@0.136.0
  - @valbuild/react@0.136.0
  - @valbuild/mcp@0.136.0

## 0.135.0

### Patch Changes

- [#707](https://github.com/valbuild/val/pull/707) [`c9affec`](https://github.com/valbuild/val/commit/c9affece6ae6ba62bd6c1113ed1fdab6317fa112) Thanks [@freekh](https://github.com/freekh)! - `val validate --fix` now formats with your prettier config instead of prettier's defaults

  `--fix` formatted the files it repaired by calling `prettier.format(code, { filepath })`, which never reads `.prettierrc`: `filepath` picks the parser and nothing else — only `resolveConfig`, `getFileInfo` and prettier's own CLI consult the config. On a project whose style is not prettier's default, a two-line content fix therefore arrived as a whole-file rewrite, and in a repo with a format check in CI it turned a content fix into a red build.

  There is now one implementation of "format a written file the way this project does", `createPrettierFormatter`, exported from `@valbuild/server` and re-exported by `@valbuild/next/server` and `@valbuild/tanstack/server`. It resolves `.prettierrc` for each file (including any `overrides` that match it), leaves anything in `.prettierignore` untouched, and falls back to prettier's defaults when the project has no config. `val validate --fix` uses it, so the CLI and the Studio can no longer disagree about formatting.

  Use it for your app's `formatter` too — this is the recommended setup, and it replaces reading `.prettierrc.json` by hand:

  ```ts
  import prettier from "prettier";
  import {
    initValServer,
    createPrettierFormatter,
  } from "@valbuild/next/server";

  const { valNextAppRouter } = initValServer(
    valModules,
    { ...config },
    {
      draftMode,
      formatter: createPrettierFormatter(prettier, {
        projectRoot: process.cwd(),
      }),
    },
  );
  ```

  Existing `formatter` callbacks keep working unchanged.

- Updated dependencies [[`c9affec`](https://github.com/valbuild/val/commit/c9affece6ae6ba62bd6c1113ed1fdab6317fa112), [`72a7ca7`](https://github.com/valbuild/val/commit/72a7ca78354fff00e37a51359b17fba9334dc5e6)]:
  - @valbuild/server@0.135.0
  - @valbuild/language-server@0.135.0
  - @valbuild/mcp@0.135.0

## 0.134.1

### Patch Changes

- Updated dependencies [[`821e789`](https://github.com/valbuild/val/commit/821e789c1af47510af5d23eb96384ff78ddd7646)]:
  - @valbuild/shared@0.134.1
  - @valbuild/language-server@0.134.1
  - @valbuild/mcp@0.134.1
  - @valbuild/react@0.134.1
  - @valbuild/server@0.134.1
  - @valbuild/ui@0.134.0

## 0.134.0

### Minor Changes

- [#690](https://github.com/valbuild/val/pull/690) [`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2) Thanks [@freekh](https://github.com/freekh)! - Read a view with `useVal` / `fetchVal`.

  A `s.view()` field reads as a pointer with no properties on it. It can now be handed to a reader, which resolves it to the module it names:

  ```tsx
  const page = useVal(pageVal);
  const header = useVal(page.header); // the header module's content, typed
  ```

  The point is single source of truth rather than a new capability: the page declares which module it shows, and a component follows that declaration instead of importing the target a second time. Change `s.view(headerVal)` to `s.view(navVal)` and the reader follows; an import would have kept reading the header.

  The readers that take a MODULE rather than a value follow the same rule — `useValKey`, `useValRoute`, `useValRouteUrl` and the `fetchVal*` counterparts, in both the Next and TanStack packages:

  ```tsx
  const page = useVal(pageVal);
  const note = useValRoute(page.notes, params); // the router module the view names
  ```

  Works in draft mode, including when the page itself has a pending edit. Two things to know:

  - **Resolve a handle in the component that read the module containing it.** A handle carries the module it points at, and that cannot survive serialization — so one passed from a server component to a client component as a prop arrives empty. It throws with an explanation rather than handing back the pointer. This is why it throws rather than returning nothing: every one of the route and key readers already uses `null` / `undefined` to mean "no such entry", so a quiet answer would be indistinguishable from a 404.
  - **`ValView<Source>` is now a member of `SelectorSource`**, since a reader accepts one.

### Patch Changes

- Updated dependencies [[`be78a9b`](https://github.com/valbuild/val/commit/be78a9b51678439f7ecb1c7f3887f9e8e1261a13), [`1c31dcc`](https://github.com/valbuild/val/commit/1c31dcca7f1bb0199350567fd579de29f48bb26d), [`688b9e3`](https://github.com/valbuild/val/commit/688b9e36b821323cda6870cdff03dd36ec3e782f), [`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2), [`eaa265e`](https://github.com/valbuild/val/commit/eaa265e78d9f6d2a1b685c38901612b8a3704eed)]:
  - @valbuild/server@0.134.0
  - @valbuild/ui@0.134.0
  - @valbuild/core@0.134.0
  - @valbuild/react@0.134.0
  - @valbuild/shared@0.134.0
  - @valbuild/language-server@0.134.0
  - @valbuild/mcp@0.134.0

## 0.133.0

### Patch Changes

- Updated dependencies [[`2b9a51b`](https://github.com/valbuild/val/commit/2b9a51b7dbe2dff53b7686a4f3b7eb9bc5784fae), [`802412b`](https://github.com/valbuild/val/commit/802412b92c06bc1abbca78c86885e39c8710dd83)]:
  - @valbuild/ui@0.133.0
  - @valbuild/server@0.133.0
  - @valbuild/shared@0.133.0
  - @valbuild/react@0.133.0
  - @valbuild/language-server@0.133.0
  - @valbuild/mcp@0.133.0

## 0.132.1

### Patch Changes

- Updated dependencies [[`c9a5cd3`](https://github.com/valbuild/val/commit/c9a5cd3a4ab5908ecb9757b7a95db17a77e3b173), [`f413c5c`](https://github.com/valbuild/val/commit/f413c5cebca27ba82052825abc8c632b6177747e), [`1ddf245`](https://github.com/valbuild/val/commit/1ddf245ec73ad5af8099c3d18d4d33c6a1cc1254), [`a19997a`](https://github.com/valbuild/val/commit/a19997a542e65cc1375837b1bdb11c8af9e10160), [`c07b1ab`](https://github.com/valbuild/val/commit/c07b1abe30e226c80ef7ec4b4f0f5ccdae061c11), [`76c5d41`](https://github.com/valbuild/val/commit/76c5d41c3afa7cc8180d156c9e19fb082af7fba4), [`cbfa2b8`](https://github.com/valbuild/val/commit/cbfa2b884898f1603bde8e5aa5cd9da78778101f), [`f2ac188`](https://github.com/valbuild/val/commit/f2ac1887c11397b597081eef7206063b52b21c5b), [`003419a`](https://github.com/valbuild/val/commit/003419ab72f3069d92e67dfea931d5accc63e730)]:
  - @valbuild/ui@0.132.1
  - @valbuild/server@0.132.1
  - @valbuild/language-server@0.132.1
  - @valbuild/react@0.132.1
  - @valbuild/mcp@0.132.1

## 0.132.0

### Patch Changes

- Updated dependencies [[`72cc676`](https://github.com/valbuild/val/commit/72cc6765e92a6e72b5c09ddd9eed8efa7ce899f2)]:
  - @valbuild/server@0.132.0
  - @valbuild/language-server@0.132.0
  - @valbuild/mcp@0.132.0

## 0.131.0

### Patch Changes

- Updated dependencies [[`0d5857b`](https://github.com/valbuild/val/commit/0d5857b731e11f7e6a011f79297df6485908c31f)]:
  - @valbuild/server@0.131.0
  - @valbuild/language-server@0.131.0
  - @valbuild/mcp@0.131.0

## 0.130.0

### Patch Changes

- Updated dependencies [[`be1e8be`](https://github.com/valbuild/val/commit/be1e8bee673207596b3eb3d9a9886b8ade9b332f), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`8425378`](https://github.com/valbuild/val/commit/8425378c315ea46b5d822f1130b633e0449ff1b0), [`7d13dbc`](https://github.com/valbuild/val/commit/7d13dbced9ea49d8243b6b6cf9854cd1a259501f), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`07db94c`](https://github.com/valbuild/val/commit/07db94c23b73c8c0b2b50a30a89926823c2da1d6), [`473a185`](https://github.com/valbuild/val/commit/473a185f70351b44388f3bc1852649e2c1dbe001), [`64f0de3`](https://github.com/valbuild/val/commit/64f0de339b8621cb5a6c422dfe55cae5b2bbe2a0), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75)]:
  - @valbuild/ui@0.130.0
  - @valbuild/server@0.130.0
  - @valbuild/mcp@0.130.0
  - @valbuild/core@0.130.0
  - @valbuild/react@0.130.0
  - @valbuild/language-server@0.130.0
  - @valbuild/shared@0.130.0

## 0.129.0

### Patch Changes

- [#655](https://github.com/valbuild/val/pull/655) [`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b) Thanks [@freekh](https://github.com/freekh)! - A project can now make Val Studio look like its own.

  `s.settings()` has a new `theme` section, edited under **Settings → Appearance**
  in the Studio. It is content like everything else: edited as a draft, shown in
  the publish diff, and the same for everyone working on the project.

  ```ts
  export default c.define("/settings.val.ts", s.settings(), {
    theme: {
      accent: "#2563eb",
      radius: "tight",
      mode: "light",
    },
  });
  ```

  **`accent` is one hex, and it restyles the whole chrome** — Publish, the active
  rail item, focus rings, switches, the caret in a rich text field, and the
  outlines the canvas draws around editable elements on your own page. Any colour
  is allowed, not a list of approved ones, because what the accent replaces is a
  ten-step ramp that is _generated_ from it: each step keeps the lightness of the
  step it replaces and changes only the hue. WCAG contrast is almost entirely a
  function of lightness, so every foreground/background pair the chrome renders
  stays at AA — which is asserted across the hue circle, pure black and a
  saturated yellow included, rather than argued for. One value drives both light
  and dark mode, since the semantic tokens pick different steps of the ramp in
  each.

  **`radius`** is `square`, `tight`, `default` or `soft`, and moves every corner
  in the Studio.

  The accent also moves the outlines the canvas draws around editable elements on
  your own page. Those are drawn inside your document, which has none of Val's
  stylesheet, so the colour is sent to the page over the canvas protocol — which
  means a project on an older `@valbuild/next` or `@valbuild/tanstack` than its
  Studio keeps Val's green there until it upgrades, rather than breaking.

  **`mode`** is the mode the Studio opens in for an editor who has never picked
  one. It never overrides an editor who has — that choice stays theirs, per
  person and per browser, behind the account button.

  Every field is optional, and unset means Val's own look, so an existing
  settings module needs no change.

  Two smaller fixes that came with it:

  - **A settings change is its own entry in the publish diff.** Editing the
    assistant's tone used to collapse the entire settings module into one change
    card labelled "Settings", because the patch that writes a settings field is
    an `add`, and `PatchSets` had no case for a settings section — so it gave up
    and grouped the whole module. Two unrelated settings edits now show as two
    changes, each under the name the panel gives it.
  - **The Val mark keeps its green.** It named a step of the brand ramp, so it
    would have recoloured along with a project's accent. It has its own token now.

- Updated dependencies [[`e20f6fb`](https://github.com/valbuild/val/commit/e20f6fbcc215c310eef49a44c1a592c1e2081613), [`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b), [`0c351c4`](https://github.com/valbuild/val/commit/0c351c4f97ae7f09772eab0e856ae69821b803b7), [`41a0d76`](https://github.com/valbuild/val/commit/41a0d76636a2dce3f1e506d93170d97e46041d98), [`9e0ebb0`](https://github.com/valbuild/val/commit/9e0ebb00430f05ef92dff031309f73b8075a7d99)]:
  - @valbuild/ui@0.129.0
  - @valbuild/core@0.129.0
  - @valbuild/shared@0.129.0
  - @valbuild/react@0.129.0
  - @valbuild/server@0.129.0
  - @valbuild/language-server@0.129.0
  - @valbuild/mcp@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [[`8b52b33`](https://github.com/valbuild/val/commit/8b52b33e1f629f14f66cc71dcc7cf415d210c7d4), [`362fb49`](https://github.com/valbuild/val/commit/362fb49f30d2b04c4ff78d54dca2bf5ad978a05c), [`c595799`](https://github.com/valbuild/val/commit/c59579977a436ec530c6c69f2b340ab9829d97ab)]:
  - @valbuild/core@0.128.0
  - @valbuild/language-server@0.128.0
  - @valbuild/mcp@0.128.0
  - @valbuild/react@0.128.0
  - @valbuild/server@0.128.0
  - @valbuild/shared@0.128.0
  - @valbuild/ui@0.127.0

## 0.127.0

### Patch Changes

- [#665](https://github.com/valbuild/val/pull/665) [`7072e07`](https://github.com/valbuild/val/commit/7072e07623c953a09ac14388ae22dada0b431ce3) Thanks [@freekh](https://github.com/freekh)! - `.nullable()` no longer drops the field's `.validate(...)` functions.

  `.nullable()` returns a copy of the schema, and most of the schema classes built
  that copy with an empty list of custom validators — so a validator declared
  before the `.nullable()` was silently thrown away:

  ```ts
  s.number()
    .validate((n) => (n > 100 ? "Too big" : false))
    .nullable(); // the validator never ran
  ```

  `array`, `object`, `discriminatedUnion`, `enum`, `number`, `boolean`, `literal`,
  `keyOf`, `date`, `dateTime`, `code`, `color` and `richtext` were affected;
  `string`, `record`, `route`, `file` and `image` already carried them over, which
  is why the bug was easy to miss. Validators now survive `.nullable()` on every
  schema, in either order.

  A validator on a nullable schema is called with `null` when the value is unset,
  rather than being skipped — the same thing the schemas that never dropped them
  have always done. If yours was written before the `.nullable()`, its argument is
  typed as non-null even though `null` can reach it, so guard for it.

- Updated dependencies [[`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65), [`600308d`](https://github.com/valbuild/val/commit/600308d0174990ad9f5c417147d160273489c65a), [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63), [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a), [`7072e07`](https://github.com/valbuild/val/commit/7072e07623c953a09ac14388ae22dada0b431ce3), [`29811c3`](https://github.com/valbuild/val/commit/29811c3f8c7e001a950e6f4833af6888e6a4efea), [`9983116`](https://github.com/valbuild/val/commit/99831164c5151aad7ca69de79e1d0d59878be251)]:
  - @valbuild/core@0.127.0
  - @valbuild/shared@0.127.0
  - @valbuild/ui@0.127.0
  - @valbuild/server@0.127.0
  - @valbuild/react@0.127.0
  - @valbuild/language-server@0.127.0
  - @valbuild/mcp@0.127.0

## 0.126.0

### Patch Changes

- [#652](https://github.com/valbuild/val/pull/652) [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a) Thanks [@freekh](https://github.com/freekh)! - `s.union` is now `s.discriminatedUnion` and `s.enum`.

  `s.union` did two unrelated jobs and worked out which one you meant from its
  first argument: a string key meant a tagged union of objects, literal schemas
  meant a set of allowed strings. Those are now two schemas with two names.

  ```ts
  // A fixed set of strings — presents as a dropdown
  s.enum("primary", "secondary", "ghost"); // Schema<"primary" | "secondary" | "ghost">

  // One of several object shapes, told apart by a tag field
  s.discriminatedUnion(
    "type",
    s.object({ type: s.literal("hero"), heading: s.string() }),
    s.object({ type: s.literal("quote"), text: s.string() }),
  );
  ```

  `s.enum` takes the strings directly, so the `s.literal(...)` wrapper is gone.

  **`s.union` still works** — it is deprecated, and it builds exactly the schema
  above, so nothing has to change today:

  ```ts
  s.union(s.literal("one"), s.literal("two")); // → s.enum("one", "two")
  s.union("type", pageA, pageB); // → s.discriminatedUnion("type", pageA, pageB)
  ```

  The two are different kinds of node, and that is the reason for the split. A
  discriminated union is a container: the selected variant's fields are the fields
  being edited, and everything that walks a schema descends through it. An enum is
  a leaf — a string with a closed domain — so nothing recurses into it. Told apart
  only by the shape of `key`, every consumer had to re-derive which one it was
  holding; each now has its own serialized type (`"discriminated-union"` and
  `"enum"`) and Val Studio has a field per kind rather than one field that
  branches.

  Two behaviour changes fall out of the split, both of them fixes:

  - A value that is not a string at all now fails an enum's validation with a
    type error. `s.union` of literals only ever checked the value against its
    literals when the value WAS a string, so a number or an object where an enum
    was declared validated clean.
  - An enum field now shows its validation errors in Val Studio where the field
    is opened on its own — the module editor and the canvas's fields column — and
    gets the compact error layout inside an inline list row. It is a leaf now, so
    it goes through the same error rendering as every other leaf field; the string
    union bypassed it and showed nothing in those places.

  Several latent crashes in the old `s.union` are fixed on the way past, all of
  them cases where it threw a `TypeError` instead of reporting:

  - A required discriminated union holding `null` now reports a type error rather
    than throwing, and resolving a path underneath a nullable one that is `null`
    gives the error the API promises instead of a crash.
  - `s.literal("")` is a legal discriminator tag, and `s.enum("")` a legal value.
    Both used to be treated as absent by a truthiness check — in path resolution,
    in stega encoding, and in the message that lists a union's valid tags. The
    editor's dropdowns handle them too: an empty value is reserved by the select
    component and had to be mapped around.
  - A variant that omits the discriminator entirely is now reported as the schema
    error it is, instead of throwing while the check looked for it.
  - An enum's value is now indexed for search, like every other string leaf. The
    old string union was never indexed at all, so searching for one of its values
    could not find the field.
  - A nullable discriminated union set to `null` no longer renders a spinner that
    never resolves.

  `s.discriminatedUnion` also requires at least one variant, as `s.enum` requires
  at least one value: a union with nothing to select is not a thing to write, and
  everything downstream reads the first variant where it needs any.

  If you read serialized schemas yourself, that is the breaking part: `type` is no
  longer `"union"`, an enum carries `values: string[]` instead of a `key` plus
  `items` of literal schemas, and `UnionSchema` is no longer a class.
  `SerializedUnionSchema`, `SerializedStringUnionSchema`,
  `SerializedObjectUnionSchema` and `UnionSchema` remain as deprecated type
  aliases.

- [#661](https://github.com/valbuild/val/pull/661) [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f) Thanks [@freekh](https://github.com/freekh)! - Every schema method now has a worked `@example` in its JSDoc, so hovering it in
  your editor shows what to write.

  That covers the whole builder surface — `.describe()`, `.validate()`,
  `.nullable()`, `.readonly()`, `.hidden()`, `.preview()`, `.render()`, and the
  per-type methods such as `.minLength()`, `.regexp()`, `.raw()`, `.multiline()`,
  `.from()` / `.to()`, `.remote()`, `.jsonValues()` and `.external()` — as well as
  `c.define()`, `c.json()`, `c.external()` and the `val` helpers (`val.attrs`,
  `val.raw`, `val.unstable_getPath` and friends).

  One of the examples corrected a real trap: a custom validator returns
  `false | string`, so the natural-looking

  ```ts
  s.string().validate((val) => val.trim() === val || "No surrounding spaces");
  ```

  does not type check — `||` yields `true`, and `true` is not one of the two
  answers. Write it as a ternary instead:

  ```ts
  s.string().validate((val) =>
    val.trim() === val ? false : "No surrounding spaces",
  );
  ```

  The examples are checked in CI, not just written: one test asks the TypeScript
  checker for the doc each method actually resolves to and fails if it has no
  `@example`, and another compiles every example it finds.

- Updated dependencies [[`719ad6b`](https://github.com/valbuild/val/commit/719ad6b607bcf136d0dbde9e90bf4b8a843561a4), [`9830277`](https://github.com/valbuild/val/commit/9830277e9aaca8da3030f629c2656ec58da47e45), [`64bfd0a`](https://github.com/valbuild/val/commit/64bfd0a6c85832ea5169b53e47087f22e193df36), [`7782979`](https://github.com/valbuild/val/commit/7782979e9b52f2015a6e72dc981e630d4f8c78e2), [`5bfd630`](https://github.com/valbuild/val/commit/5bfd630b63dee2189e238f20fe72ecc5537160f7), [`ccbcda6`](https://github.com/valbuild/val/commit/ccbcda60b3e3c465071229ae1ba28ac735483e63), [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a), [`5c18c99`](https://github.com/valbuild/val/commit/5c18c99ecc84651f82123481fc042063db953833), [`755e1a3`](https://github.com/valbuild/val/commit/755e1a3953775cb8d2c2dce87d6810d3dc329640), [`c6b1ec8`](https://github.com/valbuild/val/commit/c6b1ec84f1883750a4cfe5f70470b177621e971f), [`656f680`](https://github.com/valbuild/val/commit/656f680043c640f678625a64e690389ab23a0a69), [`610a041`](https://github.com/valbuild/val/commit/610a0414b120b521f38a2eb1182b3778bf778b2b), [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f)]:
  - @valbuild/ui@0.126.0
  - @valbuild/shared@0.126.0
  - @valbuild/server@0.126.0
  - @valbuild/core@0.126.0
  - @valbuild/react@0.126.0
  - @valbuild/language-server@0.126.0
  - @valbuild/mcp@0.126.0

## 0.125.0

### Patch Changes

- [#638](https://github.com/valbuild/val/pull/638) [`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90) Thanks [@freekh](https://github.com/freekh)! - Val now runs on TanStack Start.

  `@valbuild/tanstack` is a new package with everything `@valbuild/next` has: Val
  Studio at `/val`, the on-page overlay and canvas, draft mode, the client hooks,
  server-side content reads, images, and the MCP tools.

  ```sh
  npm install @valbuild/tanstack
  ```

  ```ts
  // val.config.ts
  import { initVal } from "@valbuild/tanstack";
  const { s, c, config, tanstackRouter } = initVal({ project: "org/project" });
  ```

  **Routes are first class.** A Val module for a route is named after the route
  file it sits beside — `src/routes/posts.$postId.tsx` is served content by
  `src/routes/posts.$postId.val.ts` — and its keys are the URLs that route serves:

  ```ts
  export default c.define(
    "/src/routes/posts.$postId.val.ts",
    s.router(tanstackRouter, s.object({ title: s.string() })),
    { "/posts/hello-world": { title: "Hello world" } },
  );
  ```

  `.` and `/` both separate segments, `$param` is a parameter, `$` is a splat, and
  `index`, `route`, `(groups)` and `_pathless` layouts add no URL segment — the
  same rules TanStack Router uses for the route file itself. Val validates every
  key against that pattern, and Val Studio shows these modules as a sitemap under
  **Pages**, where an editor can add a page.

  Point the route generator away from your content files, in `vite.config.ts` and
  `tsr.config.json`:

  ```ts
  tanstackStart({ router: { routeFileIgnorePattern: "\\.val\\.[tj]sx?$" } });
  ```

  See the [README](https://github.com/valbuild/val/blob/main/packages/tanstack/README.md)
  for the full wiring, and `examples/tanstack` for a working app.

  **Also fixed, for everyone:** `Internal.VERSION.core` was `null` in any ESM
  bundle — it was read with `require("../package.json")` inside a `try`, so the
  failure was silent. That version goes into every remote file ref and proxy mode
  refuses to start without it. Every package now reads its version through a
  static JSON import, which is inlined at build time.

  Two smaller fixes that came out of running the whole toolchain against a
  TanStack project:

  - `val versions` reports `@valbuild/tanstack`, and `val debug` writes a snapshot
    that names whichever framework package the captured project actually has.
  - `@valbuild/eslint-plugin` reads a `tsconfig.json` that has comments in it. A
    tsconfig is JSONC, and `JSON.parse` is not — so on any project whose tsconfig
    carries a comment (the TanStack starter's does) the
    `module-in-val-modules` rule threw `Expected double-quoted property name in
JSON` on the first file and took the whole lint run with it.

  Three fixes found by driving the Studio against a real TanStack app:

  - **A draft image now loads on the page.** The source the Studio pushes to the
    host page carries `patch_id` for any file whose bytes are still in a patch, so
    the page asks `/api/val/files/...?patch_id=` rather than a `/public` path that
    nothing has written yet. This was silent — the image just did not appear — and
    it affects any page that reads media through the hooks rather than on the
    server, `@valbuild/next` included.
  - **A splat route no longer logs an error on every render.** TanStack returns
    both `_splat` and `*` for the same parameter; Val reported the second as a
    parameter it could not place in the path.
  - The TanStack example and starter render a 404 page instead of throwing
    `notFound()` from a component, which escaped to the error boundary and logged
    `Error in renderToReadableStream` (and, with no not-found component
    configured, aborted the response) on every miss.

- Updated dependencies [[`22f78b4`](https://github.com/valbuild/val/commit/22f78b471fd18e542f518f72b75bd472d7c3dc52), [`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90)]:
  - @valbuild/language-server@0.125.0
  - @valbuild/core@0.125.0
  - @valbuild/shared@0.125.0
  - @valbuild/ui@0.125.0
  - @valbuild/mcp@0.125.0
  - @valbuild/react@0.125.0
  - @valbuild/server@0.125.0

## 0.124.0

### Patch Changes

- Updated dependencies [[`5674237`](https://github.com/valbuild/val/commit/56742371a75b4fdcbff8b1afccff8fcc1ebf8078), [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055), [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055), [`aa89fc2`](https://github.com/valbuild/val/commit/aa89fc26de7028b3c5a1666b99afc03b39e92769)]:
  - @valbuild/ui@0.124.0
  - @valbuild/server@0.124.0
  - @valbuild/shared@0.124.0
  - @valbuild/core@0.124.0
  - @valbuild/react@0.124.0
  - @valbuild/language-server@0.124.0
  - @valbuild/mcp@0.124.0

## 0.123.3

### Patch Changes

- Updated dependencies [[`4c9369b`](https://github.com/valbuild/val/commit/4c9369bad3f17e96868262e78a4f47361d85319e), [`fb1baff`](https://github.com/valbuild/val/commit/fb1baffead5228d8a86a51af65178b88738d5a64), [`accf4f8`](https://github.com/valbuild/val/commit/accf4f852fe3400d762cc14e80316da741a69a9a), [`356eb11`](https://github.com/valbuild/val/commit/356eb11b5f6a0a02dfec80580c6fccac75d28402), [`aef45ce`](https://github.com/valbuild/val/commit/aef45ce3ef269f1b6221de44a56df0f6a0d9dbbd)]:
  - @valbuild/server@0.123.3
  - @valbuild/language-server@0.123.3
  - @valbuild/shared@0.123.3
  - @valbuild/ui@0.123.3
  - @valbuild/mcp@0.123.3
  - @valbuild/react@0.123.3

## 0.123.2

### Patch Changes

- [#629](https://github.com/valbuild/val/pull/629) [`04b6d4c`](https://github.com/valbuild/val/commit/04b6d4cbbecc131bbaf3c20633af9dad8c857310) Thanks [@freekh](https://github.com/freekh)! - Stop shipping zod to every visitor of a Val site (~113 KB)

  `@valbuild/next`'s client code needed five things from
  `@valbuild/shared/internal`, three of which are string constants like
  `VAL_THEME_SESSION_STORAGE_KEY`. But preconstruct publishes each entrypoint as
  a single bundled module, so importing a string constant pulled in the whole
  entrypoint — including `ApiRoutes.ts` and its zod schemas. Measured on
  val.build, that was 113 KB of zod in the initial JS of every page, for
  visitors who never open the Studio.

  Two changes:

  - New `@valbuild/shared/client` entrypoint carrying the parts that are safe in
    a browser bundle: the session-storage keys, the canvas protocol, and the
    route-pattern helpers. Nothing reachable from it may import zod, and
    `noZodInClientEntrypoint.test.ts` walks the source graph to enforce that —
    one careless re-export would silently put the 113 KB back.
  - `ValNextProvider` now imports `createValClient` on first use rather than at
    module scope. It genuinely needs zod (it `safeParse`s every request and
    response), but its only caller is the draft-mode poll, which returns early
    unless the overlay is mounted. A visitor without the Val Enable cookie never
    triggers the import.

  No API change. `@valbuild/shared/internal` still exports everything it did.

- Updated dependencies [[`04b6d4c`](https://github.com/valbuild/val/commit/04b6d4cbbecc131bbaf3c20633af9dad8c857310), [`8e58c34`](https://github.com/valbuild/val/commit/8e58c3495d1bf0f221a57082cb0a3045929722a1), [`3e93508`](https://github.com/valbuild/val/commit/3e93508b05d08b0c24947a97c6141a9ad8a3931e)]:
  - @valbuild/shared@0.123.2
  - @valbuild/server@0.123.2
  - @valbuild/ui@0.123.2
  - @valbuild/language-server@0.123.2
  - @valbuild/mcp@0.123.2
  - @valbuild/react@0.123.2

## 0.123.1

### Patch Changes

- Updated dependencies [[`468f147`](https://github.com/valbuild/val/commit/468f147e62d1a96585890208921341959f118b6d)]:
  - @valbuild/mcp@0.123.1

## 0.123.0

### Minor Changes

- [#613](https://github.com/valbuild/val/pull/613) [`c5e7dfd`](https://github.com/valbuild/val/commit/c5e7dfd12aa1371195be642e1c2fb72b6f3e3ce2) Thanks [@freekh](https://github.com/freekh)! - Val's MCP endpoint moves to its own package, and can now upload images

  Everything that serves Val's content tools over MCP — the tool registry, the
  write path behind it, the request guards and the access-token verification —
  now lives in **`@valbuild/mcp`** instead of being split between
  `@valbuild/server` and `@valbuild/next`.

  **Nothing changes for an app that already mounts it.** `initValMcp` is still
  exported from `@valbuild/next/server` and behaves exactly as before; it is now a
  ten-line binding over `@valbuild/mcp`, supplying the Next version that
  `initHandlerOptions` asks for. A host that is not Next can call
  `initValMcp` from `@valbuild/mcp` directly.

  If you built your own host on `createValTools`, import it from `@valbuild/mcp`
  rather than `@valbuild/server`; the tool types moved with it.

  ## Image uploads

  An agent can now add an image, with a new `upload_image` tool. It takes a path
  to a file on the machine your app runs on, or the image inline as base64, and
  puts it in an `s.image()` field or an `s.images()` gallery.

  Uploads are converted **only where the Studio would convert them**: `encode` is
  off unless the schema asks for it (`s.image({ encode: { type: "webp" } })`), and
  when it does, which images are converted, how far they are scaled and when the
  original wins are the same decisions the browser makes — the same code, now
  shared. An upload to a schema without `encode` is stored exactly as it arrived,
  whatever its size.

  One thing the tool does that the Studio does not: it refuses an image the
  schema's `accept` does not cover, checked on the bytes that would actually be
  stored. The Studio does not need to — its file picker carries `accept` — and
  validation reports a mismatch as server-repairable, so nothing downstream would
  stop it. An agent has no picker. Note the ordering:
  `s.image({ accept: "image/webp", encode: { type: "webp" } })` still takes a PNG,
  because the conversion happens first and it is the result that is checked.

  It is the one tool you construct yourself, because it needs an image library
  and `sharp` ships a compiled binary per platform. Val does not put one in every
  project that installs it, so you decide:

  ```sh
  npm install sharp
  ```

  ```ts
  import sharp from "sharp";
  import { createValImageTools } from "@valbuild/mcp";
  import { sharpImageProcessor } from "@valbuild/mcp/sharp";

  const { valMcpAuthorize, valMcpTools } = initValMcp(valModules, config, {
    extraTools: createValImageTools(sharpImageProcessor(sharp)),
  });
  ```

  Leave `extraTools` out and everything else works as before — the agent can read,
  validate and edit content, it just cannot add an image. `sharp` is passed in
  rather than imported, so you can supply another encoder: `ValImageProcessor` is
  two functions, `read` and `encode`.

  Remotely stored images work too — `s.image().remote()` and
  `s.images({ remote: true })` — and they need nothing extra from the MCP client.
  Adding one does not upload anything to Val's content host: the bytes go into the
  patch store like any other unpublished change, and the push to
  `remote.val.build` happens when you publish, exactly as it does for an image
  added through the Studio. All the tool has to do first is ask the project which
  bucket to name in the ref, and the credential for that is the one your app
  already has — its API key when it has one, and in local development the
  `val login` token in your project, the same one `val validate --fix` uses. If
  you have not logged in, it says so and writes nothing.

  ## `npm create @valbuild` asks

  The starter template now ships the MCP endpoint, and `npm create @valbuild`
  asks whether you want it — and, if you do, whether agents should be able to
  upload images, saying that this adds `sharp`. Both default to yes, and both can
  be answered up front for a scripted setup:

  ```sh
  pnpm create @valbuild my-app --mcp --no-image-uploads
  ```

### Patch Changes

- Updated dependencies [[`c5e7dfd`](https://github.com/valbuild/val/commit/c5e7dfd12aa1371195be642e1c2fb72b6f3e3ce2), [`53f670c`](https://github.com/valbuild/val/commit/53f670c0cf2d7a03a6d068c78b7874ce77652c2a)]:
  - @valbuild/mcp@0.123.0
  - @valbuild/server@0.123.0
  - @valbuild/shared@0.123.0
  - @valbuild/ui@0.123.0
  - @valbuild/language-server@0.123.0
  - @valbuild/react@0.123.0

## 0.122.0

### Minor Changes

- [#597](https://github.com/valbuild/val/pull/597) [`5d14612`](https://github.com/valbuild/val/commit/5d14612f612d657a37338136188f2b3c02b28fe7) Thanks [@freekh](https://github.com/freekh)! - MCP: remove personal access token auth. The endpoint now needs an `oauth`
  config, or local filesystem mode.

  Until now, an MCP endpoint with no `oauth` config accepted whatever bearer token
  a caller presented and relayed it to the Val content backend unread. The
  reasoning was that without an issuer the app has no key to check a token
  against, so it should not pretend to be the authority on what that token may
  do — and that much was right. The shape was not: a credential the app cannot
  check is one it cannot refuse either, so "a deployed endpoint that authenticates
  nobody" was a supported configuration, and an app could serve content-rewriting
  tools without ever being told where its callers should authorize.

  **If you run Val in proxy mode**, MCP now requires the `oauth` config that
  shipped in `0.120.0`. Callers authorize as themselves against the Val
  authorization server, this app verifies the token's signature, issuer, audience
  and expiry itself, and patches carry the verified profile as their author:

  ```ts
  initValMcp(valModules, config, {
    oauth: {
      issuer: "https://admin.val.build",
      resource: "https://your-app.com/api/mcp",
    },
  });
  ```

  Leave it out and the endpoint answers `500` naming the missing config, rather
  than serving the request.

  **If you run Val in local filesystem mode**, nothing changes. Local development
  still needs no `oauth` config and no authorization server: there is no backend
  to authenticate to, and patches are written with no author. A token presented
  to such a project is still refused rather than ignored — the endpoint answers
  `400` and says to take the credential out of the client's configuration, since
  what it reached was a working tree with no permission check in front of it.

  Two API changes if you built your own host on `createValTools`:

  - `ValToolContext.auth` no longer has a `{ type: "pat", pat }` variant.
    `{ type: "verified-profile", profileId, scopes }` is the only credential the
    registry accepts, and `null` still means local filesystem mode.
  - `createValOps` no longer takes an `auth` argument. `ValOpsHttp` still accepts
    a personal access token directly — that is how `val debug` uses the token from
    `val login` — but no server request builds one.

  Proxy mode also stops keeping one data layer per credential. Each personal
  access token needed its own `ValOpsHttp` to hold it, each of those cached the
  project's evaluated modules, and the bounded cache that kept the memory in
  check turned an eviction into a re-evaluation of every module on the next call.
  Verified callers all share one instance, because they all reach the backend
  under the app's own API key.

### Patch Changes

- Updated dependencies [[`be32261`](https://github.com/valbuild/val/commit/be32261af19db8018bc37b180d903416018c0b79), [`5d14612`](https://github.com/valbuild/val/commit/5d14612f612d657a37338136188f2b3c02b28fe7), [`da6794f`](https://github.com/valbuild/val/commit/da6794f3dbd77d49ccfe780b359bab1689ee1b11), [`1c8b7fd`](https://github.com/valbuild/val/commit/1c8b7fda1e84cd8bd32a03a85d2789598b98c3fb)]:
  - @valbuild/server@0.122.0
  - @valbuild/shared@0.122.0
  - @valbuild/ui@0.122.0
  - @valbuild/language-server@0.122.0
  - @valbuild/react@0.122.0

## 0.121.0

### Minor Changes

- [#605](https://github.com/valbuild/val/pull/605) [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79) Thanks [@freekh](https://github.com/freekh)! - `s.settings()`: the project's settings, as content.

  A settings module is one per project, at the root of the content tree:

  ```typescript
  // settings.val.ts
  export default c.define("/settings.val.ts", s.settings(), {});
  ```

  Register it in `val.modules.ts` like any other module, and it shows up in the
  Studio under the cog at the foot of the left rail. Everything in it is content:
  it is edited as a draft, it appears in the publish diff, and it is the same for
  everyone working on the project.

  Every key is optional, at every level, so `{}` is a complete settings module —
  and stays one as sections are added. What it holds today is the assistant:

  ```typescript
  export default c.define("/settings.val.ts", s.settings(), {
    assistant: {
      enabled: true,
      context: "A CMS for developers, run by a team of four in Oslo.",
      tone: "Plain and direct. British English, sentence case in headings.",
    },
  });
  ```

  `context` is background the assistant would otherwise guess at; `tone` is how it
  should write when it writes content. Both are sent with every message it makes.

  `enabled` decides whether editors have an assistant, and it has **three** states
  rather than two:

  - `true` — they do.
  - `false` — they do not, and every trace of it goes: no button in the top bar,
    no row in the quick actions, no panel, nothing sent.
  - unset — nobody has decided. The assistant is still **shown**, and asks to be
    turned on before it is used. Hiding an assistant nobody has decided about
    means nobody discovers it; quietly enabling one means a project starts sending
    its content to a model because it did not know to say no.

  A project with no settings module at all has an assistant, as before: there is
  nowhere to record a decision, and nowhere for the prompt to write the answer.

  **Breaking: `ai.chat` is gone from `val.config.ts`.** Whether the assistant is
  available is a decision about the project's content, made by the people who edit
  it, so it moved to settings — turning the chat on used to take a developer, a
  deploy and a code review of a boolean. Remove the whole block:

  ```diff
   const { s, c, val, config } = initVal({
  -  ai: {
  -    chat: {
  -      experimental: { enable: true },
  -      suggestions: ["Summarize", "Fix typos at this page"],
  -      title: "Ask me anything",
  -      description: "Val can answer questions about the content.",
  -    },
  -  },
   });
  ```

  `experimental.enable` becomes `assistant.enabled` in the settings module.
  `suggestions`, `title` and `description` are removed with nothing replacing
  them: the assistant now opens with its own copy. A project that had the chat
  enabled and wants it to stay on for everyone should write
  `assistant: { enabled: true }` — otherwise editors are offered it and asked.

  `ai.commitMessages` stays in `val.config.ts`, and is unaffected.

  Two settings modules, or one in a subdirectory, is a module error: the dev
  server refuses to serve sources, `npx val validate` reports it against the file,
  and the Studio says so rather than picking one.

### Patch Changes

- [#607](https://github.com/valbuild/val/pull/607) [`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2) Thanks [@freekh](https://github.com/freekh)! - `.readonly()` and `.hidden()` now take the flag as an argument, so a schema can
  decide these from a variable instead of only from whether the call was written at
  all:

  ```ts
  s.string().readonly(!canEdit);
  s.image().hidden(hideMedia);
  ```

  The argument defaults to `true`, so `.readonly()` and `.readonly(true)` are the
  same thing and nothing about existing schemas changes. Passing `false` leaves the
  field editable or visible, which is also what a schema is without the call - it
  is there so the flag can come from a variable.

- Updated dependencies [[`105479b`](https://github.com/valbuild/val/commit/105479b84a08846f1fe5971916f6a54275198d12), [`55ec736`](https://github.com/valbuild/val/commit/55ec73651394908b6f440e360d181b95a91c0a93), [`2bcc6fd`](https://github.com/valbuild/val/commit/2bcc6fdff8d668123e07e3c5e81ac6fa1436e47b), [`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2), [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79), [`2db27d5`](https://github.com/valbuild/val/commit/2db27d555441bee2dd31817acc8c92b7b718ee55)]:
  - @valbuild/ui@0.121.0
  - @valbuild/shared@0.121.0
  - @valbuild/server@0.121.0
  - @valbuild/core@0.121.0
  - @valbuild/react@0.121.0
  - @valbuild/language-server@0.121.0

## 0.120.4

### Patch Changes

- Updated dependencies [[`6df3cae`](https://github.com/valbuild/val/commit/6df3caec1cc043a07b532d3174583b8218d4871d)]:
  - @valbuild/ui@0.120.4
  - @valbuild/react@0.120.4
  - @valbuild/server@0.120.4
  - @valbuild/language-server@0.120.4

## 0.120.3

### Patch Changes

- Updated dependencies [[`9b96184`](https://github.com/valbuild/val/commit/9b96184cf6ad6d52a714867fb1527eeec6c776f4), [`1a2484a`](https://github.com/valbuild/val/commit/1a2484a309679bd5e963d626466c2828f74d49f8), [`71becc7`](https://github.com/valbuild/val/commit/71becc7e543432e4a57e36d54aaf803e9a447ffd)]:
  - @valbuild/ui@0.120.3
  - @valbuild/react@0.120.3
  - @valbuild/server@0.120.3
  - @valbuild/language-server@0.120.3

## 0.120.2

### Patch Changes

- [#593](https://github.com/valbuild/val/pull/593) [`095ee0d`](https://github.com/valbuild/val/commit/095ee0dd011b069c30bc99ae58356e28796e106b) Thanks [@freekh](https://github.com/freekh)! - Publish the packages that 0.120.1 did not reach.

  `@valbuild/server@0.120.1` made it to npm, but `@valbuild/cli`,
  `@valbuild/language-server` and `@valbuild/next` did not — the release job
  failed part-way through, and the version numbers it had already claimed could
  not be reused. This release carries the same contents for those three packages:
  they pick up the MCP signing-key rotation fix from `@valbuild/server@0.120.1`,
  and there is nothing else in it.

  If you are on 0.120.0, upgrade straight to this version. There is no 0.120.1 of
  these three packages, and there will not be one.

- Updated dependencies [[`095ee0d`](https://github.com/valbuild/val/commit/095ee0dd011b069c30bc99ae58356e28796e106b)]:
  - @valbuild/language-server@0.120.2

## 0.120.1

### Patch Changes

- [#590](https://github.com/valbuild/val/pull/590) [`6f318d4`](https://github.com/valbuild/val/commit/6f318d406295b772e721bf463283f47e2822e996) Thanks [@freekh](https://github.com/freekh)! - MCP: survive a signing-key rotation, and say what a refused local token means.

  `@valbuild/next` caches the authorization server's JWKS for five minutes. Until
  now a token signed with a key that arrived inside that window was refused
  outright, so every warm instance rejected valid tokens until the cache expired —
  a rotation on the issuer's side showed up as an outage on yours.

  A token naming a key the cache does not hold now provokes one refetch of the key
  set, at most once per issuer every 30 seconds. The rate limit matters because the
  key id comes from the token: without it, unknown key ids would be a way to make
  your app call its issuer once per request. It limits how often a fetch is
  _started_, so requests that arrive while one is already running join it — which
  is the normal shape of a rotation, where many requests meet the new key at once.

  Separately, an MCP call that presents an access token to a project running in
  local filesystem mode is still refused — there is nothing to authenticate against
  — but the message now names the cause, which is that the project has an `oauth`
  issuer configured (often `VAL_OAUTH_ISSUER` in a local `.env`) and should not
  have one for local development.

- Updated dependencies [[`6f318d4`](https://github.com/valbuild/val/commit/6f318d406295b772e721bf463283f47e2822e996)]:
  - @valbuild/server@0.120.1
  - @valbuild/language-server@0.120.1

## 0.120.0

### Minor Changes

- [#589](https://github.com/valbuild/val/pull/589) [`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a) Thanks [@freekh](https://github.com/freekh)! - **Breaking:** `s.richtext()` options are flat.

  The `style`, `block` and `inline` groups are gone — every option is a key of its
  own. The names are unchanged, so updating a schema is only a matter of removing
  the wrappers:

  ```ts
  // before
  s.richtext({
    style: { bold: true, italic: true },
    block: { h1: true, ul: true },
    inline: { a: true, img: s.image() },
  });

  // after
  s.richtext({
    bold: true,
    italic: true,
    h1: true,
    ul: true,
    a: true,
    img: s.image(),
  });
  ```

  The groups never carried any meaning the option names did not already have, and
  they cost something real: an option name and its `ValRichText` theme key were
  spelled differently (`block.h1` vs `theme.h1`), so the type that keeps a theme
  exhaustive had to restate all thirteen options by hand. It is now a mapped type
  over the options themselves — which also fixes an inconsistency in it: enabling
  links with a schema (`a: s.route()`) rather than `a: true` now requires an `a`
  key in the theme, the way `img` always has.

  `ValRichText` themes were already flat and are unchanged. The serialized schema
  that the server sends the Studio is flat too, so a project must not mix
  `@valbuild/*` versions across this release.

### Patch Changes

- Updated dependencies [[`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a)]:
  - @valbuild/core@0.120.0
  - @valbuild/react@0.120.0
  - @valbuild/shared@0.120.0
  - @valbuild/ui@0.120.0
  - @valbuild/language-server@0.120.0
  - @valbuild/server@0.120.0

## 0.119.0

### Patch Changes

- Updated dependencies [[`84165f7`](https://github.com/valbuild/val/commit/84165f743eb5802da1e8079bbe98eafcb2cdcec8)]:
  - @valbuild/ui@0.119.0
  - @valbuild/react@0.119.0
  - @valbuild/server@0.119.0
  - @valbuild/language-server@0.119.0

## 0.118.0

### Patch Changes

- Updated dependencies [[`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95), [`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95), [`fe6a398`](https://github.com/valbuild/val/commit/fe6a3981691394e6f34d4d80ec17febd356a98cc)]:
  - @valbuild/ui@0.118.0
  - @valbuild/server@0.118.0
  - @valbuild/shared@0.118.0
  - @valbuild/react@0.118.0
  - @valbuild/language-server@0.118.0

## 0.117.1

### Patch Changes

- Updated dependencies [[`0ae7bac`](https://github.com/valbuild/val/commit/0ae7bac8a186460bc2b31f2ded89b00027bafb55)]:
  - @valbuild/ui@0.117.1
  - @valbuild/react@0.117.1
  - @valbuild/server@0.117.1
  - @valbuild/language-server@0.117.1

## 0.117.0

### Minor Changes

- [#582](https://github.com/valbuild/val/pull/582) [`fca3efa`](https://github.com/valbuild/val/commit/fca3efa389e2817401f55ea3dd184af7c611b807) Thanks [@freekh](https://github.com/freekh)! - Accept OAuth access tokens on the MCP endpoint, so editors can authorize as themselves

  `initValMcp` takes an optional `oauth` config. Give it the authorization server's
  URL and this endpoint's own URL, and every MCP call must then present an access
  token that Val's authorization server issued:

  ```ts
  const { valMcpAuthorize, valMcpTools, valMcpMetadata } = initValMcp(
    valModules,
    config,
    {
      oauth: {
        issuer: "https://admin.val.build",
        resource: "https://your-app.com/api/mcp",
      },
    },
  );
  ```

  The token is verified in your app — signature against the issuer's published
  keys, plus issuer, audience and expiry — so the caller's identity is checked
  rather than claimed. **Patches created over MCP now carry that profile as their
  author**, which is what makes an edit made from a phone show up in the review
  screen as somebody's rather than nobody's. Scopes are enforced too: a token
  without `val:write` cannot reach a tool that writes.

  Mount the discovery document so clients can find where to authorize:

  ```ts
  // app/.well-known/oauth-protected-resource/route.ts
  import { valMcpMetadata } from "../../../val/mcp";
  export const { GET, OPTIONS } = valMcpMetadata!;
  ```

  `valMcpMetadata` is `null` when no `oauth` config is given.

  **Nothing changes if you leave `oauth` out.** Local development still works with
  no authorization server, and an app already using a personal access token keeps
  working as before.

  One breaking change if you built your own host on `createValTools`:
  `ValToolContext.auth` is now a tagged union, so `{ pat }` becomes
  `{ type: "pat", pat }`. The new variant is
  `{ type: "verified-profile", profileId, scopes }`, for a host that verified a
  token itself.

### Patch Changes

- [#579](https://github.com/valbuild/val/pull/579) [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d) Thanks [@freekh](https://github.com/freekh)! - Every release now ships a changelog. Each package's `CHANGELOG.md` records what
  changed under the version that shipped it — with a link to the pull request, the
  commit and the author — and the same entry becomes the body of the GitHub
  Release for the tag. The file is included in the npm tarball, so it is also
  readable from an installed copy.

  Up to now those changelogs were generated empty, and the GitHub Releases with
  them, so there was no record of what any given version contained. Releases from
  this one on have one; earlier versions stay blank.

- Updated dependencies [[`fca3efa`](https://github.com/valbuild/val/commit/fca3efa389e2817401f55ea3dd184af7c611b807), [`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f), [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d)]:
  - @valbuild/server@0.117.0
  - @valbuild/language-server@0.117.0
  - @valbuild/core@0.117.0
  - @valbuild/react@0.117.0
  - @valbuild/shared@0.117.0
  - @valbuild/ui@0.117.0
