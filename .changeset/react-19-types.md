---
"@valbuild/react": patch
"@valbuild/ui": patch
---

React 19 types: `React.JSX` instead of the global `JSX` namespace

@types/react 19 removed the global `JSX` namespace, so the four `JSX.Element`
annotations in `ValRichText`, the unpacked aliases in `jsx-namespace.d.ts` and
two `JSX.Element` return types in the Studio now name `React.JSX` (or import
`JSX` from `react`) instead. `React.RefObject<HTMLDivElement>` in
`ValPortalProvider` becomes `RefObject<HTMLDivElement | null>`, which is what
`useRef<HTMLDivElement>(null)` returns under the new types.

Type-level only — no runtime behaviour changes. The peer ranges are unchanged:
both packages still accept React 18, and only the type packages they build
against moved.
