# Validation warnings

> **Status: plan.** Nothing below is implemented yet.

Today every validation error is fatal: one of them turns the publish button into
`Fix 3` and there is no way to say "this is worth telling the editor about, but
it must not stop the release". This plan adds a second severity.

Target API — severity is the **last optional positional argument** of every
constraint method:

```ts
s.string().maxLength(12, "warn");
s.string().validate((src) => (src.includes("!") ? "No shouting" : false), "warn");
s.number().min(1, "warn");
s.richtext({}).maxLength(500, "warn");
s.date().from("2020-01-01", "warn");
s.route().include(/^\/blog\//, "warn");
```

A warning:

- does **not** block publish,
- renders in the amber palette while errors move to red,
- is counted by a new button beside Publish.

---

## Part A — the two facts that decide the shape

### A.1 The Studio validates against a **deserialized** schema

`SchemaValidator.validate` (`packages/ui/spa/validation/validateModule.ts`)
calls `deserializeSchema(serializedSchema)` and then `executeValidate` on the
result, on a worker thread. There is no second validation implementation
anywhere — which is good news for correctness and means severity **must survive
serialization**, or a `maxLength(12, "warn")` would be a hard error in the
Studio and a warning in the CLI.

Two mirrors have to move with the serialized type, and both fail *silently*:

- `packages/shared/src/internal/zod/SerializedSchema.ts` — the file's own
  comment says it: "these z.objects STRIP unknown keys". A severity field not
  declared there is dropped in transit from `/schema` and the Studio sees an
  error.
- `packages/shared/src/internal/ApiRoutes.ts:65` — the zod `ValidationError`.
  A `severity` not declared there is dropped on `/sources/~`, so server-produced
  warnings arrive as errors.

**While in that file, fix an adjacent bug.** `SerializedStringSchema` in the zod
mirror declares neither `customValidate` nor `description`, though the type has
both. Unless something else supplies them, `s.string().validate(…)` never runs
in the Studio (`hasCustomValidate` reads `schema.customValidate === true`) and
`s.string().describe(…)` never shows. Verify it with a parse test first; if
confirmed, it is a one-line fix and a test, and it belongs in this change
because the same field list is being edited.

### A.2 Severity must not enter `schema.options` for image/file

`getValidationBasis` (`packages/core/src/remote/validationBasis.ts`) hashes
`{ type, opt, options }` of an image/file schema into every remote ref's
validation hash. Anything added to `options` re-validates every remote file in
every project. `encode` is already deleted there for exactly this reason.

So severity is carried in a **separate top-level field** on the serialized
schema, not inside `options`:

```ts
export type SerializedStringSchema = {
  type: "string";
  options?: { maxLength?: number; minLength?: number; regexp?: {…} };
  /**
   * Constraints declared with a non-default severity. Absent entry = "error".
   * Deliberately NOT inside `options` — see `getValidationBasis`.
   */
  severity?: {
    maxLength?: ValidationSeverity;
    minLength?: ValidationSeverity;
    regexp?: ValidationSeverity;
  };
  …
};
```

Image and file schemas get no `severity` field at all (they have no value
constraints — see A.3), so the basis is untouched either way. The separate field
keeps it that way if one is ever added.

### A.3 Which methods take a severity

Severity applies to **value** constraints and custom validators only. It never
applies to a type assertion: `Expected 'string', got 'number'` cannot be a
warning, because publishing it ships content of the wrong shape.

| Schema     | Constraint methods                    |
| ---------- | ------------------------------------- |
| `string`   | `minLength`/`min`, `maxLength`/`max`, `regexp` |
| `number`   | `min`, `max`                          |
| `richtext` | `minLength`, `maxLength`              |
| `date`     | `from`, `to`                          |
| `datetime` | `from`, `to`                          |
| `route`    | `include`, `exclude`                  |

Plus `.validate(fn, severity?)` on all 17 classes that have it: `string`,
`number`, `boolean`, `literal`, `object`, `array`, `record`, `union`, `keyOf`,
`richtext`, `route`, `date`, `datetime`, `color`, `code`, `image`, `file`.
(`images`/`files` and `settings` declare no `validate`.)

Deliberately **not** severity-eligible:

- `s.color({ format })`, `s.code({ language })` — a value in the wrong format is
  a type-shaped error, not a preference.
- `s.image({ accept })` — a mismatch is already reported as
  `image:check-metadata`, which `partitionValidationErrors` treats as
  server-repairable and therefore already non-blocking.
- The factory options (`s.number({ min: 1 })`). Severity is expressed only
  through the chainable methods, which is the API the request named; a
  `{ min: 1, severity: { min: "warn" } }` argument would be a second way to say
  the same thing. Document that `s.number({ min: 1 })` is an error and
  `.min(1, "warn")` is the way to warn.

`regexp` already takes a message as its second argument, so severity is third:
`regexp(re, message?, severity?)`. **This is a trap worth a doc comment:**
`.regexp(re, "warn")` sets the *message* to `"warn"`. Consider an overload
taking `{ message?, severity? }`, but do not make it the only form.

---

## Part B — core

### B.1 The severity type and the error field

`packages/core/src/schema/validation/ValidationError.ts`:

```ts
export type ValidationSeverity = "error" | "warn";

export type ValidationError = {
  message: string;
  value?: unknown;
  typeError?: boolean;
  schemaError?: boolean;
  fixes?: ValidationFix[];
  keyError?: boolean;
  /**
   * Absent means "error". Only ever WRITTEN as "warn" — read it through
   * `severityOf`, never by comparing to a literal, so the default lives in one
   * place.
   */
  severity?: ValidationSeverity;
};

export function severityOf(error: ValidationError): ValidationSeverity {
  return error.severity ?? "error";
}
export function isWarning(error: ValidationError): boolean {
  return severityOf(error) === "warn";
}
```

Absent-means-error is what keeps this change tractable: every existing test,
snapshot and equality assertion across `packages/core`, `packages/server` and
`packages/cli` keeps passing untouched. Export `ValidationSeverity`,
`severityOf` and `isWarning` from `packages/core/src/index.ts`.

### B.2 Custom validators

The base class holds the execution loop
(`Schema.executeCustomValidateFunctions`) while each of the 17 subclasses holds
its own `private readonly customValidateFunctions`. Widen the element type in
the base rather than the subclasses:

```ts
export type CustomValidateEntry<Src extends SelectorSource> =
  | CustomValidateFunction<Src>
  | { validate: CustomValidateFunction<Src>; severity: ValidationSeverity };
```

`executeCustomValidateFunctions` accepts `CustomValidateEntry<Src>[]`,
normalizes each entry, and stamps `severity: "warn"` on the produced error when
the entry asked for it. Accepting a bare function keeps every existing
constructor call — including `deserializeSchema`'s `[]` — working, and keeps the
public constructors backwards compatible for anyone who calls them directly.

Then in each of the 17 classes, `validate` becomes:

```ts
validate(
  validationFunction: CustomValidateFunction<Src>,
  severity: ValidationSeverity = "error",
): StringSchema<Src> {
  return new StringSchema<Src>(
    this.options,
    this.opt,
    this.isRaw,
    this.customValidateFunctions.concat(
      severity === "error" ? validationFunction : { validate: validationFunction, severity },
    ),
    …
  );
}
```

Concatenating the bare function when severity is default keeps the stored shape
identical to today's in the common case.

**A validator that throws stays an error.** The `catch` branch in
`executeCustomValidateFunctions` produces `schemaError: true` — that is a bug in
the schema, not a soft finding about content, so it must not inherit the
entry's `"warn"`. Test this explicitly.

### B.3 Value constraints

Per schema, a parallel severity record beside the options record:

```ts
type StringOptions = { maxLength?: number; minLength?: number; regexp?: RegExp; regExpMessage?: string };
type StringSeverities = { maxLength?: ValidationSeverity; minLength?: ValidationSeverity; regexp?: ValidationSeverity };
```

`StringSchema` gains a `private readonly severities: StringSeverities = {}`
constructor parameter — **appended last**, so existing positional calls keep
working — and threads it through all ~12 builder methods (`describe`,
`nullable`, `readonly`, `hidden`, `raw`, `render`, `preview`, `multiline`, and
the constraint methods themselves). This is the mechanical bulk of the change.

`executeValidate` then stamps it:

```ts
if (this.options?.maxLength && src.length > this.options.maxLength) {
  errors.push({
    message: `Expected string to be at most ${this.options.maxLength} characters long, got ${src.length}`,
    value: src,
    ...(this.severities.maxLength === "warn" ? { severity: "warn" } : {}),
  });
}
```

Spread-when-warn rather than always writing the field, so an error's object
shape is byte-identical to today's and no existing `toEqual` breaks.

`executeSerialize` writes `severity: hasAny(this.severities) ? this.severities : undefined`.

Repeat for `number`, `richtext`, `date`, `datetime`, `route`.

### B.4 Deserialize

`packages/core/src/schema/deserialize.ts` reconstructs each schema from the
serialized form. Every case for a severity-carrying schema passes
`serialized.severity` into the new constructor slot. Miss one and that schema's
warnings become errors in the Studio only — the failure mode is silent, so a
**round-trip test is mandatory**: build a schema with each constraint at
`"warn"`, `executeSerialize`, parse through the zod mirror, `deserializeSchema`,
`executeValidate`, assert `severity: "warn"` survived. One test per severity-
carrying schema; the zod parse in the middle is what catches a missing mirror
field.

---

## Part C — what "blocking" means

`filterBlockingValidationErrors` (`packages/shared/src/internal/validation/blockingValidationErrors.ts`)
currently returns `partitionValidationErrors(resolved).surfaced` — its name says
blocking, but four of its six callers use it for **display**. Splitting severity
here is the whole point of the change, so split the names too:

- `filterSurfacedValidationErrors(errors, schemas, sources)` — resolve +
  partition, exactly today's behaviour. Everything a user should *see*.
- `partitionBySeverity(surfaced) → { errors, warnings }` — new, in
  `packages/shared/src/internal/validation/`.
- `filterBlockingValidationErrors(…)` — keeps its name and becomes honest:
  `partitionBySeverity(filterSurfacedValidationErrors(…)).errors`.

Then move each caller to the one it means:

| Caller | Use | Why |
| --- | --- | --- |
| `useValidationErrorsAtPath` (`stores/react/useValidationErrors.ts:224`) | surfaced | a field shows both, coloured by severity |
| `useAllValidationErrors` (`components/ValErrorProvider.tsx:122`) | surfaced | the shared map; consumers partition |
| `createSystem.publish` gate (`stores/createSystem.ts:2190`) | **blocking** | the gate this feature exists to change |
| `useAI.ts` ×4 (1187, 1414, 1555, 1917) | **blocking** | a warning must not make the assistant reject its own patch, for the same reason it does not stop a publish |
| `mcp/tools/writePath.ts:227` | **blocking** to refuse, surfaced to report | a warning must not refuse a write; it should still come back in the response |
| `mcp/tools/readTools.ts:238` | surfaced, with severity in the payload | it is a report |

`sameErrors` in `ValErrorProvider.tsx` compares by message only. Two errors
differing solely in severity would compare equal and the UI would keep the stale
colour — add severity to that comparison.

Note the counting convention already in place: the publish button counts
**paths**, not errors (`Object.keys(allValidationErrors).length`). Keep it, but a
path holding one warning and one error counts as blocking; a path holding only
warnings does not.

---

## Part D — UI

### D.1 Colours

`FieldErrorList.tsx` renders every message in the amber/warning palette today,
with a deliberate comment about it. That has to change, because amber is now
what a warning means:

- error rows → `error` tokens (`bg-bg-error-*`, `text-fg-error-*`,
  `border-border-error-*` — all already defined in `index.css`),
- warning rows → the existing `warning` tokens,
- the 2px left rail takes the **worst** severity present in the field's list,
- sort errors above warnings within a field.

Update the component's doc comment: its current text argues *for* amber-for-
everything, so leaving it would be a comment that lies.

### D.2 The publish button

`publishButtonState.ts` needs no new state — `validationErrorCount` simply stops
counting warnings. `PublishButton.tsx` feeds it
`partitionBySeverity(allValidationErrors).errors`. `publishButtonState.test.ts`
gains a case pinning that warnings alone leave the button `ready`.

### D.3 The warnings button

Requested: a button beside Publish showing the number of warnings.

`Shell` is presentational and takes a `publishSlot` (`Shell.tsx:260`); mirror it
with a `warningsSlot` rendered in `TopBar.tsx` between `ReviewButton` and the
publish slot, and give it a story alongside the existing shell stories. A new
`WarningsButton` component in `packages/ui/spa/components/`:

- amber, `TriangleAlert`, `N` with a `9+` cap — matching how `Fix 9+` is capped
  and why (button width is fixed; see the comment in `publishButtonState.ts`),
- **renders nothing when the count is 0** — unlike Publish, this button has no
  resting state to hold a slot for,
- clicking navigates to `VAL_ERRORS_ROUTE` with `errorFields` = the warning
  paths, the same as the blocked publish button does for errors,
- a `compact` variant for `MobileChrome` / `OverlayMenu`, where `PublishButton`
  already has one.

### D.4 The `/val/errors` page

`ValidationErrors.tsx` is driven by `errorFields` from the URL and does not care
where they came from, so it works unchanged — but it would call a warning an
error. Needed:

- per-row and per-module tone from severity,
- header pill: `N errors, M warnings` rather than `N fields`,
- `AllFixedBanner` says "Ready to publish", which is *true* with warnings
  outstanding but reads as though they were fixed. Word it for the case.

### D.5 Everything else reading `useAllValidationErrors`

Each of these needs a decision, not a mechanical edit — list them in the PR so
none is missed:

`useNavMenuData.ts:132` (`indexNavErrors` → the nav tree's badges; a
warning-only subtree should badge amber and must not inflate the error count —
this means severity has to reach `NavMenuData`), `ValShell.tsx:162`,
`useShellData.ts:49`, `SortableList.tsx:249`, `FieldValidationError.tsx:38`,
`fields/ModuleGallery.tsx:70`, `fields/RecordFields.tsx:53`,
`DraftChanges.tsx:82,312` (does a warning mark a change as problematic in
Review? Proposal: shown, amber, not blocking), `ValOverlay.tsx:1382`,
`hooks/useAIValidation.ts:19`.

---

## Part E — tooling

### E.1 CLI

`packages/cli/src/runValidation.ts` yields `validation-error` events and counts
them into a per-file `errorCount`; `validate.ts` prints the summary and sets the
exit code.

- add a `severity` to the `validation-error` event and a separate warning count,
- print warnings in a distinct section/colour,
- **exit 0 when only warnings remain.** This is the point of the feature: a
  warning that fails CI is an error with extra steps.
- add `--strict` to make warnings fail, for a project that wants the ratchet.

`runValidation` reaches warnings through the `!v.fixes || v.fixes.length === 0`
branch (a warning from `maxLength` or `validate` carries no fixes), so the
severity only has to be forwarded, not re-derived.

### E.2 Language server

`severityFor` in `packages/language-server/src/diagnostics.ts` already returns
`DiagnosticSeverity.Warning` for a fixable `val/validation`. Extend it to take
the error's severity and return `Warning` for `"warn"`. The severity has to be
carried on `ValDiagnosticData` to get there.

### E.3 MCP

`validate_content` and the write-path response should report severity so an
agent can tell "you must fix this" from "you might want to". See the table in
Part C for which filter each call site takes.

### E.4 Schema compatibility

`packages/shared/src/internal/schema/compatibility.ts` — check whether changing
a constraint's severity counts as a compatible schema change. It almost
certainly should (nothing about the *source* changes), but the file has explicit
opinions about constraints and should get an explicit one about this.

---

## Part F — order of work

Each step is independently reviewable and leaves the tree green.

1. **Core types** — `ValidationSeverity`, `severity` on `ValidationError`,
   `severityOf`/`isWarning`, exports. No behaviour change.
2. **Custom validators** — `CustomValidateEntry`, base-class normalization,
   `.validate(fn, severity?)` on all 17 classes. Tests per class.
3. **Value constraints** — `severities` on `string`, `number`, `richtext`,
   `date`, `datetime`, `route`; serialize; deserialize; the zod mirror (and the
   `customValidate`/`description` fix from A.1); round-trip tests.
4. **Transit** — `severity` on the zod `ValidationError` in `ApiRoutes.ts`.
5. **Blocking split** — `filterSurfacedValidationErrors`,
   `partitionBySeverity`, the honest `filterBlockingValidationErrors`, and every
   caller moved per the Part C table. Extend
   `blockingValidationErrors.test.ts` / `partitionValidationErrors.test.ts`; add
   a `publishGate.test.ts` case where a module with only warnings publishes.
6. **UI colours** — `FieldErrorList`, the `/val/errors` page.
7. **The warnings button** — `warningsSlot`, `WarningsButton`, the compact
   variant, stories, and the publish button's count.
8. **Fan-out** — the Part D.5 consumers, nav badges included.
9. **Tooling** — CLI, language server, MCP, compatibility.
10. **Changeset + docs.** The changeset summary is the release note (see
    `.claude/CLAUDE.md`): write it for users, with the three examples from the
    top of this file.

### Verification

`node_modules` is absent in this checkout, so nothing here has been run yet —
`pnpm install` first. Then the full CI set from `.claude/CLAUDE.md`:
`pnpm run lint`, `pnpm -w run format`, `pnpm run -r typecheck`, `pnpm test`,
`pnpm run build` (then `pnpm preconstruct dev`), and
`cd examples/next && pnpm run build`.

Plus, because this touches the CLI and the loader path nothing else exercises:

```bash
cd packages/cli && pnpm exec tsx src/cli.ts validate --root ../../examples/next
```

and one run through the packaged entry (`node bin.js validate --root …`). Add a
`.val.ts` in `examples/next` with a `warn` constraint on it so the Studio and
the CLI can both be looked at by hand — a warning that renders amber and leaves
Save pressable is the acceptance test this feature actually has.

---

## Open questions

1. **`regexp`'s third argument.** `regexp(re, message?, severity?)` is
   consistent but `.regexp(re, "warn")` silently means "message = warn". Add a
   `{ message?, severity? }` overload, or accept the trap with a doc comment?
2. **Errors going red.** Field errors are amber today, deliberately. Flipping
   them to red is the right way to distinguish the two, but it changes how every
   existing error looks. Confirm.
3. **One page or two.** Warnings reuse `/val/errors` with severity grouping in
   this plan. A separate `/val/warnings` route would be tidier per-button but
   duplicates the page.
4. **`val validate` exit code.** Proposal: warnings exit 0, `--strict` opts in.
5. **Warnings in Review.** Should a change carrying a warning be marked in
   `DraftChanges`? Proposal: yes, amber, non-blocking.
6. **Nullable and `opt`.** `s.string().maxLength(12, "warn").nullable()` — the
   severity survives, but is there a case for a constraint whose severity
   *differs* when the value is absent? Assume no.
