---
"@valbuild/core": patch
"@valbuild/next": patch
---

`modules()` no longer implicitly registers `window.__VAL_MODULES__` as a side-effect. Register your client-side modules explicitly with the new `<ValModulesClient modules={valModules} />` component (or the `useRegisterValModules` hook) from `@valbuild/next`, rendered inside both `ValProvider` and `ValApp`. `ValApp` now accepts `children`.
