---
"@valbuild/react": minor
"@valbuild/ui": minor
---

**Breaking:** `@valbuild/react` and `@valbuild/ui` now require React 19

Their `peerDependencies` were `>=18.2.0 || ^19.0 || ^19.0.0-rc`, which was
already only half true: `@valbuild/next` has required `react >=19.0.0` for a
while, because `useValRoute` calls `React.use` to unwrap the params promise
Next 14.3+ hands a page. On React 18 that path logged an error and returned
`null`, so a route silently 404'd. The peer range now says what the code has
been doing.

```diff
- "react": ">=18.2.0 || ^19.0 || ^19.0.0-rc"
+ "react": ">=19.0.0"
```

A project on React 18 keeps working on the previous release; upgrading Val
means upgrading React first. There is no source change to make in your own
code beyond React 19's own migration - notably that `@types/react` 19 dropped
the global `JSX` namespace, so `JSX.Element` in your components becomes
`import type { JSX } from "react"`.
