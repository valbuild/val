---
"@valbuild/core": minor
"@valbuild/react": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/next": minor
"@valbuild/init": minor
"@valbuild/language-server": minor
---

**Breaking:** `s.richtext()` options are flat.

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
