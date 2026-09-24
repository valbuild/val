# @valbuild/react

## 0.136.6

### Patch Changes

- Updated dependencies [[`562713a`](https://github.com/valbuild/val/commit/562713a2e972e603abb43259f40ccfbf06990fe5)]:
  - @valbuild/ui@0.136.6

## 0.136.5

### Patch Changes

- Updated dependencies [[`28a71c3`](https://github.com/valbuild/val/commit/28a71c3beb40d15d628b99959c5161cee09d1871)]:
  - @valbuild/ui@0.136.5

## 0.136.4

### Patch Changes

- Updated dependencies [[`d19b1f6`](https://github.com/valbuild/val/commit/d19b1f67360b057e63536ac020f7109bd2496389)]:
  - @valbuild/ui@0.136.4

## 0.136.3

### Patch Changes

- Updated dependencies [[`38d24f7`](https://github.com/valbuild/val/commit/38d24f723639ee109d1007854507c4571bc82575), [`3b19534`](https://github.com/valbuild/val/commit/3b19534bb7aa16452a104906d9594083c3bc3e89), [`fa28164`](https://github.com/valbuild/val/commit/fa28164dfd1e05ff53eccf375334741d857fd2ef)]:
  - @valbuild/ui@0.136.3
  - @valbuild/shared@0.136.3

## 0.136.2

### Patch Changes

- Updated dependencies [[`f76cd56`](https://github.com/valbuild/val/commit/f76cd56b9f1c1bcc0a608a7a4de24b1e776adccb)]:
  - @valbuild/ui@0.136.2
  - @valbuild/shared@0.136.2

## 0.136.1

### Patch Changes

- Updated dependencies [[`cf89e74`](https://github.com/valbuild/val/commit/cf89e7429a79c4304ecbedd4f8b571a0de0f145f), [`c219574`](https://github.com/valbuild/val/commit/c21957498f3c7f4f47cef197c5dc0d591aa744ca), [`e673b43`](https://github.com/valbuild/val/commit/e673b43feaf48b7f30881d6786c858a0cb6a44a2), [`5c82928`](https://github.com/valbuild/val/commit/5c82928992d29f133f81cf0704a273c0449b18f1), [`d2f385a`](https://github.com/valbuild/val/commit/d2f385a04978992a5036379235e447ba7775faef)]:
  - @valbuild/ui@0.136.1
  - @valbuild/shared@0.136.1
  - @valbuild/core@0.136.1

## 0.136.0

### Patch Changes

- Updated dependencies [[`f3a4bb7`](https://github.com/valbuild/val/commit/f3a4bb7aea604943b92545c122243798c759715c)]:
  - @valbuild/ui@0.136.0
  - @valbuild/core@0.136.0
  - @valbuild/shared@0.136.0

## 0.134.1

### Patch Changes

- Updated dependencies [[`821e789`](https://github.com/valbuild/val/commit/821e789c1af47510af5d23eb96384ff78ddd7646)]:
  - @valbuild/shared@0.134.1
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

- [#680](https://github.com/valbuild/val/pull/680) [`eaa265e`](https://github.com/valbuild/val/commit/eaa265e78d9f6d2a1b685c38901612b8a3704eed) Thanks [@freekh](https://github.com/freekh)! - Add `s.view()`: point at another module, so editors can reach it from the page it belongs to.

  Content that has to live in its own module — a `keyOf` target, shared settings, a route-keyed record — is invisible from the page an editor thinks of it as part of. A view field puts a row on that page's screen that leads to it:

  ```ts
  import employeesVal from "../data/employees.val";

  const schema = s.object({
    title: s.string(),
    employees: s.view(employeesVal),
  });

  export default c.define("/app/menneskene/page.val.ts", schema, {
    title: "Våre folk",
    employees: { view: "/data/employees.val.ts" },
  });
  ```

  The source is a pointer and nothing else. The module it names keeps its own source, patches, validation and address, and an editor who follows the row lands on that module's own screen — so it is clear they are changing something other pages use too.

  A few things worth knowing:

  - **The path autocompletes, and a wrong one does not compile.** A module now carries its own id in its type, so the source type of the field above is the literal `{ view: "/data/employees.val.ts" }`.
  - **It is not readable in code.** `useVal(pageVal).employees` is a `ValView<…>` — an opaque pointer with no fields on it. Read the module it names directly, as before.
  - **`view` is now a reserved object key**, like `_type` and `patch_id`: `s.object({ view: ... })` no longer compiles. A single `view: string` key is what a view pointer looks like, and an ordinary object with that shape would be indistinguishable from one.
  - **Views may not form a cycle.** `A → B → A`, and a module viewing itself, are reported as module errors by `val validate` and in the Studio.
  - **A pointer that disagrees with its schema is repaired automatically.** It can only happen in hand-written JSON, and the schema is the authority, so `val validate --fix` and saving in the Studio both write the module the schema names.
  - **A view's `hidden` and `readonly` are its own, never the module's it points at.** A view whose target is hidden is still shown, and still leads there.

  That last one comes with a change to what `hidden()` means on a **module's own schema**, which is the other half of making a shared module usable:

  ```ts
  // Not in the nav, and on exactly one page.
  export default c.define("/data/employees.val.ts", s.record(...).hidden(), { ... });
  ```

  It now means the nav does not list the module — the Explorer for an ordinary module, Media for a gallery — and nothing more. Previously it also blanked the module's own page, so a module you had hidden was still in the nav and showed nothing when opened. A hidden module is now reached from an `s.view()` row, from search or from a validation error, and renders in full when you get there.

  One gap worth naming rather than leaving to be discovered: a view pointing at a
  module the project does not have is reported by the FIELD — the row says the
  target is missing — but not by `val validate`. The schema check compares the
  pointer against the schema, and the cycle check deliberately skips a target that
  is not a module of the project, so neither catches it. A project-level check
  belongs with them and is not here yet.

### Patch Changes

- Updated dependencies [[`1c31dcc`](https://github.com/valbuild/val/commit/1c31dcca7f1bb0199350567fd579de29f48bb26d), [`688b9e3`](https://github.com/valbuild/val/commit/688b9e36b821323cda6870cdff03dd36ec3e782f), [`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2), [`eaa265e`](https://github.com/valbuild/val/commit/eaa265e78d9f6d2a1b685c38901612b8a3704eed)]:
  - @valbuild/ui@0.134.0
  - @valbuild/core@0.134.0
  - @valbuild/shared@0.134.0

## 0.133.0

### Patch Changes

- Updated dependencies [[`2b9a51b`](https://github.com/valbuild/val/commit/2b9a51b7dbe2dff53b7686a4f3b7eb9bc5784fae), [`802412b`](https://github.com/valbuild/val/commit/802412b92c06bc1abbca78c86885e39c8710dd83)]:
  - @valbuild/ui@0.133.0
  - @valbuild/shared@0.133.0

## 0.132.1

### Patch Changes

- Updated dependencies [[`c9a5cd3`](https://github.com/valbuild/val/commit/c9a5cd3a4ab5908ecb9757b7a95db17a77e3b173), [`f413c5c`](https://github.com/valbuild/val/commit/f413c5cebca27ba82052825abc8c632b6177747e), [`1ddf245`](https://github.com/valbuild/val/commit/1ddf245ec73ad5af8099c3d18d4d33c6a1cc1254), [`a19997a`](https://github.com/valbuild/val/commit/a19997a542e65cc1375837b1bdb11c8af9e10160), [`76c5d41`](https://github.com/valbuild/val/commit/76c5d41c3afa7cc8180d156c9e19fb082af7fba4), [`cbfa2b8`](https://github.com/valbuild/val/commit/cbfa2b884898f1603bde8e5aa5cd9da78778101f), [`003419a`](https://github.com/valbuild/val/commit/003419ab72f3069d92e67dfea931d5accc63e730)]:
  - @valbuild/ui@0.132.1

## 0.130.0

### Patch Changes

- Updated dependencies [[`be1e8be`](https://github.com/valbuild/val/commit/be1e8bee673207596b3eb3d9a9886b8ade9b332f), [`8425378`](https://github.com/valbuild/val/commit/8425378c315ea46b5d822f1130b633e0449ff1b0), [`7d13dbc`](https://github.com/valbuild/val/commit/7d13dbced9ea49d8243b6b6cf9854cd1a259501f), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`07db94c`](https://github.com/valbuild/val/commit/07db94c23b73c8c0b2b50a30a89926823c2da1d6), [`473a185`](https://github.com/valbuild/val/commit/473a185f70351b44388f3bc1852649e2c1dbe001), [`64f0de3`](https://github.com/valbuild/val/commit/64f0de339b8621cb5a6c422dfe55cae5b2bbe2a0)]:
  - @valbuild/ui@0.130.0
  - @valbuild/core@0.130.0
  - @valbuild/shared@0.130.0

## 0.129.0

### Patch Changes

- Updated dependencies [[`e20f6fb`](https://github.com/valbuild/val/commit/e20f6fbcc215c310eef49a44c1a592c1e2081613), [`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b), [`0c351c4`](https://github.com/valbuild/val/commit/0c351c4f97ae7f09772eab0e856ae69821b803b7), [`41a0d76`](https://github.com/valbuild/val/commit/41a0d76636a2dce3f1e506d93170d97e46041d98), [`9e0ebb0`](https://github.com/valbuild/val/commit/9e0ebb00430f05ef92dff031309f73b8075a7d99)]:
  - @valbuild/ui@0.129.0
  - @valbuild/core@0.129.0
  - @valbuild/shared@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [[`8b52b33`](https://github.com/valbuild/val/commit/8b52b33e1f629f14f66cc71dcc7cf415d210c7d4), [`362fb49`](https://github.com/valbuild/val/commit/362fb49f30d2b04c4ff78d54dca2bf5ad978a05c), [`c595799`](https://github.com/valbuild/val/commit/c59579977a436ec530c6c69f2b340ab9829d97ab)]:
  - @valbuild/core@0.128.0
  - @valbuild/shared@0.128.0
  - @valbuild/ui@0.127.0

## 0.127.0

### Minor Changes

- [#608](https://github.com/valbuild/val/pull/608) [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63) Thanks [@freekh](https://github.com/freekh)! - `s.locale()`: one of the project's languages.

  The languages themselves are declared in the settings module (`locales.available`);
  this says that a value is one of them.

  ```typescript
  // a field: everything in this entry is in this language
  s.record(s.string(), s.object({ locale: s.locale(), title: s.string() }));

  // a key: one entry per language
  s.record(s.locale(), s.object({ title: s.string() }));
  ```

  Every locale in content is checked against the project's list, the way `keyOf`
  and `route` are checked against what they point at. An undeclared language names
  the ones the project has; a project that has declared none is told to declare
  them rather than told the value is wrong.

  A locale is stored as the tag itself — the value in content is `nb-NO`, and a
  record keyed by `s.locale()` has `nb-NO` as its key. Spelling one differently
  where it is stored (`/no/…` as a URL segment) is a real need and is deliberately
  not in this release: it changes what is accepted as well as what is shown, so it
  is being designed on its own rather than folded in here.

  A locale is **never stega encoded**: it ends up in `<html lang>`, in `hreflang`
  and in `Intl` constructors, none of which survive invisible characters.

  `assistant.translation` joins the settings module alongside `context` and `tone`
  — a note per language, keyed by language, so only the target language's rules are
  sent when translating into it.

### Patch Changes

- Updated dependencies [[`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65), [`600308d`](https://github.com/valbuild/val/commit/600308d0174990ad9f5c417147d160273489c65a), [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63), [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a), [`7072e07`](https://github.com/valbuild/val/commit/7072e07623c953a09ac14388ae22dada0b431ce3), [`29811c3`](https://github.com/valbuild/val/commit/29811c3f8c7e001a950e6f4833af6888e6a4efea), [`9983116`](https://github.com/valbuild/val/commit/99831164c5151aad7ca69de79e1d0d59878be251)]:
  - @valbuild/core@0.127.0
  - @valbuild/shared@0.127.0
  - @valbuild/ui@0.127.0

## 0.126.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`719ad6b`](https://github.com/valbuild/val/commit/719ad6b607bcf136d0dbde9e90bf4b8a843561a4), [`9830277`](https://github.com/valbuild/val/commit/9830277e9aaca8da3030f629c2656ec58da47e45), [`64bfd0a`](https://github.com/valbuild/val/commit/64bfd0a6c85832ea5169b53e47087f22e193df36), [`7782979`](https://github.com/valbuild/val/commit/7782979e9b52f2015a6e72dc981e630d4f8c78e2), [`5bfd630`](https://github.com/valbuild/val/commit/5bfd630b63dee2189e238f20fe72ecc5537160f7), [`ccbcda6`](https://github.com/valbuild/val/commit/ccbcda60b3e3c465071229ae1ba28ac735483e63), [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a), [`755e1a3`](https://github.com/valbuild/val/commit/755e1a3953775cb8d2c2dce87d6810d3dc329640), [`c6b1ec8`](https://github.com/valbuild/val/commit/c6b1ec84f1883750a4cfe5f70470b177621e971f), [`656f680`](https://github.com/valbuild/val/commit/656f680043c640f678625a64e690389ab23a0a69), [`610a041`](https://github.com/valbuild/val/commit/610a0414b120b521f38a2eb1182b3778bf778b2b), [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f)]:
  - @valbuild/ui@0.126.0
  - @valbuild/shared@0.126.0
  - @valbuild/core@0.126.0

## 0.125.0

### Patch Changes

- Updated dependencies [[`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90)]:
  - @valbuild/core@0.125.0
  - @valbuild/shared@0.125.0
  - @valbuild/ui@0.125.0

## 0.124.0

### Patch Changes

- Updated dependencies [[`5674237`](https://github.com/valbuild/val/commit/56742371a75b4fdcbff8b1afccff8fcc1ebf8078), [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055), [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055), [`aa89fc2`](https://github.com/valbuild/val/commit/aa89fc26de7028b3c5a1666b99afc03b39e92769)]:
  - @valbuild/ui@0.124.0
  - @valbuild/shared@0.124.0
  - @valbuild/core@0.124.0

## 0.123.3

### Patch Changes

- Updated dependencies [[`accf4f8`](https://github.com/valbuild/val/commit/accf4f852fe3400d762cc14e80316da741a69a9a), [`356eb11`](https://github.com/valbuild/val/commit/356eb11b5f6a0a02dfec80580c6fccac75d28402), [`aef45ce`](https://github.com/valbuild/val/commit/aef45ce3ef269f1b6221de44a56df0f6a0d9dbbd)]:
  - @valbuild/shared@0.123.3
  - @valbuild/ui@0.123.3

## 0.123.2

### Patch Changes

- Updated dependencies [[`04b6d4c`](https://github.com/valbuild/val/commit/04b6d4cbbecc131bbaf3c20633af9dad8c857310), [`3e93508`](https://github.com/valbuild/val/commit/3e93508b05d08b0c24947a97c6141a9ad8a3931e)]:
  - @valbuild/shared@0.123.2
  - @valbuild/ui@0.123.2

## 0.123.0

### Patch Changes

- Updated dependencies [[`c5e7dfd`](https://github.com/valbuild/val/commit/c5e7dfd12aa1371195be642e1c2fb72b6f3e3ce2), [`53f670c`](https://github.com/valbuild/val/commit/53f670c0cf2d7a03a6d068c78b7874ce77652c2a)]:
  - @valbuild/shared@0.123.0
  - @valbuild/ui@0.123.0

## 0.122.0

### Patch Changes

- Updated dependencies [[`be32261`](https://github.com/valbuild/val/commit/be32261af19db8018bc37b180d903416018c0b79), [`da6794f`](https://github.com/valbuild/val/commit/da6794f3dbd77d49ccfe780b359bab1689ee1b11), [`1c8b7fd`](https://github.com/valbuild/val/commit/1c8b7fda1e84cd8bd32a03a85d2789598b98c3fb)]:
  - @valbuild/shared@0.122.0
  - @valbuild/ui@0.122.0

## 0.121.0

### Patch Changes

- Updated dependencies [[`105479b`](https://github.com/valbuild/val/commit/105479b84a08846f1fe5971916f6a54275198d12), [`55ec736`](https://github.com/valbuild/val/commit/55ec73651394908b6f440e360d181b95a91c0a93), [`2bcc6fd`](https://github.com/valbuild/val/commit/2bcc6fdff8d668123e07e3c5e81ac6fa1436e47b), [`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2), [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79), [`2db27d5`](https://github.com/valbuild/val/commit/2db27d555441bee2dd31817acc8c92b7b718ee55)]:
  - @valbuild/ui@0.121.0
  - @valbuild/shared@0.121.0
  - @valbuild/core@0.121.0

## 0.120.4

### Patch Changes

- Updated dependencies [[`6df3cae`](https://github.com/valbuild/val/commit/6df3caec1cc043a07b532d3174583b8218d4871d)]:
  - @valbuild/ui@0.120.4

## 0.120.3

### Patch Changes

- Updated dependencies [[`9b96184`](https://github.com/valbuild/val/commit/9b96184cf6ad6d52a714867fb1527eeec6c776f4), [`1a2484a`](https://github.com/valbuild/val/commit/1a2484a309679bd5e963d626466c2828f74d49f8), [`71becc7`](https://github.com/valbuild/val/commit/71becc7e543432e4a57e36d54aaf803e9a447ffd)]:
  - @valbuild/ui@0.120.3

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
  - @valbuild/shared@0.120.0
  - @valbuild/ui@0.120.0

## 0.119.0

### Patch Changes

- Updated dependencies [[`84165f7`](https://github.com/valbuild/val/commit/84165f743eb5802da1e8079bbe98eafcb2cdcec8)]:
  - @valbuild/ui@0.119.0

## 0.118.0

### Patch Changes

- Updated dependencies [[`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95), [`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95), [`fe6a398`](https://github.com/valbuild/val/commit/fe6a3981691394e6f34d4d80ec17febd356a98cc)]:
  - @valbuild/ui@0.118.0
  - @valbuild/shared@0.118.0

## 0.117.1

### Patch Changes

- Updated dependencies [[`0ae7bac`](https://github.com/valbuild/val/commit/0ae7bac8a186460bc2b31f2ded89b00027bafb55)]:
  - @valbuild/ui@0.117.1

## 0.117.0

### Patch Changes

- [#579](https://github.com/valbuild/val/pull/579) [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d) Thanks [@freekh](https://github.com/freekh)! - Every release now ships a changelog. Each package's `CHANGELOG.md` records what
  changed under the version that shipped it — with a link to the pull request, the
  commit and the author — and the same entry becomes the body of the GitHub
  Release for the tag. The file is included in the npm tarball, so it is also
  readable from an installed copy.

  Up to now those changelogs were generated empty, and the GitHub Releases with
  them, so there was no record of what any given version contained. Releases from
  this one on have one; earlier versions stay blank.

- Updated dependencies [[`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f), [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d)]:
  - @valbuild/core@0.117.0
  - @valbuild/shared@0.117.0
  - @valbuild/ui@0.117.0
