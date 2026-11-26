import { StrictMode, startTransition } from "react";
import { StartClient } from "@tanstack/react-start/client";
import { hydrateValRoot } from "@valbuild/tanstack/entry-client";

/**
 * TanStack Start's own client entry, with `hydrateValRoot` for its
 * `hydrateRoot`: the same thing on every page a visitor opens, and a render
 * rather than a hydration in a quick preview of a proposal, whose markup the
 * last build's server rendered (see `hydrateValRoot`). On Val's hosting the
 * platform's own entry does this; here it is the app's, so the suite's quick
 * previews (`e2e/proposal/`) are taken over the way the platform's are.
 */
startTransition(() => {
  hydrateValRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
