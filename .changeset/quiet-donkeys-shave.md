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
- **It is not readable in code.** `useVal(pageVal).employees` is an opaque pointer with no fields on it. Read the module it names directly, as before.
- **`view` is now a reserved object key**, like `_type` and `patch_id`: `s.object({ view: ... })` no longer compiles. A single `view: string` key is what a view pointer looks like, and an ordinary object with that shape would be indistinguishable from one.
- **Views may not form a cycle.** `A → B → A`, and a module viewing itself, are reported as module errors by `val validate` and in the Studio.
- **A pointer that disagrees with its schema is repaired automatically.** It can only happen in hand-written JSON, and the schema is the authority, so `val validate --fix` and saving in the Studio both write the module the schema names.
