---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/react": minor
"@valbuild/ui": minor
---

Add `s.view()`: point at another module, so editors can reach it from the page it belongs to.

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
