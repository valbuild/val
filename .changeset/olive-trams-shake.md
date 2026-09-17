---
"@valbuild/core": minor
"@valbuild/react": minor
"@valbuild/next": minor
"@valbuild/tanstack": minor
---

Read a view with `useVal` / `fetchVal`.

A `s.view()` field reads as a pointer with no properties on it. It can now be handed to a reader, which resolves it to the module it names:

```tsx
const page = useVal(pageVal);
const header = useVal(page.header); // the header module's content, typed
```

The point is single source of truth rather than a new capability: the page declares which module it shows, and a component follows that declaration instead of importing the target a second time. Change `s.view(headerVal)` to `s.view(navVal)` and the reader follows; an import would have kept reading the header.

Works in draft mode, including when the page itself has a pending edit. Two things to know:

- **Resolve a handle in the component that read the module containing it.** A handle carries the module it points at, and that cannot survive serialization — so one passed from a server component to a client component as a prop arrives empty. It throws with an explanation rather than handing back the pointer.
- **`View<Source>` is now a member of `SelectorSource`**, since a reader accepts one.
