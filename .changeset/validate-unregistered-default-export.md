---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/cli": patch
---

Only warn about an unregistered `*.val.ts` that really is a Val module

`val validate` warned about every `*.val.ts` on disk that `val.modules` does not
register. But the suffix is used for more than Val modules — shared schemas and
other content-adjacent helpers wear it too — and those are never meant to be
registered, so a project with a handful of them got a wall of warnings with the
one that mattered buried in it:

```
✔ src/app/(main)/products/[sku]/page.val.ts  valid (1ms)
⚠ /src/components/atoms/linkButton.val.ts is not registered in val.modules - skipping
⚠ /src/components/base/variants.val.ts is not registered in val.modules - skipping
⚠ /src/components/sections/anySection.val.ts is not registered in val.modules - skipping
… four more
```

The default export is what separates the two. An unregistered file is now:

- **silent** when it has no default export — it is a helper, not a module;
- a **warning** when its default export is a Val module — someone meant to
  register it and forgot;
- an **error** when it has a default export that is _not_ a Val module (or that
  will not evaluate) — nothing can ever load that file under that name, so it is
  a mistake rather than something to skip quietly.

The default export is checked syntactically first and only evaluated if it is
there, so a helper file is never run just to find out it is a helper.

The fix for a file the last rule now flags is a NAMED export, not a rename: a
file that imports `s` or `c` is a `.val` file, and stays one. Only the default
export slot is reserved for a module.

Adds `Internal.isValModule` to `@valbuild/core` and
`createValModuleFileInspector` to `@valbuild/server`.
