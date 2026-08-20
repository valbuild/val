---
"@valbuild/core": patch
"@valbuild/shared": patch
"@valbuild/react": patch
"@valbuild/next": patch
"@valbuild/server": patch
"@valbuild/ui": patch
---

Add `s.svg()` — a schema that stores an SVG as a JSON node tree instead of a binary file, so custom icons become real, diffable, type-checked content.

Colors are **variables**, not baked hexes. A schema declares the variables an icon may use, along with an example value that doubles as the CSS fallback and as the key used to auto-match literal colors on import:

```ts
s.svg({
  width: 24,
  height: 24,
  variables: {
    brand: "#0055ff",
    line: { value: "currentColor" },
    surface: { value: "#ffffff", match: ["#fff", "#fefefe"] },
  },
});
```

Drop an SVG onto the field in the editor and its literal colors are matched onto those variables automatically; anything that does not match is surfaced as a mapping step where the editor picks a variable per unmatched color. With the default `literals: "forbid"`, a raw color is both a validation error and a _compile_ error — attributes are a per-attribute mapped type, so `fill: "#f00"` does not typecheck. `literals: "allow"` or an explicit allowlist relaxes that. Geometry can be constrained too, via `width` / `height` / `aspectRatio`, validated against the viewBox.

`<ValSvg>` renders the tree as React elements — never `dangerouslySetInnerHTML` — and is exhaustively typed the same way `ValRichText`'s `theme` is: adding a variable to the schema breaks every call site until the mapping is supplied.

```tsx
<ValSvg
  src={icons.bell}
  size={32}
  vars={{ brand: "var(--brand-500)", line: "currentColor", surface: "#fff" }}
/>
```

Notes:

- **The allowlist in `@valbuild/core` is the security boundary.** `ValSvg` builds React elements, and React renders unknown attributes on host elements verbatim, so tags and attributes are checked against a strict per-tag allowlist of exact names. `script`, `foreignObject`, `style`, `image`, `a`, animation and filter elements, all `on*` handlers, and any non-local `href` are rejected. `id`s and their `url(#…)` references are prefixed per instance so multiple icons on a page cannot collide.
- **SVG sources are never stega encoded.** Every string in one (`d`, `viewBox`, `points`, `transform`) is machine parsed, and invisible characters would corrupt the icon, so `stegaEncode` returns the source untouched and attaches the path out of band for the visual editing overlay.
