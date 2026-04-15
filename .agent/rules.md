# Val Codebase Instructions

Instructions for AI assistants working with the Val content management system codebase.

## General rules

1. Never add @ts-expect-error unless explicitly being allowed to do so
2. Never use as any unless explicitly being allowed to do so
3. Ask if you need to use type assertions (`as Something`) - we try to avoid those

## Type System Architecture

### Core Type Hierarchy

Val has a dual type system: **Source** types define data shape, **Selector** types is the user facing types.

```
Source (data)          →  Selector (access)
─────────────────────────────────────────────
ImageSource            →  ImageSelector
FileSource<M>          →  FileSelector<M>
RemoteSource<M>        →  GenericSelector
RichTextSource<O>      →  RichTextSelector<O>
SourceObject           →  ObjectSelector<T>
SourceArray            →  ArraySelector<T>
string/number/boolean  →  StringSelector/NumberSelector/BooleanSelector
```

### Key Type Definitions

**Source** (`packages/core/src/source/index.ts`):

```typescript
export type Source =
  | SourcePrimitive // string | number | boolean | null
  | SourceObject // { [key: string]: Source }
  | SourceArray // readonly Source[]
  | RemoteSource
  | FileSource
  | ImageSource
  | RichTextSource<RichTextOptions>;
```

**SelectorSource** (`packages/core/src/selector/index.ts`):

```typescript
export type SelectorSource =
  | SourcePrimitive
  | undefined
  | readonly SelectorSource[]
  | { [key: string]: SelectorSource }
  | ImageSource
  | FileSource
  | RemoteSource
  | RichTextSource<AllRichTextOptions>
  | GenericSelector<Source>;
```

**GenericSelector** (`packages/core/src/selector/index.ts`):

```typescript
class GenericSelector<T extends Source> {
  [GetSource]: T; // The actual source value
  [GetSchema]: Schema<T> | undefined; // Schema for validation
  [Path]: SourcePath | undefined; // Path in the module tree
  [ValError]: Error | undefined; // Type errors
}
```

### CRITICAL: Adding New Source Types

When adding a new source type, it **MUST** be added to BOTH unions:

1. `Source` in `packages/core/src/source/index.ts`
2. `SelectorSource` in `packages/core/src/selector/index.ts`

Additionally: 3. Create selector type in `packages/core/src/selector/{name}.ts` 4. Add mapping in `Selector<T>` conditional type in `packages/core/src/selector/index.ts`

### FORBIDDEN: Type Intersection Hacks

**NEVER** use type intersections (`&`) to force a type to satisfy constraints:

```typescript
// ❌ WRONG - This is a hack that hides the real problem
export type RichTextSelector<O> = GenericSelector<RichTextSource<O> & Source>;

// ✅ CORRECT - Add missing types to SelectorSource union
export type SelectorSource =
  | ...existing types...
  | ImageSource  // Add missing type here
```

If you see `Type 'X' does not satisfy the constraint 'Source'`, the fix is almost always adding a type to `SelectorSource`, NOT using intersections.

## Schema System

### Schema-Source Relationship

Each Schema class validates and types its corresponding Source type:

| Schema              | Source              | Factory               |
| ------------------- | ------------------- | --------------------- |
| `ImageSchema<T>`    | `ImageSource`       | `s.image()`           |
| `FileSchema<T>`     | `FileSource`        | `s.file()`            |
| `RichTextSchema<O>` | `RichTextSource<O>` | `s.richtext(options)` |
| `ObjectSchema<T>`   | `SourceObject`      | `s.object({...})`     |
| `ArraySchema<T>`    | `SourceArray`       | `s.array(schema)`     |

## Module System

### c.define() Pattern

```typescript
c.define(
  "/content/page.val.ts",  // Module path
  s.object({...}),          // Schema
  { ... }                   // Source data matching schema
)
```

### Source Constructors

```typescript
c.image("/public/val/logo.png", {
  width: 100,
  height: 100,
  mimeType: "image/png",
});
c.file("/public/val/doc.pdf", { mimeType: "application/pdf" });
c.remote("https://...", { mimeType: "image/jpeg" });
```

## UI Architecture

### Shadow DOM Isolation

The Val UI runs inside a Shadow DOM for CSS/JS isolation from the host page:

```typescript
// packages/ui/spa/components/ShadowRoot.tsx
const root = node.attachShadow({ mode: "open" });
// ID: "val-shadow-root"
```

**Implications:**

- CSS must target `:host` (not `:root`) for shadow DOM styles
- External stylesheets must be loaded inside the shadow root
- `document.querySelector` won't find elements inside shadow DOM
- Use `shadowRoot.querySelector` or React refs instead

### CSS Architecture

```css
/* packages/ui/spa/index.css */
@layer base {
  :host,    /* Shadow DOM */
  :root {
    /* Regular DOM fallback */
    --background: ...;
    --foreground: ...;
  }
}
```

- Dark mode: `[data-mode="dark"]` selector
- CSS loaded via `/api/val/static/{VERSION}/spa/index.css`
- Event `val-css-loaded` dispatched when styles are ready

### Tailwind Configuration

```javascript
// packages/ui/tailwind.config.js
darkMode: ["class", '[data-mode="dark"]'];
```

Custom color tokens map to CSS variables (e.g., `bg-background` → `var(--background)`).

## Testing

Run tests from root dir with:

```bash
pnpm test                           # All tests
pnpm test packages/core/src/...     # Specific test file
pnpm run -r typecheck               # Type checking
pnpm lint
pnpm format
```

### Test rules

1. Never "fix" an issue by changing the test file
2. Prefer to define test data in a type-safe manner using `s` and `c` from `initVal`. Search for examples.

## Common Fixes

### "Type 'X' does not satisfy constraint 'Source'"

→ Add the type to `SelectorSource` union in `packages/core/src/selector/index.ts`

### "Property 'X' does not exist on type 'never'"

→ Check if all variants are handled in conditional types (especially in `ImageNode`, `RichTextSource`)
