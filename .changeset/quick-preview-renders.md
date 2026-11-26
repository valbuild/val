---
"@valbuild/tanstack": patch
"@valbuild/shared": patch
---

A quick preview no longer fails every page check with React's hydration error (React error 418)

In code mode, a change is first shown as a quick preview: the page the last build's server rendered, run by the proposal's new code. That page used to be _hydrated_ by the new code, and since the new code's markup is not the old server's, React reported a hydration failure on every quick preview. The page check read it as the site's own error and asked the assistant to fix something that was never there.

A quick preview's page is now _rendered_ by the new code instead, so there is nothing to fail. Every other page, for every visitor, is hydrated exactly as before, and a real hydration bug is still reported.

Nothing changes in your project. Quick previews exist only on Val's hosting, where the platform starts React for your app, and does it with the new `hydrateValRoot` from `@valbuild/tanstack/entry-client`. It is exported for an app that starts React itself in a client entry of its own: use it where TanStack Start's entry calls `hydrateRoot`.

```tsx
// src/client.tsx
import { StrictMode, startTransition } from "react";
import { StartClient } from "@tanstack/react-start/client";
import { hydrateValRoot } from "@valbuild/tanstack/entry-client";

startTransition(() => {
  hydrateValRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
```
